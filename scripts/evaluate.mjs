import { readFile, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  prepareEvaluation,
  summarize,
  verifyArtifacts,
} from './evaluation.mjs';

const [command, path, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  !['prepare', 'report'].includes(command) ||
  (command === 'prepare' ? path !== undefined : !path)
) {
  throw new Error(
    'Usage: node scripts/evaluate.mjs prepare | report <observations.json>',
  );
}
if (command === 'prepare')
  console.log(JSON.stringify(await prepareEvaluation(), null, 2));
else {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw new Error('Record must be a regular file up to 1 MiB');
  const text = await readFile(path, 'utf8');
  const record = JSON.parse(text);
  await verifyArtifacts(record, dirname(path));
  console.log(JSON.stringify(summarize(record), null, 2));
}
