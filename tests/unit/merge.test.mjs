import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../helpers.mjs';
import {
  KnowledgeStore,
  KnowledgePublication,
  mergeCards,
  fingerprint,
} from '../../packages/core/dist/index.js';
const code = (expected) => (error) => error.code === expected;
async function setup(action) {
  const f = await fixture(),
    knowledge = new KnowledgeStore(f.repository, f.store),
    publication = new KnowledgePublication(knowledge);
  try {
    const read = await knowledge.read('read-fallback'),
      base = read.card;
    const propose = async (changes) => {
      const current = await knowledge.read(base.id);
      return knowledge.propose({
        id: base.id,
        baseRevision: current.card.revision,
        baseSnapshot: current.snapshotRevision,
        reason: 'Self-authored fixture',
        proposedCard: {
          ...current.card,
          revision: current.card.revision + 1,
          ...changes,
        },
      });
    };
    const publish = async (id) =>
      publication.publish(id, (await publication.previewProposal(id)).token);
    await action({ ...f, knowledge, publication, base, propose, publish });
  } finally {
    await f.cleanup();
  }
}

test('field merge preserves disjoint human changes, agrees on identical changes and keeps conflicts current', () =>
  setup(async (f) => {
    const base = f.base,
      current = { ...base, revision: 2, body: '人工设计理由' },
      proposed = { ...base, revision: 2, title: 'New title' };
    const clean = mergeCards(base, current, proposed);
    assert.equal(clean.merged.body, current.body);
    assert.equal(clean.merged.title, proposed.title);
    assert.equal(clean.merged.revision, 3);
    assert.deepEqual(clean.conflicts, []);
    const conflict = mergeCards(base, current, {
      ...proposed,
      body: 'Agent rewrite',
      tags: ['suggested'],
    });
    assert.deepEqual(conflict.conflicts, ['body']);
    assert.equal(conflict.merged.body, current.body);
    assert.deepEqual(conflict.merged.tags, ['suggested']);
    assert.deepEqual(
      mergeCards(base, current, { ...proposed, body: current.body }).conflicts,
      [],
    );
    assert.throws(
      () => mergeCards(base, current, { ...proposed, id: 'other' }),
      code('INVALID_MERGE_BASE'),
    );
    const arrays = mergeCards(
      base,
      { ...current, tags: ['human'] },
      { ...proposed, tags: ['agent'] },
    );
    assert.ok(arrays.conflicts.includes('tags'));
    assert.deepEqual(arrays.merged.tags, ['human']);
  }));

test('captured bases support stale disjoint suggestions through a new reviewed draft and monotonic rollback', () =>
  setup(async (f) => {
    const old = await f.propose({ title: 'Suggested title' }),
      oldPath = join(f.store, 'proposals', old.proposalId + '.json'),
      oldBytes = await readFile(oldPath);
    assert.deepEqual(JSON.parse(oldBytes).baseCard, f.base);
    const human = await f.propose({ body: '人工设计理由必须保留' });
    await f.publish(human.proposalId);
    await assert.rejects(
      f.publication.previewProposal(old.proposalId),
      code('REVISION_CONFLICT'),
    );
    assert.equal(
      (await f.publication.listCandidates()).find(
        (item) => item.id === old.proposalId,
      ).state,
      'needs-merge',
    );
    const report = await f.publication.previewMerge(old.proposalId),
      before = await readFile(join(f.store, 'knowledge.json'));
    assert.deepEqual(report.conflicts, []);
    const draft = await f.publication.createMergeDraft(
      old.proposalId,
      fingerprint(JSON.stringify(report)),
    );
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), before);
    const candidate = await f.publication.submitDraft(draft.draftId),
      published = await f.publish(candidate.proposalId);
    const result = await f.knowledge.read(f.base.id);
    assert.equal(result.card.body, '人工设计理由必须保留');
    assert.equal(result.card.title, 'Suggested title');
    assert.equal(result.card.revision, 3);
    assert.deepEqual(await readFile(oldPath), oldBytes);
    const rollback = await f.publication.previewRollback(
      published.transactionId,
    );
    await f.publication.rollback(published.transactionId, rollback.token);
    assert.equal(
      (await f.knowledge.read(f.base.id)).card.body,
      '人工设计理由必须保留',
    );
    assert.equal((await f.knowledge.read(f.base.id)).card.revision, 4);
  }));

