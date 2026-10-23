import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { KnowledgeStore } from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';

test('source navigation binds snapshot, validates ranges and refuses missing sources', async () => {
  const f = await fixture();
  try {
    const store = new KnowledgeStore(f.repository, f.store);
    const read = await store.read('read-fallback');
    const location = await store.evidenceLocation(
      'read-fallback',
      0,
      read.snapshotRevision,
    );
    assert.equal(location.path, join(f.repository, 'src/读取.ts'));
    assert.equal(location.startLine, 1);
    await assert.rejects(
      store.evidenceLocation('read-fallback', -1, read.snapshotRevision),
      /unavailable/u,
    );
    const snapshot = JSON.parse(
      await readFile(join(f.store, 'knowledge.json'), 'utf8'),
    );
    snapshot.cards[2].title += 'changed';
    await writeFile(join(f.store, 'knowledge.json'), JSON.stringify(snapshot));
    await assert.rejects(
      store.evidenceLocation('read-fallback', 0, read.snapshotRevision),
      /changed/u,
    );
    const now = await store.read('read-fallback');
    await rm(join(f.repository, 'src/读取.ts'));
    await assert.rejects(
      store.evidenceLocation('read-fallback', 0, now.snapshotRevision),
      /unavailable/u,
    );
  } finally {
    await f.cleanup();
  }
});

test('Chinese/code Top-5 retrieval evaluation uses 15 cards and records lexical misses', async () => {
  const f = await fixture();
  try {
    const file = join(f.store, 'knowledge.json');
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    const examples = [
      [
        'cache-expiry',
        '缓存过期 TTL',
        'Cache.expire controls lifetime',
        ['过期', 'TTL'],
      ],
      [
        'cache-lock',
        '缓存锁与并发',
        'Cache.lock controls simultaneous writes',
        ['并发'],
      ],
      [
        'cache-metrics',
        '缓存命中率指标',
        'Cache.metrics reports hit ratio',
        ['指标'],
      ],
      [
        'disk-storage',
        '磁盘文件持久化',
        'DiskStorage writes files',
        ['持久化'],
      ],
      ['http-get', 'HTTP GET 请求', 'HTTP client get request', ['HTTP']],
      ['auth-token', '认证令牌', 'Auth.token authenticates requests', ['认证']],
      ['build-command', '构建命令', 'Build.compile creates bundles', ['构建']],
      ['read-file', '文件读取编码', 'File.read decodes UTF-8 bytes', ['文件']],
      [
        'empty-array',
        '空数组返回值',
        'An empty array is returned for no records',
        ['数组'],
      ],
      ['null-check', 'null 值检查', 'Check null before converting', ['null']],
      [
        'cache-delete',
        '删除缓存条目',
        'Cache.delete removes an entry',
        ['删除'],
      ],
      [
        'cache-size',
        '缓存大小统计',
        'Cache.size returns entry count',
        ['统计'],
      ],
    ];
    for (const [id, title, body, tags] of examples)
      snapshot.cards.push({ ...snapshot.cards[0], id, title, body, tags });
    await writeFile(file, JSON.stringify(snapshot));
    const store = new KnowledgeStore(f.repository, f.store);
    const cases = [
      ['读取', 'read-fallback'],
      ['空字符串 读取', 'read-fallback'],
      ['read fallback', 'read-fallback'],
      ['Ｃａｃｈｅ．ｇｅｔ', 'cache-storage'],
      ['Cache.get', 'cache-storage'],
      ['Cache get', 'cache-storage'],
      ['未命中', 'cache-miss'],
      ['undefined', 'cache-miss'],
      ['Map', 'cache-storage'],
      ['Cache.expire', 'cache-expiry'],
      ['缓存 过期 TTL', 'cache-expiry'],
      ['Cache lock', 'cache-lock'],
      ['命中率', 'cache-metrics'],
      ['DiskStorage', 'disk-storage'],
      ['HTTP GET', 'http-get'],
      ['Auth.token', 'auth-token'],
      ['文件 读取 编码', 'read-file'],
      ['Cache.delete', 'cache-delete'],
      ['缓存 大小 统计', 'cache-size'],
      ['构建', 'build-command'],
    ];
    let hits = 0;
    for (const [query, id] of cases)
      if ((await store.search(query, 5)).results.some((r) => r.id === id))
        hits++;
    assert.ok(hits / cases.length >= 0.95, `Top-5 ${hits}/${cases.length}`);
    const misses = [];
    for (const query of [
      '持久记忆的可靠性',
      'what happens when nothing was saved',
    ]) {
      if (
        !(await store.search(query, 5)).results.some(
          (r) => r.id === 'read-fallback',
        )
      )
        misses.push(query);
    }
    assert.equal(
      misses.length,
      2,
      'lexical search must not pretend semantic retrieval',
    );
    console.log(
      `Retrieval fixture: ${snapshot.cards.length} cards; lexical Top-5 ${hits}/${cases.length}; documented semantic misses ${misses.length}`,
    );
  } finally {
    await f.cleanup();
  }
});
