import { createVSIX } from '@vscode/vsce';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
await mkdir('dist', { recursive: true });
await createVSIX({
  cwd: 'packages/vscode-extension',
  packagePath: resolve('dist/repo-knowledge-0.0.0.vsix'),
  dependencies: false,
});
const hash = createHash('sha256')
  .update(await readFile('dist/repo-knowledge-0.0.0.vsix'))
  .digest('hex');
await writeFile('dist/SHA256SUMS', `${hash}  repo-knowledge-0.0.0.vsix\n`);
