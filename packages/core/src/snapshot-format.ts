import { isDeepStrictEqual } from 'node:util';
import { snapshotSchema, type Snapshot } from './schema.js';
import { wikiSnapshotSchema, type WikiSnapshot } from './wiki.js';
import { KnowledgeError } from './files.js';

/** Core compatibility harness only. Editor/MCP entry points still construct v1 stores. */
export type SnapshotFormat = 'v1' | 'wiki-v2';
export type RuntimeSnapshot = Snapshot | WikiSnapshot;

export function parseRuntimeSnapshot(
  input: unknown,
  format: SnapshotFormat,
): RuntimeSnapshot {
  if (format !== 'v1' && format !== 'wiki-v2')
    throw new KnowledgeError(
      'INVALID_SNAPSHOT_FORMAT',
      'Unknown snapshot compatibility mode',
    );
  if (
    format === 'wiki-v2' &&
    input &&
    typeof input === 'object' &&
    'schemaVersion' in input &&
    input.schemaVersion === 2
  ) {
    const result = wikiSnapshotSchema.safeParse(input);
    if (!result.success)
      throw new KnowledgeError(
        'INVALID_SNAPSHOT',
        'Knowledge does not match schemaVersion 2',
      );
    // Card-only operations must not normalize unrelated human-authored content.
    if (!isDeepStrictEqual(input, result.data))
      throw new KnowledgeError(
        'WIKI_NORMALIZES_CONTENT',
        'Review noncanonical text separately before writing Wiki knowledge',
      );
    return result.data;
  }
  const result = snapshotSchema.safeParse(input);
  if (!result.success)
    throw new KnowledgeError(
      'INVALID_SNAPSHOT',
      'knowledge.json does not match schemaVersion 1',
    );
  return result.data;
}
