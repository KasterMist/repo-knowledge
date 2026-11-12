import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import {
  KnowledgeStore,
  snapshotSchema,
} from '../../packages/core/dist/index.js';
import {
  recordTemplate,
  summarize,
  digest,
  source,
  fixtureIdentity,
  prepareEvaluation,
  verifyArtifacts,
} from '../../scripts/evaluation.mjs';

test('T21 prepares isolated identical static source, external current cards, and no answers in workspaces', async () => {
  const result = await prepareEvaluation();
  try {
    assert.equal(result.modelRequests, 0);
    assert.equal(result.sourceExecuted, false);
    for (const arm of ['baseline', 'natural', 'explicit']) {
      assert.equal(
        await readFile(
          join(result.directory, arm, 'workspace/src/reservations.ts'),
          'utf8',
        ),
        source,
      );
      if (arm === 'baseline') {
        await assert.rejects(
          readFile(join(result.directory, arm, 'store/knowledge.json')),
          { code: 'ENOENT' },
        );
      } else {
        const storePath = join(result.directory, arm, 'store');
        const bytes = await readFile(join(storePath, 'knowledge.json'));
        assert.equal(digest(bytes), fixtureIdentity.snapshotSha256);
        snapshotSchema.parse(JSON.parse(bytes));
        const store = new KnowledgeStore(
          join(result.directory, arm, 'workspace'),
          storePath,
        );
        assert.ok((await store.status()).cards.every((card) => !card.stale));
        assert.equal((await store.search('预留')).results.length, 2);
        assert.match(
          (await store.read('reservation-rationale')).card.body,
          /不是从源码推导/u,
        );
      }
    }
    const template = recordTemplate();
    await verifyArtifacts(template, join(result.directory, 'reviewer'));
    assert.equal(summarize(template).coverageComplete, false);
    assert.ok(
      summarize({ ...template, observations: [] }).rows.every(
        (row) => row.status === 'missing',
      ),
    );
  } finally {
    assert.equal(dirname(result.directory), tmpdir());
    assert.ok(basename(result.directory).startsWith('repo-knowledge-t21-'));
    await rm(result.directory, { recursive: true, force: true });
  }
});

test('T21 rejects fabricated completion, duplicate conversations, drift and invalid evidence', async () => {
  const record = recordTemplate();
  for (const change of [
    (r) => {
      r.observations[0].status = 'completed';
    },
    (r) => {
      r.observations[0].ratings.sourceFacts = 'pass';
    },
    (r) => {
      r.observations.push(r.observations[0]);
    },
    (r) => {
      r.observations[0].promptSha256 = '0'.repeat(64);
    },
    (r) => {
      r.fixture.sourceSha256 = '0'.repeat(64);
    },
    (r) => {
      r.observations[0].transcript = {
        file: '../secret.txt',
        sha256: '0'.repeat(64),
      };
    },
    (r) => {
      r.observations[0].elapsedMs = -1;
    },
    (r) => {
      r.observations[0].sessionLabel = r.observations[1].sessionLabel =
        'same-chat';
    },
  ]) {
    const copy = structuredClone(record);
    change(copy);
    assert.throws(() => summarize(copy));
  }
  const prepared = await prepareEvaluation();
  try {
    const text = 'Synthetic checker test only, not a real Codex response.\n';
    await writeFile(join(prepared.directory, 'reviewer/test.txt'), text);
    const entry = record.observations[0];
    Object.assign(entry, {
      status: 'completed',
      sessionLabel: 'test-only',
      independentConversation: true,
      accessVerified: true,
      observedAt: '2026-11-12T00:00:00.000Z',
      toolObservation: 'visible-calls',
      environment: {
        model: 'synthetic',
        codexVersion: 'synthetic',
        editorVersion: 'synthetic',
        extensionVersion: 'synthetic',
      },
      transcript: { file: 'test.txt', sha256: digest(text) },
      tools: [],
    });
    await verifyArtifacts(record, join(prepared.directory, 'reviewer'));
    assert.equal(summarize(record).rows[0].eligible, true);
    const natural = record.observations[1];
    Object.assign(natural, structuredClone(entry), {
      arm: 'natural',
      sessionLabel: 'independent-natural-test',
    });
    assert.equal(
      summarize(record).rows[1].eligible,
      true,
      'Observed natural non-use is a valid result',
    );
    natural.toolObservation = 'user-report';
    assert.equal(
      summarize(record).rows[1].eligible,
      false,
      'A claimed call is not a visible trace',
    );
    assert.equal(
      natural.observedTokens,
      null,
      'Unknown token usage stays unknown',
    );
    entry.tools.push({ name: 'read_knowledge', outcome: 'success' });
    assert.equal(
      summarize(record).rows[0].eligible,
      false,
      'Contaminated baseline must not count',
    );
    await writeFile(join(prepared.directory, 'reviewer/test.txt'), 'changed');
    await assert.rejects(
      verifyArtifacts(record, join(prepared.directory, 'reviewer')),
      /checksum/u,
    );
  } finally {
    assert.equal(dirname(prepared.directory), tmpdir());
    assert.ok(basename(prepared.directory).startsWith('repo-knowledge-t21-'));
    await rm(prepared.directory, { recursive: true, force: true });
  }
});
