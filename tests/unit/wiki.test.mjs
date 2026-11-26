import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  cp,
  mkdir,
  symlink,
  unlink,
} from 'node:fs/promises';
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
  prepareWikiNoteEdit,
  WikiNoteCandidates,
  KnowledgePublication,
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

test('reviewed note publication and monotonic rollback preserve facts and retain valid history', async () => {
  const f = await fixture();
  try {
    const { snapshot } = await model(f),
      path = join(f.store, 'knowledge.json');
    await writeFile(path, JSON.stringify(snapshot));
    const knowledge = new KnowledgeStore(f.repository, f.store, 'wiki-v2'),
      p = new KnowledgePublication(knowledge);
    const request = {
      articleId: 'overview',
      sectionId: 'behavior',
      blockId: 'reason',
      baseRevision: 1,
      baseSnapshot: fingerprint(JSON.stringify(snapshot)),
      body: '已审阅的新人工说明',
      reason: '澄清',
    };
    const candidate = await new WikiNoteCandidates(knowledge).save(request);
    const review = await p.previewWikiNote(candidate.candidateId);
    await assert.rejects(
      p.publishWikiNote(candidate.candidateId, 'wrong'),
      (e) => e.code === 'REVIEW_CHANGED',
    );
    const result = await p.publishWikiNote(candidate.candidateId, review.token);
    assert.equal(result.revision, 2);
    await unlink(join(f.store, 'history', result.transactionId, 'committed'));
    assert.equal(
      (await p.history()).find(
        (h) => h.record.transactionId === result.transactionId,
      ).state,
      'prepared',
    );
    await p.recover(result.transactionId, result.snapshotRevision);
    assert.deepEqual(
      (await knowledge.snapshot()).snapshot.cards,
      snapshot.cards,
    );
    const back = await p.previewWikiNote(result.transactionId, true);
    await p.publishWikiNote(result.transactionId, back.token, true);
    const current = (await knowledge.snapshot()).snapshot;
    assert.equal(current.articles[0].revision, 3);
    assert.equal(
      current.articles[0].sections[0].blocks[1].body,
      snapshot.articles[0].sections[0].blocks[1].body,
    );
    assert.deepEqual(current.cards, snapshot.cards);
    assert.equal(
      (await p.history()).filter((h) => h.state === 'committed').length,
      2,
    );
    await assert.rejects(
      p.publishWikiNote(candidate.candidateId, review.token),
    );
  } finally {
    await f.cleanup();
  }
});

test('note review rejects candidate mutation and changed source without publishing', async () => {
  const f = await fixture();
  try {
    const { snapshot } = await model(f),
      path = join(f.store, 'knowledge.json');
    await writeFile(path, JSON.stringify(snapshot));
    const knowledge = new KnowledgeStore(f.repository, f.store, 'wiki-v2'),
      p = new KnowledgePublication(knowledge);
    const request = {
      articleId: 'overview',
      sectionId: 'behavior',
      blockId: 'reason',
      baseRevision: 1,
      baseSnapshot: fingerprint(JSON.stringify(snapshot)),
      body: '第一版人工说明',
      reason: '澄清',
    };
    const saved = await new WikiNoteCandidates(knowledge).save(request),
      review = await p.previewWikiNote(saved.candidateId);
    const candidatePath = join(
      f.store,
      'wiki-note-candidates',
      saved.candidateId + '.json',
    );
    const record = JSON.parse(await readFile(candidatePath, 'utf8'));
    record.request.body = '审阅后修改的正文';
    await writeFile(candidatePath, JSON.stringify(record));
    await assert.rejects(
      p.publishWikiNote(saved.candidateId, review.token),
      (e) => e.code === 'REVIEW_CHANGED',
    );
    const fresh = await p.previewWikiNote(saved.candidateId);
    await writeFile(join(f.repository, 'src/读取.ts'), '// changed source\n');
    await assert.rejects(
      p.publishWikiNote(saved.candidateId, fresh.token),
      (e) => e.code === 'STALE_EVIDENCE',
    );
    assert.deepEqual((await knowledge.snapshot()).snapshot, snapshot);
    assert.equal((await p.history()).length, 0);
  } finally {
    await f.cleanup();
  }
});

