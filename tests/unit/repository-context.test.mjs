import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../helpers.mjs';
import {
  repositoryContext,
  bindRepositoryContext,
  KnowledgeStore,
  scanRepository,
  verifyScanPlan,
  defaultScanOptions,
  KnowledgePublication,
} from '../../packages/core/dist/index.js';

const code = (expected) => (error) => error.code === expected;
async function gitFixture(action) {
  const f = await fixture();
  try {
    const git = join(f.repository, '.git');
    await mkdir(join(git, 'refs/heads'), { recursive: true });
    await writeFile(join(git, 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(git, 'refs/heads/main'), 'a'.repeat(40) + '\n');
    const knowledge = new KnowledgeStore(f.repository, f.store);
    await action({ ...f, git, knowledge });
  } finally {
    await f.cleanup();
  }
}

test('unbound Git stores fail closed; binding is explicit, idempotent and branch-specific', () =>
  gitFixture(async (f) => {
    await assert.rejects(
      f.knowledge.snapshot(),
      code('CONTEXT_BINDING_REQUIRED'),
    );
    const before = await readFile(join(f.store, 'knowledge.json'));
    assert.equal(
      (await bindRepositoryContext(f.repository, f.store)).alreadyBound,
      false,
    );
    assert.equal(
      (await bindRepositoryContext(f.repository, f.store)).alreadyBound,
      true,
    );
    await f.knowledge.snapshot();
    await writeFile(join(f.git, 'HEAD'), 'ref: refs/heads/other\n');
    await assert.rejects(
      f.knowledge.snapshot(),
      code('REPOSITORY_CONTEXT_CHANGED'),
    );
    await assert.rejects(
      bindRepositoryContext(f.repository, f.store),
      code('REPOSITORY_CONTEXT_CHANGED'),
    );
    await writeFile(join(f.git, 'HEAD'), 'ref: refs/heads/main\n');
    await f.knowledge.snapshot();
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), before);
  }));

test('plans reject HEAD, index, branch, dirty selected source and legacy unbound context', () =>
  gitFixture(async (f) => {
    await bindRepositoryContext(f.repository, f.store);
    const plan = await scanRepository(f.repository, f.store, {
      ...defaultScanOptions,
      include: ['src/**'],
    });
    await verifyScanPlan(f.repository, f.store, plan);
    const legacy = { ...plan };
    delete legacy.context;
    await assert.rejects(
      verifyScanPlan(f.repository, f.store, legacy),
      code('REPOSITORY_CONTEXT_CHANGED'),
    );
    await writeFile(join(f.git, 'index'), Buffer.from([0, 1, 2, 3]));
    await assert.rejects(
      verifyScanPlan(f.repository, f.store, plan),
      code('REPOSITORY_CONTEXT_CHANGED'),
    );
    const staged = await scanRepository(f.repository, f.store, plan.options);
    await writeFile(join(f.git, 'refs/heads/main'), 'b'.repeat(40) + '\n');
    await assert.rejects(
      verifyScanPlan(f.repository, f.store, staged),
      code('REPOSITORY_CONTEXT_CHANGED'),
    );
    const head = await scanRepository(f.repository, f.store, plan.options);
    await writeFile(
      join(f.repository, 'src/读取.ts'),
      '// changed saved dirty source\n',
    );
    await assert.rejects(
      verifyScanPlan(f.repository, f.store, head),
      code('PLAN_CHANGED'),
    );
  }));

test('linked worktrees and copied stores cannot share bindings; packed refs and detached HEAD are observed', () =>
  gitFixture(async (f) => {
    await bindRepositoryContext(f.repository, f.store);
    const other = join(f.directory, '另一个 worktree');
    const metadata = join(f.git, 'worktrees', 'other');
    await mkdir(other);
    await mkdir(metadata, { recursive: true });
    await writeFile(join(other, '.git'), 'gitdir: ' + metadata + '\n');
    await writeFile(join(metadata, 'commondir'), '../..\n');
    await writeFile(join(metadata, 'HEAD'), 'ref: refs/heads/main\n');
    assert.notEqual(
      (await repositoryContext(other)).identity,
      (await repositoryContext(f.repository)).identity,
    );
    await assert.rejects(
      new KnowledgeStore(other, f.store).snapshot(),
      code('REPOSITORY_CONTEXT_CHANGED'),
    );
    const copy = join(f.directory, 'copy');
    await cp(f.repository, copy, { recursive: true });
    await assert.rejects(
      new KnowledgeStore(copy, f.store).snapshot(),
      code('REPOSITORY_CONTEXT_CHANGED'),
    );
    await writeFile(join(f.git, 'HEAD'), 'ref: refs/heads/packed\n');
    await writeFile(
      join(f.git, 'packed-refs'),
      'c'.repeat(40) + ' refs/heads/packed\n',
    );
    const first = await repositoryContext(f.repository);
    await writeFile(
      join(f.git, 'packed-refs'),
      'd'.repeat(40) + ' refs/heads/packed\n',
    );
    assert.equal(
      first.identity,
      (await repositoryContext(f.repository)).identity,
    );
    assert.notEqual(
      first.revision,
      (await repositoryContext(f.repository)).revision,
    );
    await writeFile(join(f.git, 'HEAD'), 'd'.repeat(40) + '\n');
    assert.notEqual(
      first.identity,
      (await repositoryContext(f.repository)).identity,
    );
  }));

test('legacy metadata cannot be silently adopted by binding a store', () =>
  gitFixture(async (f) => {
    await mkdir(join(f.store, 'generation-jobs'));
    await writeFile(join(f.store, 'generation-jobs', 'legacy.json'), '{}');
    await assert.rejects(
      bindRepositoryContext(f.repository, f.store),
      code('LEGACY_CONTEXT_UNVERIFIED'),
    );
  }));

test('publication review becomes invalid after staging even when cited source is unchanged', () =>
  gitFixture(async (f) => {
    await bindRepositoryContext(f.repository, f.store);
    const current = await f.knowledge.read('read-fallback');
    const input = {
      id: current.card.id,
      baseRevision: current.card.revision,
      baseSnapshot: current.snapshotRevision,
      proposedCard: {
        ...current.card,
        revision: 2,
        body: current.card.body + '\nClarification.',
      },
      reason: 'self-authored test',
    };
    const proposed = await f.knowledge.propose(input);
    const publication = new KnowledgePublication(f.knowledge);
    const review = await publication.previewProposal(proposed.proposalId);
    const before = await readFile(join(f.store, 'knowledge.json'));
    await writeFile(join(f.git, 'index'), Buffer.from([1, 2, 3]));
    await assert.rejects(
      publication.publish(proposed.proposalId, review.token),
      code('REVIEW_CHANGED'),
    );
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), before);
  }));
