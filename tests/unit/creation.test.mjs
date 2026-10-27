import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  unlink,
  mkdir,
  readdir,
  symlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  KnowledgeStore,
  KnowledgePublication,
  scanRepository,
  defaultScanOptions,
  buildGenerationPacket,
} from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';
const code = (expected) => (error) => error.code === expected;
async function setup(action) {
  const f = await fixture();
  const knowledge = new KnowledgeStore(f.repository, f.store);
  const publication = new KnowledgePublication(knowledge);
  const plan = await scanRepository(f.repository, f.store, {
    ...defaultScanOptions,
    include: ['src/**/*.ts'],
    exclude: [],
  });
  const packet = await buildGenerationPacket(knowledge, plan);
  const page = {
    id: 'new-reading',
    title: '新的读取说明',
    kind: 'fact',
    body: '空字符串会保留。',
    tags: ['读取'],
    scope: ['src'],
    evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
  };
  const output = {
    packetRevision: packet.packetRevision,
    pages: [page, { ...page, id: 'new-cache', title: '新的缓存说明' }],
  };
  const path = join(f.store, 'knowledge.json');
  try {
    await action({ ...f, knowledge, publication, plan, packet, output, path });
  } finally {
    await f.cleanup();
  }
}
test('new-card batch is saved without source text, reviewed, atomically published, and removed with retired IDs', () =>
  setup(async (f) => {
    const original = await readFile(f.path);
    const saved = await f.publication.saveCreation(f.plan, f.packet, f.output);
    assert.equal(saved.state, 'pending-review');
    assert.deepEqual(await readFile(f.path), original);
    const text = await readFile(saved.path, 'utf8');
    assert.ok(!text.includes(f.repository));
    assert.ok(!text.includes(f.packet.sources[0].content));
    assert.equal((await f.publication.listCreations()).length, 1);
    const review = await f.publication.previewCreation(saved.candidateId);
    assert.deepEqual(review.before, []);
    assert.equal(review.after.length, 2);
    await assert.rejects(
      f.publication.publishCreation(saved.candidateId, 'wrong-token'),
      code('REVIEW_CHANGED'),
    );
    const committed = await f.publication.publishCreation(
      saved.candidateId,
      review.token,
    );
    assert.equal((await f.knowledge.snapshot()).snapshot.cards.length, 5);
    assert.equal((await f.knowledge.read('new-reading')).card.revision, 1);
    assert.equal((await f.publication.listCreations()).length, 0);
    assert.equal((await f.publication.history())[0].record.schemaVersion, 2);
    assert.deepEqual(
      await readFile(
        join(f.store, 'history', committed.transactionId, 'before.json'),
      ),
      original,
    );
    await assert.rejects(
      f.publication.publishCreation(saved.candidateId, review.token),
      code('ALREADY_PUBLISHED'),
    );
    const rollback = await f.publication.previewRollback(
      committed.transactionId,
    );
    assert.equal(rollback.operation, 'remove-created');
    assert.equal(rollback.before.length, 2);
    assert.deepEqual(rollback.after, []);
    const removed = await f.publication.rollback(
      committed.transactionId,
      rollback.token,
    );
    assert.deepEqual(
      (await f.knowledge.snapshot()).snapshot,
      JSON.parse(original),
    );
    await assert.rejects(f.knowledge.read('new-reading'), code('NOT_FOUND'));
    assert.deepEqual(await f.publication.reservedCreationIds(), [
      'new-cache',
      'new-reading',
    ]);
    await assert.rejects(
      f.publication.previewRollback(removed.transactionId),
      code('INVALID_HISTORY'),
    );
    await assert.rejects(
      f.publication.previewRollback(committed.transactionId),
      code('REVISION_CONFLICT'),
    );
    const fresh = await buildGenerationPacket(f.knowledge, f.plan);
    await assert.rejects(
      f.publication.saveCreation(f.plan, fresh, {
        ...f.output,
        packetRevision: fresh.packetRevision,
      }),
      code('RETIRED_ID'),
    );
    await assert.rejects(
      f.publication.publishCreation(saved.candidateId, review.token),
      code('ALREADY_PUBLISHED'),
    );
    // Even restoring the exact old creation bytes cannot replay its removal.
    await writeFile(
      f.path,
      await readFile(
        join(f.store, 'history', committed.transactionId, 'after.json'),
      ),
    );
    await assert.rejects(
      f.publication.previewRollback(committed.transactionId),
      code('REVISION_CONFLICT'),
    );
  }));
