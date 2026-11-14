import { isDeepStrictEqual } from 'node:util';
import { boundedRead, KnowledgeError } from './files.js';
import { KnowledgeStore } from './store.js';
import {
  parseWikiSnapshot,
  resolveWikiArticle,
  type WikiSnapshot,
} from './wiki.js';

/** Explicit preview file only; never a canonical store writer or implicit importer. */
export const loadWikiPreviewText = (path: string): Promise<string> =>
  boundedRead(path);
export class WikiPreviewReader {
  private constructor(
    private readonly knowledge: KnowledgeStore,
    private readonly preview: WikiSnapshot,
  ) {}
  static async open(knowledge: KnowledgeStore, text: string) {
    const preview = parseWikiSnapshot(text);
    const { snapshot } = await knowledge.snapshot();
    if (!isDeepStrictEqual(preview.repository, snapshot.repository))
      throw new KnowledgeError(
        'WIKI_REPOSITORY_MISMATCH',
        'Preview belongs to another repository/source revision',
      );
    return new WikiPreviewReader(knowledge, preview);
  }
  catalog() {
    return this.preview.articles
      .map(({ id, title, parentId, order }) => ({ id, title, parentId, order }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }
  async read(id: string) {
    const { snapshot, snapshotRevision } = await this.knowledge.snapshot();
    if (!isDeepStrictEqual(snapshot.repository, this.preview.repository))
      throw new KnowledgeError(
        'WIKI_REPOSITORY_MISMATCH',
        'Repository changed; reopen the preview',
      );
    // Preview-supplied cards never replace canonical facts. Only article metadata is used.
    const resolved = resolveWikiArticle(
      { ...this.preview, cards: snapshot.cards },
      id,
    );
    const ids = new Set(
      resolved.sections.flatMap((section) =>
        section.blocks.flatMap((block) =>
          block.bindings
            .filter((binding) => binding.binding === 'matches')
            .map((binding) => binding.reference.cardId),
        ),
      ),
    );
    const evidence: {
      cardId: string;
      index: number;
      path: string;
      startLine: number;
      endLine: number;
      status: string;
    }[] = [];
    for (const cardId of ids) {
      const current = await this.knowledge.read(cardId);
      if (current.snapshotRevision !== snapshotRevision)
        throw new KnowledgeError(
          'REVISION_CONFLICT',
          'Knowledge changed while reading; refresh the preview',
        );
      evidence.push(
        ...current.evidence.map((entry, index) => ({
          cardId,
          index,
          path: entry.path,
          startLine: entry.startLine,
          endLine: entry.endLine,
          status: entry.status,
        })),
      );
    }
    if ((await this.knowledge.snapshot()).snapshotRevision !== snapshotRevision)
      throw new KnowledgeError(
        'REVISION_CONFLICT',
        'Knowledge changed while reading; refresh the preview',
      );
    const sourceFreshness: 'current' | 'stale' | 'unavailable' | 'unchecked' =
      evidence.some((entry) => entry.status !== 'current')
        ? 'stale'
        : resolved.needsReview
          ? 'unavailable'
          : evidence.length
            ? 'current'
            : 'unchecked';
    return {
      ...resolved,
      snapshotRevision,
      evidence,
      sourceFreshness,
      preview: true as const,
    };
  }
  async evidence(
    articleId: string,
    cardId: string,
    index: number,
    revision: string,
  ) {
    const view = await this.read(articleId);
    if (view.snapshotRevision !== revision)
      throw new KnowledgeError(
        'REVISION_CONFLICT',
        'Knowledge changed; refresh before opening evidence',
      );
    if (
      !Number.isInteger(index) ||
      !view.evidence.some(
        (entry) => entry.cardId === cardId && entry.index === index,
      )
    )
      throw new KnowledgeError(
        'INVALID_EVIDENCE',
        'Evidence is not part of this article',
      );
    return this.knowledge.evidenceLocation(cardId, index, revision);
  }
}
export type WikiArticleView = Awaited<ReturnType<WikiPreviewReader['read']>>;
