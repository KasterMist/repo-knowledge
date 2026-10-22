import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const destination = 'packages/vscode-extension/dist';
const bundledPackages = new Set();
await mkdir(destination, { recursive: true });
for (const [entry, output, external] of [
  ['packages/vscode-extension/src/index.ts', 'extension.cjs', ['vscode']],
  ['packages/mcp-server/src/cli.ts', 'server.cjs', []],
]) {
  const result = await build({
    entryPoints: [entry],
    outfile: `${destination}/${output}`,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external,
    sourcemap: false,
    legalComments: 'eof',
    metafile: true,
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes('node_modules/')) continue;
    let directory = dirname(input);
    while (directory !== '.') {
      let manifest;
      try {
        manifest = JSON.parse(
          await readFile(join(directory, 'package.json'), 'utf8'),
        );
      } catch {
        /* continue to package root */
      }
      if (manifest?.name) {
        bundledPackages.add(directory);
        break;
      }
      directory = dirname(directory);
    }
  }
}
const notices = ['# Bundled third-party notices\n'];
for (const directory of [...bundledPackages].sort()) {
  const manifest = JSON.parse(
    await readFile(join(directory, 'package.json'), 'utf8'),
  );
  const licenses = (await readdir(directory)).filter((file) =>
    /^licen[cs]e(?:\.|$)/iu.test(file),
  );
  if (!licenses.length)
    throw new Error(`Missing license for bundled package ${manifest.name}`);
  notices.push(
    `## ${manifest.name} ${manifest.version}\n\nDeclared license: ${manifest.license}\n`,
  );
  for (const file of licenses)
    notices.push(await readFile(join(directory, file), 'utf8'));
}
await writeFile(
  'packages/vscode-extension/THIRD_PARTY_NOTICES.md',
  notices.join('\n'),
);
await cp('examples/demo', 'packages/vscode-extension/demo', {
  recursive: true,
});
for (const file of ['LICENSE', 'CHANGELOG.md'])
  await cp(file, `packages/vscode-extension/${file}`);
const readme = (await readFile('README.md', 'utf8')).replace(
  /\]\((?![a-z][a-z0-9+.-]*:|#)([^)]+)\)/giu,
  '](' + 'https://github.com/KasterMist/repo-knowledge/blob/main/$1)',
);
await writeFile('packages/vscode-extension/README.md', readme);
