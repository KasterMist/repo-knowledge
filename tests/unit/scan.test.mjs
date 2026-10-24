import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import {
  readFile,
  writeFile,
  mkdir,
  symlink,
  realpath,
  access,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  scanRepository,
  verifyScanPlan,
  saveScanPlan,
  defaultScanOptions,
  scanOptionsSchema,
} from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';
const code = (expected) => (error) => error.code === expected;
async function setup(action) {
  const f = await fixture();
  try {
    await action(f);
  } finally {
    await f.cleanup();
  }
}
const options = (values = {}) => ({
  ...defaultScanOptions,
  include: ['src/**'],
  exclude: [],
  ...values,
});

test('static scope excludes credentials, tool metadata and an in-repository store without changing files', () =>
  setup(async (f) => {
    for (const directory of ['.git', '.codex', '.vscode', 'node_modules']) {
      await mkdir(join(f.repository, directory), { recursive: true });
      await writeFile(
        join(f.repository, directory, 'private.txt'),
        'do not scan this',
      );
    }
    for (const name of [
      '.env',
      '.env.example',
      '.info',
      'id_rsa',
      'credential.key',
    ])
      await writeFile(join(f.repository, name), 'do not scan this');
    const canonical = await readFile(
      join(f.repository, 'knowledge/knowledge.json'),
    );
    const plan = await scanRepository(
      f.repository,
      join(f.repository, 'knowledge'),
      options({ include: ['**'] }),
    );
    assert.ok(plan.files.some((file) => file.path === 'src/读取.ts'));
    assert.ok(plan.summary.skipped.excluded >= 10);
    assert.ok(
      plan.files.every(
        (file) =>
          !file.path.includes('private') &&
          !file.path.startsWith('knowledge/') &&
          !file.path.startsWith('.'),
      ),
    );
    assert.deepEqual(
      await readFile(join(f.repository, 'knowledge/knowledge.json')),
      canonical,
    );
    assert.equal(plan.summary.limited, false);
  }));

test('POSIX globs cover root and nested Unicode files with case-sensitive excludes', () =>
  setup(async (f) => {
    await mkdir(join(f.repository, 'src/目录'), { recursive: true });
    await writeFile(
      join(f.repository, 'src/目录/extra.ts'),
      'export const 示例 = 1;',
    );
    await writeFile(join(f.repository, 'src/目录/upper.TS'), 'not matched');
    const plan = await scanRepository(
      f.repository,
      f.store,
      options({ include: ['src/**/*.ts'], exclude: ['**/cache.ts'] }),
    );
    assert.deepEqual(
      plan.files.map((file) => file.path),
      ['src/目录/extra.ts', 'src/读取.ts'],
    );
    assert.equal(
      (
        await scanRepository(
          f.repository,
          f.store,
          options({ include: ['**/extra.?s'] }),
        )
      ).files.length,
      1,
    );
    for (const value of [
      '../secret',
      'C:/secret',
      '/secret',
      'src\\file',
      'a/**x',
      'a/[x]',
    ])
      assert.equal(
        scanOptionsSchema.safeParse(options({ include: [value] })).success,
        false,
        value,
      );
  }));

test('bounded files and bytes, binary detection and incomplete coverage are explicit', () =>
  setup(async (f) => {
    const limited = await scanRepository(
      f.repository,
      f.store,
      options({ maxFiles: 1 }),
    );
    assert.equal(limited.files.length, 1);
    assert.equal(limited.summary.limited, true);
    assert.ok(limited.summary.skipped['file-limit'] > 0);
    const bytes = await scanRepository(
      f.repository,
      f.store,
      options({ maxTotalBytes: 1 }),
    );
    assert.equal(bytes.files.length, 0);
    assert.equal(bytes.summary.limited, true);
    const oversized = await scanRepository(
      f.repository,
      f.store,
      options({ maxFileBytes: 1 }),
    );
    assert.equal(oversized.files.length, 0);
    assert.ok(oversized.summary.skipped.oversized > 0);
    await writeFile(join(f.repository, 'src/null.bin'), Buffer.from([0, 1]));
    await writeFile(
      join(f.repository, 'src/bad.bin'),
      Buffer.from([0xff, 0xfe]),
    );
    const binary = await scanRepository(f.repository, f.store, options());
    assert.equal(binary.summary.skipped.binary, 2);
  }));

