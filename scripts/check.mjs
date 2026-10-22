import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Invoke JS entry points with the current Node executable: no npm.cmd/bash dependency.
const tasks = [
  ['repository', ['scripts/check-repository.mjs']],
  ['format', ['node_modules/prettier/bin/prettier.cjs', '--check', '.']],
  ['lint', ['node_modules/eslint/bin/eslint.js', '.', '--max-warnings', '0']],
  [
    'typecheck/build',
    ['node_modules/typescript/bin/tsc', '-b', '--pretty', 'false'],
  ],
  ['unit', ['--test', 'tests/unit/repository-policy.test.mjs']],
  ['integration', ['--test', 'tests/integration/bootstrap.test.mjs']],
];

for (const [name, args] of tasks) {
  console.log(`\n[check] ${name}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
