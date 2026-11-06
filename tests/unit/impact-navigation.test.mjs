import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../helpers.mjs';
import { resolveImpactSource } from '../../packages/core/dist/index.js';
test('impact navigation resolves Unicode source but refuses missing, traversal and symbolic-link targets', async () => {
  const f = await fixture();
  try {
    assert.equal(
      await resolveImpactSource(f.repository, 'src/读取.ts'),
      join(f.repository, 'src/读取.ts'),
    );
    await assert.rejects(
      resolveImpactSource(f.repository, 'src/deleted.ts'),
      (e) => e.code === 'IMPACT_SOURCE_MISSING',
    );
    await assert.rejects(resolveImpactSource(f.repository, '../outside.ts'));
    await assert.rejects(
      resolveImpactSource(f.repository, 'src'),
      (e) => e.code === 'INVALID_FILE',
    );
    const outside = join(f.directory, 'outside');
    await mkdir(outside);
    await symlink(
      outside,
      join(f.repository, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(
      resolveImpactSource(f.repository, 'linked/file.ts'),
      (e) => e.code === 'PATH_ESCAPE',
    );
  } finally {
    await f.cleanup();
  }
});