test('plan revalidation rejects changed source, inventory, repository and edited metadata', () =>
  setup(async (f) => {
    const plan = await scanRepository(f.repository, f.store, options());
    assert.equal(
      (await verifyScanPlan(f.repository, f.store, plan)).id,
      plan.id,
    );
    const source = join(f.repository, 'src/读取.ts'),
      original = await readFile(source);
    await writeFile(source, original.toString().replace('??', '||'));
    await assert.rejects(
      verifyScanPlan(f.repository, f.store, plan),
      code('PLAN_CHANGED'),
    );
    await writeFile(source, original);
    await assert.rejects(
      verifyScanPlan(f.repository, f.store, {
        ...plan,
        options: { ...plan.options, language: 'en' },
      }),
      code('PLAN_CHANGED'),
    );
    await writeFile(join(f.repository, 'src/new.ts'), 'new source');
    await assert.rejects(
      verifyScanPlan(f.repository, f.store, plan),
      code('PLAN_CHANGED'),
    );
    const other = await fixture();
    try {
      await assert.rejects(
        verifyScanPlan(other.repository, other.store, plan),
        code('PLAN_CHANGED'),
      );
    } finally {
      await other.cleanup();
    }
  }));

test('explicit plan save is immutable, external and metadata-only; cancellation saves nothing', () =>
  setup(async (f) => {
    const original = await readFile(join(f.store, 'knowledge.json'));
    const plan = await scanRepository(f.repository, f.store, options());
    const saved = await saveScanPlan(f.repository, f.store, plan);
    const text = await readFile(saved.path, 'utf8');
    assert.equal(JSON.parse(text).manifestRevision, plan.manifestRevision);
    assert.ok(!text.includes(f.repository));
    assert.ok(!text.includes('return cache.get'));
    await assert.rejects(
      saveScanPlan(f.repository, f.store, plan),
      code('EEXIST'),
    );
    await assert.rejects(
      saveScanPlan(f.repository, join(f.repository, 'knowledge'), plan),
      code('INVALID_PATH'),
    );
    const controller = new globalThis.AbortController();
    controller.abort();
    await assert.rejects(
      scanRepository(f.repository, f.store, options(), controller.signal),
      code('SCAN_CANCELLED'),
    );
    const active = new globalThis.AbortController();
    setImmediate(() => active.abort());
    await assert.rejects(
      scanRepository(f.repository, f.store, options(), active.signal),
      code('SCAN_CANCELLED'),
    );
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), original);
  }));

test('existing symlinks are not followed and symlink plan metadata cannot escape store', () =>
  setup(async (f) => {
    await mkdir(join(f.directory, 'outside'), { recursive: true });
    await writeFile(join(f.directory, 'outside/leak.ts'), 'outside source');
    try {
      await symlink(
        await realpath(join(f.directory, 'outside')),
        join(f.repository, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (
        process.platform === 'win32' &&
        ['EPERM', 'EACCES'].includes(error.code)
      )
        return;
      throw error;
    }
    const plan = await scanRepository(
      f.repository,
      f.store,
      options({ include: ['**'] }),
    );
    assert.equal(plan.summary.skipped.symlink, 1);
    assert.ok(!plan.files.some((file) => file.path.startsWith('linked/')));
    await symlink(
      await realpath(f.repository),
      join(f.directory, 'target-alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(
      saveScanPlan(
        f.repository,
        join(f.directory, 'target-alias/must-not-create'),
        plan,
      ),
      code('PATH_ESCAPE'),
    );
    await assert.rejects(
      access(join(f.repository, 'must-not-create')),
      code('ENOENT'),
    );
    await symlink(
      await realpath(join(f.directory, 'outside')),
      join(f.store, 'plans'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(
      saveScanPlan(f.repository, f.store, plan),
      code('PATH_ESCAPE'),
    );
  }));
