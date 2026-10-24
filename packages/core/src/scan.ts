import { createHash, randomUUID } from 'node:crypto';
import {
  opendir,
  realpath,
  lstat,
  mkdir,
  open,
  unlink,
} from 'node:fs/promises';
import { join, resolve, isAbsolute, dirname, basename } from 'node:path';
import { z } from 'zod';
import { boundedBytes, fingerprint, within, KnowledgeError } from './files.js';
import { relativePath } from './schema.js';

// Deliberately small POSIX glob grammar, independent of shell/OS glob expansion.
const pattern = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      ![...value].some(
        (character) =>
          '\\:[]{}!'.includes(character) ||
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127,
      ) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..') &&
      value.split('/').every((part) => !part.includes('**') || part === '**'),
    'Use relative POSIX globs with *, ** or ?; no traversal or shell syntax',
  );
export const scanOptionsSchema = z.strictObject({
  include: z.array(pattern).min(1).max(32),
  exclude: z.array(pattern).max(32),
  language: z.enum(['zh-CN', 'en']),
  maxFiles: z.int().min(1).max(200),
  maxFileBytes: z
    .int()
    .min(1)
    .max(256 * 1024),
  maxTotalBytes: z
    .int()
    .min(1)
    .max(2 * 1024 * 1024),
});
export type ScanOptions = z.infer<typeof scanOptionsSchema>;
export const defaultScanOptions: ScanOptions = {
  include: ['**'],
  exclude: ['dist/**', 'build/**', 'vendor/**', 'coverage/**'],
  language: 'zh-CN',
  maxFiles: 50,
  maxFileBytes: 64 * 1024,
  maxTotalBytes: 128 * 1024,
};
const reasons = [
  'excluded',
  'out-of-scope',
  'symlink',
  'unsupported',
  'oversized',
  'binary',
  'unreadable',
  'file-limit',
  'byte-limit',
  'entry-limit',
  'depth-limit',
] as const;
const count = z.int().min(0);
const counters = z.strictObject({
  excluded: count,
  'out-of-scope': count,
  symlink: count,
  unsupported: count,
  oversized: count,
  binary: count,
  unreadable: count,
  'file-limit': count,
  'byte-limit': count,
  'entry-limit': count,
  'depth-limit': count,
});
const fileSchema = z.strictObject({
  path: relativePath,
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.int().min(0),
  lines: z.int().min(1),
});
export const scanPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  repositoryId: z.string().regex(/^[a-f0-9]{64}$/u),
  options: scanOptionsSchema,
  files: z.array(fileSchema).max(200),
  summary: z.strictObject({
    visitedEntries: z.int().min(0).max(10001),
    selectedBytes: z
      .int()
      .min(0)
      .max(2 * 1024 * 1024),
    limited: z.boolean(),
    skipped: counters,
  }),
  manifestRevision: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type ScanPlan = z.infer<typeof scanPlanSchema>;
const blockedDirectories = new Set([
  '.git',
  '.codex',
  '.qoder',
  '.vscode',
  '.aws',
  '.ssh',
  '.tools',
  '.tmp',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
]);
function mandatory(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    blockedDirectories.has(lower) ||
    lower === '.info' ||
    lower === '.npmrc' ||
    lower === '.netrc' ||
    lower === 'auth.json' ||
    lower === 'credentials' ||
    lower === 'credentials.json' ||
    lower.startsWith('.env') ||
    /^id_(rsa|dsa|ecdsa|ed25519)(\.|$)/u.test(lower) ||
    /\.(pem|key|p12|pfx|keystore|vsix)$/u.test(lower)
  );
}
function matcher(value: string): RegExp {
  const parts = value.split('/');
  const source = parts
    .map((part, index) => {
      if (part === '**')
        return index === parts.length - 1 ? '.*' : '(?:[^/]+/)*';
      return (
        [...part]
          .map((character) =>
            character === '*'
              ? '[^/]*'
              : character === '?'
                ? '[^/]'
                : character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
          )
          .join('') + (index === parts.length - 1 ? '' : '/')
      );
    })
    .join('');
  return new RegExp('^' + source + '$', 'u');
}
function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new KnowledgeError('SCAN_CANCELLED', 'Scan cancelled; no plan saved');
}
const repositoryId = (root: string) =>
  createHash('sha256').update(root).digest('hex');
async function storagePath(path: string): Promise<string> {
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(await realpath(current), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.push(basename(current));
      current = parent;
    }
  }
}
const revision = (
  plan: Pick<ScanPlan, 'repositoryId' | 'options' | 'files' | 'summary'>,
) => fingerprint(JSON.stringify(plan));

