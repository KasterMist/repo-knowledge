import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../helpers.mjs';
import {
  KnowledgeStore,
  KnowledgePublication,
  IncrementalUpdates,
  scanRepository,
  defaultScanOptions,
  buildGenerationPacket,
  validateGeneratedPages,
  validateGeneratedUpdate,
  captureDependencyBaseline,
  reviewDependencyImpact,
} from '../../packages/core/dist/index.js';
const code = (expected) => (error) => error.code === expected;
async function setup(action) {
  const f = await fixture();
  try {
    const knowledge = new KnowledgeStore(f.repository, f.store),
      publication = new KnowledgePublication(knowledge),
      options = {
        ...defaultScanOptions,
        include: ['src/**/*.ts'],
        exclude: [],
      };
    const plan = await scanRepository(f.repository, f.store, options),
      base = await knowledge.read('read-fallback'),
      packet = await buildGenerationPacket(knowledge, plan);
    const output = {
      packetRevision: packet.packetRevision,
      pages: [
        {
          id: base.card.id,
          title: base.card.title,
          kind: base.card.kind,
          body: '使用 || 后空字符串返回缺省值；人工设计理由保留。',
          tags: base.card.tags,
          scope: ['src'],
          evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
        },
      ],
    };
    const cwd = join(f.directory, 'scratch');
    await mkdir(cwd);
    await action({
      ...f,
      knowledge,
      publication,
      options,
      plan,
      base,
      packet,
      output,
      cwd,
    });
  } finally {
    await f.cleanup();
  }
}

test('update validator admits exactly one selected ID without weakening first-generation or source-reference rules', () =>
  setup(async (f) => {
    const updated = validateGeneratedUpdate(f.packet, f.output, f.base.card);
    assert.equal(updated.revision, 2);
    assert.equal(updated.id, f.base.card.id);
    assert.throws(
      () => validateGeneratedPages(f.packet, f.output),
      code('EXISTING_CARD'),
    );
    assert.throws(
      () =>
        validateGeneratedUpdate(
          f.packet,
          { ...f.output, pages: [{ ...f.output.pages[0], id: 'other' }] },
          f.base.card,
        ),
      code('WRONG_UPDATE_TARGET'),
    );
    assert.throws(() =>
      validateGeneratedUpdate(
        f.packet,
        { ...f.output, pages: [] },
        f.base.card,
      ),
    );
    assert.throws(
      () =>
        validateGeneratedUpdate(
          f.packet,
          {
            ...f.output,
            pages: [
              {
                ...f.output.pages[0],
                evidence: [{ path: 'outside.ts', startLine: 1, endLine: 5 }],
              },
            ],
          },
          f.base.card,
        ),
      code('INVALID_GENERATED_EVIDENCE'),
    );
  }));

test('self-authored incremental workflow: impact -> single update -> no-model recovery -> reviewed publication -> source-consistent rollback', () =>
  setup(async (f) => {
    const baseline = await captureDependencyBaseline(f.knowledge, f.plan),
      source = join(f.repository, 'src/读取.ts'),
      original = await readFile(source);
    await writeFile(source, original.toString().replace('??', '||'));
    const impact = await reviewDependencyImpact(f.knowledge, baseline);
    assert.equal(
      impact.cards.find((card) => card.id === 'read-fallback').state,
      'invalid-evidence',
    );
    const plan = await scanRepository(f.repository, f.store, f.options),
      packet = await buildGenerationPacket(f.knowledge, plan),
      output = { ...f.output, packetRevision: packet.packetRevision };
    let calls = 0;
    // Deterministic response seam, not actual Codex/model acceptance.
    const updates = new IncrementalUpdates(f.knowledge, async (options) => {
      await options.recheck();
      options.onTurnRequest();
      calls++;
      assert.ok(options.prompt.includes('CURRENT_CARD_JSON'));
      return {
        output,
        text: JSON.stringify(output),
        observedTokens: 17,
        submittedTurns: 1,
      };
    });
    const before = await readFile(join(f.store, 'knowledge.json'));
    const saved = await updates.run({
      plan,
      cardId: 'read-fallback',
      command: process.execPath,
      cwd: f.cwd,
    });
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), before);
    assert.equal(saved.metrics.submittedTurnRequests, 1);
    assert.equal(saved.metrics.observedTokens, 17);
    assert.ok(saved.metrics.elapsedMs >= 0);
    assert.equal((await updates.list()).length, 1);
    assert.equal(
      (await updates.recover(saved.attemptId)).proposalId,
      saved.proposalId,
    );
    assert.equal(
      (await updates.recover(saved.attemptId)).state,
      'pending-review',
    );
    assert.equal(calls, 1);
    const record = await readFile(
      join(f.store, 'incremental-attempts', saved.attemptId + '.request.json'),
      'utf8',
    );
    assert.ok(!record.includes('return cache.get'));
    assert.ok(!record.includes(f.base.card.body));
    const review = await f.publication.previewProposal(saved.proposalId),
      published = await f.publication.publish(saved.proposalId, review.token);
    assert.equal((await f.knowledge.read('read-fallback')).stale, false);
    assert.equal((await f.knowledge.read('read-fallback')).card.revision, 2);
    assert.equal(
      (await updates.recover(saved.attemptId)).state,
      'previously-published',
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      (await f.knowledge.snapshot()).snapshot.cards.filter(
        (card) => card.id !== 'read-fallback',
      ),
      JSON.parse(before).cards.filter((card) => card.id !== 'read-fallback'),
    );
    await assert.rejects(
      f.publication.previewRollback(published.transactionId),
      code('STALE_EVIDENCE'),
    );
    // Rollback must retain valid evidence: restore only the self-authored fixture source.
    await writeFile(source, original);
    const rollback = await f.publication.previewRollback(
      published.transactionId,
    );
    await f.publication.rollback(published.transactionId, rollback.token);
    assert.equal((await f.knowledge.read('read-fallback')).card.revision, 3);
    assert.equal(
      (await f.knowledge.read('read-fallback')).card.body,
      f.base.card.body,
    );
    assert.equal((await f.knowledge.read('read-fallback')).stale, false);
  }));

