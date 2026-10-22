import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  snapshotSchema,
  KnowledgeStore,
  fingerprint,
} from '../../packages/core/dist/index.js';
import { fixture, emptyDirectory } from '../helpers.mjs';

test('schema rejects unknown versions, duplicate IDs, traversal and unbounded content', async () => {
  const f = await fixture();
  try {
    const original = JSON.parse(
      await readFile(join(f.store, 'knowledge.json'), 'utf8'),
    );
    for (const mutate of [
      (s) => {
        s.schemaVersion = 2;
      },
      (s) => {
        s.cards.push(s.cards[0]);
      },
      (s) => {
        s.cards[0].evidence[0].path = '../escape';
      },
      (s) => {
        s.cards[0].scope = ['C:\\private'];
      },
      (s) => {
        s.cards[0].evidence[0].endLine = 1000;
      },
      (s) => {
        s.cards[0].revision = 0;
      },
      (s) => {
        s.cards[0].body = 'x'.repeat(16001);
      },
      (s) => {
        s.secret = 'unexpected';
      },
    ]) {
      const changed = structuredClone(original);
      mutate(changed);
      assert.equal(snapshotSchema.safeParse(changed).success, false);
    }
  } finally {
    await f.cleanup();
  }
});
test('Chinese/code search, source excerpts, CRLF normalization and stale detection', async () => {
  const f = await fixture();
  try {
    const store = new KnowledgeStore(f.repository, f.store);
    assert.equal((await store.search('读取')).results[0].id, 'read-fallback');
    assert.ok(
      (await store.search('Cache.get')).results.some(
        (card) => card.id === 'cache-miss',
      ),
    );
    assert.equal((await store.search('absent-token')).results.length, 0);
    const card = await store.read('cache-storage');
    assert.equal(card.stale, false);
    assert.match(card.evidence[0].excerpt, /class Cache/u);
    const source = join(f.repository, 'src/cache.ts');
    const text = await readFile(source, 'utf8');
    await writeFile(source, text.replaceAll('\n', '\r\n'));
    assert.equal((await store.read(card.card.id)).stale, false);
    await writeFile(source, text + '// changed\n');
    assert.equal(
      (await store.read(card.card.id)).evidence[0].status,
      'changed',
    );
    assert.equal(
      (await store.status()).cards.filter((entry) => entry.stale).length,
      2,
    );
    await assert.rejects(store.search('', 5), { code: 'INVALID_QUERY' });
    await assert.rejects(store.read('absent'), { code: 'NOT_FOUND' });
  } finally {
    await f.cleanup();
  }
});
test('proposals preserve canonical bytes, require current bases and validate new evidence', async () => {
  const f = await fixture();
  try {
    const store = new KnowledgeStore(f.repository, f.store);
    const before = await readFile(join(f.store, 'knowledge.json'), 'utf8');
    const { card, snapshotRevision } = await store.read('cache-miss');
    const input = {
      id: card.id,
      baseRevision: card.revision,
      baseSnapshot: snapshotRevision,
      reason: 'Clarify empty values',
      proposedCard: { ...card, revision: 2, body: '空字符串是有效缓存命中。' },
    };
    const results = await Promise.all([
      store.propose(input),
      store.propose(input),
    ]);
    assert.notEqual(results[0].proposalId, results[1].proposalId);
    assert.equal((await readdir(join(f.store, 'proposals'))).length, 2);
    assert.equal(
      await readFile(join(f.store, 'knowledge.json'), 'utf8'),
      before,
    );
    await assert.rejects(store.propose({ ...input, baseRevision: 9 }), {
      code: 'REVISION_CONFLICT',
    });
    await assert.rejects(
      store.propose({ ...input, baseSnapshot: '0'.repeat(64) }),
      { code: 'REVISION_CONFLICT' },
    );
    await assert.rejects(store.propose({ ...input, proposedCard: card }), {
      code: 'INVALID_REVISION',
    });
    await writeFile(join(f.repository, 'src/cache.ts'), '// source changed\n');
    await assert.rejects(store.propose(input), { code: 'STALE_EVIDENCE' });
    const proposal = JSON.parse(
      await readFile(
        join(f.store, 'proposals', `${results[0].proposalId}.json`),
        'utf8',
      ),
    );
    assert.equal(proposal.baseSnapshot, snapshotRevision);
  } finally {
    await f.cleanup();
  }
});
test('missing/oversized store fails closed; existing directory symlinks cannot escape repository or proposal store', async () => {
  const f = await fixture();
  try {
    const outside = await emptyDirectory(f.directory, 'outside');
    await writeFile(join(outside, 'source.txt'), 'private outside\n');
    const link = join(f.repository, 'link');
    await symlink(
      outside,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const snapshot = JSON.parse(
      await readFile(join(f.store, 'knowledge.json'), 'utf8'),
    );
    snapshot.cards[0].evidence = [
      {
        path: 'link/source.txt',
        startLine: 1,
        endLine: 1,
        sha256: fingerprint('private outside\n'),
      },
    ];
    await writeFile(join(f.store, 'knowledge.json'), JSON.stringify(snapshot));
    const store = new KnowledgeStore(f.repository, f.store);
    const read = await store.read('cache-storage');
    assert.equal(read.evidence[0].status, 'PATH_ESCAPE');
    assert.equal(read.evidence[0].excerpt, '');
    await symlink(
      outside,
      join(f.store, 'proposals'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const valid = await store.read('cache-miss');
    await assert.rejects(
      store.propose({
        id: valid.card.id,
        baseRevision: 1,
        baseSnapshot: valid.snapshotRevision,
        reason: 'test',
        proposedCard: { ...valid.card, revision: 2 },
      }),
      { code: 'PATH_ESCAPE' },
    );
    await writeFile(
      join(f.store, 'knowledge.json'),
      'x'.repeat(1024 * 1024 + 1),
    );
    await assert.rejects(store.snapshot(), { code: 'LIMIT' });
    await assert.rejects(new KnowledgeStore(f.repository, outside).snapshot(), {
      code: 'STORE_UNAVAILABLE',
    });
  } finally {
    await f.cleanup();
  }
});