test('creation rechecks candidate edits, source and canonical knowledge without overwriting human edits', () =>
  setup(async (f) => {
    const saved = await f.publication.saveCreation(f.plan, f.packet, f.output);
    const review = await f.publication.previewCreation(saved.candidateId);
    const bytes = await readFile(saved.path);
    const changed = JSON.parse(bytes);
    changed.cards[0].body += ' 人工补充';
    await writeFile(saved.path, JSON.stringify(changed));
    await assert.rejects(
      f.publication.publishCreation(saved.candidateId, review.token),
      code('REVIEW_CHANGED'),
    );
    changed.cards[0].evidence[0].sha256 = '0'.repeat(64);
    await writeFile(saved.path, JSON.stringify(changed));
    await assert.rejects(
      f.publication.previewCreation(saved.candidateId),
      code('INVALID_PROPOSAL'),
    );
    await writeFile(saved.path, bytes);
    const source = join(f.repository, 'src/读取.ts'),
      original = await readFile(source);
    await writeFile(source, original.toString().replace('??', '||'));
    await assert.rejects(
      f.publication.publishCreation(saved.candidateId, review.token),
      code('PLAN_CHANGED'),
    );
    await writeFile(source, original);
    const canonical = JSON.parse(await readFile(f.path, 'utf8'));
    canonical.cards[0].body += ' Human rationale';
    const human = JSON.stringify(canonical);
    await writeFile(f.path, human);
    await assert.rejects(
      f.publication.publishCreation(saved.candidateId, review.token),
      code('GENERATION_BASE_CHANGED'),
    );
    assert.equal(await readFile(f.path, 'utf8'), human);
    assert.equal((await f.publication.history()).length, 0);
  }));
test('creation and existing-card publication share one writer lock and never publish mixed snapshots', () =>
  setup(async (f) => {
    const saved = await f.publication.saveCreation(f.plan, f.packet, f.output);
    const creation = await f.publication.previewCreation(saved.candidateId);
    const current = await f.knowledge.read('read-fallback');
    const proposal = await f.knowledge.propose({
      id: current.card.id,
      baseRevision: 1,
      baseSnapshot: current.snapshotRevision,
      reason: 'clarify',
      proposedCard: { ...current.card, revision: 2, body: 'Human explanation' },
    });
    const review = await f.publication.previewProposal(proposal.proposalId);
    const outcomes = Promise.allSettled([
      f.publication.publishCreation(saved.candidateId, creation.token),
      f.publication.publish(proposal.proposalId, review.token),
    ]);
    for (let i = 0; i < 15; i++)
      assert.ok(
        [3, 5].includes((await f.knowledge.snapshot()).snapshot.cards.length),
      );
    const results = await outcomes;
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      (await f.publication.history()).filter(
        (entry) => entry.state === 'committed',
      ).length,
      1,
    );
  }));
test('creation removal refuses any intervening human update and stale removal tokens', () =>
  setup(async (f) => {
    const saved = await f.publication.saveCreation(f.plan, f.packet, f.output);
    const review = await f.publication.previewCreation(saved.candidateId);
    const created = await f.publication.publishCreation(
      saved.candidateId,
      review.token,
    );
    const removal = await f.publication.previewRollback(created.transactionId);
    await assert.rejects(
      f.publication.rollback(created.transactionId, 'wrong-token'),
      code('REVIEW_CHANGED'),
    );
    const read = await f.knowledge.read('new-reading');
    const proposal = await f.knowledge.propose({
      id: read.card.id,
      baseRevision: 1,
      baseSnapshot: read.snapshotRevision,
      reason: 'human addition',
      proposedCard: {
        ...read.card,
        revision: 2,
        body: 'Human rationale must survive',
      },
    });
    const edit = await f.publication.previewProposal(proposal.proposalId);
    await f.publication.publish(proposal.proposalId, edit.token);
    await assert.rejects(
      f.publication.rollback(created.transactionId, removal.token),
      code('REVISION_CONFLICT'),
    );
    assert.equal(
      (await f.knowledge.read('new-reading')).card.body,
      'Human rationale must survive',
    );
  }));
test('prepared creation/removal records block writers and explicit marker recovery preserves canonical bytes', () =>
  setup(async (f) => {
    const saved = await f.publication.saveCreation(f.plan, f.packet, f.output);
    const review = await f.publication.previewCreation(saved.candidateId);
    const created = await f.publication.publishCreation(
      saved.candidateId,
      review.token,
    );
    const marker = join(f.store, 'history', created.transactionId, 'committed');
    await unlink(marker);
    const bytes = await readFile(f.path);
    const read = await f.knowledge.read('read-fallback');
    const proposal = await f.knowledge.propose({
      id: read.card.id,
      baseRevision: 1,
      baseSnapshot: read.snapshotRevision,
      reason: 'test recovery',
      proposedCard: { ...read.card, revision: 2 },
    });
    const update = await f.publication.previewProposal(proposal.proposalId);
    await assert.rejects(
      f.publication.publish(proposal.proposalId, update.token),
      code('RECOVERY_REQUIRED'),
    );
    assert.equal(
      (
        await f.publication.recover(
          created.transactionId,
          (await f.knowledge.snapshot()).snapshotRevision,
        )
      ).state,
      'committed',
    );
    assert.deepEqual(await readFile(f.path), bytes);
    const removal = await f.publication.previewRollback(created.transactionId);
    const removed = await f.publication.rollback(
      created.transactionId,
      removal.token,
    );
    await unlink(join(f.store, 'history', removed.transactionId, 'committed'));
    const removedBytes = await readFile(f.path);
    assert.equal(
      (
        await f.publication.recover(
          removed.transactionId,
          (await f.knowledge.snapshot()).snapshotRevision,
        )
      ).state,
      'committed',
    );
    assert.deepEqual(await readFile(f.path), removedBytes);
    assert.equal((await f.publication.history()).length, 2);
  }));
