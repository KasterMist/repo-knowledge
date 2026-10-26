import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { KnowledgeStore } from './store.js';
import { boundedBytes, fingerprint, within, KnowledgeError } from './files.js';
import { verifyScanPlan, type ScanPlan } from './scan.js';
import { cardSchema, relativePath, type Card } from './schema.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceSchema = z.strictObject({
  path: relativePath,
  sha256: digest,
  lines: z.int().min(1),
  content: z.string().max(256 * 1024),
});
const packetContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  repositoryId: digest,
  planId: z.uuid(),
  planRevision: digest,
  baseSnapshot: digest,
  language: z.enum(['zh-CN', 'en']),
  existingIds: z.array(cardSchema.shape.id).max(200),
  sources: z.array(sourceSchema).min(1).max(200),
});
export const generationPacketSchema = packetContentSchema.extend({
  packetRevision: digest,
});
export type GenerationPacket = z.infer<typeof generationPacketSchema>;
const referenceSchema = z
  .strictObject({
    path: relativePath,
    startLine: z.int().min(1),
    endLine: z.int().min(1),
  })
  .refine(
    (value) =>
      value.endLine >= value.startLine && value.endLine - value.startLine < 200,
    'Use 1–200 source lines',
  );
const pageSchema = z.strictObject({
  id: cardSchema.shape.id,
  title: cardSchema.shape.title,
  kind: cardSchema.shape.kind,
  body: cardSchema.shape.body,
  tags: cardSchema.shape.tags,
  scope: cardSchema.shape.scope,
  evidence: z.array(referenceSchema).min(1).max(10),
});
export const generatedKnowledgeSchema = z
  .strictObject({
    packetRevision: digest,
    pages: z.array(pageSchema).min(1).max(8),
  })
  .superRefine((value, context) => {
    if (new Set(value.pages.map((page) => page.id)).size !== value.pages.length)
      context.addIssue({ code: 'custom', message: 'Duplicate generated IDs' });
  });
export function generationOutputJsonSchema() {
  return z.toJSONSchema(generatedKnowledgeSchema, { unrepresentable: 'any' });
}
const content = (packet: GenerationPacket) =>
  packetContentSchema.parse({
    schemaVersion: packet.schemaVersion,
    repositoryId: packet.repositoryId,
    planId: packet.planId,
    planRevision: packet.planRevision,
    baseSnapshot: packet.baseSnapshot,
    language: packet.language,
    existingIds: packet.existingIds,
    sources: packet.sources,
  });
function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new KnowledgeError(
      'GENERATION_CANCELLED',
      'Generation preparation cancelled',
    );
}

export async function buildGenerationPacket(
  knowledge: KnowledgeStore,
  input: unknown,
  signal?: AbortSignal,
): Promise<GenerationPacket> {
  cancelled(signal);
  const plan = await verifyScanPlan(
    knowledge.repositoryRoot,
    knowledge.storeRoot,
    input,
    signal,
  );
  if (plan.summary.limited || !plan.files.length)
    throw new KnowledgeError(
      'INCOMPLETE_PLAN',
      'Select a nonempty fully covered scope and review a fresh plan',
    );
  const base = await knowledge.snapshot();
  const root = await realpath(knowledge.repositoryRoot);
  const sources: GenerationPacket['sources'] = [];
  let sourceBytes = 0;
  for (const file of plan.files) {
    cancelled(signal);
    const path = join(root, file.path),
      resolved = await realpath(path),
      info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || !within(root, resolved))
      throw new KnowledgeError(
        'PATH_ESCAPE',
        'Selected generation source is no longer a contained regular file',
      );
    const bytes = await boundedBytes(path);
    const text = new TextDecoder('utf-8', { fatal: true })
      .decode(bytes)
      .replaceAll('\r\n', '\n');
    if (
      bytes.length !== file.bytes ||
      fingerprint(text) !== file.sha256 ||
      text.split('\n').length !== file.lines
    )
      throw new KnowledgeError(
        'PLAN_CHANGED',
        'Selected source changed while preparing generation',
      );
    const source = {
      path: file.path,
      sha256: file.sha256,
      lines: file.lines,
      content: text,
    };
    sourceBytes += Buffer.byteLength(JSON.stringify(source), 'utf8');
    if (sourceBytes > 128 * 1024)
      throw new KnowledgeError(
        'GENERATION_INPUT_LIMIT',
        'Encoded source packet exceeds 128 KiB; narrow and review the scope',
      );
    sources.push(source);
  }
  const packetContent = packetContentSchema.parse({
    schemaVersion: 1,
    repositoryId: plan.repositoryId,
    planId: plan.id,
    planRevision: plan.manifestRevision,
    baseSnapshot: base.snapshotRevision,
    language: plan.options.language,
    existingIds: base.snapshot.cards.map((card) => card.id).sort(),
    sources,
  });
  if (sources.every((source) => !source.content.trim()))
    throw new KnowledgeError(
      'EMPTY_SOURCE_CONTEXT',
      'Selected files contain no non-whitespace source context',
    );
  const packet = {
    ...packetContent,
    packetRevision: fingerprint(JSON.stringify(packetContent)),
  };
  if (Buffer.byteLength(JSON.stringify(packet), 'utf8') > 128 * 1024)
    throw new KnowledgeError(
      'GENERATION_INPUT_LIMIT',
      'Encoded source packet exceeds 128 KiB; narrow and review the scope',
    );
  await verifyScanPlan(
    knowledge.repositoryRoot,
    knowledge.storeRoot,
    plan,
    signal,
  );
  cancelled(signal);
  if ((await knowledge.snapshot()).snapshotRevision !== base.snapshotRevision)
    throw new KnowledgeError(
      'REVISION_CONFLICT',
      'Knowledge changed while preparing generation',
    );
  return packet;
}

