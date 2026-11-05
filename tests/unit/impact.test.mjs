import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../helpers.mjs';
import {
  KnowledgeStore,
  scanRepository,
  defaultScanOptions,
  captureDependencyBaseline,
  reviewDependencyImpact,
} from '../../packages/core/dist/index.js';
async function setup(action) {
  const f = await fixture();
  try {
    const fixturePath = join(f.store, 'knowledge.json');
    const snapshot = JSON.parse(await readFile(fixturePath, 'utf8'));
    snapshot.cards[0].scope = ['src'];
    await writeFile(fixturePath, JSON.stringify(snapshot));
    const k = new KnowledgeStore(f.repository, f.store),
      canonical = await readFile(join(f.store, 'knowledge.json'));
    const plan = await scanRepository(f.repository, f.store, {
      ...defaultScanOptions,
      include: ['src/**/*.ts'],
      exclude: [],
    });
    const baseline = await captureDependencyBaseline(k, plan);
    await action({ f, k, baseline });
    assert.deepEqual(
      await readFile(join(f.store, 'knowledge.json')),
      canonical,
    );
  } finally {
    await f.cleanup();
  }
}
test('unchanged evidence is current; baseline contains no knowledge body or source text', () =>
  setup(async ({ k, baseline }) => {
    assert.ok(!JSON.stringify(baseline).includes('return cache.get'));
    assert.ok(baseline.cards.every((c) => !('body' in c)));
    const report = await reviewDependencyImpact(k, baseline);
    assert.equal(report.coverageComplete, true);
    assert.ok(report.cards.every((c) => c.state === 'current'));
  }));
test('direct evidence changes and deletions invalidate dependent cards', () =>
  setup(async ({ f, k, baseline }) => {
    await writeFile(join(f.repository, 'src/读取.ts'), 'changed');
    let r = await reviewDependencyImpact(k, baseline);
    assert.equal(
      r.cards.find((c) => c.id === 'read-fallback').state,
      'invalid-evidence',
    );
    await unlink(join(f.repository, 'src/读取.ts'));
    r = await reviewDependencyImpact(k, baseline);
    assert.ok(r.changes.some((c) => c.kind === 'deleted'));
    assert.ok(
      r.cards
        .find((c) => c.id === 'read-fallback')
        .evidence.some((e) => e.state === 'missing'),
    );
  }));
test('scope additions signal potential impact without falsifying evidence', () =>
  setup(async ({ f, k, baseline }) => {
    await writeFile(
      join(f.repository, 'src/new.ts'),
      '// self-authored addition',
    );
    const r = await reviewDependencyImpact(k, baseline);
    assert.ok(r.changes.some((c) => c.kind === 'added'));
    assert.ok(r.cards.some((c) => c.state === 'potential-impact'));
    assert.equal(r.cards.find((c) => c.id === 'cache-miss').state, 'current');
    assert.ok(
      r.cards.every((c) => c.evidence.every((e) => e.state === 'current')),
    );
  }));

test('unique content suggests a rename while retaining deletion, addition and missing evidence', () =>
  setup(async ({ f, k, baseline }) => {
    await rename(
      join(f.repository, 'src/读取.ts'),
      join(f.repository, 'src/renamed.ts'),
    );
    const r = await reviewDependencyImpact(k, baseline);
    assert.deepEqual(r.possibleRenames, [
      {
        from: 'src/读取.ts',
        to: 'src/renamed.ts',
        reason: 'unique-content-match',
      },
    ]);
    assert.ok(r.changes.some((c) => c.kind === 'deleted'));
    assert.ok(r.changes.some((c) => c.kind === 'added'));
    assert.equal(
      r.cards.find((c) => c.id === 'read-fallback').state,
      'invalid-evidence',
    );
  }));
test('copies and incomplete coverage do not imply a rename', () =>
  setup(async ({ f, k }) => {
    const text = await readFile(join(f.repository, 'src/读取.ts'));
    await writeFile(join(f.repository, 'src/copy.ts'), text);
    const plan = await scanRepository(f.repository, f.store, {
      ...defaultScanOptions,
      include: ['src/**/*.ts'],
      exclude: [],
    });
    const baseline = await captureDependencyBaseline(k, plan);
    await rename(
      join(f.repository, 'src/读取.ts'),
      join(f.repository, 'src/renamed.ts'),
    );
    assert.deepEqual(
      (await reviewDependencyImpact(k, baseline)).possibleRenames,
      [],
    );
    await writeFile(join(f.repository, 'src/large.ts'), 'x'.repeat(70000));
    const r = await reviewDependencyImpact(k, baseline);
    assert.equal(r.coverageComplete, false);
    assert.deepEqual(r.possibleRenames, []);
  }));
test('tampered baselines and incomplete coverage cannot report all current', () =>
  setup(async ({ f, k, baseline }) => {
    await assert.rejects(
      reviewDependencyImpact(k, { ...baseline, revision: 'bad' }),
      (e) => e.code === 'INVALID_BASELINE',
    );
    await writeFile(join(f.repository, 'src/large.ts'), 'x'.repeat(70000));
    const r = await reviewDependencyImpact(k, baseline);
    assert.equal(r.coverageComplete, false);
    assert.ok(r.cards.every((c) => c.state === 'unknown'));
  }));
