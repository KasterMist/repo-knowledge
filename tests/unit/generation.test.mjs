import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KnowledgeStore,
  scanRepository,
  defaultScanOptions,
  buildGenerationPacket,
  validateGeneratedPages,
  validateCurrentGeneration,
  generationOutputJsonSchema,
} from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';
const code = (expected) => (error) => error.code === expected;
async function setup(action) {
  const f = await fixture();
  const knowledge = new KnowledgeStore(f.repository, f.store);
  const plan = await scanRepository(f.repository, f.store, {
    ...defaultScanOptions,
    include: ['src/**/*.ts'],
    exclude: [],
  });
  try {
    await action({ ...f, knowledge, plan });
  } finally {
    await f.cleanup();
  }
}
const output = (packet) => ({
  packetRevision: packet.packetRevision,
  pages: [
    {
      id: 'generated-overview',
      title: '项目概览',
      kind: 'fact',
      body: '缓存读取通过空值合并保留空字符串。',
      tags: ['读取'],
      scope: ['src'],
      evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
    },
  ],
});

test('generation packet is bounded to reviewed sources and validates evidence without writing knowledge', () =>
  setup(async (f) => {
    const original = await readFile(join(f.store, 'knowledge.json'));
    const packet = await buildGenerationPacket(f.knowledge, f.plan);
    assert.deepEqual(
      packet.sources.map((source) => source.path),
      ['src/cache.ts', 'src/读取.ts'],
    );
    assert.equal(packet.language, 'zh-CN');
    assert.equal(packet.existingIds.length, 3);
    assert.ok(!JSON.stringify(packet).includes(f.repository));
    assert.ok(!JSON.stringify(packet).includes(f.store));
    const pages = await validateCurrentGeneration(
      f.knowledge,
      f.plan,
      packet,
      output(packet),
    );
    assert.equal(pages[0].revision, 1);
    assert.equal(pages[0].id, 'generated-overview');
    assert.equal(
      pages[0].evidence[0].sha256,
      packet.sources.find((source) => source.path === 'src/读取.ts').sha256,
    );
    assert.deepEqual(await readFile(join(f.store, 'knowledge.json')), original);
    const schema = generationOutputJsonSchema();
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
  }));

test('unselected paths, invented ranges, unknown fields, duplicate/existing IDs and mixed packets are rejected', () =>
  setup(async (f) => {
    const packet = await buildGenerationPacket(f.knowledge, f.plan);
    const variants = [
      (value) => {
        value.pages[0].id = 'cache-storage';
      },
      (value) => {
        value.pages[0].scope = ['private'];
      },
      (value) => {
        value.pages[0].evidence[0].path = 'private.ts';
      },
      (value) => {
        value.pages[0].evidence[0].endLine = 999;
      },
      (value) => {
        value.pages[0].evidence[0].startLine = 9;
      },
      (value) => {
        value.pages[0].evidence[0].sha256 = '0'.repeat(64);
      },
      (value) => {
        value.pages.push(structuredClone(value.pages[0]));
      },
      (value) => {
        value.packetRevision = '0'.repeat(64);
      },
      (value) => {
        value.pages[0].revision = 2;
      },
    ];
    for (const mutate of variants) {
      const value = output(packet);
      mutate(value);
      assert.throws(() => validateGeneratedPages(packet, value));
    }
    const tampered = structuredClone(packet);
    tampered.sources[0].content += ' changed';
    assert.throws(
      () => validateGeneratedPages(tampered, output(packet)),
      code('INVALID_PACKET'),
    );
  }));

test('source or canonical changes during generation invalidate output instead of merging over human edits', () =>
  setup(async (f) => {
    const packet = await buildGenerationPacket(f.knowledge, f.plan),
      result = output(packet);
    const source = join(f.repository, 'src/读取.ts'),
      original = await readFile(source);
    await writeFile(source, original.toString().replace('??', '||'));
    await assert.rejects(
      validateCurrentGeneration(f.knowledge, f.plan, packet, result),
      code('PLAN_CHANGED'),
    );
    await writeFile(source, original);
    const path = join(f.store, 'knowledge.json'),
      canonical = JSON.parse(await readFile(path, 'utf8'));
    canonical.cards[0].body += ' Human rationale';
    await writeFile(path, JSON.stringify(canonical));
    await assert.rejects(
      validateCurrentGeneration(f.knowledge, f.plan, packet, result),
      code('GENERATION_BASE_CHANGED'),
    );
    assert.match(
      (await f.knowledge.read('cache-storage')).card.body,
      /Human rationale/u,
    );
  }));

test('empty/incomplete scopes, encoded source excess and cancelled preparation never start generation', () =>
  setup(async (f) => {
    const empty = await scanRepository(f.repository, f.store, {
      ...f.plan.options,
      include: ['missing/**'],
    });
    await assert.rejects(
      buildGenerationPacket(f.knowledge, empty),
      code('INCOMPLETE_PLAN'),
    );
    const limited = await scanRepository(f.repository, f.store, {
      ...f.plan.options,
      maxFiles: 1,
    });
    await assert.rejects(
      buildGenerationPacket(f.knowledge, limited),
      code('INCOMPLETE_PLAN'),
    );
    await writeFile(join(f.repository, 'src/large.ts'), 'x'.repeat(130 * 1024));
    const large = await scanRepository(f.repository, f.store, {
      ...f.plan.options,
      maxFileBytes: 256 * 1024,
      maxTotalBytes: 512 * 1024,
    });
    assert.equal(large.summary.limited, false);
    await assert.rejects(
      buildGenerationPacket(f.knowledge, large),
      code('GENERATION_INPUT_LIMIT'),
    );
    const controller = new globalThis.AbortController();
    controller.abort();
    await assert.rejects(
      buildGenerationPacket(f.knowledge, f.plan, controller.signal),
      code('GENERATION_CANCELLED'),
    );
    const blankPlan = await scanRepository(f.repository, f.store, {
      ...f.plan.options,
      include: ['src/cache.ts'],
    });
    await writeFile(join(f.repository, 'src/cache.ts'), ' \n');
    const blank = await scanRepository(
      f.repository,
      f.store,
      blankPlan.options,
    );
    await assert.rejects(
      buildGenerationPacket(f.knowledge, blank),
      code('EMPTY_SOURCE_CONTEXT'),
    );
  }));
