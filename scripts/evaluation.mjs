// Offline experiment support. Never starts an agent or executes fixture source.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const digest = (text) => createHash('sha256').update(text).digest('hex');
export const source = `export class Reservations {
  private readonly receipts = new Map<string, { quantity: number }>();
  constructor(public remaining: number) {}
  reserve(token: string, quantity: number) {
    const previous = this.receipts.get(token);
    if (previous) return previous;
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
    if (quantity > this.remaining) throw new Error('stock');
    const receipt = { quantity };
    this.remaining -= quantity;
    this.receipts.set(token, receipt);
    return receipt;
  }
}
`;
const question =
  '请静态审阅 src/reservations.ts：初始库存 10，同一 token 先 reserve(token, 3) 再 reserve(token, 7)，第二次返回什么、剩余库存多少？为什么允许相同 token 携带不同数量？请区分源码事实、已记录的设计理由和无法确认的推测，注明依据。不要运行源码、测试或构建，不修改任何文件。';
export const prompts = {
  baseline: question,
  natural: question,
  explicit: `请实际调用 Repo Knowledge 的 get_knowledge_status、search_knowledge（搜索“预留”）和 read_knowledge，再完成下面任务；若工具没有直接暴露，请如实报告，不用脚本模拟。\n${question}`,
  reuse:
    '请静态判断这个项目中，同一个 token 已成功预留 3 后，再携带数量 0 请求，会抛 quantity 错误还是返回原收据？说明依据，并区分源码事实和设计理由。不要运行源码、测试或构建，不修改任何文件。',
};
export const arms = Object.keys(prompts);
export const hosts = ['windows-native', 'remote-ssh-linux'];
export const criteria = [
  'sourceFacts',
  'humanRationale',
  'attribution',
  'noExecution',
];
export const snapshot = {
  schemaVersion: 1,
  repository: { id: 't21-reservations', sourceRevision: 'self-authored-v1' },
  cards: [
    {
      id: 'reservation-idempotency',
      revision: 1,
      kind: 'fact',
      title: '预留的幂等 token 优先于数量验证',
      body: 'reserve 先查 token 的已有收据，再验证数量和库存。重复 token 直接返回同一收据，不再扣库存；即使后续 quantity 为 0，也不会走 quantity 验证。',
      tags: ['预留', 'reserve', 'token'],
      scope: ['src/reservations.ts'],
      evidence: [
        {
          path: 'src/reservations.ts',
          startLine: 4,
          endLine: 12,
          sha256: digest(source),
        },
      ],
    },
    {
      id: 'reservation-rationale',
      revision: 1,
      kind: 'rationale',
      title: '预留重试兼容的人工设计理由',
      body: '自编案例作者提供的设计理由（不是从源码推导出的历史事实）：旧版售货终端离线重放时可能重算数量，但交易 token 不变；服务端以第一次成功收据为准，避免重放重复扣库存。当前实现对应所引源码，但源码哈希不能独立证明这段历史理由。',
      tags: ['预留', '重试', '设计理由'],
      scope: ['src/reservations.ts'],
      evidence: [
        {
          path: 'src/reservations.ts',
          startLine: 4,
          endLine: 6,
          sha256: digest(source),
        },
      ],
    },
  ],
};
export const fixtureIdentity = {
  sourceSha256: digest(source),
  snapshotSha256: digest(JSON.stringify(snapshot, null, 2) + '\n'),
};

export function recordTemplate() {
  return {
    schemaVersion: 1,
    fixture: fixtureIdentity,
    observations: hosts.flatMap((host) =>
      arms.map((arm) => ({
        host,
        arm,
        status: 'not-run',
        sessionLabel: null,
        independentConversation: null,
        environment: null,
        observedAt: null,
        toolObservation: 'unknown',
        promptSha256: digest(prompts[arm]),
        accessVerified: null,
        transcript: null,
        tools: null,
        elapsedMs: null,
        observedTokens: null,
        ratings: Object.fromEntries(criteria.map((key) => [key, 'unknown'])),
        notes: '',
      })),
    ),
  };
}

function keys(value, expected) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}
const short = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= 200;
const hash = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const nullableBoolean = (value) => value === null || typeof value === 'boolean';
const nullableMetric = (value) =>
  value === null || (Number.isSafeInteger(value) && value >= 0);

