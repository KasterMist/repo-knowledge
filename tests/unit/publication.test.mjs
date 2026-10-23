import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KnowledgeStore,
  KnowledgePublication,
} from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';

const code = (expected) => (error) => error.code === expected;
async function setup(action) {
  const f = await fixture();
  const knowledge = new KnowledgeStore(f.repository, f.store);
  const publication = new KnowledgePublication(knowledge);
  const path = join(f.store, 'knowledge.json');
  const candidate = async (body = '缓存中保存的空字符串会原样返回。') => {
    const read = await knowledge.read('read-fallback');
    return knowledge.propose({
      id: read.card.id,
      baseRevision: read.card.revision,
      baseSnapshot: read.snapshotRevision,
      reason: '人工澄清',
      proposedCard: { ...read.card, revision: read.card.revision + 1, body },
    });
  };
  try {
    await action({ ...f, knowledge, publication, path, candidate });
  } finally {
    await f.cleanup();
  }
}

test('durable draft, reviewed publication and monotonic rollback preserve canonical and original bytes', () =>
  setup(async (f) => {
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from((await readFile(f.path, 'utf8')).replaceAll('\n', '\r\n')),
    ]);
    await writeFile(f.path, original);
    const old = await f.knowledge.read('read-fallback');
    const draft = await f.publication.createDraft('read-fallback');
    const edited = JSON.parse(await readFile(draft.path, 'utf8'));
    edited.proposedCard.body = '人工保留：缓存中的空字符串会原样返回。';
    await writeFile(draft.path, JSON.stringify(edited));
    const pending = await f.publication.submitDraft(draft.draftId);
    assert.deepEqual(await readFile(f.path), original);
    assert.equal((await f.publication.listCandidates('drafts')).length, 1);
    const review = await f.publication.previewProposal(pending.proposalId);
    assert.equal(review.before.revision, 1);
    assert.equal(review.after.revision, 2);
    const result = await f.publication.publish(
      pending.proposalId,
      review.token,
    );
    assert.equal(
      (await f.knowledge.read('read-fallback')).card.body,
      edited.proposedCard.body,
    );
    assert.equal((await f.publication.listCandidates()).length, 0);
    assert.deepEqual(
      await readFile(
        join(f.store, 'history', result.transactionId, 'before.json'),
      ),
      original,
    );
    assert.equal((await f.publication.history())[0].state, 'committed');
    const rollback = await f.publication.previewRollback(result.transactionId);
    assert.equal(rollback.after.revision, 3);
    await f.publication.rollback(result.transactionId, rollback.token);
    const restored = await f.knowledge.read('read-fallback');
    assert.equal(restored.card.body, old.card.body);
    assert.equal(restored.card.revision, 3);
    assert.equal(restored.stale, false);
    assert.notEqual(restored.snapshotRevision, old.snapshotRevision);
    assert.equal((await f.publication.history()).length, 2);
    await assert.rejects(
      f.publication.previewRollback(result.transactionId),
      code('REVISION_CONFLICT'),
    );
  }));

test('changed review, stale evidence, another writer and changed canonical fail without publication', () =>
  setup(async (f) => {
    const pending = await f.candidate();
    const review = await f.publication.previewProposal(pending.proposalId);
    const candidatePath = join(
      f.store,
      'proposals',
      pending.proposalId + '.json',
    );
    const bytes = await readFile(candidatePath);
    const changed = JSON.parse(bytes);
    changed.reason += ' changed';
    await writeFile(candidatePath, JSON.stringify(changed));
    await assert.rejects(
      f.publication.publish(pending.proposalId, review.token),
      code('REVIEW_CHANGED'),
    );
    await writeFile(candidatePath, bytes);
    const sourcePath = join(f.repository, 'src/读取.ts');
    const source = await readFile(sourcePath);
    await writeFile(sourcePath, source.toString().replace('??', '||'));
    await assert.rejects(
      f.publication.publish(pending.proposalId, review.token),
      code('STALE_EVIDENCE'),
    );
    await writeFile(sourcePath, source);
    const lock = join(f.store, '.publication.lock');
    await writeFile(lock, 'another writer');
    await assert.rejects(
      f.publication.publish(pending.proposalId, review.token),
      code('STORE_LOCKED'),
    );
    await unlink(lock);
    const snapshot = JSON.parse(await readFile(f.path, 'utf8'));
    snapshot.cards[0].body += ' external edit';
    const external = JSON.stringify(snapshot);
    await writeFile(f.path, external);
    await assert.rejects(
      f.publication.publish(pending.proposalId, review.token),
      code('REVISION_CONFLICT'),
    );
    assert.equal(await readFile(f.path, 'utf8'), external);
    assert.equal((await f.publication.history()).length, 0);
  }));

test('concurrent writers publish exactly one complete snapshot', () =>
  setup(async (f) => {
    const a = await f.candidate('first');
    const b = await f.candidate('second');
    const ar = await f.publication.previewProposal(a.proposalId);
    const br = await f.publication.previewProposal(b.proposalId);
    const outcomes = Promise.allSettled([
      f.publication.publish(a.proposalId, ar.token),
      f.publication.publish(b.proposalId, br.token),
    ]);
    for (let index = 0; index < 25; index++)
      assert.equal((await f.knowledge.snapshot()).snapshot.cards.length, 3);
    const results = await outcomes;
    assert.equal(
      results.filter((r) => r.status === 'fulfilled').length,
      1,
      results
        .map((r) =>
          r.status === 'rejected' ? String(r.reason.stack) : 'success',
        )
        .join('\n'),
    );
    assert.equal(
      (await f.publication.history()).filter((h) => h.state === 'committed')
        .length,
      1,
    );
    assert.equal((await f.knowledge.read('read-fallback')).card.revision, 2);
  }));

test('interrupted marker blocks further publication and explicit recovery never rewrites canonical', () =>
  setup(async (f) => {
    const pending = await f.candidate();
    const review = await f.publication.previewProposal(pending.proposalId);
    const result = await f.publication.publish(
      pending.proposalId,
      review.token,
    );
    await unlink(join(f.store, 'history', result.transactionId, 'committed'));
    const next = await f.candidate('next');
    const nextReview = await f.publication.previewProposal(next.proposalId);
    await assert.rejects(
      f.publication.publish(next.proposalId, nextReview.token),
      code('RECOVERY_REQUIRED'),
    );
    const bytes = await readFile(f.path);
    const recovered = await f.publication.recover(
      result.transactionId,
      (await f.knowledge.snapshot()).snapshotRevision,
    );
    assert.equal(recovered.state, 'committed');
    assert.deepEqual(await readFile(f.path), bytes);
    await assert.rejects(
      readFile(join(f.store, '.publication.lock')),
      code('ENOENT'),
    );
  }));

test('unknown history and traversal candidates fail closed', () =>
  setup(async (f) => {
    const pending = await f.candidate();
    const review = await f.publication.previewProposal(pending.proposalId);
    const bytes = await readFile(f.path);
    await mkdir(join(f.store, 'history', 'unknown'), { recursive: true });
    await assert.rejects(
      f.publication.publish(pending.proposalId, review.token),
      code('INVALID_HISTORY'),
    );
    await assert.rejects(
      f.publication.readCandidate('../escape'),
      code('INVALID_ID'),
    );
    assert.deepEqual(await readFile(f.path), bytes);
  }));
