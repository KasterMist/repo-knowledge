import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Match the real Windows acceptance version; do not silently follow latest.
await mkdir(resolve('.tmp/vscode-test'), { recursive: true });
const executable = await downloadAndUnzipVSCode({
  version: '1.117.0',
  cachePath: resolve('.tmp/vscode-test'),
});
const directory = dirname(executable);
const candidates = [join(directory, 'resources/app/out/cli.js')];
for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (entry.isDirectory() && /^[a-f0-9]{10,40}$/u.test(entry.name))
    candidates.push(join(directory, entry.name, 'resources/app/out/cli.js'));
}
let cli;
for (const candidate of candidates) {
  try {
    await access(candidate);
    cli = candidate;
    break;
  } catch {
    // Windows updates can place application resources under a commit directory.
  }
}
if (!cli) throw new Error('Downloaded VS Code CLI script was not found');
const command = process.platform === 'linux' ? 'xvfb-run' : process.execPath;
for (const mode of ['single', 'multi-root']) {
  const args = [
    'scripts/run-host-check.mjs',
    executable,
    cli,
    ...(mode === 'multi-root' ? ['--multi-root'] : []),
  ];
  const result = spawnSync(
    command,
    process.platform === 'linux' ? ['-a', process.execPath, ...args] : args,
    {
      stdio: 'inherit',
      timeout: 180000,
      env: {
        ...process.env,
        REPO_KNOWLEDGE_HOST_REPORT: resolve(
          mode === 'single'
            ? '.tmp/editor-host-result.json'
            : '.tmp/editor-host-multi-root-result.json',
        ),
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const single = JSON.parse(
  await readFile('.tmp/editor-host-result.json', 'utf8'),
);
single.multiRoot = JSON.parse(
  await readFile('.tmp/editor-host-multi-root-result.json', 'utf8'),
);
await writeFile(
  '.tmp/editor-host-result.json',
  JSON.stringify(single, null, 2),
);