export function summarize(record) {
  keys(record, ['schemaVersion', 'fixture', 'observations']);
  assert.equal(record.schemaVersion, 1);
  assert.deepEqual(
    record.fixture,
    fixtureIdentity,
    'Fixture version/hash mismatch',
  );
  assert.ok(
    Array.isArray(record.observations) && record.observations.length <= 8,
  );
  const seen = new Set(),
    sessions = new Set();
  for (const entry of record.observations) {
    keys(entry, Object.keys(recordTemplate().observations[0]));
    assert.ok(hosts.includes(entry.host) && arms.includes(entry.arm));
    const key = `${entry.host}/${entry.arm}`;
    assert.ok(!seen.has(key), 'Duplicate host/arm');
    seen.add(key);
    assert.ok(['not-run', 'completed', 'unavailable'].includes(entry.status));
    assert.equal(
      entry.promptSha256,
      digest(prompts[entry.arm]),
      'Prompt mismatch',
    );
    assert.ok(
      nullableBoolean(entry.independentConversation) &&
        nullableBoolean(entry.accessVerified),
    );
    assert.ok(
      nullableMetric(entry.elapsedMs) && nullableMetric(entry.observedTokens),
    );
    assert.ok(typeof entry.notes === 'string' && entry.notes.length <= 2000);
    assert.ok(
      entry.observedAt === null ||
        (typeof entry.observedAt === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
            entry.observedAt,
          ) &&
          Number.isFinite(Date.parse(entry.observedAt))),
    );
    assert.ok(
      ['unknown', 'user-report', 'visible-calls'].includes(
        entry.toolObservation,
      ),
    );
    keys(entry.ratings, criteria);
    assert.ok(
      Object.values(entry.ratings).every((value) =>
        ['pass', 'fail', 'unknown'].includes(value),
      ),
    );
    if (entry.environment !== null) {
      keys(entry.environment, [
        'model',
        'codexVersion',
        'editorVersion',
        'extensionVersion',
      ]);
      assert.ok(Object.values(entry.environment).every(short));
    }
    if (entry.sessionLabel !== null) {
      assert.ok(
        short(entry.sessionLabel) && !sessions.has(entry.sessionLabel),
        'Conversation reused',
      );
      sessions.add(entry.sessionLabel);
    }
    if (entry.transcript !== null) {
      keys(entry.transcript, ['file', 'sha256']);
      assert.match(entry.transcript.file, /^[a-z0-9][a-z0-9-]*\.txt$/u);
      assert.ok(hash(entry.transcript.sha256));
    }
    if (entry.tools !== null) {
      assert.ok(Array.isArray(entry.tools) && entry.tools.length <= 50);
      for (const tool of entry.tools) {
        keys(tool, ['name', 'outcome']);
        assert.ok(
          [
            'get_knowledge_status',
            'search_knowledge',
            'read_knowledge',
            'propose_knowledge_update',
          ].includes(tool.name),
        );
        assert.ok(['success', 'error'].includes(tool.outcome));
      }
    }
    if (entry.status === 'completed') {
      assert.ok(
        entry.transcript &&
          entry.sessionLabel &&
          entry.environment &&
          entry.tools !== null &&
          entry.observedAt,
        'Completed needs evidence and observed tool list',
      );
    } else {
      assert.ok(
        Object.values(entry.ratings).every((value) => value === 'unknown'),
        'Unperformed task cannot receive scores',
      );
    }
  }
  const rows = hosts.flatMap((host) =>
    arms.map((arm) => {
      const entry = record.observations.find(
        (item) => item.host === host && item.arm === arm,
      );
      const eligible =
        entry?.status === 'completed' &&
        entry.independentConversation === true &&
        entry.accessVerified === true &&
        entry.toolObservation === 'visible-calls' &&
        (arm !== 'baseline' || entry.tools.length === 0);
      return {
        host,
        arm,
        status: entry?.status ?? 'missing',
        eligible: Boolean(eligible),
        ratings:
          entry?.ratings ??
          Object.fromEntries(criteria.map((key) => [key, 'unknown'])),
      };
    }),
  );
  return {
    schemaVersion: 1,
    fixture: fixtureIdentity,
    rows,
    coverageComplete: rows.every((row) => row.eligible),
    comparableEnvironments: hosts.map((host) => {
      const entries = record.observations.filter(
        (entry) => entry.host === host,
      );
      return {
        host,
        same:
          entries.length === 4 &&
          entries.every(
            (entry) =>
              entry.environment !== null &&
              entries[0].environment !== null &&
              Object.keys(entry.environment).every(
                (key) => entry.environment[key] === entries[0].environment[key],
              ),
          ),
      };
    }),
    // No automatic quality winner or model-usage claim from manual ratings.
    interpretation:
      'Manual observational small-sample ratings; artifact verification and review required. No causal or statistical effectiveness claim.',
  };
}

export async function verifyArtifacts(record, directory) {
  summarize(record);
  for (const entry of record.observations) {
    if (!entry.transcript) continue;
    const path = join(directory, entry.transcript.file),
      stat = await lstat(path);
    assert.ok(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024,
      'Invalid transcript artifact',
    );
    assert.equal(
      digest(await readFile(path)),
      entry.transcript.sha256,
      'Transcript checksum mismatch',
    );
  }
}

export async function prepareEvaluation() {
  const directory = await mkdtemp(join(tmpdir(), 'repo-knowledge-t21-'));
  for (const arm of ['baseline', 'natural', 'explicit']) {
    const workspace = join(directory, arm, 'workspace');
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src/reservations.ts'), source, {
      flag: 'wx',
    });
    if (arm !== 'baseline') {
      const store = join(directory, arm, 'store');
      await mkdir(store);
      await writeFile(
        join(store, 'knowledge.json'),
        JSON.stringify(snapshot, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
    }
  }
  await mkdir(join(directory, 'reviewer'));
  await writeFile(
    join(directory, 'reviewer/observations.json'),
    JSON.stringify(recordTemplate(), null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  return {
    directory,
    fixture: fixtureIdentity,
    reuseWorkspace: 'natural/workspace',
    modelRequests: 0,
    sourceExecuted: false,
  };
}
