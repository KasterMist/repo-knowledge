import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { readFile } from 'node:fs/promises';
import {
  artifactName,
  release,
  validateRelease,
  verifyArtifact,
  sha256,
} from '../../scripts/release-config.mjs';
import { fixture } from '../helpers.mjs';

test('release tag mapping rejects mismatched versions and unsafe names', () => {
  assert.equal(validateRelease(release, release.version), artifactName);
  for (const config of [
    { ...release, version: '9.9.9' },
    { ...release, tag: '../artifact' },
    { ...release, prerelease: false },
  ])
    assert.throws(() => validateRelease(config, release.version));
});

test('release verification rejects a tampered payload and a mismatched checksum filename', async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.from('self-authored release fixture');
    await writeFile(join(f.store, artifactName), bytes);
    await writeFile(
      join(f.store, 'SHA256SUMS'),
      `${sha256(bytes)}  ${artifactName}\n`,
    );
    assert.equal((await verifyArtifact(f.store)).digest, sha256(bytes));
    await writeFile(join(f.store, artifactName), 'tampered');
    await assert.rejects(verifyArtifact(f.store), /checksum mismatch/u);
    await writeFile(join(f.store, artifactName), bytes);
    await writeFile(
      join(f.store, 'SHA256SUMS'),
      `${sha256(bytes)}  wrong.vsix\n`,
    );
    await assert.rejects(verifyArtifact(f.store), /checksum mismatch/u);
  } finally {
    await f.cleanup();
  }
});

test('publishing is manual, write-scoped and follows both identical-payload install jobs', async () => {
  const workflow = parse(
    await readFile(
      new URL('../../.github/workflows/release.yml', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.jobs.publish.permissions.contents, 'write');
  assert.equal(workflow.jobs.publish.needs, 'install');
  assert.equal(workflow.jobs.install.needs, 'build');
  assert.deepEqual(workflow.jobs.install.strategy.matrix.os, [
    'windows-latest',
    'ubuntu-latest',
  ]);
  assert.equal(workflow.jobs['public-install'].needs, 'publish');
  assert.deepEqual(workflow.jobs['public-install'].strategy.matrix.os, [
    'windows-latest',
    'ubuntu-latest',
  ]);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name !== 'publish') assert.notEqual(job.permissions?.contents, 'write');
    for (const step of job.steps) {
      if (step.uses)
        assert.match(step.uses, /^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/u);
      if (name !== 'build')
        assert.ok(
          !/npm run (?:check|build|package)/u.test(step.run ?? ''),
          'do not rebuild release payload',
        );
    }
  }
});