export async function scanRepository(
  repository: string,
  store: string,
  input: unknown = defaultScanOptions,
  signal?: AbortSignal,
): Promise<ScanPlan> {
  const options = scanOptionsSchema.parse(input);
  if (!isAbsolute(repository) || !isAbsolute(store))
    throw new KnowledgeError(
      'INVALID_PATH',
      'Repository and store must be absolute',
    );
  const root = await realpath(repository);
  const excludedStore = await storagePath(store);
  const includes = options.include.map(matcher),
    excludes = options.exclude.map(matcher);
  const skipped = Object.fromEntries(
    reasons.map((reason) => [reason, 0]),
  ) as ScanPlan['summary']['skipped'];
  const files: ScanPlan['files'] = [];
  let visitedEntries = 0,
    selectedBytes = 0,
    limited = false;
  const walk = async (
    directory: string,
    prefix: string,
    depth: number,
  ): Promise<void> => {
    cancelled(signal);
    if (depth > 32) {
      skipped['depth-limit']++;
      limited = true;
      return;
    }
    const entries = [];
    try {
      const handle = await opendir(directory);
      for await (const entry of handle) {
        cancelled(signal);
        visitedEntries++;
        if (visitedEntries > 10000) {
          skipped['entry-limit']++;
          limited = true;
          break;
        }
        entries.push(entry);
      }
    } catch (error) {
      if (signal?.aborted) {
        cancelled(signal);
      }
      if (directory === root) throw error;
      skipped.unreadable++;
      limited = true;
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      cancelled(signal);
      const path = join(directory, entry.name),
        relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (
        mandatory(entry.name) ||
        within(excludedStore, path) ||
        excludes.some(
          (glob) =>
            glob.test(relative) ||
            (entry.isDirectory() && glob.test(relative + '/')),
        )
      ) {
        skipped.excluded++;
        continue;
      }
      if (entry.isSymbolicLink()) {
        skipped.symlink++;
        continue;
      }
      if (entry.isDirectory()) {
        if (visitedEntries <= 10000) await walk(path, relative, depth + 1);
        continue;
      }
      if (!entry.isFile() || !relativePath.safeParse(relative).success) {
        skipped.unsupported++;
        continue;
      }
      if (!includes.some((glob) => glob.test(relative))) {
        skipped['out-of-scope']++;
        continue;
      }
      if (files.length >= options.maxFiles) {
        skipped['file-limit']++;
        limited = true;
        continue;
      }
      try {
        const resolved = await realpath(path);
        const info = await lstat(path);
        if (info.isSymbolicLink() || !within(root, resolved)) {
          skipped.symlink++;
          continue;
        }
        if (!info.isFile()) {
          skipped.unsupported++;
          continue;
        }
        if (info.size > options.maxFileBytes) {
          skipped.oversized++;
          limited = true;
          continue;
        }
        if (selectedBytes + info.size > options.maxTotalBytes) {
          skipped['byte-limit']++;
          limited = true;
          continue;
        }
        const bytes = await boundedBytes(path);
        cancelled(signal);
        if (bytes.length > options.maxFileBytes) {
          skipped.oversized++;
          limited = true;
          continue;
        }
        if (selectedBytes + bytes.length > options.maxTotalBytes) {
          skipped['byte-limit']++;
          limited = true;
          continue;
        }
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          skipped.binary++;
          continue;
        }
        if (text.includes('\0')) {
          skipped.binary++;
          continue;
        }
        files.push({
          path: relative,
          sha256: fingerprint(text),
          bytes: bytes.length,
          lines: text.replaceAll('\r\n', '\n').split('\n').length,
        });
        selectedBytes += bytes.length;
      } catch (error) {
        if (signal?.aborted) cancelled(signal);
        if (error instanceof KnowledgeError && error.code === 'LIMIT') {
          skipped.oversized++;
          limited = true;
        } else {
          skipped.unreadable++;
          limited = true;
        }
      }
    }
  };
  await walk(root, '', 0);
  cancelled(signal);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = {
    repositoryId: repositoryId(root),
    options,
    files,
    summary: { visitedEntries, selectedBytes, limited, skipped },
  };
  return scanPlanSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...manifest,
    manifestRevision: revision(manifest),
  });
}

export async function verifyScanPlan(
  repository: string,
  store: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<ScanPlan> {
  const plan = scanPlanSchema.parse(input);
  const fresh = await scanRepository(repository, store, plan.options, signal);
  const manifest = {
    repositoryId: plan.repositoryId,
    options: plan.options,
    files: plan.files,
    summary: plan.summary,
  };
  if (
    revision(manifest) !== plan.manifestRevision ||
    fresh.manifestRevision !== plan.manifestRevision
  )
    throw new KnowledgeError(
      'PLAN_CHANGED',
      'Repository inventory or plan changed; scan and review again',
    );
  return plan;
}

export async function saveScanPlan(
  repository: string,
  store: string,
  input: unknown,
  signal?: AbortSignal,
) {
  const root = await realpath(repository);
  if (!isAbsolute(store) || within(root, resolve(store)))
    throw new KnowledgeError(
      'INVALID_PATH',
      'Scan plans require a store outside the target repository',
    );
  if (within(root, await storagePath(store)))
    throw new KnowledgeError(
      'PATH_ESCAPE',
      'Plan store resolves inside repository',
    );
  const plan = await verifyScanPlan(repository, store, input, signal);
  cancelled(signal);
  await mkdir(store, { recursive: true });
  const storage = await realpath(store);
  if (within(root, storage))
    throw new KnowledgeError(
      'PATH_ESCAPE',
      'Plan store resolves inside repository',
    );
  const directory = join(storage, 'plans');
  await mkdir(directory, { recursive: true });
  if (
    (await lstat(directory)).isSymbolicLink() ||
    !within(storage, await realpath(directory))
  )
    throw new KnowledgeError('PATH_ESCAPE', 'Plan directory escapes store');
  const entries = await opendir(directory);
  let count = 0;
  for await (const entry of entries) {
    if (entry) count++;
    if (count >= 200)
      throw new KnowledgeError(
        'LIMIT',
        'Archive backed-up plans before saving more',
      );
  }
  cancelled(signal);
  const path = join(directory, plan.id + '.json'),
    handle = await open(path, 'wx', 0o600);
  let completed = false;
  try {
    cancelled(signal);
    await handle.writeFile(JSON.stringify(plan, null, 2) + '\n');
    await handle.sync();
    cancelled(signal);
    completed = true;
  } finally {
    await handle.close();
    if (!completed) await unlink(path);
  }
  return { id: plan.id, path };
}
