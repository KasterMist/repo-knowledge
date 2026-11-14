import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { cardSchema, snapshotSchema } from './schema.js';
import { fingerprint, KnowledgeError } from './files.js';

export const wikiLimits = {
  bytes: 1024 * 1024,
  articles: 64,
  depth: 8,
} as const;
const id = cardSchema.shape.id;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const wikiCardReferenceSchema = z.strictObject({
  cardId: id,
  revision: z.int().min(1),
  sha256: digest,
});
export type WikiCardReference = z.infer<typeof wikiCardReferenceSchema>;
export const wikiBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id,
    type: z.literal('card'),
    reference: wikiCardReferenceSchema,
  }),
  z
    .strictObject({
      id,
      type: z.literal('note'),
      kind: z.enum(['context', 'inference', 'rationale']),
      author: z.enum(['human', 'model']),
      body: z
        .string()
        .min(1)
        .max(8000)
        .refine(
          (value) => value.trim().length > 0,
          'Note body cannot be blank',
        ),
      references: z.array(wikiCardReferenceSchema).max(10),
    })
    .refine(
      (block) => block.kind !== 'rationale' || block.author === 'human',
      'Model-authored prose cannot assert a human design rationale',
    ),
]);
export const wikiArticleSchema = z
  .strictObject({
    id,
    revision: z.int().min(1),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(['overview', 'architecture', 'module', 'guide']),
    language: z.enum(['zh-CN', 'en']),
    parentId: id.nullable(),
    order: z.int().min(0).max(999),
    sections: z
      .array(
        z.strictObject({
          id,
          title: z.string().trim().min(1).max(200),
          blocks: z.array(wikiBlockSchema).min(1).max(20),
        }),
      )
      .min(1)
      .max(20),
  })
  .superRefine((article, context) => {
    const sections = article.sections.map((section) => section.id);
    const blocks = article.sections.flatMap((section) =>
      section.blocks.map((block) => block.id),
    );
    if (
      new Set(sections).size !== sections.length ||
      new Set(blocks).size !== blocks.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Duplicate article section/block IDs',
      });
  });
export type WikiArticle = z.infer<typeof wikiArticleSchema>;
/** Prepared schema only. Runtime KnowledgeStore/MCP writers remain strictly v1. */
export const wikiSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    repository: snapshotSchema.shape.repository,
    cards: snapshotSchema.shape.cards,
    articles: z.array(wikiArticleSchema).max(wikiLimits.articles),
  })
  .superRefine((snapshot, context) => {
    if (
      new Set(snapshot.cards.map((card) => card.id)).size !==
      snapshot.cards.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate card IDs' });
    const articles = new Map(
      snapshot.articles.map((article) => [article.id, article]),
    );
    if (articles.size !== snapshot.articles.length)
      context.addIssue({ code: 'custom', message: 'Duplicate article IDs' });
    const siblings = new Set<string>();
    for (const article of snapshot.articles) {
      const position = JSON.stringify([article.parentId, article.order]);
      if (siblings.has(position))
        context.addIssue({
          code: 'custom',
          message: 'Duplicate sibling order',
        });
      siblings.add(position);
      const visited = new Set<string>();
      let current: WikiArticle | undefined = article;
      while (current) {
        if (visited.has(current.id) || visited.size >= wikiLimits.depth) {
          context.addIssue({
            code: 'custom',
            message: 'Article hierarchy cycle or excessive depth',
          });
          break;
        }
        visited.add(current.id);
        if (current.parentId === null) break;
        current = articles.get(current.parentId);
        if (!current)
          context.addIssue({
            code: 'custom',
            message: 'Missing article parent',
          });
      }
    }
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > wikiLimits.bytes)
      context.addIssue({
        code: 'custom',
        message: 'Wiki snapshot exceeds byte limit',
      });
  });
export type WikiSnapshot = z.infer<typeof wikiSnapshotSchema>;

