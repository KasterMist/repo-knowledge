import { lstat, realpath, open, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  boundedRead,
  boundedBytes,
  fingerprint,
  KnowledgeError,
  within,
} from './files.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const repositoryContextSchema = z.strictObject({
  identity: digest,
  revision: digest,
});
export type RepositoryContext = z.infer<typeof repositoryContextSchema>;
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';
async function optional(path: string) {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new KnowledgeError(
        'CONTEXT_UNAVAILABLE',
        'Git metadata symlinks are unsupported',
      );
    return await boundedRead(path);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}
/** Read metadata only: no Git commands, hooks, filters, network or source execution. */
export async function repositoryContext(
  repository: string,
): Promise<RepositoryContext | undefined> {
  const root = await realpath(repository);
  let top = root;
  let git: string | undefined;
  for (;;) {
    const marker = join(top, '.git');
    try {
      const info = await lstat(marker);
      if (info.isSymbolicLink())
        throw new KnowledgeError(
          'CONTEXT_UNAVAILABLE',
          'Git marker must not be a symlink',
        );
      if (info.isDirectory()) {
        // Empty .git-shaped fixture directories are not initialized repositories.
        if ((await optional(join(marker, 'HEAD'))) !== undefined) git = marker;
      } else {
        const match = /^gitdir: ([^\r\n]+)\r?\n?$/u.exec(
          await boundedRead(marker),
        );
        if (!match)
          throw new KnowledgeError(
            'CONTEXT_UNAVAILABLE',
            'Invalid Git worktree marker',
          );
        git = resolve(top, match[1]!);
      }
      if (git) break;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const parent = dirname(top);
    if (parent === top) return undefined;
    top = parent;
  }
  git = await realpath(git);
  const commonText = await optional(join(git, 'commondir'));
  const common = commonText
    ? await realpath(resolve(git, commonText.trim()))
    : git;
  const head = (await optional(join(git, 'HEAD')))?.trim();
  if (!head)
    throw new KnowledgeError('CONTEXT_UNAVAILABLE', 'Git HEAD is unavailable');
  const reference = head.startsWith('ref: ') ? head.slice(5) : undefined;
  if (
    reference &&
    (!/^refs\/heads\/[a-zA-Z0-9_./\-\u0080-\uFFFF]+$/u.test(reference) ||
      reference.split('/').some((p) => p === '..' || p === '.' || !p))
  )
    throw new KnowledgeError(
      'CONTEXT_UNAVAILABLE',
      'Unsupported Git symbolic HEAD',
    );
  let commit = head;
  if (reference) {
    const loose = await optional(join(common, reference));
    const packed =
      loose === undefined
        ? await optional(join(common, 'packed-refs'))
        : undefined;
    commit =
      loose?.trim() ??
      packed
        ?.split('\n')
        .find((line) => line.endsWith(' ' + reference))
        ?.split(' ')[0] ??
      'unborn';
  }
  if (commit !== 'unborn' && !/^[a-f0-9]{40,64}$/u.test(commit))
    throw new KnowledgeError(
      'CONTEXT_UNAVAILABLE',
      'Unsupported Git HEAD value',
    );
  let index = 'absent';
  try {
    const path = join(git, 'index');
    if ((await lstat(path)).isSymbolicLink())
      throw new KnowledgeError(
        'CONTEXT_UNAVAILABLE',
        'Git index symlink is unsupported',
      );
    index = createHash('sha256')
      .update(await boundedBytes(path))
      .digest('hex');
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const identity = fingerprint(
    JSON.stringify({ root, top, git, common, branch: reference ?? head }),
  );
  return {
    identity,
    revision: fingerprint(JSON.stringify({ identity, head, commit, index })),
  };
}

export function assertContext(
  expected: RepositoryContext | undefined,
  current: RepositoryContext | undefined,
  identityOnly = false,
) {
  if (
    expected?.identity !== current?.identity ||
    (!identityOnly && expected?.revision !== current?.revision)
  )
    throw new KnowledgeError(
      'REPOSITORY_CONTEXT_CHANGED',
      'Repository/worktree/branch or HEAD/index changed; select the matching store and review a fresh plan',
    );
}

const binding = z.strictObject({
  schemaVersion: z.literal(1),
  identity: digest,
});
export async function checkRepositoryBinding(
  repository: string,
  store: string,
) {
  const current = await repositoryContext(repository);
  let root: string;
  try {
    root = await realpath(store);
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
  const path = join(root, 'repository-context.json');
  const text = await optional(path);
  if (!text) {
    if (current)
      throw new KnowledgeError(
        'CONTEXT_BINDING_REQUIRED',
        'Git store is unbound. Use Bind Repository Context with a fresh store; legacy candidates cannot be adopted.',
      );
    return;
  }
  const saved = binding.parse(JSON.parse(text));
  if (!current || saved.identity !== current.identity)
    throw new KnowledgeError(
      'REPOSITORY_CONTEXT_CHANGED',
      'Store belongs to another repository, worktree or branch. Select a separate store; do not overwrite its binding.',
    );
}

/** Explicit one-time binding. Never adopts pre-existing pending writes/history. */
export async function bindRepositoryContext(repository: string, store: string) {
  const current = await repositoryContext(repository);
  if (!current)
    throw new KnowledgeError(
      'CONTEXT_UNAVAILABLE',
      'Open an initialized Git worktree to bind its context',
    );
  const root = await realpath(store);
  if (within(await realpath(repository), root))
    throw new KnowledgeError(
      'INVALID_PATH',
      'Binding requires an external store',
    );
  const path = join(root, 'repository-context.json');
  if (await optional(path)) {
    await checkRepositoryBinding(repository, store);
    return { alreadyBound: true };
  }
  for (const name of [
    'proposals',
    'drafts',
    'creations',
    'history',
    'generation-jobs',
    'plans',
    'dependency-baselines',
    'merge-reviews',
  ]) {
    try {
      if ((await readdir(join(root, name))).length)
        throw new KnowledgeError(
          'LEGACY_CONTEXT_UNVERIFIED',
          'Use a fresh store; preserve legacy plans, candidates and history separately',
        );
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  assertContext(current, await repositoryContext(repository));
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(
      JSON.stringify({ schemaVersion: 1, identity: current.identity }) + '\n',
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await checkRepositoryBinding(repository, store);
  return { alreadyBound: false };
}
