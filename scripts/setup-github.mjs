import { readFile } from 'node:fs/promises';

// Explicitly dispatched maintenance only; no personal token, model, cron or daemon.
if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
  throw new Error('Run this through the Repository setup workflow.');
}
const config = JSON.parse(
  await readFile(
    new URL('../.github/repository-setup.json', import.meta.url),
    'utf8',
  ),
);
if (
  process.env.GITHUB_REPOSITORY !== config.repository ||
  !process.env.GITHUB_TOKEN
) {
  throw new Error('Repository identity or workflow token missing.');
}
async function request(path, method = 'GET', body) {
  const response = await fetch(
    `https://api.github.com/repos/${config.repository}/${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
  return response.json();
}
async function list(path) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const items = await request(
      `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    );
    all.push(...items);
    if (items.length < 100) return all;
  }
}
const labels = await list('labels');
for (const label of config.labels) {
  const existing = labels.find((item) => item.name === label.name);
  await request(
    existing ? `labels/${encodeURIComponent(label.name)}` : 'labels',
    existing ? 'PATCH' : 'POST',
    label,
  );
}
const milestones = await list('milestones?state=all');
for (const milestone of config.milestones) {
  const existing = milestones.find((item) => item.title === milestone.title);
  await request(
    existing ? `milestones/${existing.number}` : 'milestones',
    existing ? 'PATCH' : 'POST',
    milestone,
  );
}
console.log(
  'Repository labels and milestones configured; no existing milestones were reopened or deleted.',
);
