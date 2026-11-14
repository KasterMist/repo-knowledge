import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  scanRepository,
  KnowledgeError,
} from '../../packages/core/dist/index.js';
import {
  GenerationSession,
  generationDefaults,
  parseGenerationForm,
  generationMessage,
} from '../../packages/vscode-extension/dist/generation-session.js';
import {
  generationClient,
  generationHtml,
} from '../../packages/vscode-extension/dist/generation-view.js';
import { fixture } from '../helpers.mjs';
const form = {
  ...generationDefaults,
  include: 'src/**/*.ts',
  exclude: '',
  maxFiles: '10',
};

test('generation form rejects unbounded, traversal and unknown inputs before scanning', () => {
  assert.equal(parseGenerationForm(form).options.maxFileBytes, 64 * 1024);
  for (const changed of [
    { maxFiles: '201' },
    { maxKiB: '2049' },
    { maxPages: '100' },
    { maxFiles: '1e2' },
    { include: '../secret' },
    { include: 'C:/secret' },
    { include: 'x'.repeat(8193) },
    { extra: 'command' },
    { language: 'js' },
  ])
    assert.throws(() => parseGenerationForm({ ...form, ...changed }));
  for (const value of [
    null,
    [],
    { action: 'eval' },
    { action: ['recover'] },
    { action: 'preview', form, command: 'x' },
    { action: 'cancel', path: '../x' },
    Object.assign(Object.create({ action: 'cancel' }), { x: 1 }),
  ])
    assert.equal(generationMessage(value), undefined);
});

test('session scans actual Unicode fixture, rejects edits/limited plans and preserves durable result', async () => {
  const f = await fixture();
  let calls = 0;
  const session = new GenerationSession(
    {
      preview: (options, signal) =>
        scanRepository(f.repository, f.store, options, signal),
      generate: async (interaction, recover) => {
        calls++;
        if (recover) return { pages: 2, recovered: true, modelStarted: false };
        assert.equal(interaction.expectedPlanId, session.state.plan.id);
        interaction.phase('running');
        return { pages: 2, state: 'pending-review', published: false };
      },
      review: async () => {},
    },
    () => {},
  );
  try {
    assert.equal(calls, 0);
    await session.handle({ action: 'preview', form });
    assert.deepEqual(session.state.plan.files.map((file) => file.path).sort(), [
      'src/cache.ts',
      'src/读取.ts',
    ]);
    const id = session.state.plan.id;
    await session.handle({
      action: 'generate',
      form: { ...form, maxPages: '4' },
      planId: id,
    });
    assert.match(session.state.error, /PREVIEW_REQUIRED/u);
    assert.equal(calls, 0);
    await session.handle({
      action: 'preview',
      form: { ...form, maxFiles: '1' },
    });
    await session.handle({
      action: 'generate',
      form: { ...form, maxFiles: '1' },
      planId: session.state.plan.id,
    });
    assert.match(session.state.error, /INCOMPLETE_PLAN/u);
    assert.equal(calls, 0);
    await session.handle({ action: 'preview', form });
    await session.handle({
      action: 'generate',
      form,
      planId: session.state.plan.id,
    });
    assert.equal(session.state.result.state, 'pending-review');
    assert.equal(session.state.result.published, false);
    await session.handle({ action: 'recover' });
    assert.equal(session.state.result.modelStarted, false);
    assert.equal(calls, 2);
  } finally {
    session.dispose();
    await f.cleanup();
  }
});

test('cancel/dispose abort only the active operation, concurrent messages cannot start a second task', async () => {
  let signal,
    calls = 0;
  const session = new GenerationSession(
    {
      preview: async (_options, value) => {
        calls++;
        signal = value;
        return await new Promise((_, reject) =>
          value.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          }),
        );
      },
      generate: async () => {
        throw new Error('must not generate');
      },
      review: async () => {},
    },
    () => {},
  );
  const pending = session.handle({ action: 'preview', form });
  await session.handle({ action: 'preview', form });
  assert.equal(calls, 1);
  await session.handle({ action: 'cancel' });
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(session.state.phase, 'cancelled');
  const second = session.handle({ action: 'preview', form });
  session.dispose();
  await second;
  assert.equal(signal.aborted, true);
  await session.handle({ action: 'preview', form });
  assert.equal(calls, 2);
});