test('durable human note candidates survive restart, bind stores, retain stale bases and never publish', async () => {
  const f = await fixture();
  try {
    const { snapshot } = await model(f);
    const path = join(f.store, 'knowledge.json');
    await writeFile(path, JSON.stringify(snapshot));
    const before = await readFile(path);
    const knowledge = new KnowledgeStore(f.repository, f.store, 'wiki-v2');
    const request = {
      articleId: 'overview',
      sectionId: 'behavior',
      blockId: 'reason',
      baseRevision: 1,
      baseSnapshot: fingerprint(JSON.stringify(snapshot)),
      body: '待审阅人工说明',
      reason: '澄清',
    };
    const saved = await new WikiNoteCandidates(knowledge).save(request);
    const restarted = new WikiNoteCandidates(knowledge);
    const read = await restarted.read(saved.candidateId);
    assert.equal(read.state, 'current');
    assert.equal(read.published, false);
    assert.equal(read.review.after.articles[0].revision, 2);
    assert.equal((await restarted.list()).length, 1);
    assert.deepEqual(await readFile(path), before);
    const other = join(f.directory, 'other-store');
    await cp(f.store, other, { recursive: true });
    await assert.rejects(
      new WikiNoteCandidates(
        new KnowledgeStore(f.repository, other, 'wiki-v2'),
      ).read(saved.candidateId),
      (e) => e.code === 'INVALID_WIKI_NOTE_CANDIDATE',
    );
    snapshot.articles[0].revision = 2;
    await writeFile(path, JSON.stringify(snapshot));
    assert.equal((await restarted.read(saved.candidateId)).state, 'changed');
    await assert.rejects(
      restarted.save(request),
      (e) => e.code === 'REVISION_CONFLICT',
    );
    await assert.rejects(restarted.read('../knowledge'));
    const candidatePath = join(
      f.store,
      'wiki-note-candidates',
      saved.candidateId + '.json',
    );
    const damaged = JSON.parse(await readFile(candidatePath, 'utf8'));
    damaged.request.author = 'human';
    await writeFile(candidatePath, JSON.stringify(damaged));
    await assert.rejects(restarted.read(saved.candidateId));
  } finally {
    await f.cleanup();
  }
});

test('note candidate staging refuses an escaping directory link before writing', async () => {
  const f = await fixture();
  try {
    const { snapshot } = await model(f);
    await writeFile(join(f.store, 'knowledge.json'), JSON.stringify(snapshot));
    const outside = join(f.directory, 'outside');
    await mkdir(outside);
    await symlink(
      outside,
      join(f.store, 'wiki-note-candidates'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(
      new WikiNoteCandidates(
        new KnowledgeStore(f.repository, f.store, 'wiki-v2'),
      ).list(),
      (e) => e.code === 'PATH_ESCAPE',
    );
  } finally {
    await f.cleanup();
  }
});

test('human note review preparation preserves shared facts and bindings and refuses stale or forged edits', async () => {
  const f = await fixture();
  try {
    const { snapshot } = await model(f);
    const original = structuredClone(snapshot);
    const request = {
      articleId: 'overview',
      sectionId: 'behavior',
      blockId: 'reason',
      baseRevision: 1,
      baseSnapshot: fingerprint(JSON.stringify(snapshot)),
      body: '人工补充：空字符串应保持。',
      reason: '澄清意图',
    };
    const result = prepareWikiNoteEdit(snapshot, request);
    assert.deepEqual(snapshot, original);
    assert.deepEqual(result.after.cards, original.cards);
    assert.equal(result.after.articles[0].revision, 2);
    assert.deepEqual(
      result.after.articles[0].sections[0].blocks[0],
      original.articles[0].sections[0].blocks[0],
    );
    assert.deepEqual(
      result.after.articles[0].sections[0].blocks[1].references,
      original.articles[0].sections[0].blocks[1].references,
    );
    assert.equal(result.published, false);
    for (const patch of [{ baseRevision: 2 }, { baseSnapshot: '0'.repeat(64) }])
      assert.throws(
        () => prepareWikiNoteEdit(snapshot, { ...request, ...patch }),
        (e) => e.code === 'REVISION_CONFLICT',
      );
    assert.throws(
      () => prepareWikiNoteEdit(snapshot, { ...request, blockId: 'read' }),
      (e) => e.code === 'WIKI_NOTE_NOT_EDITABLE',
    );
    assert.throws(() =>
      prepareWikiNoteEdit(snapshot, { ...request, author: 'human' }),
    );
    assert.throws(() =>
      prepareWikiNoteEdit(snapshot, { ...request, body: ' ' }),
    );
    assert.throws(
      () =>
        prepareWikiNoteEdit(snapshot, {
          ...request,
          body: original.articles[0].sections[0].blocks[1].body,
        }),
      (e) => e.code === 'WIKI_NOTE_UNCHANGED',
    );
    const modelNote = structuredClone(snapshot);
    modelNote.articles[0].sections[0].blocks[1].kind = 'inference';
    modelNote.articles[0].sections[0].blocks[1].author = 'model';
    assert.throws(
      () =>
        prepareWikiNoteEdit(modelNote, {
          ...request,
          baseSnapshot: fingerprint(JSON.stringify(modelNote)),
        }),
      (e) => e.code === 'WIKI_NOTE_NOT_EDITABLE',
    );
  } finally {
    await f.cleanup();
  }
});

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
