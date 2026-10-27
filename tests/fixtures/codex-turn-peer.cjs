// Self-authored JSONL peer. No Codex, network, model or target-code execution.
const { createInterface } = require('node:readline');
const { writeFileSync } = require('node:fs');
const { setTimeout } = require('node:timers');
const { spawn } = require('node:child_process');
const mode = process.argv[2],
  trace = process.argv[3];
const methods = [];
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const event = (method, value = {}) =>
  send({
    method,
    params: {
      threadId: mode === 'wrong-thread' ? 'other' : 'thread-fixture',
      turnId: 'turn-fixture',
      ...value,
    },
  });
const item = {
  id: 'reply',
  type: 'agentMessage',
  phase: 'final_answer',
  text: mode === 'invalid-json' ? 'SECRET-raw-invalid' : '{"answer":"读取"}',
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (!message.method) return;
  methods.push(message.method);
  if (trace) writeFileSync(trace, JSON.stringify(methods));
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method !== 'turn/start') return;
  if (mode === 'grandchild') {
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore', windowsHide: true },
    );
    writeFileSync(trace + '.child', String(child.pid));
  }
  if (mode === 'exit') {
    process.exit(3);
    return;
  }
  const response = () =>
    send({
      id: message.id,
      result: {
        turn: {
          id: mode === 'wrong-response-turn' ? 'other' : 'turn-fixture',
          status: 'inProgress',
        },
      },
    });
  const complete = () => {
    if (mode === 'upstream-error') {
      event('error', {
        error: {
          message: 'Unsupported schema SECRET-private',
          codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 400 } },
        },
      });
      return;
    }
    if (mode === 'server-request') {
      send({
        id: 'approval',
        method: 'item/commandExecution/requestApproval',
        params: { command: 'SECRET-never-executed' },
      });
      return;
    }
    if (mode === 'flood') {
      for (let i = 0; i < 8; i++) event('thread/status/changed');
      return;
    }
    if (mode === 'unexpected-event') {
      event('item/commandExecution/outputDelta');
      return;
    }
    if (mode === 'hook') {
      event('hook/started');
      return;
    }
    if (mode === 'tool') {
      event('item/started', { item: { id: 'bad', type: 'commandExecution' } });
      return;
    }
    if (mode === 'wrong-turn') {
      event('item/completed', { turnId: 'other', item });
      return;
    }
    if (mode === 'tokens' || mode === 'usage-regression') {
      event('thread/tokenUsage/updated', {
        tokenUsage: { total: { totalTokens: 20 } },
      });
      if (mode === 'usage-regression')
        event('thread/tokenUsage/updated', {
          tokenUsage: { total: { totalTokens: 10 } },
        });
    }
    event('item/reasoning/textDelta', {
      delta: 'SECRET-reasoning-never-retained',
    });
    if (mode === 'delta-limit')
      event('item/agentMessage/delta', {
        itemId: item.id,
        delta: 'x'.repeat(200),
      });
    if (!['missing', 'failed', 'interrupted'].includes(mode)) {
      event('item/completed', {
        item:
          mode === 'output-limit' ? { ...item, text: 'x'.repeat(200) } : item,
      });
      if (mode === 'duplicate') event('item/completed', { item });
      if (mode === 'ambiguous')
        event('item/completed', { item: { ...item, id: 'second' } });
    }
    event('turn/completed', {
      turn: {
        id: 'turn-fixture',
        status:
          mode === 'failed'
            ? 'failed'
            : mode === 'interrupted'
              ? 'interrupted'
              : 'completed',
        error: mode === 'failed' ? { message: 'SECRET-error' } : null,
        items: mode === 'conflicting' ? [{ ...item, text: 'different' }] : [],
      },
    });
  };
  event('turn/started', {
    turn: { id: 'turn-fixture', status: 'inProgress', items: [] },
  });
  if (mode === 'no-start-ack') return;
  if (mode === 'late-start-ack') {
    complete();
    setTimeout(response, 10000);
    return;
  }
  if (mode === 'early-events') {
    complete();
    response();
    return;
  }
  response();
  if (mode === 'hang' || mode === 'grandchild') return;
  setTimeout(complete, 5);
});