test('body conflicts require explicit acknowledgement, retain three versions and reject removed merge metadata', () =>
  setup(async (f) => {
    const old = await f.propose({ body: 'Agent body' }),
      human = await f.propose({ body: 'Human body' });
    await f.publish(human.proposalId);
    const report = await f.publication.previewMerge(old.proposalId),
      draft = await f.publication.createMergeDraft(
        old.proposalId,
        fingerprint(JSON.stringify(report)),
      );
    assert.equal(report.base.body, f.base.body);
    assert.equal(report.current.body, 'Human body');
    assert.equal(report.proposed.body, 'Agent body');
    assert.deepEqual(report.conflicts, ['body']);
    const bytes = await readFile(join(f.store, 'knowledge.json'));
    await assert.rejects(
      f.publication.submitDraft(draft.draftId),
      code('MERGE_CONFLICTS_UNRESOLVED'),
    );
    const data = JSON.parse(await readFile(draft.path));
    const merge = data.merge;
    delete data.merge;
    await writeFile(draft.path, JSON.stringify(data));
    await assert.rejects(
      f.publication.submitDraft(draft.draftId),
      code('MERGE_CONFLICTS_UNRESOLVED'),
    );
    data.merge = { ...merge, resolvedFields: ['body'] };
    data.proposedCard.body = 'Human body\nReviewed agent explanation.';
    await writeFile(draft.path, JSON.stringify(data));
    const proposed = await f.publication.submitDraft(draft.draftId);
    assert.equal(proposed.state, 'pending-review');
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), bytes);
  }));

test('legacy and malformed captured bases are refused without guessing or rewriting', () =>
  setup(async (f) => {
    const old = await f.propose({ title: 'Suggested title' }),
      path = join(f.store, 'proposals', old.proposalId + '.json');
    const data = JSON.parse(await readFile(path));
    data.schemaVersion = 1;
    delete data.baseCard;
    await writeFile(path, JSON.stringify(data));
    await assert.rejects(
      f.publication.previewMerge(old.proposalId),
      code('MERGE_BASE_UNAVAILABLE'),
    );
    data.schemaVersion = 2;
    data.baseCard = { ...f.base, revision: 7 };
    await writeFile(path, JSON.stringify(data));
    await assert.rejects(
      f.publication.previewMerge(old.proposalId),
      code('INVALID_MERGE_BASE'),
    );
  }));

test('stale merge review/draft and changed candidate or source cannot create publishable resolutions', () =>
  setup(async (f) => {
    const old = await f.propose({ title: 'Suggested title' }),
      report = await f.publication.previewMerge(old.proposalId);
    const human = await f.propose({ body: 'New human rationale' });
    await f.publish(human.proposalId);
    await assert.rejects(
      f.publication.createMergeDraft(
        old.proposalId,
        fingerprint(JSON.stringify(report)),
      ),
      code('MERGE_REVIEW_CHANGED'),
    );
    const fresh = await f.publication.previewMerge(old.proposalId),
      draft = await f.publication.createMergeDraft(
        old.proposalId,
        fingerprint(JSON.stringify(fresh)),
      );
    const later = await f.propose({ tags: ['later'] });
    await f.publish(later.proposalId);
    await assert.rejects(
      f.publication.submitDraft(draft.draftId),
      code('REVISION_CONFLICT'),
    );
    const next = await f.publication.previewMerge(old.proposalId),
      sourceDraft = await f.publication.createMergeDraft(
        old.proposalId,
        fingerprint(JSON.stringify(next)),
      );
    await writeFile(join(f.repository, 'src/读取.ts'), '// changed evidence\n');
    await assert.rejects(
      f.publication.submitDraft(sourceDraft.draftId),
      code('STALE_EVIDENCE'),
    );
  }));
