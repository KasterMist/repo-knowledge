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
  buildGenerationPacket,
  validateCurrentGeneration,
  type GenerationPacket,
} from './generation.js';
import { scanPlanSchema, type ScanPlan } from './scan.js';
import {
  boundedRead,
  boundedBytes,
  within,
  fingerprint,
  KnowledgeError,
} from './files.js';
import {
  proposalInputSchema,
  cardSchema,
  snapshotSchema,
  type Card,
  type ProposalInput,
  type Snapshot,
} from './schema.js';

const uuid = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const savedProposal = proposalInputSchema.extend({
  schemaVersion: z.literal(1),
  proposalId: uuid,
  createdAt: z.iso.datetime(),
});
const updateJournal = z.strictObject({
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
const creationJournal = z.strictObject({
  schemaVersion: z.literal(2),
  transactionId: uuid,
  operation: z.enum(['create', 'remove-created']),
  itemId: uuid,
  cardIds: z.array(cardSchema.shape.id).min(1).max(8),
  createdAt: z.iso.datetime(),
  beforeSnapshot: digest,
  afterSnapshot: digest,
});
const journal = z.union([updateJournal, creationJournal]);
const creationCandidate = z.strictObject({
  schemaVersion: z.literal(1),
  candidateId: uuid,
  createdAt: z.iso.datetime(),
  plan: scanPlanSchema,
  packetRevision: digest,
  baseSnapshot: digest,
  cards: z.array(cardSchema).min(1).max(8),
});
export interface CreationReview {
  itemId: string;
  operation: 'create' | 'remove-created';
  token: string;
  baseSnapshot: string;
  before: Card[];
  after: Card[];
  reason: string;
}
export type PublicationReview = KnowledgeReview | CreationReview;
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
          'Metadata directory exceeds 200 entries; stop writing and back up the complete store; retain all creation history',
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
  private async reservedIds() {
    return new Set(
      (await this.history()).flatMap((entry) =>
        entry.state === 'committed' &&
        entry.record.schemaVersion === 2 &&
        entry.record.operation === 'create'
          ? entry.record.cardIds
          : [],
      ),
    );
  }
  private async checkCreationIds(cards: Card[]) {
    const reserved = await this.reservedIds();
    if (cards.some((card) => reserved.has(card.id)))
      throw new KnowledgeError(
        'RETIRED_ID',
        'Previously created IDs cannot be reused, including after removal',
      );
  }
  async saveCreation(
    plan: ScanPlan,
    packet: GenerationPacket,
    output: unknown,
  ) {
    const cards = await validateCurrentGeneration(
      this.knowledge,
      plan,
      packet,
      output,
    );
    await this.checkCreationIds(cards);
    const candidate = creationCandidate.parse({
      schemaVersion: 1,
      candidateId: randomUUID(),
      createdAt: new Date().toISOString(),
      plan,
      packetRevision: packet.packetRevision,
      baseSnapshot: packet.baseSnapshot,
      cards,
    });
    const text = json(candidate);
    if (Buffer.byteLength(text) > 1024 * 1024)
      throw new KnowledgeError('LIMIT', 'Creation candidate exceeds 1 MiB');
    const directory = await this.directory('creations', true);
    if ((await this.names('creations')).length >= 200)
      throw new KnowledgeError('LIMIT', 'Too many creation candidates');
    const path = join(directory, candidate.candidateId + '.json');
    await writeExclusive(path, text);
    return {
      candidateId: candidate.candidateId,
      state: 'pending-review',
      path,
    };
  }
  async readCreation(id: string) {
    if (!uuid.safeParse(id).success)
      throw new KnowledgeError(
        'INVALID_ID',
        'Expected a creation candidate UUID',
      );
    const path = join(await this.directory('creations'), id + '.json');
    const text = await this.readFile(path);
    const candidate = creationCandidate.parse(JSON.parse(text));
    if (candidate.candidateId !== id)
      throw new KnowledgeError(
        'INVALID_PROPOSAL',
        'Creation filename and identity differ',
      );
    return { candidate, text, path };
  }
  async listCreations() {
    const applied = new Set(
      (await this.history())
        .filter(
          (entry) =>
            entry.state === 'committed' && entry.record.operation === 'create',
        )
        .map((entry) => entry.record.itemId),
    );
    const entries = [];
    for (const name of await this.names('creations')) {
      const id = name.replace(/\.json$/u, '');
      if (
        !name.endsWith('.json') ||
        !uuid.safeParse(id).success ||
        applied.has(id)
      )
        continue;
      try {
        const { candidate } = await this.readCreation(id);
        entries.push({
          id,
          title: candidate.cards.map((card) => card.title).join(' · '),
          state: 'pending-review',
          error: '',
        });
      } catch {
        entries.push({
          id,
          title: id,
          state: 'invalid',
          error: 'Invalid creation candidate; inspect saved file',
        });
      }
    }
    return entries;
  }
  private async prepareCreation(id: string) {
    const { candidate, text } = await this.readCreation(id);
    if (
      (await this.history()).some(
        (entry) =>
          entry.state === 'committed' &&
          entry.record.operation === 'create' &&
          entry.record.itemId === id,
      )
    )
      throw new KnowledgeError(
        'ALREADY_PUBLISHED',
        'Creation candidate has already been published',
      );
    const packet = await buildGenerationPacket(this.knowledge, candidate.plan);
    if (
      packet.baseSnapshot !== candidate.baseSnapshot ||
      packet.packetRevision !== candidate.packetRevision
    )
      throw new KnowledgeError(
        'GENERATION_BASE_CHANGED',
        'Creation source or knowledge changed; prepare a fresh candidate',
      );
    const output = {
      packetRevision: candidate.packetRevision,
      pages: candidate.cards.map((card) => ({
        id: card.id,
        title: card.title,
        kind: card.kind,
        body: card.body,
        tags: card.tags,
        scope: card.scope,
        evidence: card.evidence.map((evidence) => ({
          path: evidence.path,
          startLine: evidence.startLine,
          endLine: evidence.endLine,
        })),
      })),
    };
    const cards = await validateCurrentGeneration(
      this.knowledge,
      candidate.plan,
      packet,
      output,
    );
    if (json(cards) !== json(candidate.cards))
      throw new KnowledgeError(
        'INVALID_PROPOSAL',
        'Creation card revisions or evidence hashes differ from selected source',
      );
    await this.checkCreationIds(cards);
    const current = await this.knowledge.snapshot();
    if (current.snapshotRevision !== candidate.baseSnapshot)
      throw new KnowledgeError(
        'REVISION_CONFLICT',
        'Knowledge changed during creation review',
      );
    return {
      snapshot: {
        ...current.snapshot,
        cards: [...current.snapshot.cards, ...cards],
      },
      review: {
        itemId: id,
        operation: 'create' as const,
        token: fingerprint(text + '\n' + current.snapshotRevision),
        baseSnapshot: current.snapshotRevision,
        before: [],
        after: cards,
        reason: '首次创建 / First knowledge creation',
      },
    };
  }
  async previewCreation(id: string): Promise<CreationReview> {
    return (await this.prepareCreation(id)).review;
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
    if (record.schemaVersion === 1) {
      const oldCard = previous.cards.find((card) => card.id === record.cardId);
      const newCard = next.cards.find((card) => card.id === record.cardId);
      if (
        !oldCard ||
        !newCard ||
        oldCard.revision !== record.beforeRevision ||
        newCard.revision !== record.afterRevision ||
        newCard.revision !== oldCard.revision + 1
      )
        throw new KnowledgeError(
          'INVALID_HISTORY',
          'History revision mismatch',
        );
      const restored = structuredClone(next);
      restored.cards = restored.cards.map((card) =>
        card.id === record.cardId ? oldCard : card,
      );
      if (json(restored) !== json(previous))
        throw new KnowledgeError(
          'INVALID_HISTORY',
          'History changes more than the recorded card',
        );
    } else {
      const ids = new Set(record.cardIds);
      const smaller = record.operation === 'create' ? previous : next;
      const larger = record.operation === 'create' ? next : previous;
      const added = larger.cards.filter((card) => ids.has(card.id));
      const restored = {
        ...larger,
        cards: larger.cards.filter((card) => !ids.has(card.id)),
      };
      if (
        ids.size !== record.cardIds.length ||
        added.length !== ids.size ||
        added.some((card) => card.revision !== 1) ||
        smaller.cards.some((card) => ids.has(card.id)) ||
        json(restored) !== json(smaller) ||
        (record.operation === 'create' &&
          json(larger.cards.slice(-ids.size).map((card) => card.id)) !==
            json(record.cardIds))
      )
        throw new KnowledgeError(
          'INVALID_HISTORY',
          'Creation history must only add/remove the recorded revision-1 batch',
        );
    }
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
    if (entry.record.schemaVersion !== 1)
      throw new KnowledgeError(
        'INVALID_HISTORY',
        'Use creation rollback for a creation transaction',
      );
    const cardId = entry.record.cardId;
    const previous = snapshotSchema.parse(JSON.parse(entry.before));
    const old = previous.cards.find((c) => c.id === cardId);
    const before = current.snapshot.cards.find((c) => c.id === cardId);
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
  private async prepareCreationRollback(id: string) {
    const entry = await this.historyEntry(id);
    const current = await this.knowledge.snapshot();
    if (entry.record.schemaVersion !== 2 || entry.record.operation !== 'create')
      throw new KnowledgeError(
        'INVALID_HISTORY',
        'Only a creation transaction can remove its new cards; removal cannot be undone',
      );
    const history = await this.history();
    if (
      entry.state !== 'committed' ||
      current.snapshotRevision !== entry.record.afterSnapshot ||
      history.some(
        (item) =>
          item.state === 'committed' &&
          ((item.record.operation === 'remove-created' &&
            item.record.itemId === id) ||
            item.record.beforeSnapshot === entry.record.afterSnapshot),
      )
    )
      throw new KnowledgeError(
        'REVISION_CONFLICT',
        'Removal requires an unmodified, not previously removed creation head',
      );
    const ids = new Set(entry.record.cardIds);
    const cards = current.snapshot.cards.filter((card) => ids.has(card.id));
    return {
      snapshot: {
        ...current.snapshot,
        cards: current.snapshot.cards.filter((card) => !ids.has(card.id)),
      },
      review: {
        itemId: id,
        operation: 'remove-created' as const,
        token: fingerprint(
          json(entry.record) +
            entry.before +
            entry.after +
            current.snapshotRevision,
        ),
        baseSnapshot: current.snapshotRevision,
        before: cards,
        after: [],
        reason:
          '删除这批首次创建的卡片；ID 永久保留 / Remove this creation batch; IDs remain reserved',
      },
    };
  }
  async previewRollback(id: string): Promise<PublicationReview> {
    const entry = await this.historyEntry(id);
    return entry.record.schemaVersion === 1
      ? (await this.prepareRollback(id)).review
      : (await this.prepareCreationRollback(id)).review;
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
    const validate = async () => {
      const validated = await this.knowledge.validateProposal(input);
      const snapshot = structuredClone(validated.snapshot);
      snapshot.cards = snapshot.cards.map((c) =>
        c.id === input.id ? input.proposedCard : c,
      );
      return { snapshot, snapshotRevision: validated.snapshotRevision };
    };
    return this.commitSnapshot(
      review,
      () => validate(),
      {
        schemaVersion: 1,
        cardId: input.id,
        beforeRevision: review.before.revision,
        afterRevision: review.after.revision,
      },
      input.proposedCard.revision,
    );
  }
  private async commitSnapshot(
    review: PublicationReview,
    validate: () => Promise<{ snapshot: Snapshot; snapshotRevision: string }>,
    fields:
      | {
          schemaVersion: 1;
          cardId: string;
          beforeRevision: number;
          afterRevision: number;
        }
      | { schemaVersion: 2; cardIds: string[] },
    revision: number,
  ) {
    if ((await this.history()).some((h) => h.state === 'prepared'))
      throw new KnowledgeError(
        'RECOVERY_REQUIRED',
        'Resolve prepared history before another publication',
      );
    const validated = await validate();
    if (validated.snapshotRevision !== review.baseSnapshot)
      throw new KnowledgeError(
        'REVISION_CONFLICT',
        'Snapshot changed after review',
      );
    const after = json(snapshotSchema.parse(validated.snapshot));
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
        'History is full; stop writing and back up the complete store; do not remove creation history',
      );
    const transactionId = randomUUID();
    const directory = join(history, transactionId);
    await mkdir(directory);
    const record = journal.parse({
      ...fields,
      transactionId,
      operation: review.operation,
      itemId: review.itemId,
      createdAt: new Date().toISOString(),
      beforeSnapshot: review.baseSnapshot,
      afterSnapshot: fingerprint(after),
    });
    await writeExclusive(join(directory, 'before.json'), beforeBytes);
    await writeExclusive(join(directory, 'after.json'), after);
    await writeExclusive(join(directory, 'record.json'), json(record));
    const temporary = join(root, `.publication-${transactionId}.tmp`);
    let replaced = false;
    try {
      await writeExclusive(temporary, after);
      for (let attempt = 0; ; attempt++) {
        const last = await validate();
        if (
          last.snapshotRevision !== review.baseSnapshot ||
          json(last.snapshot) !== after
        )
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
        revision,
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
      if ((await this.historyEntry(id)).record.schemaVersion === 2)
        return this.commitCreation(id, token, true);
      const prepared = await this.prepareRollback(id);
      if (prepared.review.token !== token)
        throw new KnowledgeError(
          'REVIEW_CHANGED',
          'Rollback view changed; review again',
        );
      return this.commit(prepared.input, prepared.review);
    });
  }
  private async commitCreation(id: string, token: string, remove = false) {
    const prepare = () =>
      remove ? this.prepareCreationRollback(id) : this.prepareCreation(id);
    const prepared = await prepare();
    if (prepared.review.token !== token)
      throw new KnowledgeError(
        'REVIEW_CHANGED',
        'Creation view changed; review the diff again',
      );
    const validate = async () => {
      const current = await prepare();
      if (current.review.token !== token)
        throw new KnowledgeError(
          'REVIEW_CHANGED',
          'Creation view changed; review again',
        );
      return {
        snapshot: current.snapshot,
        snapshotRevision: current.review.baseSnapshot,
      };
    };
    return this.commitSnapshot(
      prepared.review,
      validate,
      {
        schemaVersion: 2,
        cardIds: (remove ? prepared.review.before : prepared.review.after).map(
          (card) => card.id,
        ),
      },
      remove ? 0 : 1,
    );
  }
  async publishCreation(id: string, token: string) {
    return this.locked(() => this.commitCreation(id, token));
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
