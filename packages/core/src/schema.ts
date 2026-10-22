import { z } from 'zod';

export const relativePath = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (path) =>
      !/[\\:]/u.test(path) &&
      ![...path].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) &&
      !path.startsWith('/') &&
      path
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..') &&
      !['.git', '.codex'].includes(path.split('/')[0] ?? ''),
    'Use a relative POSIX path without traversal or control characters',
  );
export const evidenceSchema = z
  .strictObject({
    path: relativePath,
    startLine: z.int().min(1),
    endLine: z.int().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .refine(
    (value) =>
      value.endLine >= value.startLine && value.endLine - value.startLine < 200,
    'Evidence must reference 1–200 lines',
  );
export const cardSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
  revision: z.int().min(1),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['fact', 'convention', 'rationale', 'inference']),
  body: z.string().trim().min(1).max(16000),
  tags: z.array(z.string().trim().min(1).max(64)).max(20),
  scope: z.array(relativePath).min(1).max(20),
  evidence: z.array(evidenceSchema).min(1).max(10),
});
export const snapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    repository: z.strictObject({
      id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u),
      sourceRevision: z.string().trim().min(1).max(200),
    }),
    cards: z.array(cardSchema).max(200),
  })
  .superRefine((snapshot, context) => {
    if (
      new Set(snapshot.cards.map((card) => card.id)).size !==
      snapshot.cards.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate card IDs' });
  });
export const proposalInputSchema = z.strictObject({
  id: cardSchema.shape.id,
  baseRevision: z.int().min(1),
  baseSnapshot: z.string().regex(/^[a-f0-9]{64}$/u),
  reason: z.string().trim().min(1).max(2000),
  proposedCard: cardSchema,
});
export type Card = z.infer<typeof cardSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ProposalInput = z.infer<typeof proposalInputSchema>;
