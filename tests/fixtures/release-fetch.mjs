// Offline replay of GitHub's JSON response contract for binary asset uploads.
import { readFile } from 'node:fs/promises';
import { release } from '../../scripts/release-config.mjs';
const draftId = release.recovery?.emptyDraftId ?? 10;
let uploaded = 0;
const names = ['repo-knowledge-0.1.0.vsix', 'SHA256SUMS', 'release-info.json'];
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  const path = url.pathname;
  const method = options.method ?? 'GET';
  if (path.endsWith('/branches/main'))
    return json({ protected: true, commit: { sha: process.env.GITHUB_SHA } });
  if (path.endsWith('/ci.yml/runs'))
    return json({
      workflow_runs: [
        { id: 1, head_sha: process.env.GITHUB_SHA, conclusion: 'success' },
      ],
    });
  if (path.endsWith('/runs/1/jobs'))
    return json({
      jobs: [
        'check (windows-latest)',
        'check (ubuntu-latest)',
        'remote MCP runtime (Node 22.22.1)',
        'editor host (windows-latest)',
        'editor host (ubuntu-latest)',
      ].map((name) => ({ name, conclusion: 'success' })),
    });
  if (path.includes('/tags/')) return json({}, 404);
  if (path.endsWith('/releases') && method === 'POST')
    return json({
      id: draftId,
      upload_url: `https://uploads.github.com/repos/KasterMist/repo-knowledge/releases/${draftId}/assets{?name,label}`,
    });
  if (path.endsWith(`/releases/${draftId}`) && method === 'GET')
    return json({
      id: draftId,
      tag_name: release.tag,
      draft: process.env.REPLAY_DRAFT_STATE !== 'published',
      prerelease: true,
      target_commitish:
        process.env.REPLAY_DRAFT_STATE === 'wrong-source'
          ? 'b'.repeat(40)
          : release.recovery.previousSourceCommit,
      published_at: null,
      assets: process.env.REPLAY_DRAFT_STATE === 'nonempty' ? [{ id: 1 }] : [],
    });
  if (url.hostname === 'uploads.github.com' && method === 'POST') {
    // Upload request body is binary, but the response representation is JSON.
    if (options.headers.Accept !== 'application/vnd.github+json')
      return json({}, 415);
    if (options.headers['Content-Type'] !== 'application/octet-stream')
      return json({}, 415);
    uploaded += 1;
    return json({ id: 1 });
  }
  if (path.endsWith(`/releases/${draftId}/assets`))
    return json(
      uploaded === 0
        ? process.env.REPLAY_DRAFT_STATE === 'hidden-assets'
          ? [{ id: 1 }]
          : []
        : names.map((name, id) => ({ name, id: id + 1, state: 'uploaded' })),
    );
  const asset = path.match(/\/releases\/assets\/(\d+)$/u);
  if (asset && options.headers.Accept === 'application/octet-stream')
    return new Response(await readFile('dist/' + names[Number(asset[1]) - 1]));
  if (path.endsWith(`/releases/${draftId}`) && method === 'PATCH')
    return json(
      JSON.parse(options.body).draft === false
        ? {
            draft: false,
            prerelease: true,
            html_url:
              'https://github.com/KasterMist/repo-knowledge/releases/tag/v0.1.0-alpha.1',
          }
        : {
            id: draftId,
            upload_url: `https://uploads.github.com/repos/KasterMist/repo-knowledge/releases/${draftId}/assets{?name,label}`,
          },
    );
  throw new Error('Unexpected offline release request: ' + method + ' ' + path);
};