function checkedText(text: string) {
  if (
    typeof text !== 'string' ||
    Buffer.byteLength(text, 'utf8') > wikiLimits.bytes
  )
    throw new KnowledgeError(
      'WIKI_TOO_LARGE',
      'Wiki snapshot input exceeds 1 MiB',
    );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new KnowledgeError(
      'INVALID_WIKI_JSON',
      'Wiki snapshot is not valid JSON',
    );
  }
}
export function parseWikiSnapshot(text: string): WikiSnapshot {
  const result = wikiSnapshotSchema.safeParse(checkedText(text));
  if (!result.success)
    throw new KnowledgeError(
      'INVALID_WIKI_SNAPSHOT',
      'Wiki snapshot does not match prepared schemaVersion 2',
    );
  return result.data;
}
export function bindWikiCard(card: unknown): WikiCardReference {
  const parsed = cardSchema.parse(card);
  return {
    cardId: parsed.id,
    revision: parsed.revision,
    sha256: fingerprint(JSON.stringify(parsed)),
  };
}
export type WikiBinding = {
  reference: WikiCardReference;
  binding: 'matches' | 'changed' | 'missing';
};
/** Checks knowledge bindings, not live source freshness. Changed content is not substituted. */
export function resolveWikiArticle(input: unknown, articleId: string) {
  const snapshot = wikiSnapshotSchema.parse(input);
  const article = snapshot.articles.find((article) => article.id === articleId);
  if (!article)
    throw new KnowledgeError('WIKI_ARTICLE_MISSING', 'Article does not exist');
  const cards = new Map(snapshot.cards.map((card) => [card.id, card]));
  const bind = (reference: WikiCardReference): WikiBinding => {
    const card = cards.get(reference.cardId);
    if (!card) return { reference, binding: 'missing' };
    const current = bindWikiCard(card);
    return {
      reference,
      binding:
        current.revision === reference.revision &&
        current.sha256 === reference.sha256
          ? 'matches'
          : 'changed',
    };
  };
  const sections = article.sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => {
      if (block.type === 'note')
        return { ...block, bindings: block.references.map(bind) };
      const binding = bind(block.reference);
      // Never present a new card body as if it were the referenced revision.
      return {
        ...block,
        bindings: [binding],
        ...(binding.binding === 'matches'
          ? { card: cards.get(block.reference.cardId)! }
          : {}),
      };
    }),
  }));
  return {
    article,
    sections,
    needsReview: sections.some((section) =>
      section.blocks.some((block) =>
        block.bindings.some((binding) => binding.binding !== 'matches'),
      ),
    ),
    sourceFreshness: 'unchecked' as const,
  };
}
function migrationPreview(
  baseText: string,
  target: unknown,
  from: 1 | 2,
  to: 1 | 2,
) {
  const targetText = JSON.stringify(target, null, 2) + '\n';
  checkedText(targetText);
  return {
    fromSchema: from,
    toSchema: to,
    baseRevision: fingerprint(baseText),
    targetRevision: fingerprint(targetText),
    targetText,
    requiresReview: true as const,
  };
}
/** Pure, deterministic preview: no filesystem writes, backups or runtime format switch. */
export function prepareWikiUpgrade(text: string) {
  const input = checkedText(text);
  const result = snapshotSchema.safeParse(input);
  if (!result.success)
    throw new KnowledgeError(
      'WIKI_UPGRADE_REQUIRES_V1',
      'Upgrade preview requires a valid v1 snapshot',
    );
  if (!isDeepStrictEqual(input, result.data))
    throw new KnowledgeError(
      'WIKI_MIGRATION_NORMALIZES_CONTENT',
      'Migration would normalize existing text; review it separately',
    );
  const target = wikiSnapshotSchema.parse({
    ...result.data,
    schemaVersion: 2,
    articles: [],
  });
  return migrationPreview(text, target, 1, 2);
}
export function prepareWikiDowngrade(text: string) {
  const source = parseWikiSnapshot(text);
  if (!isDeepStrictEqual(checkedText(text), source))
    throw new KnowledgeError(
      'WIKI_MIGRATION_NORMALIZES_CONTENT',
      'Migration would normalize existing text; review it separately',
    );
  if (source.articles.length)
    throw new KnowledgeError(
      'WIKI_DOWNGRADE_WOULD_LOSE_ARTICLES',
      'Preserve/export articles; downgrade cannot discard them',
    );
  const target = snapshotSchema.parse({
    schemaVersion: 1,
    repository: source.repository,
    cards: source.cards,
  });
  return migrationPreview(text, target, 2, 1);
}
