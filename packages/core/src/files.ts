import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
const MAX_BYTES = 1024 * 1024;
export class KnowledgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fingerprint = (text: string): string =>
  createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
export const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return (
    rel === '' ||
    (!isAbsolute(rel) &&
      rel !== '..' &&
      !rel.startsWith('..\\') &&
      !rel.startsWith('../'))
  );
};
export async function boundedBytes(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    if (!(await handle.stat()).isFile())
      throw new KnowledgeError('INVALID_FILE', 'Expected a regular file');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const chunk = await handle.read(
        bytes,
        bytesRead,
        bytes.length - bytesRead,
        bytesRead,
      );
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > MAX_BYTES)
      throw new KnowledgeError('LIMIT', 'File exceeds 1 MiB');
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
export async function boundedRead(path: string): Promise<string> {
  return new TextDecoder('utf-8', { fatal: true }).decode(
    await boundedBytes(path),
  );
}
