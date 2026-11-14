import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KnowledgeStore,
  KnowledgePublication,
  GenerationJobs,
  IncrementalUpdates,
  bindWikiCard,
  parseRuntimeSnapshot,
  resolveWikiArticle,
  fingerprint,
  scanRepository,
  defaultScanOptions,
  buildGenerationPacket,
  captureDependencyBaseline,
  reviewDependencyImpact,
  WikiPreviewReader,
} from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';
const code = (expected) => (error) => error.code === expected;
const options = {
  ...defaultScanOptions,
  include: ['src/**/*.ts'],
  exclude: [],
};
const makeWiki = (base) => ({
  ...base,
  schemaVersion: 2,
  articles: [
    {
      id: 'overview',
      revision: 1,
      title: '项目概述',
      kind: 'overview',
      language: 'zh-CN',
      parentId: null,
      order: 0,
      sections: [
        {
          id: 'reading',
          title: '缓存读取',
          blocks: [
            {
              id: 'fact',
              type: 'card',
              reference: bindWikiCard(
                base.cards.find((card) => card.id === 'read-fallback'),
              ),
            },
            {
              id: 'reason',
              type: 'note',
              kind: 'rationale',
              author: 'human',
              body: '  人工理由：空字符串必须原样保留。\n\n',
              references: [],
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
    const base = JSON.parse(original);
    const wiki = makeWiki(base);
    // Explicitly authored fixture, not a product migration or migration-history test.
    await writeFile(path, JSON.stringify(wiki, null, 2) + '\n');
    const knowledge = new KnowledgeStore(f.repository, f.store, 'wiki-v2');
    const publication = new KnowledgePublication(knowledge);
    const propose = async (changes) => {
      const read = await knowledge.read('read-fallback');
      return knowledge.propose({
        id: read.card.id,
        baseRevision: read.card.revision,
        baseSnapshot: read.snapshotRevision,
        reason: '自编人工审阅',
        proposedCard: {
          ...read.card,
          ...changes,
          revision: read.card.revision + 1,
        },
      });
    };
    const publish = async (id) => {
      const review = await publication.previewProposal(id);
      return publication.publish(id, review.token);
    };
    const plan = () => scanRepository(f.repository, f.store, options);
    await action({
      ...f,
      path,
      base,
      wiki,
      original,
      knowledge,
      publication,
      propose,
      publish,
      plan,
    });
  } finally {
    await f.cleanup();
  }
}

test('v2 compatibility is explicit, bounded and rejects normalization; default stores still refuse it', () =>
  setup(async (f) => {
    const before = await readFile(f.path);
    await assert.rejects(
      new KnowledgeStore(f.repository, f.store).snapshot(),
      code('INVALID_SNAPSHOT'),
    );
    assert.throws(
      () => new KnowledgeStore(f.repository, f.store, 'unknown'),
      code('INVALID_SNAPSHOT_FORMAT'),
    );
    assert.throws(
      () => parseRuntimeSnapshot(f.wiki, 'unknown'),
      code('INVALID_SNAPSHOT_FORMAT'),
    );
    assert.equal(parseRuntimeSnapshot(f.base, 'wiki-v2').schemaVersion, 1);
    assert.equal((await f.knowledge.status()).schemaVersion, 2);
    assert.equal((await f.knowledge.search('读取')).results.length > 0, true);
    const bad = structuredClone(f.wiki);
    bad.articles[0].title = ' 会被 trim ';
    assert.throws(
      () => parseRuntimeSnapshot(bad, 'wiki-v2'),
      code('WIKI_NORMALIZES_CONTENT'),
    );
    const unknown = { ...f.wiki, unexpected: 'do not strip' };
    assert.throws(
      () => parseRuntimeSnapshot(unknown, 'wiki-v2'),
      code('INVALID_SNAPSHOT'),
    );
    for (const changed of [
      { ...f.wiki, schemaVersion: 3 },
      { ...f.wiki, articles: Array(65).fill(f.wiki.articles[0]) },
    ])
      assert.throws(() => parseRuntimeSnapshot(changed, 'wiki-v2'));
    assert.deepEqual(await readFile(f.path), before);
  }));

test('v2 draft/publish/monotonic rollback preserve complete article values and raw backup bytes', () =>
  setup(async (f) => {
    const before = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from((await readFile(f.path, 'utf8')).replaceAll('\n', '\r\n')),
    ]);
    await writeFile(f.path, before);
    const reader = await WikiPreviewReader.open(
      f.knowledge,
      JSON.stringify(f.wiki),
    );
    assert.equal((await reader.read('overview')).needsReview, false);
    const draft = await f.publication.createDraft('read-fallback');
    const body = JSON.parse(await readFile(draft.path, 'utf8'));
    body.proposedCard.body += '\n人工核对说明。';
    await writeFile(draft.path, JSON.stringify(body));
    const pending = await f.publication.submitDraft(draft.draftId);
    assert.deepEqual(await readFile(f.path), before);
    const committed = await f.publish(pending.proposalId);
    const snapshot = (await f.knowledge.snapshot()).snapshot;
    assert.deepEqual(snapshot.articles, f.wiki.articles);
    assert.equal(snapshot.schemaVersion, 2);
    assert.equal((await reader.read('overview')).needsReview, true);
    assert.equal(
      (await reader.read('overview')).sections[0].blocks[0].card,
      undefined,
    );
    assert.deepEqual(
      await readFile(
        join(f.store, 'history', committed.transactionId, 'before.json'),
      ),
      before,
    );
    const review = await f.publication.previewRollback(committed.transactionId);
    await f.publication.rollback(committed.transactionId, review.token);
    const restored = (await f.knowledge.snapshot()).snapshot;
    assert.equal(
      restored.cards.find((card) => card.id === 'read-fallback').revision,
      3,
    );
    assert.deepEqual(restored.articles, f.wiki.articles);
    assert.equal(resolveWikiArticle(restored, 'overview').needsReview, true); // Never rebind silently.
    assert.equal((await f.publication.history()).length, 2);
  }));

test('v2 generation jobs, creation/removal and impact checks keep articles and do not invoke a model', () =>
  setup(async (f) => {
    const plan = await f.plan(),
      packet = await buildGenerationPacket(f.knowledge, plan);
    const baseline = await captureDependencyBaseline(f.knowledge, plan);
    assert.deepEqual(
      (await reviewDependencyImpact(f.knowledge, baseline)).changes,
      [],
    );
    const jobs = new GenerationJobs(f.knowledge),
      job = await jobs.create(plan, 2, 60000);
    const output = {
      packetRevision: packet.packetRevision,
      pages: [
        {
          id: 'new-v2-card',
          title: '读取说明',
          kind: 'fact',
          body: '同一源码的新候选。',
          tags: [],
          scope: ['src'],
          evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
        },
      ],
    };
    let producers = 0;
    const saved = await jobs.run(job.jobId, async () => {
      producers++;
      return f.publication.saveCreation(
        plan,
        packet,
        output,
        undefined,
        job.jobId,
      );
    });
    const again = await jobs.run(job.jobId, async () => {
      throw new Error('must not call producer');
    });
    assert.equal(again.candidateId, saved.candidateId);
    assert.equal(again.modelStarted, false);
    assert.equal(producers, 1);
    const review = await f.publication.previewCreation(job.jobId);
    const committed = await f.publication.publishCreation(
      job.jobId,
      review.token,
    );
    assert.deepEqual(
      (await f.knowledge.snapshot()).snapshot.articles,
      f.wiki.articles,
    );
    assert.equal((await jobs.result(job.jobId)).state, 'previously-published');
    const rollback = await f.publication.previewRollback(
      committed.transactionId,
    );
    await f.publication.rollback(committed.transactionId, rollback.token);
    assert.deepEqual((await f.knowledge.snapshot()).snapshot, f.wiki);
    assert.deepEqual(await f.publication.reservedCreationIds(), [
      'new-v2-card',
    ]);
  }));

test('v2 incremental response seam and recovery preserve article rationale and share full base guards', () =>
  setup(async (f) => {
    const plan = await f.plan(),
      packet = await buildGenerationPacket(f.knowledge, plan);
    const base = (await f.knowledge.read('read-fallback')).card;
    const page = structuredClone(base);
    delete page.revision;
    delete page.evidence;
    const output = {
      packetRevision: packet.packetRevision,
      pages: [
        {
          ...page,
          body: base.body + '\n澄清措辞。',
          evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
        },
      ],
    };
    const cwd = join(f.directory, 'scratch');
    await mkdir(cwd);
    let turns = 0;
    const updates = new IncrementalUpdates(f.knowledge, async (interaction) => {
      await interaction.recheck();
      interaction.onTurnRequest();
      turns++;
      return {
        output,
        text: JSON.stringify(output),
        observedTokens: 7,
        submittedTurns: 1,
      };
    });
    const saved = await updates.run({
      plan,
      cardId: base.id,
      command: process.execPath,
      cwd,
    });
    assert.equal(
      (await updates.recover(saved.attemptId)).state,
      'pending-review',
    );
    const committed = await f.publish(saved.proposalId);
    assert.equal(
      (await updates.recover(saved.attemptId)).state,
      'previously-published',
    );
    assert.equal(turns, 1);
    assert.deepEqual(
      (await f.knowledge.snapshot()).snapshot.articles,
      f.wiki.articles,
    );
    const rollback = await f.publication.previewRollback(
      committed.transactionId,
    );
    await f.publication.rollback(committed.transactionId, rollback.token);
    assert.deepEqual(
      (await f.knowledge.snapshot()).snapshot.articles,
      f.wiki.articles,
    );
  }));

test('v2 conservative merge retains human body and articles across publication', () =>
  setup(async (f) => {
    const old = await f.propose({ title: '新标题' });
    const human = await f.propose({ body: '人工设计理由必须保留。' });
    await f.publish(human.proposalId);
    await assert.rejects(
      f.publication.previewProposal(old.proposalId),
      code('REVISION_CONFLICT'),
    );
    const report = await f.publication.previewMerge(old.proposalId);
    assert.deepEqual(report.conflicts, []);
    const draft = await f.publication.createMergeDraft(
      old.proposalId,
      fingerprint(JSON.stringify(report)),
    );
    const pending = await f.publication.submitDraft(draft.draftId);
    await f.publish(pending.proposalId);
    const snapshot = (await f.knowledge.snapshot()).snapshot;
    assert.equal(
      snapshot.cards.find((card) => card.id === 'read-fallback').body,
      '人工设计理由必须保留。',
    );
    assert.deepEqual(snapshot.articles, f.wiki.articles);
  }));

test('v2 prepared-marker recovery keeps exact snapshot bytes; mixed v1 history remains readable but old proposals do not publish', () =>
  setup(async (f) => {
    await writeFile(f.path, f.original);
    const pending = await f.propose({ title: '旧候选' });
    const first = await f.propose({ body: '先前 v1 正式说明。' });
    await f.publish(first.proposalId);
    const v1 = (await f.knowledge.snapshot()).snapshot;
    assert.equal(v1.schemaVersion, 1);
    await writeFile(f.path, JSON.stringify(makeWiki(v1))); // Fixture switch, no product migration.
    const beforePending = await readFile(
      join(f.store, 'proposals', pending.proposalId + '.json'),
    );
    await assert.rejects(
      f.publication.previewProposal(pending.proposalId),
      code('REVISION_CONFLICT'),
    );
    assert.deepEqual(
      await readFile(join(f.store, 'proposals', pending.proposalId + '.json')),
      beforePending,
    );
    const second = await f.propose({ title: 'v2 新标题' });
    const committed = await f.publish(second.proposalId);
    const marker = join(
      f.store,
      'history',
      committed.transactionId,
      'committed',
    );
    await unlink(marker);
    const before = await readFile(f.path);
    assert.ok(
      (await f.publication.history()).some(
        (entry) => entry.state === 'prepared',
      ),
    );
    const current = await f.knowledge.snapshot();
    assert.equal(
      (
        await f.publication.recover(
          committed.transactionId,
          current.snapshotRevision,
        )
      ).state,
      'committed',
    );
    assert.deepEqual(await readFile(f.path), before);
    assert.equal((await f.publication.history()).length, 2);
    await assert.rejects(
      new KnowledgePublication(
        new KnowledgeStore(f.repository, f.store),
      ).history(),
      code('INVALID_SNAPSHOT'),
    );
  }));

test('card-only history rejects altered articles, dropped articles or a hidden format switch even with recomputed hashes', () =>
  setup(async (f) => {
    const pending = await f.propose({ title: '新标题' });
    const committed = await f.publish(pending.proposalId);
    const directory = join(f.store, 'history', committed.transactionId);
    const afterPath = join(directory, 'after.json'),
      recordPath = join(directory, 'record.json'),
      markerPath = join(directory, 'committed');
    const after = await readFile(afterPath, 'utf8'),
      record = JSON.parse(await readFile(recordPath, 'utf8'));
    for (const mutate of [
      (v) => {
        v.articles[0].sections[0].blocks[1].body = 'Tampered reason';
      },
      (v) => {
        v.articles = [];
      },
      (v) => {
        delete v.articles;
        v.schemaVersion = 1;
      },
    ]) {
      const altered = JSON.parse(after);
      mutate(altered);
      const text = JSON.stringify(altered);
      await writeFile(afterPath, text);
      await writeFile(
        recordPath,
        JSON.stringify({ ...record, afterSnapshot: fingerprint(text) }),
      );
      await writeFile(markerPath, fingerprint(text) + '\n');
      await assert.rejects(
        f.publication.readHistory(committed.transactionId),
        code('INVALID_HISTORY'),
      );
    }
    await writeFile(afterPath, after);
    await writeFile(recordPath, JSON.stringify(record));
    await writeFile(markerPath, record.afterSnapshot + '\n');
    assert.equal(
      (await f.publication.readHistory(committed.transactionId)).state,
      'committed',
    );
  }));