test('creation metadata rejects traversal, symlinks and unknown history without changing canonical knowledge', () =>
  setup(async (f) => {
    const original = await readFile(f.path);
    await assert.rejects(
      f.publication.readCreation('../escape'),
      code('INVALID_ID'),
    );
    const outside = join(f.directory, 'outside');
    await mkdir(outside);
    await symlink(
      outside,
      join(f.store, 'creations'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(
      f.publication.saveCreation(f.plan, f.packet, f.output),
      code('PATH_ESCAPE'),
    );
    await unlink(join(f.store, 'creations'));
    await mkdir(join(f.store, 'history', 'unknown'), { recursive: true });
    await assert.rejects(
      f.publication.saveCreation(f.plan, f.packet, f.output),
      code('INVALID_HISTORY'),
    );
    assert.deepEqual(await readFile(f.path), original);
    assert.ok(!(await readdir(f.store)).includes('creations'));
  }));

test('creation recovery refuses divergent snapshots, can mark an unapplied transaction aborted, and validates batch identities', () =>
  setup(async (f) => {
    const original = await readFile(f.path);
    const saved = await f.publication.saveCreation(f.plan, f.packet, f.output);
    const review = await f.publication.previewCreation(saved.candidateId);
    const created = await f.publication.publishCreation(
      saved.candidateId,
      review.token,
    );
    const history = join(f.store, 'history', created.transactionId);
    await unlink(join(history, 'committed'));
    const divergent = JSON.parse(original);
    divergent.cards[0].body += ' preserved';
    await writeFile(f.path, JSON.stringify(divergent));
    const changedBytes = await readFile(f.path);
    await assert.rejects(
      f.publication.recover(
        created.transactionId,
        (await f.knowledge.snapshot()).snapshotRevision,
      ),
      code('RECOVERY_CONFLICT'),
    );
    assert.deepEqual(await readFile(f.path), changedBytes);
    await writeFile(f.path, original);
    assert.equal(
      (
        await f.publication.recover(
          created.transactionId,
          (await f.knowledge.snapshot()).snapshotRevision,
        )
      ).state,
      'aborted',
    );
    assert.deepEqual(await readFile(f.path), original);
    const retryReview = await f.publication.previewCreation(saved.candidateId);
    const retry = await f.publication.publishCreation(
      saved.candidateId,
      retryReview.token,
    );
    const recordPath = join(
      f.store,
      'history',
      retry.transactionId,
      'record.json',
    );
    const record = JSON.parse(await readFile(recordPath, 'utf8'));
    record.cardIds.push(record.cardIds[0]);
    await writeFile(recordPath, JSON.stringify(record));
    await assert.rejects(f.publication.history(), code('INVALID_HISTORY'));
  }));

test('creation removal cannot cross an intervening create/remove round trip even when canonical bytes match again', () =>
  setup(async (f) => {
    const saved = await f.publication.saveCreation(f.plan, f.packet, f.output);
    const review = await f.publication.previewCreation(saved.candidateId);
    const first = await f.publication.publishCreation(
      saved.candidateId,
      review.token,
    );
    const packet = await buildGenerationPacket(f.knowledge, f.plan);
    const later = await f.publication.saveCreation(f.plan, packet, {
      packetRevision: packet.packetRevision,
      pages: [{ ...f.output.pages[0], id: 'another-batch' }],
    });
    const secondReview = await f.publication.previewCreation(later.candidateId);
    const second = await f.publication.publishCreation(
      later.candidateId,
      secondReview.token,
    );
    const removeSecond = await f.publication.previewRollback(
      second.transactionId,
    );
    await f.publication.rollback(second.transactionId, removeSecond.token);
    assert.equal(
      (await f.knowledge.snapshot()).snapshotRevision,
      first.snapshotRevision,
    );
    await assert.rejects(
      f.publication.previewRollback(first.transactionId),
      code('REVISION_CONFLICT'),
    );
  }));

test('cancelled generation cannot save a new creation candidate or alter canonical knowledge', () =>
  setup(async (f) => {
    const original = await readFile(f.path);
    const controller = new globalThis.AbortController();
    controller.abort();
    await assert.rejects(
      f.publication.saveCreation(f.plan, f.packet, f.output, controller.signal),
      code('GENERATION_CANCELLED'),
    );
    assert.deepEqual(await readFile(f.path), original);
    assert.equal((await f.publication.listCreations()).length, 0);
  }));
