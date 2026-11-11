import { z } from 'zod';
import { cardSchema, proposalInputSchema, type Card } from './schema.js';
import { KnowledgeError } from './files.js';

export const mergeFieldSchema = z.enum([
  'title',
  'kind',
  'body',
  'tags',
  'scope',
  'evidence',
]);
export type MergeField = z.infer<typeof mergeFieldSchema>;
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/** Conservative field merge. Text and arrays are indivisible; conflicts keep current. */
export function mergeCards(
  baseInput: unknown,
  currentInput: unknown,
  proposedInput: unknown,
) {
  const base = cardSchema.parse(baseInput),
    current = cardSchema.parse(currentInput),
    proposed = cardSchema.parse(proposedInput);
  if (
    base.id !== current.id ||
    base.id !== proposed.id ||
    current.revision < base.revision ||
    (current.revision === base.revision && !same(base, current)) ||
    proposed.revision !== base.revision + 1
  )
    throw new KnowledgeError(
      'INVALID_MERGE_BASE',
      'Merge requires the same stable ID and valid base/current/proposed revisions',
    );
  const merged: Card = { ...current, revision: current.revision + 1 };
  const conflicts: MergeField[] = [];
  for (const field of mergeFieldSchema.options) {
    if (
      same(current[field], proposed[field]) ||
      same(base[field], proposed[field])
    )
      continue;
    if (same(base[field], current[field]))
      Object.assign(merged, { [field]: proposed[field] });
    else conflicts.push(field);
  }
  return {
    base,
    current,
    proposed,
    merged: cardSchema.parse(merged),
    conflicts,
  };
}

const header = { proposalId: z.uuid(), createdAt: z.iso.datetime() };
export const proposalRecordSchema = z.discriminatedUnion('schemaVersion', [
  proposalInputSchema.extend({ schemaVersion: z.literal(1), ...header }),
  proposalInputSchema.extend({
    schemaVersion: z.literal(2),
    ...header,
    baseCard: cardSchema,
    merge: z
      .strictObject({
        reviewId: z.uuid(),
        resolvedFields: z.array(mergeFieldSchema).max(6),
      })
      .optional(),
  }),
]);
