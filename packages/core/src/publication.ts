import { randomUUID } from 'node:crypto';
import {
  open,
  realpath,
  mkdir,
  lstat,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { z } from 'zod';
import { KnowledgeStore } from './store.js';
import {
  boundedRead,
  boundedBytes,
  within,
  fingerprint,
  KnowledgeError,
} from './files.js';
import {
  proposalInputSchema,
  snapshotSchema,
  type Card,
  type ProposalInput,
} from './schema.js';

const uuid = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const savedProposal = proposalInputSchema.extend({
  schemaVersion: z.literal(1),
  proposalId: uuid,
  createdAt: z.iso.datetime(),
});
const journal = z.strictObject({
  schemaVersion: z.literal(1),
  transactionId: uuid,
  operation: z.enum(['publish', 'rollback']),
  itemId: uuid,
  cardId: z.string(),
  createdAt: z.iso.datetime(),
  beforeSnapshot: digest,
  afterSnapshot: digest,
  beforeRevision: z.int().min(1),
  afterRevision: z.int().min(2),
});
export interface KnowledgeReview {
  itemId: string;
  operation: 'publish' | 'rollback';
  token: string;
  baseSnapshot: string;
  before: Card;
  after: Card;
  reason: string;
}
async function writeExclusive(
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

export class KnowledgePublication {
  constructor(readonly knowledge: KnowledgeStore) {}
  private async directory(name: string, create = false) {
    const root = await realpath(this.knowledge.storeRoot);
    const path = join(root, name);
    if (create) await mkdir(path, { recursive: true });
    const info = await lstat(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !within(root, await realpath(path))
    )
      throw new KnowledgeError(
        'PATH_ESCAPE',
        'Knowledge metadata directory must be a contained regular directory',
      );
    return path;
  }
  private async readFile(path: string) {
    const root = await realpath(this.knowledge.storeRoot);
    if (
      (await lstat(path)).isSymbolicLink() ||
      !within(root, await realpath(path))
    )
      throw new KnowledgeError(
        'PATH_ESCAPE',
        'Knowledge metadata file escapes store',
      );
    return boundedRead(path);
  }
  private async names(name: string) {
    try {
      const directory = await this.directory(name);
      const entries = await readdir(directory);
      if (entries.length > 200)
        throw new KnowledgeError(
          'LIMIT',
          'Metadata directory exceeds 200 entries; archive with a backup before continuing',
        );
      return entries.sort();
    } catch (error) {
      if (absent(error)) return [];
      throw error;
    }
  }
  async createDraft(id: string) {
    const result = await this.knowledge.read(id);
    const proposalId = randomUUID();
    const draft = {
      schemaVersion: 1,
      proposalId,
      createdAt: new Date().toISOString(),
      id,
      baseRevision: result.card.revision,
      baseSnapshot: result.snapshotRevision,
      reason: '人工编辑 / Human edit',
      proposedCard: { ...result.card, revision: result.card.revision + 1 },
    };
    const directory = await this.directory('drafts', true);
    if ((await this.names('drafts')).length >= 200)
      throw new KnowledgeError('LIMIT', 'Too many drafts');
    const path = join(directory, proposalId + '.json');
    await writeExclusive(path, json(savedProposal.parse(draft)));
    return { draftId: proposalId, path };
  }
  async readCandidate(id: string, kind: 'proposals' | 'drafts' = 'proposals') {
    if (!uuid.safeParse(id).success)
      throw new KnowledgeError('INVALID_ID', 'Expected a candidate UUID');
    const path = join(await this.directory(kind), id + '.json');
    const text = await this.readFile(path);
    const parsed = savedProposal.safeParse(JSON.parse(text));
    if (!parsed.success || parsed.data.proposalId !== id)
      throw new KnowledgeError(
        'INVALID_PROPOSAL',
        'Candidate file does not match schemaVersion 1 or its filename',
      );
    const {
      id: cardId,
      baseRevision,
      baseSnapshot,
      reason,
      proposedCard,
    } = parsed.data;
    const input = {
      id: cardId,
      baseRevision,
      baseSnapshot,
      reason,
      proposedCard,
    };
    return { input, path, text, createdAt: parsed.data.createdAt };
  }
  async submitDraft(id: string) {
    return this.knowledge.propose(
      (await this.readCandidate(id, 'drafts')).input,
    );
  }
  async listCandidates(kind: 'proposals' | 'drafts' = 'proposals') {
    const entries = [];
    const applied =
      kind === 'proposals'
        ? new Set(
            (await this.history())
              .filter(
                (h) =>
                  h.state === 'committed' && h.record.operation === 'publish',
              )
              .map((h) => h.record.itemId),
          )
        : new Set<string>();
    for (const name of await this.names(kind)) {
      const id = name.replace(/\.json$/u, '');
      if (
        !name.endsWith('.json') ||
        !uuid.safeParse(id).success ||
        applied.has(id)
      )
        continue;
      try {
        const candidate = await this.readCandidate(id, kind);
        entries.push({
          id,
          cardId: candidate.input.id,
          title: candidate.input.proposedCard.title,
          state: kind === 'drafts' ? 'draft' : 'pending-review',
          error: '',
        });
      } catch (error) {
        entries.push({
          id,
          cardId: '',
          title: id,
          state: 'invalid',
          error: error instanceof Error ? error.message : 'Invalid candidate',
        });
      }
    }
    return entries;
  }
  private async historyEntry(id: string) {
    if (!uuid.safeParse(id).success)
      throw new KnowledgeError('INVALID_ID', 'Expected a history UUID');
    const directory = await this.directory('history/' + id);
    const record = journal.parse(
      JSON.parse(await this.readFile(join(directory, 'record.json'))),
    );
    const before = await this.readFile(join(directory, 'before.json'));
    const after = await this.readFile(join(directory, 'after.json'));
    if (
      record.transactionId !== id ||
      fingerprint(before) !== record.beforeSnapshot ||
      fingerprint(after) !== record.afterSnapshot
    )
      throw new KnowledgeError(
        'INVALID_HISTORY',
        'History digest or identity mismatch',
      );
    const previous = snapshotSchema.parse(JSON.parse(before));
    const next = snapshotSchema.parse(JSON.parse(after));
    const oldCard = previous.cards.find((card) => card.id === record.cardId);
    const newCard = next.cards.find((card) => card.id === record.cardId);
    if (
      !oldCard ||
      !newCard ||
      oldCard.revision !== record.beforeRevision ||
      newCard.revision !== record.afterRevision ||
      newCard.revision !== oldCard.revision + 1
    )
      throw new KnowledgeError('INVALID_HISTORY', 'History revision mismatch');
    const restored = structuredClone(next);
    restored.cards = restored.cards.map((card) =>
      card.id === record.cardId ? oldCard : card,
    );
    if (json(restored) !== json(previous))
      throw new KnowledgeError(
        'INVALID_HISTORY',
        'History changes more than the recorded card',
      );
    const marker = async (name: string) => {
      try {
        const value = await this.readFile(join(directory, name));
        if (value !== record.afterSnapshot + '\n')
          throw new KnowledgeError('INVALID_HISTORY', 'Invalid history marker');
        return true;
      } catch (error) {
        if (absent(error)) return false;
        throw error;
      }
    };
    const committed = await marker('committed');
    const aborted = await marker('aborted');
    if (committed && aborted)
      throw new KnowledgeError(
        'INVALID_HISTORY',
        'Contradictory history markers',
      );
    return {
      record,
      before,
      after,
      state: committed ? 'committed' : aborted ? 'aborted' : 'prepared',
    };
  }
  async history() {
    const entries = [];
    for (const id of await this.names('history')) {
      if (!uuid.safeParse(id).success)
        throw new KnowledgeError(
          'INVALID_HISTORY',
          'Unknown history entry; inspect store before publication',
        );
      const entry = await this.historyEntry(id);
      entries.push({ record: entry.record, state: entry.state });
    }
    return entries.sort(
      (a, b) =>
        b.record.createdAt.localeCompare(a.record.createdAt) ||
        b.record.transactionId.localeCompare(a.record.transactionId),
    );
  }
  async readHistory(id: string) {
    return this.historyEntry(id);
  }
  private async prepareProposal(id: string) {
    const candidate = await this.readCandidate(id);
    if (
      (await this.history()).some(
        (h) =>
          h.state === 'committed' &&
          h.record.operation === 'publish' &&
          h.record.itemId === id,
      )
    )
      throw new KnowledgeError(
        'ALREADY_PUBLISHED',
        'Candidate has already been published',
      );
    const validated = await this.knowledge.validateProposal(candidate.input);
    const before = validated.snapshot.cards.find(
      (c) => c.id === candidate.input.id,
    )!;
    return {
      input: candidate.input,
      review: {
        itemId: id,
        operation: 'publish' as const,
        token: fingerprint(candidate.text + '\n' + validated.snapshotRevision),
        baseSnapshot: validated.snapshotRevision,
        before,
        after: candidate.input.proposedCard,
        reason: candidate.input.reason,
      },
    };
  }
  async previewProposal(id: string): Promise<KnowledgeReview> {
    return (await this.prepareProposal(id)).review;
  }
  private async prepareRollback(id: string) {
    const entry = await this.historyEntry(id);
    const current = await this.knowledge.snapshot();
    if (
      entry.state !== 'committed' ||
      current.snapshotRevision !== entry.record.afterSnapshot
    )
      throw new KnowledgeError(
        'REVISION_CONFLICT',
        'Rollback requires the current committed history head',
      );
    const previous = snapshotSchema.parse(JSON.parse(entry.before));
    const old = previous.cards.find((c) => c.id === entry.record.cardId);
    const before = current.snapshot.cards.find(
      (c) => c.id === entry.record.cardId,
    );
    if (!old || !before)
      throw new KnowledgeError('INVALID_HISTORY', 'History card is missing');
    const input: ProposalInput = {
      id: before.id,
      baseRevision: before.revision,
      baseSnapshot: current.snapshotRevision,
      reason: 'Rollback ' + id,
      proposedCard: { ...old, revision: before.revision + 1 },
    };
    await this.knowledge.validateProposal(input);
    return {
      input,
      review: {
        itemId: id,
        operation: 'rollback' as const,
        token: fingerprint(
          json(entry.record) +
            entry.before +
            entry.after +
            current.snapshotRevision,
        ),
        baseSnapshot: current.snapshotRevision,
        before,
        after: input.proposedCard,
        reason: input.reason,
      },
    };
  }
  async previewRollback(id: string): Promise<KnowledgeReview> {
    return (await this.prepareRollback(id)).review;
  }
  private async locked<T>(action: () => Promise<T>): Promise<T> {
    const root = await realpath(this.knowledge.storeRoot);
    const path = join(root, '.publication.lock');
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new KnowledgeError(
          'STORE_LOCKED',
          'Another publication or interrupted writer holds the store lock; inspect recovery guidance',
        );
      throw error;
    }
    try {
      await handle.writeFile(
        json({
          owner: randomUUID(),
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }),
      );
      await handle.sync();
      return await action();
    } finally {
      await handle.close();
      await unlink(path);
    }
  }
  private async commit(input: ProposalInput, review: KnowledgeReview) {
    if ((await this.history()).some((h) => h.state === 'prepared'))
      throw new KnowledgeError(
        'RECOVERY_REQUIRED',
        'Resolve prepared history before another publication',
      );
    const validated = await this.knowledge.validateProposal(input);
    const snapshot = structuredClone(validated.snapshot);
    snapshot.cards = snapshot.cards.map((c) =>
      c.id === input.id ? input.proposedCard : c,
    );
    const after = json(snapshotSchema.parse(snapshot));
    if (Buffer.byteLength(after) > 1024 * 1024)
      throw new KnowledgeError(
        'LIMIT',
        'Published snapshot would exceed 1 MiB',
      );
    const root = await realpath(this.knowledge.storeRoot);
    const canonical = join(root, 'knowledge.json');
    if ((await lstat(canonical)).isSymbolicLink())
      throw new KnowledgeError(
        'PATH_ESCAPE',
        'Publication requires a regular canonical snapshot, not a symlink',
      );
    const beforeBytes = await boundedBytes(canonical);
    const before = new TextDecoder('utf-8', { fatal: true }).decode(
      beforeBytes,
    );
    if (fingerprint(before) !== review.baseSnapshot)
      throw new KnowledgeError(
        'REVISION_CONFLICT',
        'Snapshot changed after review',
      );
    const history = await this.directory('history', true);
    if ((await this.names('history')).length >= 200)
      throw new KnowledgeError(
        'LIMIT',
        'History is full; back up and archive before continuing',
      );
    const transactionId = randomUUID();
    const directory = join(history, transactionId);
    await mkdir(directory);
    const record = journal.parse({
      schemaVersion: 1,
      transactionId,
      operation: review.operation,
      itemId: review.itemId,
      cardId: input.id,
      createdAt: new Date().toISOString(),
      beforeSnapshot: review.baseSnapshot,
      afterSnapshot: fingerprint(after),
      beforeRevision: review.before.revision,
      afterRevision: review.after.revision,
    });
    await writeExclusive(join(directory, 'before.json'), beforeBytes);
    await writeExclusive(join(directory, 'after.json'), after);
    await writeExclusive(join(directory, 'record.json'), json(record));
    const temporary = join(root, `.publication-${transactionId}.tmp`);
    let replaced = false;
    try {
      await writeExclusive(temporary, after);
      for (let attempt = 0; ; attempt++) {
        const last = await this.knowledge.validateProposal(input);
        if (last.snapshotRevision !== review.baseSnapshot)
          throw new KnowledgeError(
            'REVISION_CONFLICT',
            'Snapshot changed before atomic replacement',
          );
        try {
          await rename(temporary, canonical);
          break;
        } catch (error) {
          // Windows readers/AV can briefly hold the destination without delete sharing.
          // Retry only the atomic rename, with fresh base/evidence checks each time.
          if (
            process.platform !== 'win32' ||
            attempt >= 5 ||
            !['EPERM', 'EBUSY', 'EACCES'].includes(
              (error as NodeJS.ErrnoException).code ?? '',
            )
          )
            throw error;
          await pause(50);
        }
      }
      replaced = true;
      await writeExclusive(
        join(directory, 'committed'),
        record.afterSnapshot + '\n',
      );
      return {
        transactionId,
        snapshotRevision: record.afterSnapshot,
        revision: input.proposedCard.revision,
      };
    } catch (error) {
      if (replaced)
        throw new KnowledgeError(
          'RECOVERY_REQUIRED',
          'Snapshot changed but history marker failed; inspect and recover this prepared transaction',
        );
      await writeExclusive(
        join(directory, 'aborted'),
        record.afterSnapshot + '\n',
      );
      try {
        await unlink(temporary);
      } catch (cleanup) {
        if (!absent(cleanup)) throw cleanup;
      }
      throw error;
    }
  }
  async publish(id: string, token: string) {
    return this.locked(async () => {
      const prepared = await this.prepareProposal(id);
      if (prepared.review.token !== token)
        throw new KnowledgeError(
          'REVIEW_CHANGED',
          'Candidate changed; review the diff again',
        );
      return this.commit(prepared.input, prepared.review);
    });
  }
  async rollback(id: string, token: string) {
    return this.locked(async () => {
      const prepared = await this.prepareRollback(id);
      if (prepared.review.token !== token)
        throw new KnowledgeError(
          'REVIEW_CHANGED',
          'Rollback view changed; review again',
        );
      return this.commit(prepared.input, prepared.review);
    });
  }
  async recover(id: string, expectedSnapshot: string) {
    return this.locked(async () => {
      const entry = await this.historyEntry(id);
      const current = await this.knowledge.snapshot();
      if (
        entry.state !== 'prepared' ||
        current.snapshotRevision !== expectedSnapshot
      )
        throw new KnowledgeError('REVISION_CONFLICT', 'Recovery state changed');
      const state =
        current.snapshotRevision === entry.record.afterSnapshot
          ? 'committed'
          : current.snapshotRevision === entry.record.beforeSnapshot
            ? 'aborted'
            : undefined;
      if (!state)
        throw new KnowledgeError(
          'RECOVERY_CONFLICT',
          'Canonical snapshot matches neither side; preserve files for manual recovery',
        );
      await writeExclusive(
        join(await this.directory('history/' + id), state),
        entry.record.afterSnapshot + '\n',
      );
      return { state, snapshotRevision: current.snapshotRevision };
    });
  }
}
