import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, root } from '../helpers.mjs';
import {
  KnowledgeStore,
  KnowledgePublication,
} from '../../packages/core/dist/index.js';

test(
  'running MCP reloads editor publications and monotonic rollbacks from the same canonical store',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        join(root, 'packages/vscode-extension/dist/server.cjs'),
        '--repository',
        f.repository,
        '--store',
        f.store,
      ],
      cwd: f.directory,
      stderr: 'pipe',
    });
    const client = new Client({
      name: 'publication-reload-fixture',
      version: '1.0.0',
    });
    try {
      await client.connect(transport);
      const call = async (name, args = {}) => {
        const result = await client.callTool({ name, arguments: args });
        assert.notEqual(result.isError, true);
        return JSON.parse(result.content[0].text);
      };
      const read = await call('read_knowledge', { id: 'read-fallback' });
      const pending = await call('propose_knowledge_update', {
        id: read.card.id,
        baseRevision: read.card.revision,
        baseSnapshot: read.snapshotRevision,
        reason: 'Human-reviewed fixture',
        proposedCard: {
          ...read.card,
          revision: 2,
          body: '人工说明：空字符串会原样返回。',
        },
      });
      const publication = new KnowledgePublication(
        new KnowledgeStore(f.repository, f.store),
      );
      const review = await publication.previewProposal(pending.proposalId);
      const published = await publication.publish(
        pending.proposalId,
        review.token,
      );
      const updated = await call('read_knowledge', { id: 'read-fallback' });
      assert.equal(updated.card.revision, 2);
      assert.equal(updated.snapshotRevision, published.snapshotRevision);
      assert.equal(
        (await call('get_knowledge_status')).cards.find(
          (c) => c.id === 'read-fallback',
        ).revision,
        2,
      );
      const rollback = await publication.previewRollback(
        published.transactionId,
      );
      await publication.rollback(published.transactionId, rollback.token);
      const restored = await call('read_knowledge', { id: 'read-fallback' });
      assert.equal(restored.card.revision, 3);
      assert.equal(restored.card.body, read.card.body);
    } finally {
      await client.close();
      await transport.close();
      await f.cleanup();
    }
  },
);

test(
  'bundled STDIO service: handshake, four tools, proposals and fresh-session reuse without workspace dependencies',
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    try {
      const server = join(f.directory, 'standalone server.cjs');
      await cp(join(root, 'packages/vscode-extension/dist/server.cjs'), server);
      const original = await readFile(join(f.store, 'knowledge.json'), 'utf8');
      for (let session = 0; session < 2; session++) {
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: [server, '--repository', f.repository, '--store', f.store],
          cwd: f.directory,
          stderr: 'pipe',
        });
        const client = new Client({
          name: 'repo-knowledge-acceptance',
          version: '1.0.0',
        });
        try {
          await client.connect(transport);
          const tools = await client.listTools();
          assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
            'get_knowledge_status',
            'propose_knowledge_update',
            'read_knowledge',
            'search_knowledge',
          ]);
          const call = async (name, args = {}) => {
            const result = await client.callTool({ name, arguments: args });
            assert.ok(Array.isArray(result.content));
            return {
              error: result.isError === true,
              value: JSON.parse(result.content[0].text),
            };
          };
          const status = await call('get_knowledge_status');
          assert.equal(status.value.cards.length, 3);
          assert.equal(
            status.value.cards.some((card) => card.stale),
            false,
          );
          assert.equal(
            (await call('search_knowledge', { query: '读取' })).value.results[0]
              .id,
            'read-fallback',
          );
          const read = await call('read_knowledge', { id: 'read-fallback' });
          assert.match(read.value.evidence[0].excerpt, /未找到/u);
          const proposed = {
            id: read.value.card.id,
            baseRevision: 1,
            baseSnapshot: read.value.snapshotRevision,
            reason: 'Clarify fallback semantics',
            proposedCard: {
              ...read.value.card,
              revision: 2,
              body: '读取保留空字符串缓存值。',
            },
          };
          assert.equal(
            (await call('propose_knowledge_update', proposed)).value.state,
            'pending-review',
          );
          assert.equal(
            (
              await call('propose_knowledge_update', {
                ...proposed,
                baseRevision: 2,
              })
            ).value.code,
            'REVISION_CONFLICT',
          );
          assert.equal(
            (await call('read_knowledge', { id: 'unknown' })).error,
            true,
          );
          const invalid = await client.callTool({
            name: 'search_knowledge',
            arguments: { query: '', unexpected: true },
          });
          assert.equal(invalid.isError, true);
        } finally {
          await client.close();
          await transport.close();
        }
      }
      assert.equal(
        await readFile(join(f.store, 'knowledge.json'), 'utf8'),
        original,
      );
      assert.equal((await readdir(join(f.store, 'proposals'))).length, 2);
      await writeFile(join(f.store, 'knowledge.json'), '{"schemaVersion":99}');
      const failure = spawnSync(
        process.execPath,
        [server, '--repository', f.repository, '--store', f.store],
        { encoding: 'utf8', timeout: 10000 },
      );
      assert.ifError(failure.error);
      assert.equal(failure.status, 1);
      assert.equal(failure.stdout, '');
      assert.match(failure.stderr, /startup failed/u);
    } finally {
      await f.cleanup();
    }
  },
);
