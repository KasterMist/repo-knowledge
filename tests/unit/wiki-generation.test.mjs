import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KnowledgeStore,
  scanRepository,
  defaultScanOptions,
  buildGenerationPacket,
  validateGeneratedWiki,
  wikiGenerationOutputJsonSchema,
  WikiCandidates,
  WikiCandidateReader,
  generateWikiCandidate,
  bindWikiCard,
} from '../../packages/core/dist/index.js';
import {
  GenerationSession,
  generationDefaults,
} from '../../packages/vscode-extension/dist/generation-session.js';
import { wikiHtml } from '../../packages/vscode-extension/dist/wiki-view.js';
import { fixture } from '../helpers.mjs';

const code = (expected) => (error) => error.code === expected;
const output = (packet) => ({
  packetRevision: packet.packetRevision,
  pages: [
    {
      id: 'wiki-read',
      title: '读取',
      kind: 'fact',
      body: '空字符串被保留。',
      tags: ['读取'],
      scope: ['src'],
      evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
    },
  ],
  articles: [
    {
      id: 'overview',
      title: '项目概述',
      kind: 'overview',
      parentId: null,
      order: 0,
      sections: [
        {
          id: 'read',
          title: '读取流程',
          blocks: [
            { id: 'fact', type: 'card', cardId: 'wiki-read' },
            {
              id: 'assumption',
              type: 'inference',
              body: '可能用于缓存重试。',
              cardIds: ['wiki-read'],
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
    const knowledge = new KnowledgeStore(f.repository, f.store);
    const plan = await scanRepository(f.repository, f.store, {
      ...defaultScanOptions,
      include: ['src/**/*.ts'],
      exclude: [],
    });
    const packet = await buildGenerationPacket(knowledge, plan);
    await action({ ...f, knowledge, plan, packet });
  } finally {
    await f.cleanup();
  }
}

test('Wiki adapter derives model provenance, card bindings and evidence; rejects spoofed or ungrounded articles', () =>
  setup(async (f) => {
    const value = output(f.packet);
    const result = validateGeneratedWiki(f.packet, value, 2);
    const [fact, inference] = result.articles[0].sections[0].blocks;
    assert.deepEqual(fact.reference, bindWikiCard(result.cards[0]));
    assert.equal(inference.author, 'model');
    assert.equal(inference.kind, 'inference');
    assert.equal(result.cards[0].revision, 1);
    assert.equal(result.articles[0].language, 'zh-CN');
    assert.equal(wikiGenerationOutputJsonSchema().additionalProperties, false);
    const variants = [
      (v) => {
        v.articles[0].sections[0].blocks[1].author = 'human';
      },
      (v) => {
        v.articles[0].sections[0].blocks[1].type = 'rationale';
      },
      (v) => {
        v.pages[0].kind = 'rationale';
      },
      (v) => {
        v.articles[0].sections[0].blocks[0].cardId = 'cache-storage';
      },
      (v) => {
        v.articles[0].sections[0].blocks.shift();
      },
      (v) => {
        v.articles[0].parentId = 'overview';
      },
      (v) => {
        v.articles[0].sections.push(structuredClone(v.articles[0].sections[0]));
      },
      (v) => {
        v.pages.push({ ...v.pages[0], id: 'orphan' });
      },
      (v) => {
        v.pages[0].evidence[0].endLine = 999;
      },
      (v) => {
        v.pages[0].scope = ['private'];
      },
      (v) => {
        v.pages[0].id = 'cache-storage';
      },
      (v) => {
        v.packetRevision = '0'.repeat(64);
      },
      (v) => {
        v.articles = Array.from({ length: 4 }, () => v.articles[0]);
      },
      (v) => {
        v.pages[0].evidence[0].path = '../private';
      },
    ];
    for (const mutate of variants) {
      const changed = structuredClone(value);
      mutate(changed);
      assert.throws(() => validateGeneratedWiki(f.packet, changed, 2));
    }
    const huge = output(f.packet);
    huge.articles[0].sections[0].blocks = Array.from({ length: 8 }, (_, i) => ({
      id: 'note-' + i,
      type: 'inference',
      body: '汉'.repeat(8000),
      cardIds: ['wiki-read'],
    }));
    assert.throws(
      () => validateGeneratedWiki(f.packet, huge, 2),
      code('WIKI_OUTPUT_LIMIT'),
    );
  }));

test('Wiki candidate saves atomically, reopens without a model, and cannot replace canonical knowledge', () =>
  setup(async (f) => {
    const before = await readFile(join(f.store, 'knowledge.json'));
    const candidates = new WikiCandidates(f.knowledge);
    const saved = await candidates.save(f.plan, f.packet, output(f.packet), 2);
    assert.equal(saved.state, 'wiki-preview');
    assert.equal(saved.published, false);
    const entries = await readdir(join(f.store, 'wiki-candidates'));
    assert.deepEqual(entries, [saved.candidateId + '.json']);
    const text = await readFile(
      join(f.store, 'wiki-candidates', entries[0]),
      'utf8',
    );
    assert.ok(!text.includes('export class')); // No full source packet persisted.
    const reader = await WikiCandidateReader.open(
      f.knowledge,
      saved.candidateId,
    );
    assert.equal(reader.catalog().length, 1);
    const view = await reader.read('overview');
    assert.equal(view.sourceFreshness, 'current');
    assert.equal(view.sections[0].blocks[0].card.body, '空字符串被保留。');
    const html = wikiHtml(
      reader.catalog(),
      view,
      'fixture',
      'native',
      'a'.repeat(32),
      '',
      true,
    );
    assert.match(html, /不是正式知识/u);
    assert.doesNotMatch(html, /data-card=/u); // Candidate navigation has no privileged bridge.
    await assert.rejects(reader.evidence(), code('WIKI_CANDIDATE_ONLY'));
    assert.equal((await candidates.list()).length, 1);
    assert.equal(
      (await candidates.read(saved.candidateId)).sourceState,
      'current',
    );
    assert.equal((await candidates.list()).length, 1);
    await assert.rejects(f.knowledge.read('wiki-read'), code('NOT_FOUND'));
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), before);
  }));

test('source changes refuse a late Wiki save; existing candidates remain visibly stale', () =>
  setup(async (f) => {
    const candidates = new WikiCandidates(f.knowledge);
    const saved = await candidates.save(f.plan, f.packet, output(f.packet), 2);
    const reader = await WikiCandidateReader.open(
      f.knowledge,
      saved.candidateId,
    );
    const file = join(f.repository, 'src/读取.ts');
    const original = await readFile(file);
    await writeFile(file, original.toString('utf8').replace('??', '||'));
    await assert.rejects(
      candidates.save(f.plan, f.packet, output(f.packet), 2),
    );
    assert.equal((await reader.read('overview')).sourceFreshness, 'stale');
    assert.equal((await readdir(join(f.store, 'wiki-candidates'))).length, 1);
    await writeFile(file, original);
    assert.equal((await reader.read('overview')).sourceFreshness, 'current');
    const snapshotFile = join(f.store, 'knowledge.json');
    const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
    snapshot.cards[0].body += ' human change';
    await writeFile(snapshotFile, JSON.stringify(snapshot));
    assert.equal((await reader.read('overview')).sourceFreshness, 'stale');
  }));

test('cancel, unknown backends, altered identities/provenance and candidate symlinks fail closed', () =>
  setup(async (f) => {
    const candidates = new WikiCandidates(f.knowledge);
    await assert.rejects(
      candidates.save(
        f.plan,
        f.packet,
        output(f.packet),
        2,
        AbortSignal.abort(),
      ),
    );
    const scratch = join(f.directory, 'scratch');
    await mkdir(scratch);
    await assert.rejects(
      generateWikiCandidate({
        command: process.execPath,
        cwd: scratch,
        knowledge: f.knowledge,
        plan: f.plan,
        maxPages: 2,
      }),
      code('UNVERIFIED_CODEX_VERSION'),
    );
    assert.equal((await candidates.list()).length, 0);
    const saved = await candidates.save(f.plan, f.packet, output(f.packet), 2);
    const file = join(f.store, 'wiki-candidates', saved.candidateId + '.json');
    const original = await readFile(file, 'utf8');
    for (const mutate of [
      (v) => {
        v.candidateId = '00000000-0000-4000-8000-000000000000';
      },
      (v) => {
        v.plan.repositoryId = '0'.repeat(64);
      },
      (v) => {
        v.output.articles[0].sections[0].blocks[1].author = 'human';
      },
      (v) => {
        v.output.pages[0].scope = ['private'];
      },
      (v) => {
        v.output.packetRevision = '0'.repeat(64);
      },
    ]) {
      const altered = JSON.parse(original);
      mutate(altered);
      await writeFile(file, JSON.stringify(altered));
      await assert.rejects(candidates.read(saved.candidateId));
    }
    await writeFile(file, original);
    const linkedId = '00000000-0000-4000-8000-000000000001';
    const linked = join(f.store, 'wiki-candidates', linkedId + '.json');
    try {
      await symlink(file, linked);
    } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') return;
      throw error;
    }
    await assert.rejects(candidates.read(linkedId), code('PATH_ESCAPE'));
  }));

test('panel binds Wiki mode to the preview, keeps review IDs server-owned and recovers without retry', () =>
  setup(async (f) => {
    const form = {
      ...generationDefaults,
      include: 'src/**/*.ts',
      exclude: '',
      output: 'wiki',
    };
    let calls = 0,
      reviews = 0;
    const session = new GenerationSession(
      {
        preview: async () => f.plan,
        generate: async (interaction, recover) => {
          calls++;
          assert.equal(interaction.output, 'wiki');
          return {
            state: 'wiki-preview',
            articles: 1,
            pages: 1,
            published: false,
            recovered: recover,
            modelStarted: !recover,
          };
        },
        review: async () => {},
        reviewWiki: async () => {
          reviews++;
        },
      },
      () => {},
    );
    assert.equal(calls, 0);
    await session.handle({ action: 'preview', form });
    await session.handle({
      action: 'generate',
      form: { ...form, output: 'cards' },
      planId: f.plan.id,
    });
    assert.match(session.state.error, /PREVIEW_REQUIRED/u);
    assert.equal(calls, 0);
    await session.handle({ action: 'preview', form });
    await session.handle({ action: 'generate', form, planId: f.plan.id });
    assert.equal(session.state.result.state, 'wiki-preview');
    await session.handle({ action: 'reviewWiki', candidateId: '../fake' });
    assert.equal(reviews, 0);
    await session.handle({ action: 'reviewWiki' });
    assert.equal(reviews, 1);
    await session.handle({ action: 'recoverWiki' });
    assert.equal(session.state.result.modelStarted, false);
    assert.equal(calls, 2);
    session.dispose();
  }));
