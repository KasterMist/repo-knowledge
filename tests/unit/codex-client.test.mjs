import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { join } from 'node:path';
import {
  CodexStdioClient,
  inspectCodexBackend,
  diagnoseCodexBackend,
} from '../../packages/core/dist/index.js';
import { fixture, root } from '../helpers.mjs';
const peer = join(root, 'tests/fixtures/codex-peer.cjs');
const code = (value) => (error) => error.code === value;
function connect(f, mode = 'ok', timeoutMs = 2000) {
  return new CodexStdioClient({
    command: process.execPath,
    cwd: f.directory,
    args: [peer, mode, join(f.directory, 'methods.json')],
    timeoutMs,
  });
}
async function setup(action) {
  const f = await fixture();
  try {
    await action(f);
  } finally {
    await f.cleanup();
  }
}

test('fragmented UTF-8 protocol diagnostic retains only safe metadata and never starts a thread', () =>
  setup(async (f) => {
    const report = await inspectCodexBackend(
      connect(f, 'fragmented'),
      f.directory,
    );
    assert.equal(report.status, 'configured');
    assert.equal(report.account, 'present');
    assert.equal(report.checks.shellToolsDisabled, true);
    assert.equal(report.checks.accountRead, true);
    assert.equal(report.generationVerified, false);
    assert.equal(report.modelRequests, 0);
    assert.ok(!JSON.stringify(report).includes('SECRET'));
    assert.ok(!JSON.stringify(report).includes('@'));
    assert.deepEqual(
      JSON.parse(await readFile(join(f.directory, 'methods.json'), 'utf8')),
      ['initialize', 'initialized', 'config/read', 'account/read'],
    );
  }));

test('client correlates concurrent responses and refuses server token/approval requests', () =>
  setup(async (f) => {
    const client = connect(f, 'server-request');
    try {
      await client.initialize();
      const [a, b] = await Promise.all([
        client.request('echo', { value: 'first', delay: 30 }),
        client.request('echo', { value: 'second' }),
      ]);
      assert.equal(a.value, 'first');
      assert.equal(b.value, 'second');
      assert.equal(a.denied, true);
      await assert.rejects(client.initialize(), code('ALREADY_INITIALIZED'));
    } finally {
      await client.close();
    }
  }));

test('RPC rejection is actionable and redacted; account absence/external config are distinguished', () =>
  setup(async (f) => {
    const rejected = await inspectCodexBackend(
      connect(f, 'rpc-error'),
      f.directory,
    );
    assert.equal(rejected.error.code, 'RPC_REJECTED');
    assert.equal(rejected.error.phase, 'account/read');
    assert.equal(rejected.error.rpcCode, -32000);
    assert.equal(rejected.error.reason, 'authentication');
    assert.equal(rejected.checks.configurationRead, true);
    assert.equal(rejected.checks.accountRead, false);
    assert.ok(!JSON.stringify(rejected).includes('SECRET'));
    assert.equal(
      (await inspectCodexBackend(connect(f, 'absent'), f.directory)).status,
      'not-authenticated',
    );
    assert.equal(
      (await inspectCodexBackend(connect(f, 'external'), f.directory)).account,
      'external',
    );
    const config = await inspectCodexBackend(
      connect(f, 'config-unconfirmed'),
      f.directory,
    );
    assert.equal(config.error.code, 'CONFIG_UNCONFIRMED');
    assert.ok(
      !JSON.parse(
        await readFile(join(f.directory, 'methods.json'), 'utf8'),
      ).includes('account/read'),
    );
  }));

test('malformed JSON, invalid UTF-8 and orphan response IDs fail closed', () =>
  setup(async (f) => {
    for (const mode of ['malformed', 'invalid-utf8', 'orphan']) {
      const result = await inspectCodexBackend(connect(f, mode), f.directory);
      assert.equal(result.error.code, 'PROTOCOL_ERROR', mode);
      assert.equal(result.status, 'unverified');
    }
  }));

test('request deadline, process exit/start errors and cancellation settle without leaking messages', () =>
  setup(async (f) => {
    const timed = await inspectCodexBackend(
      connect(f, 'timeout', 2000),
      f.directory,
    );
    assert.equal(timed.error.code, 'REQUEST_TIMEOUT');
    assert.equal(timed.error.phase, 'account/read');
    assert.equal(timed.checks.initialized, true);
    const exited = await inspectCodexBackend(connect(f, 'exit'), f.directory);
    assert.equal(exited.error.code, 'PROCESS_EXITED');
    const missing = await diagnoseCodexBackend(
      join(f.directory, 'missing-codex'),
      f.directory,
    );
    assert.equal(missing.error.code, 'PROCESS_START_FAILED');
    const controller = new globalThis.AbortController();
    const client = new CodexStdioClient({
      command: process.execPath,
      cwd: f.directory,
      args: [peer, 'timeout'],
      signal: controller.signal,
    });
    const pending = inspectCodexBackend(client, f.directory);
    await pause(100);
    controller.abort();
    assert.equal((await pending).error.code, 'CANCELLED');
    const stopped = new globalThis.AbortController();
    stopped.abort();
    await assert.rejects(
      diagnoseCodexBackend(process.execPath, f.directory, stopped.signal),
      code('CANCELLED'),
    );
  }));

test('bounded input, line/stderr output and in-flight requests reject excess work', () =>
  setup(async (f) => {
    for (const [mode, expected] of [
      ['line-limit', 'MESSAGE_LIMIT'],
      ['stderr-limit', 'OUTPUT_LIMIT'],
    ]) {
      assert.equal(
        (await inspectCodexBackend(connect(f, mode), f.directory)).error.code,
        expected,
      );
    }
    const large = connect(f);
    try {
      await large.initialize();
      await assert.rejects(
        large.request('echo', { value: 'x'.repeat(256 * 1024) }),
        code('INPUT_LIMIT'),
      );
    } finally {
      await large.close();
    }
    const client = connect(f);
    try {
      await client.initialize();
      const pending = Array.from({ length: 8 }, () =>
        client.request('hang', {}),
      );
      const settled = Promise.allSettled(pending);
      await assert.rejects(client.request('hang', {}), code('REQUEST_LIMIT'));
      await client.close();
      assert.ok((await settled).every((entry) => entry.status === 'rejected'));
    } finally {
      await client.close();
    }
  }));
