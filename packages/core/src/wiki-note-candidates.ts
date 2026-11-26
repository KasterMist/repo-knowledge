import { randomUUID, createHash } from 'node:crypto';
import {
  mkdir,
  realpath,
  lstat,
  readdir,
  open,
  link,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { KnowledgeStore } from './store.js';
import { boundedRead, fingerprint, within, KnowledgeError } from './files.js';
import { wikiSnapshotSchema } from './wiki.js';
import {
  prepareWikiNoteEdit,
  wikiNoteEditRequestSchema,
} from './wiki-note-edit.js';

const candidateSchema = z.strictObject({
  format: z.literal('wiki-note-candidate'),
  schemaVersion: z.literal(1),
  candidateId: z.uuid(),
  createdAt: z.iso.datetime(),
  storeIdentity: z.string().regex(/^[a-f0-9]{64}$/u),
  base: wikiSnapshotSchema,
  request: wikiNoteEditRequestSchema,
});
/** Inert immutable staging; never writes canonical knowledge or publication history. */
export class WikiNoteCandidates {
  constructor(readonly knowledge: KnowledgeStore) {}
  private async identity() {
    return createHash('sha256')
      .update(
        JSON.stringify([
          await realpath(this.knowledge.repositoryRoot),
          await realpath(this.knowledge.storeRoot),
        ]),
      )
      .digest('hex');
  }
  private async directory() {
    await this.knowledge.snapshot();
    const root = await realpath(this.knowledge.storeRoot),
      directory = join(root, 'wiki-note-candidates');
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !within(root, await realpath(directory))
    )
      throw new KnowledgeError(
        'PATH_ESCAPE',
        'Note candidates must remain in the store.',
      );
    return directory;
  }
  async list() {
    const names = await readdir(await this.directory());
    if (names.length > 200)
      throw new KnowledgeError('LIMIT', 'Too many note candidate entries.');
    const result = [];
    for (const name of names.sort())
      if (name.endsWith('.json'))
        result.push(await this.read(name.slice(0, -5)));
    return result;
  }
  async read(id: string) {
    z.uuid().parse(id);
    const directory = await this.directory(),
      path = join(directory, id + '.json');
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !within(directory, await realpath(path))
    )
      throw new KnowledgeError(
        'PATH_ESCAPE',
        'Expected a contained note candidate file.',
      );
    const text = await boundedRead(path),
      candidate = candidateSchema.parse(JSON.parse(text));
    if (
      candidate.candidateId !== id ||
      candidate.storeIdentity !== (await this.identity())
    )
      throw new KnowledgeError(
        'INVALID_WIKI_NOTE_CANDIDATE',
        'Candidate identity does not match this store.',
      );
    const review = prepareWikiNoteEdit(candidate.base, candidate.request);
    const current = await this.knowledge.snapshot();
    return {
      candidate,
      review,
      state:
        fingerprint(JSON.stringify(current.snapshot)) === review.baseSnapshot
          ? ('current' as const)
          : ('changed' as const),
      candidateRevision: fingerprint(text),
      published: false as const,
    };
  }
  async save(request: unknown) {
    const snapshot = await this.knowledge.snapshot();
    const input = wikiNoteEditRequestSchema.parse(request);
    prepareWikiNoteEdit(snapshot.snapshot, input);
    const directory = await this.directory();
    if ((await readdir(directory)).length >= 100)
      throw new KnowledgeError(
        'LIMIT',
        'Back up note candidates before adding more.',
      );
    const candidate = candidateSchema.parse({
      format: 'wiki-note-candidate',
      schemaVersion: 1,
      candidateId: randomUUID(),
      createdAt: new Date().toISOString(),
      storeIdentity: await this.identity(),
      base: snapshot.snapshot,
      request: input,
    });
    const text = JSON.stringify(candidate, null, 2) + '\n';
    if (Buffer.byteLength(text, 'utf8') > 1024 * 1024)
      throw new KnowledgeError('LIMIT', 'Note candidate exceeds 1 MiB.');
    const temporary = join(directory, candidate.candidateId + '.tmp');
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
      await handle.close();
      const current = await this.knowledge.snapshot();
      prepareWikiNoteEdit(current.snapshot, input);
      if (candidate.storeIdentity !== (await this.identity()))
        throw new KnowledgeError(
          'INVALID_WIKI_NOTE_CANDIDATE',
          'Store identity changed.',
        );
      await link(temporary, join(directory, candidate.candidateId + '.json'));
    } finally {
      await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
    return {
      candidateId: candidate.candidateId,
      state: 'pending-review' as const,
      published: false as const,
    };
  }
}