test('failed preflight and cancelled attempts are bounded, recover without a model and preserve canonical bytes', () =>
  setup(async (f) => {
    const updates = new IncrementalUpdates(f.knowledge),
      before = await readFile(join(f.store, 'knowledge.json'));
    await assert.rejects(
      updates.run({
        plan: f.plan,
        cardId: f.base.card.id,
        command: process.execPath,
        cwd: f.cwd,
      }),
      code('UNVERIFIED_CODEX_VERSION'),
    );
    const attempts = await updates.list();
    assert.equal(attempts.length, 1);
    const recovered = await updates.recover(attempts[0].attemptId);
    assert.equal(recovered.state, 'no-result');
    assert.equal(recovered.metrics.submittedTurnRequests, 0);
    assert.equal(recovered.metrics.observedTokens, null);
    const controller = new globalThis.AbortController();
    controller.abort();
    await assert.rejects(
      updates.run({
        plan: f.plan,
        cardId: f.base.card.id,
        command: process.execPath,
        cwd: f.cwd,
        signal: controller.signal,
      }),
      code('GENERATION_CANCELLED'),
    );
    assert.equal((await updates.list()).length, 1);
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), before);
  }));

test('changed source/base during a response and wrong target cannot save an incremental candidate', () =>
  setup(async (f) => {
    const before = await readFile(join(f.store, 'knowledge.json'));
    const changed = new IncrementalUpdates(f.knowledge, async (options) => {
      options.onTurnRequest();
      await writeFile(join(f.repository, 'src/读取.ts'), '// changed\n');
      return {
        output: f.output,
        text: '{}',
        observedTokens: null,
        submittedTurns: 1,
      };
    });
    await assert.rejects(
      changed.run({
        plan: f.plan,
        cardId: f.base.card.id,
        command: process.execPath,
        cwd: f.cwd,
      }),
      code('PLAN_CHANGED'),
    );
    assert.equal(
      (await changed.recover((await changed.list())[0].attemptId)).state,
      'no-result',
    );
    assert.equal((await f.publication.listCandidates()).length, 0);
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), before);
  }));

test('stable proposal IDs are exclusive and cancelled saves cannot overwrite existing proposals', () =>
  setup(async (f) => {
    const card = validateGeneratedUpdate(f.packet, f.output, f.base.card),
      id = '35ec080a-03b7-4f2b-9fa8-6e925d39682b',
      input = {
        id: f.base.card.id,
        baseRevision: 1,
        baseSnapshot: f.base.snapshotRevision,
        reason: 'Self-authored update',
        proposedCard: card,
      };
    await f.knowledge.propose(input, { proposalId: id });
    const path = join(f.store, 'proposals', id + '.json'),
      before = await readFile(path);
    await assert.rejects(
      f.knowledge.propose(input, { proposalId: id }),
      (error) => error.code === 'EEXIST',
    );
    assert.deepEqual(await readFile(path), before);
    const controller = new globalThis.AbortController();
    controller.abort();
    await assert.rejects(
      f.knowledge.propose(input, { signal: controller.signal }),
      code('GENERATION_CANCELLED'),
    );
    assert.deepEqual(await readFile(path), before);
    await unlink(path);
  }));

test('incremental raw response failures are redacted and a cancelled response saves no candidate', () =>
  setup(async (f) => {
    const bad = new IncrementalUpdates(f.knowledge, async (options) => {
      options.onTurnRequest();
      throw new Error('SECRET-private-response');
    });
    await assert.rejects(
      bad.run({
        plan: f.plan,
        cardId: f.base.card.id,
        command: process.execPath,
        cwd: f.cwd,
      }),
      (error) =>
        error.code === 'INCREMENTAL_VALIDATION_FAILED' &&
        !String(error).includes('SECRET'),
    );
    const controller = new globalThis.AbortController();
    const cancelled = new IncrementalUpdates(f.knowledge, async (options) => {
      options.onTurnRequest();
      controller.abort();
      return {
        output: f.output,
        text: '{}',
        observedTokens: null,
        submittedTurns: 1,
      };
    });
    await assert.rejects(
      cancelled.run({
        plan: f.plan,
        cardId: f.base.card.id,
        command: process.execPath,
        cwd: f.cwd,
        signal: controller.signal,
      }),
      code('GENERATION_CANCELLED'),
    );
    for (const attempt of await cancelled.list()) {
      const recovered = await cancelled.recover(attempt.attemptId);
      assert.equal(recovered.state, 'no-result');
      assert.equal(recovered.metrics.submittedTurnRequests, 1);
      assert.ok(!JSON.stringify(recovered).includes('SECRET'));
    }
    assert.equal((await f.publication.listCandidates()).length, 0);
  }));
