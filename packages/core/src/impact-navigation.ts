import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { relativePath } from './schema.js';
import { KnowledgeError, within } from './files.js';

/** Open only a current regular file inside this repository; never guess a renamed target. */
export async function resolveImpactSource(repository: string, input: unknown) {
  const path = relativePath.parse(input);
  const root = await realpath(repository);
  let current = root;
  try {
    const parts = path.split('/');
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index]!);
      const info = await lstat(current);
      if (info.isSymbolicLink() || !within(root, await realpath(current)))
        throw new KnowledgeError(
          'PATH_ESCAPE',
          'Impact source must not use symbolic links',
        );
      if (index === parts.length - 1 && !info.isFile())
        throw new KnowledgeError(
          'INVALID_FILE',
          'Impact source is not a regular file',
        );
    }
    return current;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new KnowledgeError(
        'IMPACT_SOURCE_MISSING',
        '源码路径已删除或不存在；不会自动改跳可能的新路径 / Source path is missing; no automatic rename redirect.',
      );
    throw error;
  }
}
