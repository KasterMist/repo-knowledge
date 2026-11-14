import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bindWikiCard,
  wikiSnapshotSchema,
  parseWikiSnapshot,
  prepareWikiUpgrade,
  prepareWikiDowngrade,
  resolveWikiArticle,
  KnowledgeStore,
  fingerprint,
} from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';

const article = (reference) => ({
  id: 'overview',
  revision: 1,
  title: '项目概述',
  kind: 'overview',
  language: 'zh-CN',
  parentId: null,
  order: 0,
  sections: [
    {
      id: 'behavior',
      title: '读取行为',
      blocks: [
        { id: 'read', type: 'card', reference },
        {
          id: 'reason',
          type: 'note',
          kind: 'rationale',
          author: 'human',
          body: '空字符串是有效缓存值。作者记录，不是源码证明。',
          references: [reference],
        },
      ],
    },
  ],
});
async function model(f) {
  const text = await readFile(join(f.store, 'knowledge.json'), 'utf8');
  const snapshot = parseWikiSnapshot(prepareWikiUpgrade(text).targetText);
  snapshot.articles.push(
    article(
      bindWikiCard(snapshot.cards.find((card) => card.id === 'read-fallback')),
    ),
  );
  return { snapshot, text };
}

test('Wiki upgrade/downgrade previews preserve v1 knowledge, hashes and filesystem bytes without enabling v2 runtime', async () => {
  const f = await fixture();
  try {
    const path = join(f.store, 'knowledge.json');
    const original = await readFile(path, 'utf8');
    const first = prepareWikiUpgrade(original);
    assert.deepEqual(prepareWikiUpgrade(original), first);
    assert.equal(first.baseRevision, fingerprint(original));
    assert.equal(first.targetRevision, fingerprint(first.targetText));
    assert.equal(first.requiresReview, true);
    const upgraded = parseWikiSnapshot(first.targetText);
    assert.deepEqual(upgraded.cards, JSON.parse(original).cards);
    assert.deepEqual(upgraded.articles, []);
    const down = prepareWikiDowngrade(first.targetText);
    assert.deepEqual(JSON.parse(down.targetText), JSON.parse(original));
    const whitespace = JSON.parse(original);
    whitespace.cards[0].body = '  人工正文\n';
    assert.throws(
      () => prepareWikiUpgrade(JSON.stringify(whitespace)),
      (e) => e.code === 'WIKI_MIGRATION_NORMALIZES_CONTENT',
    );
    const whitespaceV2 = structuredClone(upgraded);
    whitespaceV2.cards[0].body = '  人工正文\n';
    assert.throws(
      () => prepareWikiDowngrade(JSON.stringify(whitespaceV2)),
      (e) => e.code === 'WIKI_MIGRATION_NORMALIZES_CONTENT',
    );
    assert.equal(await readFile(path, 'utf8'), original);
    assert.throws(
      () => prepareWikiUpgrade(first.targetText),
      (e) => e.code === 'WIKI_UPGRADE_REQUIRES_V1',
    );
    // An old runtime must refuse v2, rather than silently dropping article fields.
    await writeFile(path, first.targetText);
    await assert.rejects(
      new KnowledgeStore(f.repository, f.store).snapshot(),
      (e) => e.code === 'INVALID_SNAPSHOT',
    );
    await writeFile(path, original);
    assert.equal(
      (await new KnowledgeStore(f.repository, f.store).snapshot()).snapshot
        .cards.length,
      3,
    );
  } finally {
    await f.cleanup();
  }
});

test('article facts resolve the canonical card; changed revision/content or missing card never substitutes a new body', async () => {
  const f = await fixture();
  try {
    const { snapshot } = await model(f);
    const resolved = resolveWikiArticle(snapshot, 'overview');
    assert.equal(resolved.needsReview, false);
    assert.equal(resolved.sourceFreshness, 'unchecked');
    assert.equal(resolved.sections[0].blocks[0].card.id, 'read-fallback');
    assert.equal(resolved.sections[0].blocks[0].bindings[0].binding, 'matches');
    const changed = structuredClone(snapshot);
    changed.cards.find((card) => card.id === 'read-fallback').body +=
      ' 后续人工修改。';
    const stale = resolveWikiArticle(changed, 'overview');
    assert.equal(stale.needsReview, true);
    assert.equal(stale.sections[0].blocks[0].bindings[0].binding, 'changed');
    assert.equal(Object.hasOwn(stale.sections[0].blocks[0], 'card'), false);
    changed.cards.find((card) => card.id === 'read-fallback').revision++;
    assert.equal(resolveWikiArticle(changed, 'overview').needsReview, true);
    changed.cards = changed.cards.filter((card) => card.id !== 'read-fallback');
    assert.equal(
      resolveWikiArticle(changed, 'overview').sections[0].blocks[0].bindings[0]
        .binding,
      'missing',
    );
    assert.throws(
      () => resolveWikiArticle(snapshot, 'unknown'),
      (e) => e.code === 'WIKI_ARTICLE_MISSING',
    );
    assert.throws(
      () => prepareWikiDowngrade(JSON.stringify(snapshot)),
      (e) => e.code === 'WIKI_DOWNGRADE_WOULD_LOSE_ARTICLES',
    );
  } finally {
    await f.cleanup();
  }
});

