import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KnowledgeStore,
  KnowledgePublication,
  WikiCandidates,
  scanRepository,
  defaultScanOptions,
  buildGenerationPacket,
  resolveWikiArticle,
  fingerprint,
  rawDigest,
} from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';
const code = (expected) => (error) => error.code === expected;
const output = (packet, suffix = '') => ({
  packetRevision: packet.packetRevision,
  pages: [
    {
      id: 'wiki-read' + suffix,
      title: '读取说明',
      kind: 'fact',
      body: '空字符串会原样保留。',
      scope: ['src'],
      tags: [],
      evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
    },
  ],
  articles: [
    {
      id: 'overview' + suffix,
      title: '项目概述',
      kind: 'overview',
      parentId: null,
      order: 0,
      sections: [
        {
          id: 'read',
          title: '共享事实',
          blocks: [
            { id: 'fact', type: 'card', cardId: 'wiki-read' + suffix },
            {
              id: 'inference',
              type: 'inference',
              body: '可能用于缓存复用。',
              cardIds: ['wiki-read' + suffix],
            },
          ],
        },
      ],
    },
  ],
});
async function setup(action) {
  const f = await fixture();
  try {
    const path = join(f.store, 'knowledge.json');
    const original = await readFile(path);
    const knowledge = new KnowledgeStore(f.repository, f.store, 'wiki-v2');
    const publication = new KnowledgePublication(knowledge);
    const migrate = async () => {
      const review = await publication.previewWikiMigration();
      return publication.migrateWiki(review.itemId, review.token);
    };
    const candidate = async (suffix = '') => {
      const plan = await scanRepository(f.repository, f.store, {
        ...defaultScanOptions,
        include: ['src/**/*.ts'],
        exclude: [],
      });
      const packet = await buildGenerationPacket(knowledge, plan);
      return new WikiCandidates(knowledge).save(
        plan,
        packet,
        output(packet, suffix),
        2,
      );
    };
    const publish = async (id) => {
      const review = await publication.previewWikiCreation(id);
      return publication.publishWikiCreation(id, review.token);
    };
    await action({
      ...f,
      path,
      original,
      knowledge,
      publication,
      migrate,
      candidate,
      publish,
    });
  } finally {
    await f.cleanup();
  }
}

test('reviewed migration retains old pending metadata and raw BOM/CRLF bytes; untouched head restores exact bytes', () =>
  setup(async (f) => {
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(f.original.toString('utf8').replaceAll('\n', '\r\n')),
    ]);
    await writeFile(f.path, original);
    const read = await f.knowledge.read('read-fallback');
    const pending = await f.knowledge.propose({
      id: read.card.id,
      baseRevision: 1,
      baseSnapshot: read.snapshotRevision,
      reason: '旧候选保留',
      proposedCard: { ...read.card, revision: 2 },
    });
    const pendingPath = join(
        f.store,
        'proposals',
        pending.proposalId + '.json',
      ),
      pendingBytes = await readFile(pendingPath);
    const review = await f.publication.previewWikiMigration();
    assert.equal(review.retainedMetadata.entries, 1);
    assert.equal(review.after.schemaVersion, 2);
    assert.deepEqual(await readFile(f.path), original);
    await assert.rejects(
      f.publication.migrateWiki(review.itemId, 'wrong'),
      code('REVIEW_CHANGED'),
    );
    assert.equal((await f.publication.history()).length, 0);
    const result = await f.publication.migrateWiki(review.itemId, review.token);
    const history = await f.publication.readHistory(result.transactionId);
    assert.equal(history.record.schemaVersion, 3);
    assert.deepEqual(history.beforeBytes, original);
    assert.equal(history.record.beforeBytesSha256, rawDigest(original));
    assert.equal((await f.knowledge.status()).schemaVersion, 2);
    await assert.rejects(
      f.publication.previewProposal(pending.proposalId),
      code('REVISION_CONFLICT'),
    );
    assert.deepEqual(await readFile(pendingPath), pendingBytes);
    await assert.rejects(
      new KnowledgeStore(f.repository, f.store).snapshot(),
      code('INVALID_SNAPSHOT'),
    );
    const rollback = await f.publication.previewWikiRollback(
      result.transactionId,
    );
    assert.equal(rollback.operation, 'restore-wiki');
    await f.publication.rollbackWiki(result.transactionId, rollback.token);
    assert.deepEqual(await readFile(f.path), original);
    assert.deepEqual(await readFile(pendingPath), pendingBytes);
    assert.equal((await f.publication.history()).length, 2);
    await assert.rejects(
      f.publication.previewWikiRollback(result.transactionId),
      code('REVISION_CONFLICT'),
    );
    const again = await f.migrate();
    const undoAgain = await f.publication.previewWikiRollback(
      again.transactionId,
    );
    await f.publication.rollbackWiki(again.transactionId, undoAgain.token);
    assert.deepEqual(await readFile(f.path), original);
  }));

