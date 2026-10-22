import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { validateManifests, validateWorkflow } from './repository-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async (path) =>
  JSON.parse(await readFile(resolve(root, path), 'utf8'));
const rootManifest = await json('package.json');
const workspacePaths = (await readdir(resolve(root, 'packages'))).sort();
const workspaces = await Promise.all(
  workspacePaths.map((path) => json(`packages/${path}/package.json`)),
);
const errors = validateManifests(rootManifest, workspaces);
const workflow = parse(
  await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
);
errors.push(...validateWorkflow(workflow));

// Check local Markdown file links only. Anchor/remote validation is a separate concern.
const ignored = new Set(['node_modules', '.git', '.tools', '.tmp', 'dist']);
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (entry.name.endsWith('.md')) {
      const content = await readFile(path, 'utf8');
      for (const match of content.matchAll(/\]\(([^\s)#]+)(?:#[^)]*)?\)/g)) {
        const target = match[1];
        if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
        const absolute = resolve(dirname(path), decodeURIComponent(target));
        const local = relative(root, absolute);
        if (
          local === '..' ||
          local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
          isAbsolute(local)
        ) {
          errors.push(
            `${relative(root, path)}: link escapes repository: ${target}`,
          );
          continue;
        }
        try {
          await stat(absolute);
        } catch {
          errors.push(`${relative(root, path)}: broken link: ${target}`);
        }
      }
    } else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
      try {
        parse(await readFile(path, 'utf8'));
      } catch (error) {
        errors.push(`${relative(root, path)}: ${error.message}`);
      }
    }
  }
}
await inspect(root);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Repository policy, workflow matrix and local document links passed.',
  );
