import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('built packages load independently from a path with spaces and Chinese characters', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'repo knowledge 中文 '));
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
    for (const workspace of ['core', 'mcp-server', 'vscode-extension']) {
      await cp(
        join(root, 'packages', workspace, 'dist'),
        join(directory, workspace),
        { recursive: true },
      );
    }
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "await import('./core/index.js'); await import('./mcp-server/index.js'); await import('./vscode-extension/index.js');",
      ],
      { cwd: directory, encoding: 'utf8', timeout: 15000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      '',
      'M0 packages must not launch tools or print protocol output',
    );
  } finally {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('repo knowledge 中文 '));
    await rm(directory, { recursive: true, force: true });
  }
});