test('v1 Wiki candidate is explicitly revalidated after migration and articles/cards publish and remove as one batch', () =>
  setup(async (f) => {
    const saved = await f.candidate();
    const file = join(f.store, 'wiki-candidates', saved.candidateId + '.json'),
      bytes = await readFile(file);
    await assert.rejects(
      f.publication.previewWikiCreation(saved.candidateId),
      code('WIKI_MIGRATION_REQUIRED'),
    );
    const migrated = await f.migrate();
    const migrationTarget = (await f.knowledge.snapshot()).snapshotRevision;
    const review = await f.publication.previewWikiCreation(saved.candidateId);
    assert.equal(review.adaptedFromMigration, migrated.transactionId);
    assert.equal(review.before.cards.length, 3);
    assert.equal(review.before.articles.length, 0);
    assert.equal(review.after.cards.length, 4);
    assert.equal(review.after.articles.length, 1);
    assert.equal(
      resolveWikiArticle(review.after, 'overview').needsReview,
      false,
    );
    await assert.rejects(
      f.publication.publishWikiCreation(saved.candidateId, 'wrong'),
      code('REVIEW_CHANGED'),
    );
    const committed = await f.publication.publishWikiCreation(
      saved.candidateId,
      review.token,
    );
    assert.equal((await f.knowledge.read('wiki-read')).card.revision, 1);
    assert.equal(
      (await f.publication.readHistory(committed.transactionId)).record
        .operation,
      'create-wiki',
    );
    assert.deepEqual(await readFile(file), bytes);
    await assert.rejects(
      f.publish(saved.candidateId),
      code('ALREADY_PUBLISHED'),
    );
    const rollback = await f.publication.previewWikiRollback(
      committed.transactionId,
    );
    await f.publication.rollbackWiki(committed.transactionId, rollback.token);
    const after = await f.knowledge.snapshot();
    assert.equal(after.snapshot.cards.length, 3);
    assert.deepEqual(after.snapshot.articles, []);
    assert.equal(after.snapshotRevision, migrationTarget); // ABA is intentional, restoration still refused.
    await assert.rejects(
      f.publication.previewWikiRollback(migrated.transactionId),
      code('REVISION_CONFLICT'),
    );
    assert.deepEqual(await f.publication.reservedCreationIds(), ['wiki-read']);
    await assert.rejects(f.candidate(), code('EXISTING_CARD'));
    const retained = await f.publication.readHistory(committed.transactionId);
    assert.equal(JSON.parse(retained.after).articles[0].id, 'overview');
    assert.equal(retained.state, 'committed');
  }));

