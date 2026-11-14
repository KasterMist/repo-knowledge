import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  mkdir,
  symlink,
  realpath,
} from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  WikiPreviewReader,
  KnowledgeStore,
  loadWikiPreviewText,
  bindWikiCard,
} from '../../packages/core/dist/index.js';
import { safeMarkdown } from '../../packages/vscode-extension/dist/safe-markdown.js';
import {
  wikiHtml,
  wikiMessage,
  wikiClient,
} from '../../packages/vscode-extension/dist/wiki-view.js';
import { fixture } from '../helpers.mjs';
async function setup(f) {
  const text = await readFile(join(f.repository, 'wiki-preview.json'), 'utf8');
  const knowledge = new KnowledgeStore(f.repository, f.store);
  return {
    text,
    knowledge,
    reader: await WikiPreviewReader.open(knowledge, text),
  };
}
test('Wiki reader uses canonical facts, live source checks and validated evidence without writing a snapshot', async () => {
  const f = await fixture();
  try {
    const { text, knowledge } = await setup(f),
      preview = JSON.parse(text);
    const before = await readFile(join(f.store, 'knowledge.json'));
    preview.cards.find((card) => card.id === 'read-fallback').body =
      'FAKE_PREVIEW_FACT';
    const reader = await WikiPreviewReader.open(
      knowledge,
      JSON.stringify(preview),
    );
    const view = await reader.read('overview');
    assert.equal(view.sourceFreshness, 'current');
    assert.equal(view.preview, true);
    assert.equal(JSON.stringify(view).includes('FAKE_PREVIEW_FACT'), false);
    assert.equal(view.sections[0].blocks[0].bindings[0].binding, 'matches');
    const entry = view.evidence[0];
    const location = await reader.evidence(
      'overview',
      entry.cardId,
      entry.index,
      view.snapshotRevision,
    );
    assert.equal(
      await realpath(location.path),
      await realpath(join(f.repository, 'src/读取.ts')),
    );
    await assert.rejects(
      reader.evidence('overview', 'cache-storage', 0, view.snapshotRevision),
      (e) => e.code === 'INVALID_EVIDENCE',
    );
    await writeFile(
      join(f.repository, 'src/读取.ts'),
      (await readFile(location.path, 'utf8')).replace('??', '||'),
    );
    assert.equal((await reader.read('overview')).sourceFreshness, 'stale');
    assert.equal(
      (
        await reader.evidence(
          'overview',
          entry.cardId,
          entry.index,
          view.snapshotRevision,
        )
      ).status,
      'changed',
    );
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), before);
    preview.repository.id = 'another-repository';
    await assert.rejects(
      WikiPreviewReader.open(knowledge, JSON.stringify(preview)),
      (e) => e.code === 'WIKI_REPOSITORY_MISMATCH',
    );
  } finally {
    await f.cleanup();
  }
});
test('changed/missing canonical card is not substituted and stale navigation cannot bypass revision/root guards', async () => {
  const f = await fixture();
  try {
    const { reader, knowledge, text } = await setup(f);
    const view = await reader.read('overview');
    const { snapshot } = await knowledge.snapshot();
    const card = snapshot.cards.find((card) => card.id === 'read-fallback');
    card.body = 'NEW_UNREVIEWED_BODY';
    card.revision++;
    await writeFile(join(f.store, 'knowledge.json'), JSON.stringify(snapshot));
    const updated = await reader.read('overview');
    assert.equal(updated.needsReview, true);
    assert.equal(updated.sourceFreshness, 'unavailable');
    assert.equal(Object.hasOwn(updated.sections[0].blocks[0], 'card'), false);
    await assert.rejects(
      reader.evidence('overview', card.id, 0, view.snapshotRevision),
      (e) => e.code === 'REVISION_CONFLICT',
    );
    const outside = join(f.directory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.ts'), 'private fixture');
    await symlink(
      outside,
      join(f.repository, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    card.evidence[0].path = 'escape/secret.ts';
    await writeFile(join(f.store, 'knowledge.json'), JSON.stringify(snapshot));
    const preview = JSON.parse(text);
    preview.articles[0].sections[0].blocks[0].reference = bindWikiCard(card);
    const escaped = await WikiPreviewReader.open(
      knowledge,
      JSON.stringify(preview),
    );
    const escapedView = await escaped.read('overview');
    assert.equal(escapedView.sourceFreshness, 'stale');
    await assert.rejects(
      escaped.evidence('overview', card.id, 0, escapedView.snapshotRevision),
      (e) => e.code === 'INVALID_EVIDENCE',
    );
    snapshot.cards = snapshot.cards.filter(
      (card) => card.id !== 'read-fallback',
    );
    await writeFile(join(f.store, 'knowledge.json'), JSON.stringify(snapshot));
    assert.equal(
      (await reader.read('overview')).sections[0].blocks[0].bindings[0].binding,
      'missing',
    );
  } finally {
    await f.cleanup();
  }
});
test('preview input is bounded and Markdown renders only safe formatting, never HTML/links/resources', async () => {
  const f = await fixture();
  try {
    const file = join(f.directory, 'oversized.json');
    await writeFile(file, 'x'.repeat(1024 * 1024 + 1));
    await assert.rejects(loadWikiPreviewText(file), (e) => e.code === 'LIMIT');
    const input =
      '# 标题\n\n**粗体** *斜体* `code`\n\n- 列表\n\n> 引用\n\n| A | B |\n|---|---|\n| x | y |\n\n```html\n<img src=x onerror=evil>\n```\n\n<script>evil()</script>\n\n[x](command:evil) ![image](https://example.invalid/x) <svg onload=evil></svg>';
    const html = safeMarkdown(input);
    for (const tag of [
      '<h1>',
      '<strong>',
      '<em>',
      '<code>',
      '<li>',
      '<blockquote>',
      '<table>',
    ])
      assert.ok(html.includes(tag), tag);
    assert.doesNotMatch(
      html,
      /<(?:script|img|svg|a|iframe|style)\b|<[^>]*\s(?:href|src)=/iu,
    );
    assert.match(html, /&lt;script&gt;/u);
    const { reader } = await setup(f);
    const view = await reader.read('overview');
    const page = wikiHtml(
      reader.catalog(),
      view,
      'repo<script>x</script>',
      'ssh-remote',
      'a'.repeat(32),
    );
    assert.match(page, /未发布文章预览/u);
    assert.match(page, /default-src 'none'/u);
    assert.ok(page.includes('repo&lt;script&gt;x&lt;/script&gt;'));
    assert.equal((page.match(/<script nonce=/gu) ?? []).length, 1);
    assert.throws(() => safeMarkdown('x'.repeat(16001)), /WIKI_RENDER_LIMIT/u);
  } finally {
    await f.cleanup();
  }
});
test('reader message bridge is strict and shipped browser script sends only article/evidence IDs without startup work', () => {
  for (const value of [
    null,
    [],
    { action: 'article', id: '../outside' },
    {
      action: 'evidence',
      cardId: 'read-fallback',
      index: -1,
      revision: 'a'.repeat(64),
    },
    { action: 'refresh', path: '/secret' },
    { action: 'command', command: 'evil' },
  ])
    assert.equal(wikiMessage(value), undefined);
  const handlers = {},
    sent = [];
  const article = {
    dataset: { article: 'overview' },
    addEventListener: (_type, fn) => {
      handlers.article = fn;
    },
  };
  const evidence = {
    dataset: { card: 'read-fallback', index: '0', revision: 'a'.repeat(64) },
    addEventListener: (_type, fn) => {
      handlers.evidence = fn;
    },
  };
  runInNewContext(wikiClient, {
    acquireVsCodeApi: () => ({
      postMessage: (message) => sent.push(JSON.parse(JSON.stringify(message))),
    }),
    document: {
      querySelectorAll: (selector) =>
        selector.includes('data-article') ? [article] : [evidence],
      getElementById: () => ({
        addEventListener: (_type, fn) => {
          handlers.refresh = fn;
        },
      }),
    },
  });
  assert.deepEqual(sent, []);
  handlers.article();
  handlers.evidence();
  handlers.refresh();
  assert.deepEqual(sent, [
    { action: 'article', id: 'overview' },
    {
      action: 'evidence',
      cardId: 'read-fallback',
      index: 0,
      revision: 'a'.repeat(64),
    },
    { action: 'refresh' },
  ]);
});

test('article read budget rejects excessive card/evidence fanout before any source reads', async () => {
  const f = await fixture();
  try {
    const { text, knowledge } = await setup(f);
    const original = (await knowledge.snapshot()).snapshot;
    let sourceReads = 0;
    knowledge.read = async () => {
      sourceReads++;
      throw new Error('must reject before source I/O');
    };
    for (const [count, evidenceCount] of [
      [33, 1],
      [27, 3],
    ]) {
      const cards = Array.from({ length: count }, (_, index) => ({
        ...original.cards[0],
        id: `card-${index}`,
        evidence: Array.from(
          { length: evidenceCount },
          () => original.cards[0].evidence[0],
        ),
      }));
      await writeFile(
        join(f.store, 'knowledge.json'),
        JSON.stringify({ ...original, cards }),
      );
      const preview = JSON.parse(text);
      preview.cards = cards;
      const blocks = cards.map((card, index) => ({
        id: `block-${index}`,
        type: 'card',
        reference: bindWikiCard(card),
      }));
      preview.articles = [
        {
          ...preview.articles[0],
          sections: [
            { id: 'first', title: 'First', blocks: blocks.slice(0, 20) },
            { id: 'second', title: 'Second', blocks: blocks.slice(20) },
          ],
        },
      ];
      const reader = await WikiPreviewReader.open(
        knowledge,
        JSON.stringify(preview),
      );
      await assert.rejects(
        reader.read('overview'),
        (error) => error.code === 'WIKI_READ_LIMIT',
      );
    }
    assert.equal(sourceReads, 0);
  } finally {
    await f.cleanup();
  }
});
