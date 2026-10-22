import { spawnSync } from 'node:child_process';
const result = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-b', '--pretty', 'false'],
  { stdio: 'inherit' },
);
if (result.error || result.status !== 0) {
  console.error(result.error?.message ?? 'TypeScript build failed');
  process.exit(result.status ?? 1);
}
await import('./bundle.mjs');