test('append ordering is reviewed, unrelated human articles survive, and creation rollback cannot cross a later write', () =>
  setup(async (f) => {
    await f.migrate();
    const snapshot = (await f.knowledge.snapshot()).snapshot;
    snapshot.articles = [
      {
        id: 'human',
        revision: 1,
        title: '人工说明',
        kind: 'guide',
        language: 'zh-CN',
        parentId: null,
        order: 0,
        sections: [
          {
            id: 'reason',
            title: '理由',
            blocks: [
              {
                id: 'note',
                type: 'note',
                kind: 'rationale',
                author: 'human',
                body: '  人工理由必须保留。\n',
                references: [],
              },
            ],
          },
        ],
      },
    ];
    await writeFile(f.path, JSON.stringify(snapshot)); // Self-authored content fixture, not an article edit API.
    const saved = await f.candidate();
    const review = await f.publication.previewWikiCreation(saved.candidateId);
    assert.deepEqual(review.after.articles[0], snapshot.articles[0]);
    assert.equal(review.after.articles[1].order, 1);
    const committed = await f.publication.publishWikiCreation(
      saved.candidateId,
      review.token,
    );
    const second = await f.candidate('-second'),
      secondResult = await f.publish(second.candidateId);
    await assert.rejects(
      f.publication.previewWikiRollback(committed.transactionId),
      code('REVISION_CONFLICT'),
    );
    const back = await f.publication.previewWikiRollback(
      secondResult.transactionId,
    );
    await f.publication.rollbackWiki(secondResult.transactionId, back.token);
    assert.deepEqual(
      (await f.knowledge.snapshot()).snapshot.articles[0],
      snapshot.articles[0],
    );
    await assert.rejects(
      f.publication.previewWikiRollback(committed.transactionId),
      code('REVISION_CONFLICT'),
    );
  }));

test('migration and Wiki confirmation bind metadata, source, canonical base and the existing writer lock', () =>
  setup(async (f) => {
    const review = await f.publication.previewWikiMigration();
    await mkdir(join(f.store, 'plans'), { recursive: true });
    await writeFile(join(f.store, 'plans', 'retained.json'), '{}');
    await assert.rejects(
      f.publication.migrateWiki(review.itemId, review.token),
      code('REVIEW_CHANGED'),
    );
    const fresh = await f.publication.previewWikiMigration();
    await writeFile(join(f.store, '.publication.lock'), 'another writer');
    await assert.rejects(
      f.publication.migrateWiki(fresh.itemId, fresh.token),
      code('STORE_LOCKED'),
    );
    await unlink(join(f.store, '.publication.lock'));
    await f.publication.migrateWiki(fresh.itemId, fresh.token);
    const candidate = await f.candidate(),
      candidateReview = await f.publication.previewWikiCreation(
        candidate.candidateId,
      );
    const source = join(f.repository, 'src/读取.ts'),
      original = await readFile(source);
    await writeFile(source, original.toString('utf8').replace('??', '||'));
    await assert.rejects(
      f.publication.publishWikiCreation(
        candidate.candidateId,
        candidateReview.token,
      ),
    );
    assert.equal((await f.knowledge.snapshot()).snapshot.articles.length, 0);
    await writeFile(source, original);
    const candidatePath = join(
      f.store,
      'wiki-candidates',
      candidate.candidateId + '.json',
    );
    const altered = JSON.parse(await readFile(candidatePath, 'utf8'));
    altered.output.pages[0].body += ' reviewed text changed';
    await writeFile(candidatePath, JSON.stringify(altered));
    await assert.rejects(
      f.publication.publishWikiCreation(
        candidate.candidateId,
        candidateReview.token,
      ),
      code('REVIEW_CHANGED'),
    );
  }));

test('prepared v3 recovery marks applied/unapplied transactions without rewriting knowledge or silently clearing conflicts', () =>
  setup(async (f) => {
    const result = await f.migrate(),
      marker = join(f.store, 'history', result.transactionId, 'committed');
    const after = await readFile(f.path);
    await unlink(marker);
    await assert.rejects(f.publication.previewWikiMigration());
    const current = await f.knowledge.snapshot();
    assert.equal(
      (
        await f.publication.recover(
          result.transactionId,
          current.snapshotRevision,
        )
      ).state,
      'committed',
    );
    assert.deepEqual(await readFile(f.path), after);
    await unlink(marker);
    await writeFile(f.path, f.original);
    const before = await f.knowledge.snapshot();
    assert.equal(
      (
        await f.publication.recover(
          result.transactionId,
          before.snapshotRevision,
        )
      ).state,
      'aborted',
    );
    assert.deepEqual(await readFile(f.path), f.original);
  }));

