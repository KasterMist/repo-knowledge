import { mkdtemp, cp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
export const root = fileURLToPath(new URL('../', import.meta.url));
export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'repo knowledge 中文 '));
  const repository = join(directory, '源码');
  const store = join(directory, 'external store');
  await cp(join(root, 'examples/demo'), repository, { recursive: true });
  await cp(join(repository, 'knowledge'), store, { recursive: true });
  return {
    directory,
    repository,
    store,
    async cleanup() {
      assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
      assert.ok(basename(directory).startsWith('repo knowledge 中文 '));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export async function emptyDirectory(parent, name) {
  const path = join(parent, name);
  await mkdir(path, { recursive: true });
  return path;
}
