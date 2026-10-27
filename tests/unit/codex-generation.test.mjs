import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  generationDisabledFeatures,
  restrictedGenerationArguments,
  validateGenerationConfiguration,
  prepareCodexGeneration,
  generateKnowledgeCandidate,
  KnowledgeStore,
  scanRepository,
  defaultScanOptions,
} from '../../packages/core/dist/index.js';
import { fixture } from '../helpers.mjs';
const config = () => ({
  model: 'gpt-6.1-sol',
  features: Object.fromEntries(
    generationDisabledFeatures.map((name) => [name, false]),
  ),
  web_search: 'disabled',
  notify: [],
  project_doc_max_bytes: 0,
  mcp_servers: { inherited: { enabled: false, required: true } },
});
const code = (expected) => (error) => error.code === expected;
test('restricted arguments disable inherited MCP by quoted identity without overriding model, provider or credentials', () => {
  const args = restrictedGenerationArguments(['a.b', 'quote"name', 'a.b']);
  const mcp = args.find((value) => value.startsWith('mcp_servers='));
  assert.equal(
    mcp,
    'mcp_servers={"a.b"={enabled=false},"quote\\"name"={enabled=false}}',
  );
  assert.ok(args.includes('notify=[]'));
  assert.ok(args.includes('project_doc_max_bytes=0'));
  assert.ok(
    !args.some((value) =>
      /model=|model_provider=|api_key|auth_token/u.test(value),
    ),
  );
  assert.throws(
    () => restrictedGenerationArguments(['bad\nkey']),
    code('MCP_CONFIG_LIMIT'),
  );
  assert.throws(
    () =>
      restrictedGenerationArguments(
        Array.from({ length: 65 }, (_, i) => 'server' + i),
      ),
    code('MCP_CONFIG_LIMIT'),
  );
});
test('effective policy requires known version/model, disabled execution surfaces and no inherited active or new MCP server', () => {
  assert.deepEqual(
    validateGenerationConfiguration(config(), '0.164.0-alpha.11.1', [
      'inherited',
    ]),
    { model: 'gpt-6.1-sol', names: ['inherited'], provider: 'openai' },
  );
  assert.throws(
    () =>
      validateGenerationConfiguration(config(), 'future-version', [
        'inherited',
      ]),
    code('UNVERIFIED_MODEL_CAPABILITIES'),
  );
  const unknown = config();
  unknown.model = 'unverified-model';
  assert.throws(
    () =>
      validateGenerationConfiguration(unknown, '0.164.0-alpha.11.1', [
        'inherited',
      ]),
    code('UNVERIFIED_MODEL_CAPABILITIES'),
  );
  for (const surface of [
    'shell_tool',
    'hooks',
    'code_mode_host',
    'plugins',
    'computer_use',
  ]) {
    const unsafe = config();
    unsafe.features[surface] = true;
    assert.throws(
      () =>
        validateGenerationConfiguration(unsafe, '0.164.0-alpha.11.1', [
          'inherited',
        ]),
      code('UNVERIFIED_EXECUTION_FEATURE'),
    );
  }
  const inherited = config();
  const catalog = config();
  catalog.model_catalog_json = '/fixture-only/catalog.json';
  assert.throws(
    () =>
      validateGenerationConfiguration(catalog, '0.164.0-alpha.11.1', [
        'inherited',
      ]),
    code('UNVERIFIED_MODEL_CATALOG'),
  );
  const unknownFeature = config();
  unknownFeature.features.unverified_execution = true;
  assert.throws(
    () =>
      validateGenerationConfiguration(unknownFeature, '0.164.0-alpha.11.1', [
        'inherited',
      ]),
    code('UNVERIFIED_EXECUTION_FEATURE'),
  );
  const provider = config();
  provider.model_provider = 'fixture-provider';
  assert.equal(
    validateGenerationConfiguration(provider, '0.164.0-alpha.11.1', [
      'inherited',
    ]).provider,
    'fixture-provider',
  );
  inherited.mcp_servers.inherited.enabled = true;
  assert.throws(
    () =>
      validateGenerationConfiguration(inherited, '0.164.0-alpha.11.1', [
        'inherited',
      ]),
    code('MCP_CONFIG_UNCONFIRMED'),
  );
  assert.throws(
    () => validateGenerationConfiguration(config(), '0.164.0-alpha.11.1', []),
    code('MCP_CONFIG_UNCONFIRMED'),
  );
  const notify = config();
  const web = config();
  web.web_search = 'live';
  assert.throws(
    () =>
      validateGenerationConfiguration(web, '0.164.0-alpha.11.1', ['inherited']),
    code('EXECUTION_CONFIG_UNCONFIRMED'),
  );
  notify.notify = ['not-executed'];
  assert.throws(
    () =>
      validateGenerationConfiguration(notify, '0.164.0-alpha.11.1', [
        'inherited',
      ]),
    code('NOTIFY_CONFIG_UNCONFIRMED'),
  );
  const docs = config();
  docs.project_doc_max_bytes = 100;
  assert.throws(
    () =>
      validateGenerationConfiguration(docs, '0.164.0-alpha.11.1', [
        'inherited',
      ]),
    code('INSTRUCTION_CONFIG_UNCONFIRMED'),
  );
});
test('unknown executable/version and an in-repository generation cwd fail before any source transfer or model turn', async () => {
  const f = await fixture();
  try {
    const cwd = join(f.directory, 'scratch');
    await mkdir(cwd);
    await assert.rejects(
      prepareCodexGeneration(process.execPath, cwd),
      code('UNVERIFIED_CODEX_VERSION'),
    );
    const knowledge = new KnowledgeStore(f.repository, f.store);
    const plan = await scanRepository(f.repository, f.store, {
      ...defaultScanOptions,
      include: ['src/**/*.ts'],
      exclude: [],
    });
    await assert.rejects(
      generateKnowledgeCandidate({
        command: process.execPath,
        cwd: f.repository,
        knowledge,
        plan,
        maxPages: 2,
        timeoutMs: 1000,
      }),
      code('GENERATION_CWD_IN_REPOSITORY'),
    );
    await assert.rejects(
      generateKnowledgeCandidate({
        command: join(f.repository, 'src/读取.ts'),
        cwd,
        knowledge,
        plan,
        maxPages: 2,
        timeoutMs: 1000,
      }),
      code('GENERATION_EXECUTABLE_IN_REPOSITORY'),
    );
    await assert.rejects(
      generateKnowledgeCandidate({
        command: process.execPath,
        cwd: f.store,
        knowledge,
        plan,
        maxPages: 2,
        timeoutMs: 1000,
      }),
      code('GENERATION_CWD_IN_STORE'),
    );
  } finally {
    await f.cleanup();
  }
});
