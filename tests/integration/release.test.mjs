import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture, root } from '../helpers.mjs';
import {
  artifactName,
  release,
  sha256,
} from '../../scripts/release-config.mjs';

test('release uploader negotiates JSON responses independently from binary bodies/downloads', async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.from('self-authored release replay');
    const source = 'a'.repeat(40);
    await mkdir(join(f.directory, 'dist'));
    await mkdir(join(f.directory, 'docs/releases'), { recursive: true });
    await cp(
      join(root, 'docs/releases', `${release.tag}.md`),
      join(f.directory, 'docs/releases', `${release.tag}.md`),
    );
    await writeFile(join(f.directory, 'dist', artifactName), bytes);
    await writeFile(
      join(f.directory, 'dist/SHA256SUMS'),
      `${sha256(bytes)}  ${artifactName}\n`,
    );
    await writeFile(
      join(f.directory, 'dist/release-info.json'),
      JSON.stringify({
        version: release.version,
        tag: release.tag,
        sourceCommit: source,
        asset: artifactName,
        sha256: sha256(bytes),
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(join(root, 'tests/fixtures/release-fetch.mjs')).href,
        join(root, 'scripts/github-release.mjs'),
        'publish',
      ],
      {
        cwd: f.directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_TOKEN: 'offline-fixture-only',
          GITHUB_SHA: source,
          GITHUB_REPOSITORY: 'KasterMist/repo-knowledge',
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/main',
        },
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Published https:\/\/github.com/u);
    const gate = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(join(root, 'tests/fixtures/release-fetch.mjs')).href,
        join(root, 'scripts/github-release.mjs'),
        'gate',
      ],
      {
        cwd: f.directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_TOKEN: 'offline-read-only',
          GITHUB_SHA: source,
          GITHUB_REPOSITORY: 'KasterMist/repo-knowledge',
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/main',
        },
        timeout: 10000,
      },
    );
    assert.equal(gate.status, 0, gate.stderr);
    for (const state of [
      'published',
      'nonempty',
      'wrong-source',
      'hidden-assets',
    ]) {
      const rejected = spawnSync(
        process.execPath,
        [
          '--import',
          pathToFileURL(join(root, 'tests/fixtures/release-fetch.mjs')).href,
          join(root, 'scripts/github-release.mjs'),
          'publish',
        ],
        {
          cwd: f.directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            GH_TOKEN: 'offline-fixture-only',
            GITHUB_SHA: source,
            GITHUB_REPOSITORY: 'KasterMist/repo-knowledge',
            GITHUB_EVENT_NAME: 'workflow_dispatch',
            GITHUB_REF: 'refs/heads/main',
            REPLAY_DRAFT_STATE: state,
          },
          timeout: 10000,
        },
      );
      assert.notEqual(rejected.status, 0, state);
      assert.match(rejected.stderr, /refusing (?:changes|replacement)/u, state);
      assert.ok(!rejected.stdout.includes('Published'), state);
    }
  } finally {
    await f.cleanup();
  }
});
