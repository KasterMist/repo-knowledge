import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  KnowledgeStore,
  KnowledgePublication,
  WikiCandidates,
  scanRepository,
  defaultScanOptions,
  buildGenerationPacket,
  resolveWikiArticle,
} from '../../packages/core/dist/index.js';
import { createServer } from '../../packages/mcp-server/dist/index.js';
import { fixture } from '../helpers.mjs';

test(
  'opted-in MCP observes explicit migration, joint publication and article-preserving card updates',
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    let server, client;
    try {
      const sourcePath = join(f.repository, 'src/读取.ts'),
        originalSource = await readFile(sourcePath);
      const knowledge = new KnowledgeStore(f.repository, f.store, 'wiki-v2'),
        publication = new KnowledgePublication(knowledge);
      server = createServer(knowledge);
      client = new Client({
        name: 'wiki-publication-fixture',
        version: '1.0.0',
      });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);
      const call = async (name, args = {}) => {
        const result = await client.callTool({ name, arguments: args });
        assert.notEqual(result.isError, true);
        return JSON.parse(result.content[0].text);
      };
      assert.equal((await call('get_knowledge_status')).schemaVersion, 1);
      const migration = await publication.previewWikiMigration();
      await publication.migrateWiki(migration.itemId, migration.token);
      assert.equal((await call('get_knowledge_status')).schemaVersion, 2);
      const plan = await scanRepository(f.repository, f.store, {
        ...defaultScanOptions,
        include: ['src/**/*.ts'],
        exclude: [],
      });
      const packet = await buildGenerationPacket(knowledge, plan);
      const saved = await new WikiCandidates(knowledge).save(
        plan,
        packet,
        {
          packetRevision: packet.packetRevision,
          pages: [
            {
              id: 'joint-read',
              title: '联合读取说明',
              kind: 'fact',
              body: '空字符串被保留。',
              tags: ['联合读取'],
              scope: ['src'],
              evidence: [{ path: 'src/读取.ts', startLine: 1, endLine: 5 }],
            },
          ],
          articles: [
            {
              id: 'joint-overview',
              title: '概述',
              kind: 'overview',
              parentId: null,
              order: 0,
              sections: [
                {
                  id: 'flow',
                  title: '流程',
                  blocks: [{ id: 'fact', type: 'card', cardId: 'joint-read' }],
                },
              ],
            },
          ],
        },
        2,
      );
      const preview = await publication.previewWikiCreation(saved.candidateId);
      const committed = await publication.publishWikiCreation(
        saved.candidateId,
        preview.token,
      );
      assert.equal(
        (await call('get_knowledge_status')).snapshotRevision,
        committed.snapshotRevision,
      );
      assert.ok(
        (await call('search_knowledge', { query: '联合读取' })).results.some(
          (card) => card.id === 'joint-read',
        ),
      );
      const read = await call('read_knowledge', { id: 'joint-read' });
      assert.equal(read.stale, false);
      assert.equal(
        resolveWikiArticle(
          (await knowledge.snapshot()).snapshot,
          'joint-overview',
        ).needsReview,
        false,
      );
      const pending = await call('propose_knowledge_update', {
        id: read.card.id,
        baseRevision: 1,
        baseSnapshot: read.snapshotRevision,
        reason: '自编协议验证',
        proposedCard: {
          ...read.card,
          revision: 2,
          body: read.card.body + '\n人工澄清。',
        },
      });
      const review = await publication.previewProposal(pending.proposalId);
      await publication.publish(pending.proposalId, review.token);
      assert.equal(
        (await call('read_knowledge', { id: 'joint-read' })).card.revision,
        2,
      );
      assert.equal(
        resolveWikiArticle(
          (await knowledge.snapshot()).snapshot,
          'joint-overview',
        ).needsReview,
        true,
      );
      assert.deepEqual(await readFile(sourcePath), originalSource);
      assert.equal((await publication.history()).length, 3);
    } finally {
      await client?.close();
      await server?.close();
      await f.cleanup();
    }
  },
);