export function validateGeneratedPages(
  input: unknown,
  output: unknown,
): Card[] {
  const packet = generationPacketSchema.parse(input);
  if (
    Buffer.byteLength(JSON.stringify(packet), 'utf8') > 128 * 1024 ||
    new Set(packet.sources.map((source) => source.path)).size !==
      packet.sources.length ||
    new Set(packet.existingIds).size !== packet.existingIds.length ||
    packet.sources.some(
      (source) =>
        fingerprint(source.content) !== source.sha256 ||
        source.content.split('\n').length !== source.lines,
    )
  )
    throw new KnowledgeError(
      'INVALID_PACKET',
      'Generation packet contents or limits are invalid',
    );
  if (fingerprint(JSON.stringify(content(packet))) !== packet.packetRevision)
    throw new KnowledgeError(
      'INVALID_PACKET',
      'Generation packet fingerprint mismatch',
    );
  const result = generatedKnowledgeSchema.parse(output);
  if (result.packetRevision !== packet.packetRevision)
    throw new KnowledgeError(
      'WRONG_GENERATION_RESULT',
      'Result belongs to a different source packet',
    );
  if (packet.existingIds.length + result.pages.length > 200)
    throw new KnowledgeError(
      'LIMIT',
      'Generated pages exceed canonical card limit',
    );
  const sources = new Map(
    packet.sources.map((source) => [source.path, source]),
  );
  return result.pages.map((page) => {
    if (packet.existingIds.includes(page.id))
      throw new KnowledgeError(
        'EXISTING_CARD',
        'First generation must not overwrite existing knowledge IDs',
      );
    if (
      page.scope.some(
        (scope) =>
          !packet.sources.some(
            (source) =>
              source.path === scope || source.path.startsWith(scope + '/'),
          ),
      )
    )
      throw new KnowledgeError(
        'OUT_OF_SCOPE',
        'Generated scope is outside the selected packet',
      );
    const evidence = page.evidence.map((reference) => {
      const source = sources.get(reference.path);
      if (!source || reference.endLine > source.lines)
        throw new KnowledgeError(
          'INVALID_GENERATED_EVIDENCE',
          'Generated reference must cite selected source lines',
        );
      return { ...reference, sha256: source.sha256 };
    });
    return cardSchema.parse({ ...page, revision: 1, evidence });
  });
}

export async function validateCurrentGeneration(
  knowledge: KnowledgeStore,
  plan: ScanPlan,
  packet: GenerationPacket,
  output: unknown,
  signal?: AbortSignal,
): Promise<Card[]> {
  const pages = validateGeneratedPages(packet, output);
  const fresh = await buildGenerationPacket(knowledge, plan, signal);
  if (fresh.packetRevision !== packet.packetRevision)
    throw new KnowledgeError(
      'GENERATION_BASE_CHANGED',
      'Source packet or canonical knowledge changed during generation',
    );
  return pages;
}
