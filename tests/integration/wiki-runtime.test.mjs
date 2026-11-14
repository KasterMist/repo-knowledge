import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  KnowledgeStore,
  KnowledgePublication,
} from '../../packages/core/dist/index.js';
import { createServer } from '../../packages/mcp-server/dist/index.js';
import { fixture, root } from '../helpers.mjs';

test(
  'explicit v2 MCP factory supports four tools and article-preserving card publication; shipped CLI remains v1',
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    let server, client;
    try {
      const path = join(f.store, 'knowledge.json');
      const original = JSON.parse(await readFile(path, 'utf8'));
      const preview = JSON.parse(
        await readFile(join(f.repository, 'wiki-preview.json'), 'utf8'),
      );
      const wiki = {
        ...original,
        schemaVersion: 2,
        articles: preview.articles,
      };
      await writeFile(path, JSON.stringify(wiki, null, 2) + '\n');
      const before = await readFile(path);
      const knowledge = new KnowledgeStore(f.repository, f.store, 'wiki-v2');
      server = createServer(knowledge);
      client = new Client({
        name: 'wiki-runtime-self-authored',
        version: '1.0.0',
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      assert.equal((await client.listTools()).tools.length, 4);
      const call = async (name, args = {}) => {
        const result = await client.callTool({ name, arguments: args });
        assert.notEqual(result.isError, true);
        return JSON.parse(result.content[0].text);
      };
      assert.equal((await call('get_knowledge_status')).schemaVersion, 2);
      assert.ok(
        (await call('search_knowledge', { query: '读取' })).results.length,
      );
      const read = await call('read_knowledge', { id: 'read-fallback' });
      assert.equal(read.stale, false);
      const input = {
        id: read.card.id,
        baseRevision: read.card.revision,
        baseSnapshot: read.snapshotRevision,
        reason: '自编兼容测试',
        proposedCard: {
          ...read.card,
          revision: 2,
          body: read.card.body + '\n人工核对。',
        },
      };
      const pending = await call('propose_knowledge_update', input);
      assert.equal(pending.state, 'pending-review');
      assert.deepEqual(await readFile(path), before);
      const publication = new KnowledgePublication(knowledge);
      const review = await publication.previewProposal(pending.proposalId);
      await publication.publish(pending.proposalId, review.token);
      assert.equal(
        (await call('read_knowledge', { id: 'read-fallback' })).card.revision,
        2,
      );
      assert.deepEqual(
        (await knowledge.snapshot()).snapshot.articles,
        wiki.articles,
      );
      const wrong = await client.callTool({
        name: 'propose_knowledge_update',
        arguments: input,
      });
      assert.equal(wrong.isError, true);
      assert.equal(JSON.parse(wrong.content[0].text).code, 'REVISION_CONFLICT');
      const after = await readFile(path);
      // Actual packaged CLI has no compatibility switch; no implicit runtime activation.
      const refused = spawnSync(
        process.execPath,
        [
          join(root, 'packages/vscode-extension/dist/server.cjs'),
          '--repository',
          f.repository,
          '--store',
          f.store,
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 10000 },
      );
      assert.equal(refused.status, 1);
      assert.equal(refused.stdout, '');
      assert.match(refused.stderr, /schemaVersion 1/u);
      assert.ok(!refused.stderr.includes(f.repository));
      assert.deepEqual(await readFile(path), after);
    } finally {
      await client?.close();
      await server?.close();
      await f.cleanup();
    }
  },
);
