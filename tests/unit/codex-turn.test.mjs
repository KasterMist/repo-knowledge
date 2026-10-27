import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
import {
  CodexStdioClient,
  collectCodexTextTurn,
} from '../../packages/core/dist/index.js';
import { fixture, root } from '../helpers.mjs';
async function setup(mode, action) {
  const f = await fixture(),
    trace = join(f.directory, 'trace.json');
  const client = new CodexStdioClient({
    command: process.execPath,
    cwd: f.directory,
    args: [join(root, 'tests/fixtures/codex-turn-peer.cjs'), mode, trace],
    timeoutMs: 5000,
  });
  try {
    await client.initialize();
    const run = (budget = {}, signal) =>
      collectCodexTextTurn(
        client,
        'thread-fixture',
        'Read selected fixture only',
        { type: 'object', additionalProperties: false },
        budget,
        signal,
      );
    await action({ run, trace, client });
  } finally {
    await client.close();
    await f.cleanup();
  }
}
const code = (expected) => (error) => {
  assert.equal(error.code, expected);
  assert.ok(!String(error).includes('SECRET'));
  return true;
};
test('one bounded turn handles early events and keeps only authoritative JSON output', async () => {
  for (const mode of ['ok', 'early-events'])
    await setup(mode, async ({ run, trace }) => {
      const result = await run();
      assert.deepEqual(result.output, { answer: '读取' });
      assert.equal(result.submittedTurns, 1);
      assert.equal(result.observedTokens, null);
      assert.ok(!JSON.stringify(result).includes('SECRET'));
      const calls = JSON.parse(await readFile(trace, 'utf8'));
      assert.equal(calls.filter((method) => method === 'turn/start').length, 1);
      assert.equal(
        calls.filter((method) => method === 'turn/interrupt').length,
        0,
      );
    });
});
test('turn/thread mismatch, tools, hooks, server requests, duplicate or conflicting output fail closed', async () => {
  for (const [mode, expected] of [
    ['wrong-thread', 'THREAD_MISMATCH'],
    ['wrong-turn', 'TURN_MISMATCH'],
    ['wrong-response-turn', 'TURN_MISMATCH'],
    ['tool', 'UNEXPECTED_TURN_ITEM'],
    ['hook', 'UNEXPECTED_TURN_EVENT'],
    ['unexpected-event', 'UNEXPECTED_TURN_EVENT'],
    ['server-request', 'SERVER_REQUEST_BLOCKED'],
    ['duplicate', 'DUPLICATE_TURN_ITEM'],
    ['ambiguous', 'AMBIGUOUS_TURN_OUTPUT'],
    ['conflicting', 'CONFLICTING_TURN_OUTPUT'],
  ])
    await setup(mode, async ({ run }) => assert.rejects(run(), code(expected)));
});
test('input/schema, stream/completion/event and observed usage budgets reject before returning partial results', async () => {
  for (const [mode, budget, expected] of [
    ['ok', { inputBytes: 1 }, 'INPUT_LIMIT'],
    ['output-limit', { outputBytes: 100 }, 'OUTPUT_LIMIT'],
    ['delta-limit', { outputBytes: 100 }, 'OUTPUT_LIMIT'],
    ['flood', { notifications: 3 }, 'EVENT_LIMIT'],
    ['tokens', { observedTokenLimit: 10 }, 'TOKEN_LIMIT'],
    ['usage-regression', {}, 'INVALID_TOKEN_USAGE'],
  ])
    await setup(mode, async ({ run, trace }) => {
      await assert.rejects(run(budget), code(expected));
      if (expected === 'INPUT_LIMIT')
        assert.ok(
          !JSON.parse(await readFile(trace, 'utf8')).includes('turn/start'),
        );
    });
});
test('deadline covers a missing or delayed start response and the event stream; cancellation sends best-effort interrupt', async () => {
  for (const mode of ['hang', 'no-start-ack', 'late-start-ack'])
    await setup(mode, async ({ run, trace }) => {
      const started = Date.now();
      await assert.rejects(run({ timeoutMs: 250 }), code('TURN_TIMEOUT'));
      assert.ok(Date.now() - started < 3500);
      assert.ok(
        JSON.parse(await readFile(trace, 'utf8')).includes('turn/interrupt'),
      );
    });
  await setup('hang', async ({ run, trace }) => {
    const controller = new globalThis.AbortController();
    const pending = run({}, controller.signal);
    const timer = setTimeout(() => controller.abort(), 150);
    try {
      await assert.rejects(pending, code('CANCELLED'));
    } finally {
      clearTimeout(timer);
    }
    assert.ok(
      JSON.parse(await readFile(trace, 'utf8')).includes('turn/interrupt'),
    );
  });
});
test('failed/interrupted/missing/invalid output and process exit cannot become successful generation', async () => {
  for (const [mode, expected] of [
    ['failed', 'TURN_FAILED'],
    ['interrupted', 'TURN_INTERRUPTED'],
    ['missing', 'MISSING_TURN_OUTPUT'],
    ['invalid-json', 'INVALID_TURN_JSON'],
    ['exit', 'PROCESS_EXITED'],
  ])
    await setup(mode, async ({ run }) => assert.rejects(run(), code(expected)));
});
test('exclusive observation prevents a second consumer and survives a throwing teardown listener', () =>
  setup('hang', async ({ client }) => {
    const remove = client.observe(
      () => {},
      () => {
        throw Error('fixture listener');
      },
    );
    assert.throws(
      () =>
        client.observe(
          () => {},
          () => {},
        ),
      code('OBSERVER_BUSY'),
    );
    remove();
    client.observe(
      () => {},
      () => {
        throw Error('fixture listener');
      },
    );
    await client.close();
  }));

test('forced cancellation cleans up a task-owned wrapper descendant on Windows/Linux', () =>
  setup('grandchild', async ({ run, trace }) => {
    let pid;
    const running = async () => {
      try {
        process.kill(pid, 0);
        if (
          process.platform === 'linux' &&
          /\) Z /u.test(await readFile(`/proc/${pid}/stat`, 'utf8'))
        )
          return false;
        return true;
      } catch {
        return false;
      }
    };
    try {
      await assert.rejects(run({ timeoutMs: 300 }), code('TURN_TIMEOUT'));
      pid = Number(await readFile(trace + '.child', 'utf8'));
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      for (let attempt = 0; attempt < 20 && (await running()); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(
        await running(),
        false,
        'Owned descendant must not continue after cancellation',
      );
    } finally {
      if (pid && (await running())) process.kill(pid, 'SIGKILL');
    }
  }));

test('upstream failure retains only a coarse reason and numeric HTTP status', () =>
  setup('upstream-error', async ({ run }) => {
    await assert.rejects(run(), (error) => {
      assert.equal(error.code, 'TURN_FAILED');
      assert.equal(error.reason, 'unsupported');
      assert.equal(error.httpStatusCode, 400);
      assert.ok(!JSON.stringify(error).includes('SECRET'));
      return true;
    });
  }));
