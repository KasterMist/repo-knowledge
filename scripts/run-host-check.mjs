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
import {
  KnowledgeStore,
  KnowledgePublication,
  scanRepository,
  defaultScanOptions,
  buildGenerationPacket,
} from '../packages/core/dist/index.js';

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
const multiRoot = process.argv.includes('--multi-root');
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
const creationKnowledge = new KnowledgeStore(demo, join(demo, 'knowledge'));
const creationPlan = await scanRepository(demo, creationKnowledge.storeRoot, {
  ...defaultScanOptions,
  include: ['src/**/*.ts'],
  exclude: [],
});
const creationPacket = await buildGenerationPacket(
  creationKnowledge,
  creationPlan,
);
const creationCandidate = await new KnowledgePublication(
  creationKnowledge,
).saveCreation(creationPlan, creationPacket, {
  packetRevision: creationPacket.packetRevision,
  pages: [
    {
      id: 'host-new-card',
      title: '新增读取说明',
      kind: 'fact',
      body: '空字符串会保留。',
      tags: ['读取'],
      scope: ['src'],
      evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
    },
    {
      id: 'host-new-cache-card',
      title: '新增缓存说明',
      kind: 'fact',
      body: '缓存未命中以 undefined 表示。',
      tags: ['缓存'],
      scope: ['src'],
      evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
    },
  ],
});
await mkdir(join(demo, '.vscode'), { recursive: true });
await writeFile(
  join(demo, '.vscode/settings.json'),
  JSON.stringify({ 'repoKnowledge.storeDirectory': join(demo, 'knowledge') }),
);
// A separate store exercises version-2 history UI without changing the baseline.
const creationHistoryStore = join(directory, 'creation history store');
await cp(join(demo, 'knowledge'), creationHistoryStore, { recursive: true });
const historyKnowledge = new KnowledgeStore(demo, creationHistoryStore);
const historyPlan = await scanRepository(demo, creationHistoryStore, {
  ...defaultScanOptions,
  include: ['src/**/*.ts'],
  exclude: [],
});
const historyPacket = await buildGenerationPacket(
  historyKnowledge,
  historyPlan,
);
const historyPublication = new KnowledgePublication(historyKnowledge);
const historyCandidate = await historyPublication.saveCreation(
  historyPlan,
  historyPacket,
  {
    packetRevision: historyPacket.packetRevision,
    pages: [
      {
        id: 'host-history-card',
        title: '新增历史说明',
        kind: 'fact',
        body: '空字符串会保留。',
        tags: ['读取'],
        scope: ['src'],
        evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
      },
    ],
  },
);
const historyReview = await historyPublication.previewCreation(
  historyCandidate.candidateId,
);
const creationHistory = await historyPublication.publishCreation(
  historyCandidate.candidateId,
  historyReview.token,
);
let workspacePath = demo;
if (multiRoot) {
  const second = join(directory, 'second root 中文');
  const store = join(directory, 'second external store');
  await cp('examples/demo', second, { recursive: true });
  await cp(join(second, 'knowledge'), store, { recursive: true });
  const snapshot = JSON.parse(
    await readFile(join(store, 'knowledge.json'), 'utf8'),
  );
  snapshot.cards.find((card) => card.id === 'read-fallback').body +=
    '\nSECOND_ROOT_SENTINEL';
  await writeFile(join(store, 'knowledge.json'), JSON.stringify(snapshot));
  await writeFile(
    join(second, '.vscode/settings.json'),
    JSON.stringify({ 'repoKnowledge.storeDirectory': store }),
  );
  workspacePath = join(directory, 'two-roots.code-workspace');
  await writeFile(
    workspacePath,
    JSON.stringify({ folders: [{ path: demo }, { path: second }] }),
  );
}
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
  REPO_KNOWLEDGE_MULTI_ROOT: multiRoot ? '1' : '0',
  REPO_KNOWLEDGE_CREATION_ID: creationCandidate.candidateId,
  REPO_KNOWLEDGE_CREATION_HISTORY_STORE: creationHistoryStore,
  REPO_KNOWLEDGE_CREATION_HISTORY_ID: creationHistory.transactionId,
};
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(
  codeExecutable,
  [
    workspacePath,
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
