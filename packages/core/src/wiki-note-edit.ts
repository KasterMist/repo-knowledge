import { z } from 'zod';
import { cardSchema } from './schema.js';
import { wikiSnapshotSchema } from './wiki.js';
import { fingerprint, KnowledgeError } from './files.js';

export const wikiNoteEditRequestSchema = z.strictObject({
  articleId: cardSchema.shape.id,
  sectionId: cardSchema.shape.id,
  blockId: cardSchema.shape.id,
  baseRevision: z.int().min(1),
  baseSnapshot: z.string().regex(/^[a-f0-9]{64}$/u),
  body: z
    .string()
    .min(1)
    .max(8000)
    .refine((value) => value.trim().length > 0),
  reason: z.string().trim().min(1).max(2000),
});

/** Pure review preparation only: no persistence, publication or source freshness claim. */
export function prepareWikiNoteEdit(snapshot: unknown, request: unknown) {
  const before = wikiSnapshotSchema.parse(snapshot);
  const edit = wikiNoteEditRequestSchema.parse(request);
  const baseSnapshot = fingerprint(JSON.stringify(before));
  const article = before.articles.find((value) => value.id === edit.articleId);
  if (
    baseSnapshot !== edit.baseSnapshot ||
    article?.revision !== edit.baseRevision
  )
    throw new KnowledgeError(
      'REVISION_CONFLICT',
      'Review the current article and snapshot before editing.',
    );
  const block = article.sections
    .find((value) => value.id === edit.sectionId)
    ?.blocks.find((value) => value.id === edit.blockId);
  if (!block || block.type !== 'note' || block.author !== 'human')
    throw new KnowledgeError(
      'WIKI_NOTE_NOT_EDITABLE',
      'Select an existing human-authored note; shared facts and model attribution cannot be rewritten here.',
    );
  if (block.body === edit.body)
    throw new KnowledgeError(
      'WIKI_NOTE_UNCHANGED',
      'The note body has not changed.',
    );
  const after = structuredClone(before);
  const changed = after.articles.find((value) => value.id === edit.articleId)!;
  changed.revision++;
  const note = changed.sections
    .find((value) => value.id === edit.sectionId)!
    .blocks.find((value) => value.id === edit.blockId)!;
  if (note.type !== 'note') throw new Error('Unexpected note shape');
  note.body = edit.body;
  return {
    before,
    after: wikiSnapshotSchema.parse(after),
    baseSnapshot,
    reason: edit.reason,
    requiresReview: true as const,
    published: false as const,
  };
}
