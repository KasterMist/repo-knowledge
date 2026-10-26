// Self-authored protocol peer. Never contacts Codex or a model service.
const readline = require('node:readline');
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const { setImmediate, setTimeout } = require('node:timers');
const mode = process.argv[2] || 'ok',
  trace = process.argv[3];
const methods = [];
let denied = false;
const send = (value) => {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (mode === 'fragmented') {
    let index = 0;
    const next = () => {
      if (index < bytes.length) {
        process.stdout.write(bytes.subarray(index, index + 1));
        index++;
        setImmediate(next);
      }
    };
    next();
  } else process.stdout.write(bytes);
};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.error && message.id === 'server-auth') {
    denied = message.error.code === -32601;
    return;
  }
  if (!message.method) return;
  methods.push(message.method);
  if (trace) fs.writeFileSync(trace, JSON.stringify(methods));
  if (message.id === undefined) return;
  if (mode === 'exit') {
    process.exit(2);
    return;
  }
  if (mode === 'malformed') {
    process.stdout.write('{broken}\n');
    return;
  }
  if (mode === 'invalid-utf8') {
    process.stdout.write(Buffer.from([255, 10]));
    return;
  }
  if (mode === 'line-limit') {
    process.stdout.write('x'.repeat(1024 * 1024 + 1));
    return;
  }
  if (mode === 'stderr-limit') {
    process.stderr.write('x'.repeat(256 * 1024 + 1));
    return;
  }
  if (mode === 'orphan') {
    send({ id: 999999, result: {} });
    return;
  }
  if (message.method === 'initialize') {
    if (mode === 'server-request')
      send({
        id: 'server-auth',
        method: 'account/chatgptAuthTokens/refresh',
        params: {},
      });
    send({ id: message.id, result: { userAgent: 'fixture' } });
    return;
  }
  if (message.method === 'config/read') {
    send({
      id: message.id,
      result: {
        config: {
          model: 'fixture-only',
          features: { shell_tool: mode === 'config-unconfirmed' },
          privateValue: 'SECRET-config',
          diagnosticLabel: '读取',
        },
      },
    });
    return;
  }
  if (message.method === 'account/read') {
    if (message.params.refreshToken !== false) process.exit(3);
    if (mode === 'timeout') return;
    if (mode === 'rpc-error') {
      send({
        id: message.id,
        error: {
          code: -32000,
          message: 'Credential error SECRET-rpc user@example.invalid',
        },
      });
      return;
    }
    const account =
      mode === 'absent' || mode === 'external'
        ? null
        : {
            type: 'chatgpt',
            email: 'SECRET-email',
            accessToken: 'SECRET-token',
          };
    send({
      id: message.id,
      result: { account, requiresOpenaiAuth: mode !== 'external' },
    });
    return;
  }
  if (message.method === 'hang') return;
  if (message.method === 'echo')
    setTimeout(
      () =>
        send({
          id: message.id,
          result: { value: message.params.value, denied },
        }),
      message.params.delay || 0,
    );
});