test('a saved result remains visible when cancellation races with completion', async () => {
  let finish;
  const session = new GenerationSession(
    {
      preview: async () => {
        throw new Error('unused');
      },
      generate: async () =>
        await new Promise((resolve) => {
          finish = resolve;
        }),
      review: async () => {},
    },
    () => {},
  );
  const pending = session.handle({ action: 'recover' });
  await session.handle({ action: 'cancel' });
  finish({ state: 'pending-review', recovered: true, modelStarted: false });
  await pending;
  assert.equal(session.state.phase, 'finished');
  assert.equal(session.state.result.state, 'pending-review');
});

test('native progress cancellation is displayed as cancelled and never retried', async () => {
  let calls = 0;
  const session = new GenerationSession(
    {
      preview: async () => {
        calls++;
        throw new KnowledgeError('SCAN_CANCELLED', 'Scan cancelled');
      },
      generate: async () => {
        throw new Error('must not generate');
      },
      review: async () => {},
    },
    () => {},
  );
  await session.handle({ action: 'preview', form });
  assert.equal(session.state.phase, 'cancelled');
  assert.equal(calls, 1);
});

test('shipped browser script sends no startup work, binds form/plan, invalidates edits and uses text nodes', () => {
  const elements = new Map();
  const element = (id) => {
    const value = {
      id,
      value: form[id] ?? '',
      disabled: false,
      textContent: '',
      handlers: {},
      children: [],
      addEventListener(type, callback) {
        this.handlers[type] = callback;
      },
      replaceChildren(...children) {
        this.children = children;
      },
    };
    elements.set(id, value);
    return value;
  };
  let listener;
  const sent = [];
  const document = {
    getElementById: (id) => elements.get(id) ?? element(id),
    createElement: () => element('item'),
  };
  runInNewContext(generationClient, {
    document,
    window: {
      addEventListener: (_name, fn) => {
        listener = fn;
      },
    },
    acquireVsCodeApi: () => ({
      postMessage: (message) => sent.push(JSON.parse(JSON.stringify(message))),
    }),
  });
  assert.deepEqual(sent, []);
  elements.get('generation-form').handlers.submit({ preventDefault() {} });
  assert.equal(sent[0].action, 'preview');
  const plan = {
    id: 'a'.repeat(36),
    files: [{ path: '<img onerror=evil>', bytes: 10 }],
    summary: { limited: false, selectedBytes: 10, skipped: {} },
  };
  listener({
    data: { type: 'generation-state', phase: 'previewed', busy: false, plan },
  });
  assert.equal(
    elements.get('files').children[0].textContent,
    '<img onerror=evil> · 10 bytes',
  );
  elements.get('generate').handlers.click();
  assert.equal(sent.at(-1).planId, plan.id);
  elements.get('generation-form').handlers.input();
  assert.equal(sent.at(-1).action, 'invalidate');
  assert.equal(elements.get('generate').disabled, true);
  const count = sent.length;
  elements.get('generate').handlers.click();
  assert.equal(sent.length, count);
  listener({
    data: { type: 'generation-state', phase: 'running', busy: true },
  });
  assert.equal(elements.get('cancel').disabled, false);
  assert.equal(elements.get('preview').disabled, true);
  elements.get('cancel').handlers.click();
  assert.equal(sent.at(-1).action, 'cancel');
  const html = generationHtml(
    '</p><script>evil()</script>',
    'ssh-remote & linux',
    'a'.repeat(32),
  );
  assert.ok(html.includes('&lt;script&gt;evil()&lt;/script&gt;'));
  assert.match(html, /default-src 'none'/u);
  assert.doesNotMatch(html, /https?:|command:|unsafe-inline|innerHTML/u);
});
