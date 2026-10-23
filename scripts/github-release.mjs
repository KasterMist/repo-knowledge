import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  artifactName,
  release,
  requiredChecks,
  sha256,
  verifyArtifact,
} from './release-config.mjs';

const repository = 'KasterMist/repo-knowledge';
const base = `https://api.github.com/repos/${repository}`;
const files = [artifactName, 'SHA256SUMS', 'release-info.json'];
const source = process.env.GITHUB_SHA;
const mode = process.argv[2];

async function api(
  path,
  { method = 'GET', body, binary, allow404 = false } = {},
) {
  if (!process.env.GH_TOKEN)
    throw new Error('A short-lived workflow token is required');
  const url = path.startsWith(
    'https://uploads.github.com/repos/' + repository + '/',
  )
    ? path
    : base + path;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept:
        binary && method === 'GET'
          ? 'application/octet-stream'
          : 'application/vnd.github+json',
      ...(body
        ? {
            'Content-Type': binary
              ? 'application/octet-stream'
              : 'application/json',
          }
        : {}),
    },
    body: body ? (binary ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok)
    throw new Error(`GitHub ${method} failed: HTTP ${response.status}`);
  return binary && method === 'GET'
    ? Buffer.from(await response.arrayBuffer())
    : response.json();
}

function workflowOnly() {
  if (
    process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    !/^[a-f0-9]{40}$/u.test(source ?? '')
  )
    throw new Error(
      'Release requires an explicit dispatch on this repository main',
    );
}

async function checkedMain() {
  workflowOnly();
  const main = await api('/branches/main');
  if (main.commit.sha !== source || !main.protected)
    throw new Error('Release source must still be protected main HEAD');
  const result = await api(
    `/actions/workflows/ci.yml/runs?branch=main&head_sha=${source}&event=push&per_page=100`,
  );
  const run = result.workflow_runs.find(
    (item) => item.head_sha === source && item.conclusion === 'success',
  );
  if (!run)
    throw new Error(
      'Wait for successful main CI on this exact source before dispatch',
    );
  const { jobs } = await api(`/actions/runs/${run.id}/jobs?per_page=100`);
  if (
    !requiredChecks.every((name) =>
      jobs.some((job) => job.name === name && job.conclusion === 'success'),
    )
  )
    throw new Error(
      'All five required checks must succeed on the release source',
    );
}

async function verifyInfo() {
  const { digest } = await verifyArtifact();
  const info = JSON.parse(await readFile('dist/release-info.json', 'utf8'));
  if (
    info.tag !== release.tag ||
    info.version !== release.version ||
    info.asset !== artifactName ||
    info.sha256 !== digest ||
    !/^[a-f0-9]{40}$/u.test(info.sourceCommit ?? '') ||
    (source && source !== info.sourceCommit)
  )
    throw new Error('Release provenance mismatch');
  return info;
}

async function unusedTagOrEmptyDraft({ checkPrivateDraft = true } = {}) {
  if (await api(`/git/ref/tags/${release.tag}`, { allow404: true }))
    throw new Error('Release tag already exists; refusing replacement');
  const existing = await api(`/releases/tags/${release.tag}`, {
    allow404: true,
  });
  if (!release.recovery) {
    if (existing)
      throw new Error('Release already exists; refusing replacement');
    return null;
  }
  const recovery = release.recovery;
  if (
    !Number.isSafeInteger(recovery.emptyDraftId) ||
    recovery.emptyDraftId <= 0 ||
    !/^[a-f0-9]{40}$/u.test(recovery.previousSourceCommit ?? '')
  )
    throw new Error('Invalid reviewed draft recovery metadata');
  if (!checkPrivateDraft) {
    if (existing && existing.draft !== true)
      throw new Error('Public release already exists; refusing replacement');
    return null;
  }
  const draft = await api(`/releases/${recovery.emptyDraftId}`);
  if (
    (existing && existing.id !== draft.id) ||
    draft.id !== recovery.emptyDraftId ||
    draft.tag_name !== release.tag ||
    draft.draft !== true ||
    draft.prerelease !== true ||
    draft.target_commitish !== recovery.previousSourceCommit ||
    draft.published_at !== null ||
    !Array.isArray(draft.assets) ||
    draft.assets.length !== 0
  )
    throw new Error(
      'Recovery is not a matching empty unpublished draft; refusing changes',
    );
  // Recheck assets separately rather than trusting embedded/listed metadata alone.
  if ((await api(`/releases/${draft.id}/assets`)).length !== 0)
    throw new Error('Recovery draft has assets; refusing replacement');
  return draft;
}

