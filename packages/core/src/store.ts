import { boundedRead, within, fingerprint, KnowledgeError } from './files.js';
export { fingerprint, KnowledgeError } from './files.js';
import { rankCards } from './search.js';
import { randomUUID } from 'node:crypto';
import { open, realpath, mkdir, lstat } from 'node:fs/promises';
import { resolve, isAbsolute, join } from 'node:path';
import { snapshotSchema, proposalInputSchema, type Card } from './schema.js';

export class KnowledgeStore {
  constructor(
    readonly repositoryRoot: string,
    readonly storeRoot: string,
  ) {
    if (!isAbsolute(repositoryRoot) || !isAbsolute(storeRoot))
      throw new KnowledgeError(
        'INVALID_PATH',
        'Repository and store paths must be absolute',
      );
  }
  async snapshot() {
    let text: string;
    try {
      const store = await realpath(this.storeRoot);
      const path = await realpath(join(store, 'knowledge.json'));
      if (!within(store, path))
        throw new KnowledgeError('PATH_ESCAPE', 'Knowledge file escapes store');
      text = await boundedRead(path);
    } catch (error) {
      if (error instanceof KnowledgeError) throw error;
      throw new KnowledgeError(
        'STORE_UNAVAILABLE',
        'Cannot read knowledge.json; initialize or check the store',
      );
    }
    try {
      return {
        snapshot: snapshotSchema.parse(JSON.parse(text)),
        snapshotRevision: fingerprint(text),
      };
    } catch {
      throw new KnowledgeError(
        'INVALID_SNAPSHOT',
        'knowledge.json does not match schemaVersion 1',
      );
    }
  }
  private async inspect(card: Card) {
    const root = await realpath(this.repositoryRoot);
    return Promise.all(
      card.evidence.map(async (evidence) => {
        try {
          const path = await realpath(resolve(root, evidence.path));
          if (!within(root, path))
            throw new KnowledgeError(
              'PATH_ESCAPE',
              'Evidence escapes repository',
            );
          const text = (await boundedRead(path)).replaceAll('\r\n', '\n');
          const lines = text.split('\n');
          const status =
            evidence.endLine > lines.length
              ? 'invalid-range'
              : fingerprint(text) !== evidence.sha256
                ? 'changed'
                : 'current';
          const excerpt = lines
            .slice(evidence.startLine - 1, evidence.endLine)
            .join('\n');
          return {
            ...evidence,
            status,
            excerpt: excerpt.slice(0, 16000),
            truncated: excerpt.length > 16000,
          };
        } catch (error) {
          return {
            ...evidence,
            status:
              error instanceof KnowledgeError ? error.code : 'unavailable',
            excerpt: '',
          };
        }
      }),
    );
  }
  async read(id: string) {
    const { snapshot, snapshotRevision } = await this.snapshot();
    const card = snapshot.cards.find((entry) => entry.id === id);
    if (!card)
      throw new KnowledgeError('NOT_FOUND', 'Knowledge card not found');
    const evidence = await this.inspect(card);
    return {
      card,
      repository: snapshot.repository,
      snapshotRevision,
      stale: evidence.some((entry) => entry.status !== 'current'),
      evidence,
    };
  }
  async search(query: string, limit = 5) {
    if (
      !query.trim() ||
      query.length > 200 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20
    )
      throw new KnowledgeError(
        'INVALID_QUERY',
        'Use a non-empty query up to 200 characters and limit 1–20',
      );
    const { snapshot, snapshotRevision } = await this.snapshot();
    const results = rankCards(snapshot.cards, query, limit);
    return {
      snapshotRevision,
      results,
      freshness: 'Call read_knowledge to verify source evidence',
    };
  }
  async evidenceLocation(id: string, index: number, baseSnapshot: string) {
    const result = await this.read(id);
    if (result.snapshotRevision !== baseSnapshot)
      throw new KnowledgeError(
        'REVISION_CONFLICT',
        'Knowledge changed; refresh the workbench before opening evidence',
      );
    const evidence = result.evidence[index];
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      !evidence ||
      !['current', 'changed'].includes(evidence.status)
    )
      throw new KnowledgeError(
        'INVALID_EVIDENCE',
        'Source evidence is unavailable or outside the repository',
      );
    const root = await realpath(this.repositoryRoot);
    const path = await realpath(resolve(root, evidence.path));
    if (!within(root, path))
      throw new KnowledgeError('PATH_ESCAPE', 'Evidence escapes repository');
    return {
      path,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      status: evidence.status,
    };
  }
  async status() {
    const { snapshot, snapshotRevision } = await this.snapshot();
    const cards = [];
    for (const card of snapshot.cards) {
      const evidence = await this.inspect(card);
      cards.push({
        id: card.id,
        revision: card.revision,
        stale: evidence.some((entry) => entry.status !== 'current'),
      });
    }
    return {
      schemaVersion: snapshot.schemaVersion,
      repository: snapshot.repository,
      snapshotRevision,
      cards,
    };
  }
  async validateProposal(input: unknown) {
    const parsed = proposalInputSchema.safeParse(input);
    if (!parsed.success)
      throw new KnowledgeError(
        'INVALID_PROPOSAL',
        'Proposal does not match the schema',
      );
    const proposal = parsed.data;
    const { snapshot, snapshotRevision } = await this.snapshot();
    const current = snapshot.cards.find((card) => card.id === proposal.id);
    if (!current)
      throw new KnowledgeError('NOT_FOUND', 'Knowledge card not found');
    if (
      proposal.baseSnapshot !== snapshotRevision ||
      proposal.baseRevision !== current.revision
    )
      throw new KnowledgeError(
        'REVISION_CONFLICT',
        'Read the current snapshot before proposing again',
      );
    if (
      proposal.proposedCard.id !== current.id ||
      proposal.proposedCard.revision !== current.revision + 1
    )
      throw new KnowledgeError(
        'INVALID_REVISION',
        'Keep the stable ID and increment revision by one',
      );
    const evidence = await this.inspect(proposal.proposedCard);
    if (evidence.some((entry) => entry.status !== 'current'))
      throw new KnowledgeError(
        'STALE_EVIDENCE',
        'Proposed evidence must match current source',
      );
    return { proposal, snapshot, snapshotRevision };
  }
  async propose(input: unknown) {
    const { proposal, snapshotRevision } = await this.validateProposal(input);
    const store = await realpath(this.storeRoot);
    const directory = join(store, 'proposals');
    await mkdir(directory, { recursive: true });
    if (
      (await lstat(directory)).isSymbolicLink() ||
      !within(store, await realpath(directory))
    )
      throw new KnowledgeError(
        'PATH_ESCAPE',
        'Proposal directory escapes store',
      );
    const latest = await this.snapshot();
    if (latest.snapshotRevision !== snapshotRevision)
      throw new KnowledgeError(
        'REVISION_CONFLICT',
        'Snapshot changed during proposal validation',
      );
    const proposalId = randomUUID();
    const handle = await open(
      join(directory, `${proposalId}.json`),
      'wx',
      0o600,
    );
    try {
      await handle.writeFile(
        JSON.stringify(
          {
            schemaVersion: 1,
            proposalId,
            createdAt: new Date().toISOString(),
            ...proposal,
          },
          null,
          2,
        ) + '\n',
      );
    } finally {
      await handle.close();
    }
    return {
      proposalId,
      state: 'pending-review',
      baseSnapshot: snapshotRevision,
    };
  }
}