test('Wiki hierarchy refuses duplicate IDs/orders, orphan parents, cycles, excessive depth and duplicate anchors', async () => {
  const f = await fixture();
  try {
    const { snapshot } = await model(f);
    for (const mutate of [
      (s) => s.articles.push(structuredClone(s.articles[0])),
      (s) =>
        s.articles.push({ ...structuredClone(s.articles[0]), id: 'other' }),
      (s) => {
        s.articles[0].parentId = 'missing';
      },
      (s) => {
        s.articles[0].parentId = 'overview';
      },
      (s) => {
        s.articles.push({
          ...structuredClone(s.articles[0]),
          id: 'child',
          parentId: 'overview',
        });
        s.articles[0].parentId = 'child';
      },
      (s) =>
        s.articles[0].sections.push(structuredClone(s.articles[0].sections[0])),
      (s) =>
        s.articles[0].sections[0].blocks.push(
          structuredClone(s.articles[0].sections[0].blocks[0]),
        ),
      (s) => s.cards.push(structuredClone(s.cards[0])),
    ]) {
      const changed = structuredClone(snapshot);
      mutate(changed);
      assert.equal(wikiSnapshotSchema.safeParse(changed).success, false);
    }
    for (let index = 1; index < 8; index++)
      snapshot.articles.push({
        ...structuredClone(snapshot.articles[0]),
        id: `node-${index}`,
        parentId: index === 1 ? 'overview' : `node-${index - 1}`,
      });
    assert.equal(wikiSnapshotSchema.safeParse(snapshot).success, true);
    snapshot.articles.push({
      ...structuredClone(snapshot.articles[0]),
      id: 'too-deep',
      parentId: 'node-7',
    });
    assert.equal(wikiSnapshotSchema.safeParse(snapshot).success, false);
  } finally {
    await f.cleanup();
  }
});

test('notes have explicit epistemic labels and model rationale is refused; Markdown remains unexecuted data', async () => {
  const f = await fixture();
  try {
    const { snapshot } = await model(f);
    const note = snapshot.articles[0].sections[0].blocks[1];
    note.author = 'model';
    assert.equal(wikiSnapshotSchema.safeParse(snapshot).success, false);
    note.kind = 'inference';
    note.body = '    <script>alert(1)</script> [unsafe](command:evil)\n';
    assert.equal(
      resolveWikiArticle(snapshot, 'overview').sections[0].blocks[1].body,
      note.body,
    );
    note.kind = 'fact';
    assert.equal(wikiSnapshotSchema.safeParse(snapshot).success, false);
  } finally {
    await f.cleanup();
  }
});

test('prepared Wiki format rejects unknown fields/versions, unsafe identifiers and UTF-8 byte excess', async () => {
  const f = await fixture();
  try {
    const { snapshot } = await model(f);
    for (const mutate of [
      (s) => {
        s.schemaVersion = 3;
      },
      (s) => {
        s.extra = true;
      },
      (s) => {
        s.articles[0].id = '../outside';
      },
      (s) => {
        s.articles[0].sections[0].blocks[0].reference.sha256 = 'x';
      },
    ]) {
      const changed = structuredClone(snapshot);
      mutate(changed);
      assert.throws(
        () => parseWikiSnapshot(JSON.stringify(changed)),
        (e) => e.code === 'INVALID_WIKI_SNAPSHOT',
      );
    }
    assert.throws(
      () => parseWikiSnapshot('{'),
      (e) => e.code === 'INVALID_WIKI_JSON',
    );
    assert.throws(
      () => parseWikiSnapshot('中'.repeat(400000)),
      (e) => e.code === 'WIKI_TOO_LARGE',
    );
    const note = snapshot.articles[0].sections[0].blocks[1];
    snapshot.articles = Array.from({ length: 10 }, (_, index) => ({
      ...article(bindWikiCard(snapshot.cards[0])),
      id: `article-${index}`,
      order: index,
      sections: [
        {
          id: 'large',
          title: '较大内容',
          blocks: Array.from({ length: 8 }, (_, index) => ({
            ...note,
            id: `note-${index}`,
            body: '中'.repeat(8000),
          })),
        },
      ],
    }));
    assert.equal(wikiSnapshotSchema.safeParse(snapshot).success, false);
  } finally {
    await f.cleanup();
  }
});
