import { createVSIX } from '@vscode/vsce';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { artifactName } from './release-config.mjs';
await mkdir('dist', { recursive: true });
await createVSIX({
  cwd: 'packages/vscode-extension',
  packagePath: resolve('dist', artifactName),
  dependencies: false,
});
const hash = createHash('sha256')
  .update(await readFile(resolve('dist', artifactName)))
  .digest('hex');
await writeFile('dist/SHA256SUMS', `${hash}  ${artifactName}\n`);
