import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KnowledgeStore,
  PublishedWikiReader,
} from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';

test('published reader reads live canonical articles, guards old navigation, and never writes knowledge', async () => {
  const f = await fixture();
  try {
    const path = join(f.store, 'knowledge.json');
    const knowledge = new KnowledgeStore(f.repository, f.store, 'wiki-v2');
    const reader = new PublishedWikiReader(knowledge);
    await assert.rejects(reader.catalog(), { code: 'WIKI_MIGRATION_REQUIRED' });
    const snapshot = JSON.parse(
      await readFile(join(f.repository, 'wiki-preview.json'), 'utf8'),
    );
    await writeFile(path, JSON.stringify(snapshot)); // Self-authored canonical fixture only.
    const before = await readFile(path);
    const catalog = await reader.catalog();
    const first = await reader.read('overview');
    assert.equal(first.preview, false);
    assert.equal(first.sourceFreshness, 'current');
    const evidence = first.evidence[0];
    const location = await reader.evidence(
      'overview',
      evidence.cardId,
      evidence.index,
      first.snapshotRevision,
    );
    assert.equal(
      await realpath(location.path),
      await realpath(join(f.repository, evidence.path)),
    );
    await assert.rejects(
      reader.evidence('overview', 'not-referenced', 0, first.snapshotRevision),
      { code: 'INVALID_EVIDENCE' },
    );
    assert.deepEqual(await readFile(path), before);
    snapshot.articles[0].title = '正式标题已更新';
    snapshot.articles[0].revision++;
    await writeFile(path, JSON.stringify(snapshot));
    assert.equal(
      (await reader.read(snapshot.articles[0].id)).article.title,
      '正式标题已更新',
    );
    assert.notEqual(
      (await reader.catalog()).snapshotRevision,
      catalog.snapshotRevision,
    );
    await assert.rejects(
      reader.evidence(
        'overview',
        evidence.cardId,
        evidence.index,
        first.snapshotRevision,
      ),
      { code: 'REVISION_CONFLICT' },
    );
    snapshot.cards.find((card) => card.id === evidence.cardId).revision++;
    await writeFile(path, JSON.stringify(snapshot));
    const changed = await reader.read('overview');
    assert.equal(changed.needsReview, true);
    assert.ok(
      changed.sections
        .flatMap((section) => section.blocks)
        .some(
          (block) =>
            block.type === 'card' &&
            block.reference.cardId === evidence.cardId &&
            !block.card,
        ),
    );
    snapshot.articles = [];
    await writeFile(path, JSON.stringify(snapshot));
    assert.deepEqual((await reader.catalog()).articles, []);
    await assert.rejects(reader.read('overview'), {
      code: 'WIKI_ARTICLE_MISSING',
    });
  } finally {
    await f.cleanup();
  }
});

test('published reader refuses a mixed article/card snapshot when knowledge changes mid-read', async () => {
  const f = await fixture();
  try {
    const path = join(f.store, 'knowledge.json');
    const snapshot = JSON.parse(
      await readFile(join(f.repository, 'wiki-preview.json'), 'utf8'),
    );
    await writeFile(path, JSON.stringify(snapshot));
    const knowledge = new KnowledgeStore(f.repository, f.store, 'wiki-v2');
    const original = knowledge.read.bind(knowledge);
    let altered = false;
    knowledge.read = async (id) => {
      const value = await original(id);
      if (!altered) {
        altered = true;
        snapshot.articles[0].revision++;
        await writeFile(path, JSON.stringify(snapshot));
      }
      return value;
    };
    await assert.rejects(new PublishedWikiReader(knowledge).read('overview'), {
      code: 'REVISION_CONFLICT',
    });
  } finally {
    await f.cleanup();
  }
});
