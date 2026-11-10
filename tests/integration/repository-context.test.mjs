import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../helpers.mjs';
import {
  repositoryContext,
  bindRepositoryContext,
  KnowledgeStore,
  scanRepository,
  verifyScanPlan,
  defaultScanOptions,
} from '../../packages/core/dist/index.js';

test('real self-authored Git branch, dirty source, index and linked worktree keep stores isolated', async () => {
  const f = await fixture();
  try {
    const hooks = join(f.directory, 'empty-hooks');
    await mkdir(hooks);
    const git = (...args) =>
      execFileSync(
        'git',
        [
          '-c',
          'core.hooksPath=' + hooks,
          '-c',
          'core.fsmonitor=false',
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        { cwd: f.repository, encoding: 'utf8', windowsHide: true },
      );
    git('init', '--template=' + hooks, '--initial-branch=main');
    const unborn = await repositoryContext(f.repository);
    await bindRepositoryContext(f.repository, f.store);
    git('add', 'src');
    git('commit', '-m', 'Self-authored fixture');
    const context = await repositoryContext(f.repository);
    assert.equal(context.identity, unborn.identity);
    assert.notEqual(context.revision, unborn.revision);
    const knowledge = new KnowledgeStore(f.repository, f.store);
    await knowledge.snapshot();
    const plan = await scanRepository(f.repository, f.store, {
      ...defaultScanOptions,
      include: ['src/**'],
    });
    await writeFile(
      join(f.repository, 'src/new.ts'),
      'export const example = 1;\n',
    );
    await assert.rejects(
      verifyScanPlan(f.repository, f.store, plan),
      (error) => error.code === 'PLAN_CHANGED',
    );
    git('add', 'src/new.ts');
    await assert.rejects(
      verifyScanPlan(f.repository, f.store, plan),
      (error) => error.code === 'REPOSITORY_CONTEXT_CHANGED',
    );
    const canonical = await readFile(join(f.store, 'knowledge.json'));
    git('switch', '-c', 'feature');
    await assert.rejects(
      knowledge.snapshot(),
      (error) => error.code === 'REPOSITORY_CONTEXT_CHANGED',
    );
    git('switch', 'main');
    await knowledge.snapshot();
    const other = join(f.directory, 'linked worktree 中文');
    git('worktree', 'add', '-b', 'linked', other);
    await assert.rejects(
      new KnowledgeStore(other, f.store).snapshot(),
      (error) => error.code === 'REPOSITORY_CONTEXT_CHANGED',
    );
    assert.deepEqual(
      await readFile(join(f.store, 'knowledge.json')),
      canonical,
    );
  } finally {
    await f.cleanup();
  }
});
