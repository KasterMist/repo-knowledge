import { spawnSync, spawn } from 'node:child_process';
import { setTimeout, clearTimeout } from 'node:timers';
import {
  mkdir,
  mkdtemp,
  cp,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { artifactName } from './release-config.mjs';

const [codeExecutable, cliScript] = process.argv.slice(2);
if (!codeExecutable || !cliScript)
  throw new Error(
    'Usage: node scripts/run-host-check.mjs <Code executable> <VS Code cli.js>',
  );
await mkdir('.tmp', { recursive: true });
const directory = await mkdtemp(resolve('.tmp/host-check-'));
const profile = join(directory, 'profile');
const extensions = join(directory, 'extensions');
const demo = join(directory, 'demo');
const resultPath = join(directory, 'result.json');
await mkdir(join(profile, 'User'), { recursive: true });
await writeFile(
  join(profile, 'User/settings.json'),
  JSON.stringify({
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
    'chat.disableAIFeatures': true,
    'update.mode': 'none',
    'telemetry.telemetryLevel': 'off',
  }),
);
await cp('examples/demo', demo, { recursive: true });
await mkdir(join(demo, '.vscode'), { recursive: true });
await writeFile(
  join(demo, '.vscode/settings.json'),
  JSON.stringify({ 'repoKnowledge.storeDirectory': join(demo, 'knowledge') }),
);
const installed = spawnSync(
  codeExecutable,
  [
    cliScript,
    '--user-data-dir',
    profile,
    '--extensions-dir',
    extensions,
    '--install-extension',
    resolve('dist', artifactName),
  ],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 60000,
  },
);
if (installed.error || installed.status !== 0)
  throw new Error(installed.error?.message ?? installed.stderr);
console.log(installed.stdout);
const name = (await readdir(extensions)).find((entry) =>
  entry.toLowerCase().startsWith('kastermist.repo-knowledge-'),
);
if (!name)
  throw new Error(
    'VSIX was not installed into the isolated extension directory',
  );
const environment = {
  ...process.env,
  REPO_KNOWLEDGE_HOST_RESULT: resultPath,
  REPO_KNOWLEDGE_ISOLATED_PROFILE: '1',
};
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(
  codeExecutable,
  [
    demo,
    '--new-window',
    '--user-data-dir',
    profile,
    '--extensions-dir',
    extensions,
    '--extensionDevelopmentPath',
    join(extensions, name),
    '--extensionTestsPath',
    resolve('tests/extension-host.cjs'),
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-telemetry',
    '--disable-extensions',
    // Match the official test-electron runner on disposable Linux CI only.
    // The downloaded archive cannot install a root-owned setuid helper there.
    ...(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true'
      ? ['--no-sandbox', '--disable-gpu-sandbox']
      : []),
  ],
  { env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
);
child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
const timer = setTimeout(() => {
  child.kill();
}, 120000);
try {
  const code = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', done);
  });
  if (code !== 0) throw new Error(`Isolated extension host exited ${code}`);
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  if (result.passed !== true) throw new Error('Missing successful host result');
  if (process.env.REPO_KNOWLEDGE_HOST_REPORT)
    await writeFile(
      process.env.REPO_KNOWLEDGE_HOST_REPORT,
      JSON.stringify(result, null, 2),
    );
  console.log(JSON.stringify({ ...result, evidencePath: resultPath }, null, 2));
} finally {
  clearTimeout(timer);
}
