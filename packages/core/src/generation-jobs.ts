import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { boundedRead, fingerprint, KnowledgeError, within } from './files.js';
import { buildGenerationPacket } from './generation.js';
import { scanPlanSchema, type ScanPlan } from './scan.js';
import { KnowledgeStore } from './store.js';
import { KnowledgePublication } from './publication.js';
import { generateKnowledgeCandidate } from './codex-generation.js';

const uuid = z.uuid();
const jobSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jobId: uuid,
  createdAt: z.iso.datetime(),
  plan: scanPlanSchema,
  packetRevision: z.string().regex(/^[a-f0-9]{64}$/u),
  baseSnapshot: z.string().regex(/^[a-f0-9]{64}$/u),
  maxPages: z.int().min(1).max(8),
  timeoutMs: z.int().min(1000).max(60000),
});
export type GenerationJob = z.infer<typeof jobSchema>;
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';
const problem = (code: string, message: string) =>
  new KnowledgeError(code, message);
const cancelled = (signal?: AbortSignal) => {
  if (signal?.aborted)
    throw problem('GENERATION_CANCELLED', 'Generation job cancelled');
};
async function writeExclusive(path: string, value: unknown) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Metadata-only, explicit job recovery. Construction/listing never starts a model. */
export class GenerationJobs {
  constructor(readonly knowledge: KnowledgeStore) {}
  private async directory() {
    const root = await realpath(this.knowledge.storeRoot);
    const directory = join(root, 'generation-jobs');
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !within(root, await realpath(directory))
    )
      throw problem('PATH_ESCAPE', 'Generation jobs must remain in the store');
    return directory;
  }
  async list(): Promise<GenerationJob[]> {
    const directory = await this.directory();
    const names = await readdir(directory);
    if (names.length > 600)
      throw problem('LIMIT', 'Too many generation job metadata entries');
    const jobs = [];
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue;
      jobs.push(await this.read(name.slice(0, -5)));
    }
    return jobs;
  }
  async read(id: string): Promise<GenerationJob> {
    uuid.parse(id);
    const directory = await this.directory();
    const path = join(directory, id + '.json');
    if (
      (await lstat(path)).isSymbolicLink() ||
      !within(directory, await realpath(path))
    )
      throw problem('PATH_ESCAPE', 'Generation job must be a contained file');
    const job = jobSchema.parse(JSON.parse(await boundedRead(path)));
    if (job.jobId !== id)
      throw problem('INVALID_JOB', 'Job filename and identity differ');
    if (
      job.plan.repositoryId !==
      createHash('sha256')
        .update(await realpath(this.knowledge.repositoryRoot))
        .digest('hex')
    )
      throw problem('INVALID_JOB', 'Job belongs to a different repository');
    return job;
  }
  async create(
    plan: ScanPlan,
    maxPages: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<GenerationJob> {
    // Reject invalid bounds before reading source or persisting anything.
    jobSchema.shape.maxPages.parse(maxPages);
    jobSchema.shape.timeoutMs.parse(timeoutMs);
    const packet = await buildGenerationPacket(this.knowledge, plan, signal);
    const job = jobSchema.parse({
      schemaVersion: 1,
      jobId: randomUUID(),
      createdAt: new Date().toISOString(),
      plan,
      packetRevision: packet.packetRevision,
      baseSnapshot: packet.baseSnapshot,
      maxPages,
      timeoutMs,
    });
    if ((await this.list()).length >= 100)
      throw problem(
        'LIMIT',
        'Back up complete storage before adding more jobs',
      );
    cancelled(signal);
    await writeExclusive(
      join(await this.directory(), job.jobId + '.json'),
      job,
    );
    return job;
  }
  async result(id: string) {
    const job = await this.read(id);
    const publication = new KnowledgePublication(this.knowledge);
    let saved;
    try {
      saved = await publication.readCreation(id);
    } catch (error) {
      if (absent(error)) return undefined;
      throw error;
    }
    const candidate = saved.candidate;
    if (
      candidate.packetRevision !== job.packetRevision ||
      candidate.baseSnapshot !== job.baseSnapshot ||
      fingerprint(JSON.stringify(candidate.plan)) !==
        fingerprint(JSON.stringify(job.plan)) ||
      candidate.cards.length > job.maxPages
    )
      throw problem('INVALID_JOB_RESULT', 'Candidate does not match saved job');
    const history = await publication.history();
    if (history.some((entry) => entry.state === 'prepared'))
      throw problem('RECOVERY_REQUIRED', 'Recover publication history first');
    const published = history.some(
      (entry) =>
        entry.state === 'committed' &&
        entry.record.operation === 'create' &&
        entry.record.itemId === id,
    );
    if (!published) await publication.previewCreation(id);
    return {
      jobId: id,
      candidateId: id,
      pages: candidate.cards.length,
      state: published
        ? ('previously-published' as const)
        : ('pending-review' as const),
      recovered: true,
      modelStarted: false,
    };
  }
  /** The producer must save under jobId; it is invoked once only by this explicit call. */
  async run(
    id: string,
    produce: (job: GenerationJob) => Promise<unknown>,
    signal?: AbortSignal,
  ) {
    const job = await this.read(id);
    cancelled(signal);
    const existing = await this.result(id);
    if (existing) return existing;
    const lease = join(await this.directory(), id + '.lease');
    try {
      await writeExclusive(lease, {
        schemaVersion: 1,
        jobId: id,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw problem(
          'JOB_BUSY',
          'Job is active or interrupted; do not take over its lease automatically',
        );
      throw error;
    }
    try {
      // Recheck after taking the lease: another process may just have saved.
      const recovered = await this.result(id);
      if (recovered) return recovered;
      const packet = await buildGenerationPacket(
        this.knowledge,
        job.plan,
        signal,
      );
      if (packet.packetRevision !== job.packetRevision)
        throw problem(
          'GENERATION_BASE_CHANGED',
          'Review a fresh generation plan',
        );
      cancelled(signal);
      await produce(job);
      const result = await this.result(id);
      if (!result)
        throw problem(
          'JOB_RESULT_MISSING',
          'Generation did not save a complete candidate',
        );
      return { ...result, recovered: false, modelStarted: true };
    } finally {
      await unlink(lease);
    }
  }
}

export async function runCodexGenerationJob(options: {
  knowledge: KnowledgeStore;
  jobId: string;
  command: string;
  cwd: string;
  signal?: AbortSignal;
}) {
  return new GenerationJobs(options.knowledge).run(
    options.jobId,
    (job) =>
      generateKnowledgeCandidate({
        ...options,
        plan: job.plan,
        maxPages: job.maxPages,
        timeoutMs: job.timeoutMs,
        candidateId: job.jobId,
        expectedPacketRevision: job.packetRevision,
      }),
    options.signal,
  );
}
