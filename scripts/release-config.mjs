import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
export const manifest = JSON.parse(
  await readFile(new URL('package.json', root), 'utf8'),
);
export const release = JSON.parse(
  await readFile(new URL('.github/release.json', root), 'utf8'),
);
export const requiredChecks = [
  'check (windows-latest)',
  'check (ubuntu-latest)',
  'remote MCP runtime (Node 22.22.1)',
  'editor host (windows-latest)',
  'editor host (ubuntu-latest)',
];

export function validateRelease(config, version) {
  if (
    !/^\d+\.\d+\.\d+$/u.test(version) ||
    config.version !== version ||
    config.tag !== `v${version}-alpha.1` ||
    config.prerelease !== true
  )
    throw new Error(
      'Release version/tag must identify a matching alpha.1 preview',
    );
  return `repo-knowledge-${version}.vsix`;
}
export const artifactName = validateRelease(release, manifest.version);
export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');

export async function verifyArtifact(directory = 'dist') {
  const bytes = await readFile(resolve(directory, artifactName));
  const digest = sha256(bytes);
  const checksum = await readFile(resolve(directory, 'SHA256SUMS'), 'utf8');
  if (checksum !== `${digest}  ${artifactName}\n`)
    throw new Error('VSIX checksum mismatch');
  return { bytes, digest };
}