test('v3 raw backups and semantic deltas reject tampering even when normalized or recomputed hashes agree', () =>
  setup(async (f) => {
    const migrated = await f.migrate(),
      directory = join(f.store, 'history', migrated.transactionId);
    const beforePath = join(directory, 'before.json'),
      before = await readFile(beforePath);
    await writeFile(
      beforePath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), before]),
    );
    await assert.rejects(
      f.publication.readHistory(migrated.transactionId),
      code('INVALID_HISTORY'),
    );
    await writeFile(beforePath, before);
    const saved = await f.candidate(),
      committed = await f.publish(saved.candidateId);
    const created = join(f.store, 'history', committed.transactionId);
    const afterPath = join(created, 'after.json'),
      recordPath = join(created, 'record.json'),
      marker = join(created, 'committed');
    const text = await readFile(afterPath, 'utf8'),
      record = JSON.parse(await readFile(recordPath, 'utf8'));
    const altered = JSON.parse(text);
    altered.cards[0].body = 'unrelated corruption';
    const bytes = Buffer.from(JSON.stringify(altered));
    await writeFile(afterPath, bytes);
    await writeFile(
      recordPath,
      JSON.stringify({
        ...record,
        afterSnapshot: fingerprint(bytes.toString()),
        afterBytesSha256: rawDigest(bytes),
      }),
    );
    await writeFile(marker, fingerprint(bytes.toString()) + '\n');
    await assert.rejects(
      f.publication.readHistory(committed.transactionId),
      code('INVALID_HISTORY'),
    );
  }));

test('migration refuses normalization, active metadata and default runtime activation without changing original bytes', () =>
  setup(async (f) => {
    await assert.rejects(
      new KnowledgePublication(
        new KnowledgeStore(f.repository, f.store),
      ).previewWikiMigration(),
      code('INVALID_SNAPSHOT'),
    );
    const base = JSON.parse(f.original);
    base.cards[0].body += ' ';
    await writeFile(f.path, JSON.stringify(base));
    await assert.rejects(
      f.publication.previewWikiMigration(),
      code('WIKI_MIGRATION_NORMALIZES_CONTENT'),
    );
    await writeFile(f.path, f.original);
    await mkdir(join(f.store, 'generation-jobs'), { recursive: true });
    await writeFile(join(f.store, 'generation-jobs', 'active.lease'), '{}');
    await assert.rejects(
      f.publication.previewWikiMigration(),
      code('RECOVERY_REQUIRED'),
    );
    assert.deepEqual(await readFile(f.path), f.original);
    assert.equal((await f.publication.history()).length, 0);
    assert.deepEqual(
      (await readdir(f.store)).filter((name) => name === '.publication.lock'),
      [],
    );
  }));

test('inventory budgets and ordinary card writes stay safe after v3 Wiki publication', () =>
  setup(async (f) => {
    const migrated = await f.migrate(),
      saved = await f.candidate(),
      created = await f.publish(saved.candidateId);
    assert.deepEqual(await f.publication.reservedWikiArticleIds(), [
      'overview',
    ]);
    const read = await f.knowledge.read('wiki-read');
    const pending = await f.knowledge.propose({
      id: read.card.id,
      baseRevision: 1,
      baseSnapshot: read.snapshotRevision,
      reason: '人工卡片编辑',
      proposedCard: { ...read.card, revision: 2, body: '人工补充事实。' },
    });
    const review = await f.publication.previewProposal(pending.proposalId);
    await f.publication.publish(pending.proposalId, review.token);
    const snapshot = (await f.knowledge.snapshot()).snapshot;
    assert.equal(snapshot.articles.length, 1);
    assert.equal(resolveWikiArticle(snapshot, 'overview').needsReview, true);
    await assert.rejects(
      f.publication.previewWikiRollback(created.transactionId),
      code('REVISION_CONFLICT'),
    );
    await assert.rejects(
      f.publication.previewWikiRollback(migrated.transactionId),
      code('REVISION_CONFLICT'),
    );
    const before = await readFile(f.path);
    const plans = join(f.store, 'plans');
    await mkdir(plans, { recursive: true });
    for (let i = 0; i < 5; i++)
      await writeFile(join(plans, i + '.json'), 'x'.repeat(1024 * 1024));
    await assert.rejects(
      f.publication.previewWikiCreation(saved.candidateId),
      code('ALREADY_PUBLISHED'),
    );
    const next = await f.candidate('-next');
    await assert.rejects(
      f.publication.previewWikiCreation(next.candidateId),
      code('LIMIT'),
    );
    assert.deepEqual(await readFile(f.path), before);
  }));