if (mode === 'gate') {
  await checkedMain();
  await unusedTagOrEmptyDraft({ checkPrivateDraft: false });
  console.log(
    release.recovery
      ? 'Exact main CI/public tag verified; private draft checks deferred to the publish job'
      : 'Exact main CI and unused release tag verified',
  );
} else if (mode === 'prepare') {
  workflowOnly();
  const { digest } = await verifyArtifact();
  await writeFile(
    'dist/release-info.json',
    JSON.stringify(
      {
        version: release.version,
        tag: release.tag,
        sourceCommit: source,
        asset: artifactName,
        sha256: digest,
        knowledgeSchemaVersion: 1,
        workflowRun: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      },
      null,
      2,
    ) + '\n',
  );
} else if (mode === 'verify') {
  console.log(JSON.stringify(await verifyInfo()));
} else if (mode === 'publish') {
  await checkedMain();
  const info = await verifyInfo();
  const recovery = await unusedTagOrEmptyDraft();
  const notes = await readFile(`docs/releases/${release.tag}.md`, 'utf8');
  const draft = await api(recovery ? `/releases/${recovery.id}` : '/releases', {
    method: recovery ? 'PATCH' : 'POST',
    body: {
      tag_name: release.tag,
      target_commitish: source,
      name: `Repo Knowledge ${release.tag}`,
      body: `${notes}\n\nSource commit: ${source}\nVSIX SHA-256: ${info.sha256}\n`,
      draft: true,
      prerelease: true,
      make_latest: 'false',
    },
  });
  for (const name of files) {
    const bytes = await readFile(resolve('dist', name));
    await api(
      draft.upload_url.replace(/\{.*$/u, '') +
        '?name=' +
        encodeURIComponent(name),
      {
        method: 'POST',
        body: bytes,
        binary: true,
      },
    );
  }
  const assets = await api(`/releases/${draft.id}/assets`);
  if (assets.length !== files.length)
    throw new Error('Unexpected draft assets');
  for (const name of files) {
    const asset = assets.find(
      (item) => item.name === name && item.state === 'uploaded',
    );
    if (!asset) throw new Error('Missing completed draft asset');
    const downloaded = await api(`/releases/assets/${asset.id}`, {
      binary: true,
    });
    if (sha256(downloaded) !== sha256(await readFile(resolve('dist', name))))
      throw new Error('Draft asset bytes differ; leave draft for review');
  }
  const published = await api(`/releases/${draft.id}`, {
    method: 'PATCH',
    body: { draft: false },
  });
  if (published.draft || !published.prerelease)
    throw new Error('Unexpected release state');
  console.log(`Published ${published.html_url}`);
} else if (mode === 'download') {
  // Deliberately public: no GH_TOKEN or Authorization header is used here.
  const response = await fetch(`${base}/releases/tags/${release.tag}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`Public release lookup failed: HTTP ${response.status}`);
  const published = await response.json();
  if (
    published.draft ||
    published.prerelease !== true ||
    published.tag_name !== release.tag
  )
    throw new Error('Expected public alpha prerelease');
  await mkdir('dist', { recursive: true });
  for (const name of files) {
    const asset = published.assets.find(
      (item) => item.name === name && item.state === 'uploaded',
    );
    const expected = `https://github.com/${repository}/releases/download/${release.tag}/${name}`;
    if (
      !asset ||
      asset.browser_download_url !== expected ||
      asset.size > 10 * 1024 * 1024
    )
      throw new Error('Missing or unexpected public asset');
    const result = await fetch(expected, {
      signal: AbortSignal.timeout(60000),
    });
    if (!result.ok)
      throw new Error(`Public asset download failed: HTTP ${result.status}`);
    const bytes = Buffer.from(await result.arrayBuffer());
    if (
      bytes.length !== asset.size ||
      asset.digest !== `sha256:${sha256(bytes)}`
    )
      throw new Error('Public asset size/digest mismatch');
    await writeFile(resolve('dist', name), bytes);
  }
  console.log(JSON.stringify(await verifyInfo()));
} else {
  throw new Error(
    'Usage: github-release.mjs gate|prepare|verify|publish|download',
  );
}
