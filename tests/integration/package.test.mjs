import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, root } from '../helpers.mjs';

async function entries(path) {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Map();
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        if (entry.uncompressedSize > 4 * 1024 * 1024) {
          zip.close();
          reject(new Error('Oversized package entry'));
          return;
        }
        zip.openReadStream(entry, (readError, stream) => {
          if (readError) return reject(readError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
test(
  'actual VSIX contains only intended files and its extracted server runs without node_modules',
  { timeout: 30000 },
  async () => {
    const path = join(root, 'dist/repo-knowledge-0.0.0.vsix');
    const files = await entries(path);
    assert.ok(files.has('extension/LICENSE.txt'));
    assert.ok(files.has('extension/THIRD_PARTY_NOTICES.md'));
    assert.match(
      files.get('extension/THIRD_PARTY_NOTICES.md').toString(),
      /@modelcontextprotocol\/sdk/u,
    );
    assert.ok(files.has('extension/demo/src/读取.ts'));
    assert.ok(files.has('extension/dist/extension.cjs'));
    for (const name of files.keys()) {
      assert.ok(
        !name.includes('node_modules') &&
          !name.includes('.tools') &&
          !name.includes('..'),
      );
      assert.ok(
        name === '[Content_Types].xml' ||
          name === 'extension.vsixmanifest' ||
          /^extension\/(?:LICENSE.txt|THIRD_PARTY_NOTICES.md|changelog.md|package.json|readme.md|dist\/(?:extension|server)\.cjs|demo\/)/u.test(
            name,
          ),
        name,
      );
    }
    const manifest = JSON.parse(files.get('extension/package.json').toString());
    assert.equal(manifest.main, './dist/extension.cjs');
    assert.equal(manifest.contributes.commands.length, 6);
    const f = await fixture();
    try {
      const server = join(f.directory, 'packaged server.cjs');
      await writeFile(server, files.get('extension/dist/server.cjs'));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [server, '--repository', f.repository, '--store', f.store],
        cwd: f.directory,
      });
      const client = new Client({
        name: 'vsix-content-check',
        version: '1.0.0',
      });
      try {
        await client.connect(transport);
        assert.equal((await client.listTools()).tools.length, 4);
        const result = await client.callTool({
          name: 'get_knowledge_status',
          arguments: {},
        });
        assert.notEqual(result.isError, true);
      } finally {
        await client.close();
        await transport.close();
      }
      const hash = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
      assert.equal(
        await readFile(join(root, 'dist/SHA256SUMS'), 'utf8'),
        `${hash}  repo-knowledge-0.0.0.vsix\n`,
      );
    } finally {
      await f.cleanup();
    }
  },
);
