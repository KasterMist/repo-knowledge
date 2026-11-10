import {
  mkdir,
  lstat,
  realpath,
  open,
  readdir,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { KnowledgeStore } from './store.js';
import { checkRepositoryBinding } from './repository-context.js';
import { boundedRead, within, KnowledgeError, fingerprint } from './files.js';
import {
  captureDependencyBaseline,
  dependencyBaselineSchema,
  reviewDependencyImpact,
} from './impact.js';

export class ImpactBaselines {
  constructor(readonly knowledge: KnowledgeStore) {}
  private async directory(create = false) {
    await checkRepositoryBinding(
      this.knowledge.repositoryRoot,
      this.knowledge.storeRoot,
    );
    const root = await realpath(this.knowledge.repositoryRoot);
    const store = await realpath(this.knowledge.storeRoot);
    if (within(root, store))
      throw new KnowledgeError(
        'INVALID_PATH',
        'Dependency baselines require external storage',
      );
    const path = join(store, 'dependency-baselines');
    if (create) await mkdir(path, { recursive: true });
    if (
      (await lstat(path)).isSymbolicLink() ||
      !within(store, await realpath(path))
    )
      throw new KnowledgeError(
        'PATH_ESCAPE',
        'Dependency metadata escapes storage',
      );
    return path;
  }
  async read(id: string) {
    z.uuid().parse(id);
    const directory = await this.directory();
    const path = join(directory, id + '.json');
    if (
      (await lstat(path)).isSymbolicLink() ||
      !within(directory, await realpath(path))
    )
      throw new KnowledgeError(
        'PATH_ESCAPE',
        'Dependency baseline escapes storage',
      );
    const value = dependencyBaselineSchema.parse(
      JSON.parse(await boundedRead(path)),
    );
    const { revision, ...content } = value;
    if (fingerprint(JSON.stringify(content)) !== revision)
      throw new KnowledgeError(
        'INVALID_BASELINE',
        'Dependency baseline checksum differs',
      );
    if (value.plan.id !== id)
      throw new KnowledgeError(
        'INVALID_BASELINE',
        'Baseline filename and plan identity differ',
      );
    return value;
  }
  async list() {
    let names;
    try {
      names = await readdir(await this.directory());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    if (names.length > 100)
      throw new KnowledgeError(
        'LIMIT',
        'Archive complete baseline backups before adding more',
      );
    return Promise.all(
      names
        .sort()
        .map((name) =>
          this.read(name.endsWith('.json') ? name.slice(0, -5) : name),
        ),
    );
  }
  async save(plan: unknown, signal?: AbortSignal) {
    const baseline = await captureDependencyBaseline(
      this.knowledge,
      plan,
      signal,
    );
    const text = JSON.stringify(baseline, null, 2) + '\n';
    if (Buffer.byteLength(text) > 1024 * 1024)
      throw new KnowledgeError('LIMIT', 'Dependency baseline exceeds 1 MiB');
    if ((await this.list()).length >= 100)
      throw new KnowledgeError('LIMIT', 'Too many dependency baselines');
    const path = join(await this.directory(true), baseline.plan.id + '.json');
    const handle = await open(path, 'wx', 0o600);
    let completed = false;
    try {
      if (signal?.aborted)
        throw new KnowledgeError(
          'IMPACT_CANCELLED',
          'Baseline capture cancelled',
        );
      await handle.writeFile(text);
      await handle.sync();
      if (signal?.aborted)
        throw new KnowledgeError(
          'IMPACT_CANCELLED',
          'Baseline capture cancelled',
        );
      completed = true;
    } finally {
      await handle.close();
      if (!completed) await unlink(path);
    }
    return { id: baseline.plan.id, revision: baseline.revision };
  }
  async review(id: string, signal?: AbortSignal) {
    return reviewDependencyImpact(this.knowledge, await this.read(id), signal);
  }
}
