import { createHash } from 'node:crypto';
import { z } from 'zod';
import { cardSchema } from './schema.js';
import { KnowledgeError } from './files.js';
import { prepareWikiUpgrade, resolveWikiArticle } from './wiki.js';
import type { RuntimeSnapshot } from './snapshot-format.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const rawDigest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export const wikiJournalSchema = z.strictObject({
  schemaVersion: z.literal(3),
  transactionId: z.uuid(),
  operation: z.enum([
    'migrate-wiki',
    'restore-wiki',
    'create-wiki',
    'remove-wiki',
  ]),
  itemId: z.uuid(),
  cardIds: z.array(cardSchema.shape.id).max(8),
  articleIds: z.array(cardSchema.shape.id).max(3),
  createdAt: z.iso.datetime(),
  beforeSnapshot: digest,
  afterSnapshot: digest,
  beforeBytesSha256: digest,
  afterBytesSha256: digest,
  priorTransactions: z.array(z.uuid()).max(200),
});
export type WikiJournal = z.infer<typeof wikiJournalSchema>;
export interface WikiReview {
  itemId: string;
  operation: WikiJournal['operation'];
  token: string;
  baseSnapshot: string;
  before: RuntimeSnapshot;
  after: RuntimeSnapshot;
  reason: string;
  retainedMetadata: { entries: number; revision: string };
  adaptedFromMigration?: string;
  restoreBytesSha256?: string;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const invalid = () => {
  throw new KnowledgeError(
    'INVALID_HISTORY',
    'Wiki history changes more than its recorded migration or creation batch',
  );
};

/** Semantic delta validation is independent of file digests and commit markers. */
export function validateWikiTransition(
  record: WikiJournal,
  before: RuntimeSnapshot,
  after: RuntimeSnapshot,
  beforeText: string,
  afterText: string,
) {
  if (
    new Set(record.priorTransactions).size !==
      record.priorTransactions.length ||
    record.priorTransactions.includes(record.transactionId)
  )
    invalid();
  if (
    record.operation === 'migrate-wiki' ||
    record.operation === 'restore-wiki'
  ) {
    if (record.cardIds.length || record.articleIds.length) invalid();
    const old = record.operation === 'migrate-wiki' ? before : after;
    const next = record.operation === 'migrate-wiki' ? after : before;
    const text = record.operation === 'migrate-wiki' ? beforeText : afterText;
    if (
      old.schemaVersion !== 1 ||
      next.schemaVersion !== 2 ||
      next.articles.length
    )
      invalid();
    const upgraded = JSON.parse(prepareWikiUpgrade(text).targetText) as unknown;
    if (!same(upgraded, next)) invalid();
    return;
  }
  if (before.schemaVersion !== 2 || after.schemaVersion !== 2) return invalid();
  const smaller = record.operation === 'create-wiki' ? before : after;
  const larger = record.operation === 'create-wiki' ? after : before;
  const cards = new Set(record.cardIds),
    articles = new Set(record.articleIds);
  const addedCards = larger.cards.filter((card) => cards.has(card.id));
  const addedArticles = larger.articles.filter((article) =>
    articles.has(article.id),
  );
  if (
    !cards.size ||
    !articles.size ||
    cards.size !== record.cardIds.length ||
    articles.size !== record.articleIds.length ||
    addedCards.length !== cards.size ||
    addedArticles.length !== articles.size ||
    addedCards.some((card) => card.revision !== 1) ||
    addedArticles.some((article) => article.revision !== 1)
  )
    invalid();
  if (
    smaller.cards.some((card) => cards.has(card.id)) ||
    smaller.articles.some((article) => articles.has(article.id))
  )
    invalid();
  const restored = {
    ...larger,
    cards: larger.cards.filter((card) => !cards.has(card.id)),
    articles: larger.articles.filter((article) => !articles.has(article.id)),
  };
  if (!same(restored, smaller)) invalid();
  const used = new Set<string>();
  for (const article of addedArticles) {
    if (
      article.kind === 'guide' ||
      article.sections.length > 6 ||
      article.sections.some((section) => section.blocks.length > 8) ||
      !article.sections.some((section) =>
        section.blocks.some((block) => block.type === 'card'),
      )
    )
      invalid();
    if (resolveWikiArticle(larger, article.id).needsReview) invalid();
    if (
      article.sections.some((section) =>
        section.blocks.some((block) =>
          block.type === 'note'
            ? block.author !== 'model' ||
              block.kind !== 'inference' ||
              block.references.some((reference) => !cards.has(reference.cardId))
            : !cards.has(block.reference.cardId),
        ),
      )
    )
      invalid();
    for (const section of article.sections)
      for (const block of section.blocks)
        if (block.type === 'card') used.add(block.reference.cardId);
  }
  if (used.size !== cards.size) invalid();
  if (
    record.operation === 'create-wiki' &&
    (!same(
      larger.cards.slice(-cards.size).map((card) => card.id),
      record.cardIds,
    ) ||
      !same(
        larger.articles.slice(-articles.size).map((article) => article.id),
        record.articleIds,
      ))
  )
    invalid();
}
