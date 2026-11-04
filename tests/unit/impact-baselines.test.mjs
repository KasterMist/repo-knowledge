import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../helpers.mjs';
import {
  KnowledgeStore,
  ImpactBaselines,
  scanRepository,
  defaultScanOptions,
} from '../../packages/core/dist/index.js';
test('durable baseline reloads across instances, refuses overwrite and reports reverse evidence dependencies', async () => {
  const f = await fixture();
  try {
    const k = new KnowledgeStore(f.repository, f.store),
      b = new ImpactBaselines(k),
      original = await readFile(join(f.store, 'knowledge.json'));
    const p = await scanRepository(f.repository, f.store, {
      ...defaultScanOptions,
      include: ['src/**/*.ts'],
      exclude: [],
    });
    const saved = await b.save(p);
    await assert.rejects(b.save(p), (e) => e.code === 'EEXIST');
    assert.equal((await new ImpactBaselines(k).list()).length, 1);
    await writeFile(join(f.repository, 'src/读取.ts'), 'changed');
    const report = await new ImpactBaselines(k).review(saved.id);
    assert.ok(
      report.files
        .find((x) => x.path === 'src/读取.ts')
        .evidenceCardIds.includes('read-fallback'),
    );
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), original);
    const path = join(f.store, 'dependency-baselines', saved.id + '.json');
    const value = JSON.parse(await readFile(path, 'utf8'));
    value.revision = 'tampered';
    await writeFile(path, JSON.stringify(value));
    await assert.rejects(
      b.read(saved.id),
      (e) => e.code === 'INVALID_BASELINE',
    );
  } finally {
    await f.cleanup();
  }
});
test('metadata directory escape is refused', async () => {
  const f = await fixture();
  try {
    const k = new KnowledgeStore(f.repository, f.store),
      b = new ImpactBaselines(k);
    const outside = join(f.directory, 'outside');
    await mkdir(outside);
    await symlink(
      outside,
      join(f.store, 'dependency-baselines'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(b.list(), (e) => e.code === 'PATH_ESCAPE');
  } finally {
    await f.cleanup();
  }
});
