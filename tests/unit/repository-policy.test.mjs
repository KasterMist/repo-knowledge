import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateManifests,
  validateWorkflow,
} from '../../scripts/repository-policy.mjs';

const fixture = () => ({
  root: {
    name: 'root',
    private: true,
    version: '0.0.0',
    license: 'Apache-2.0',
  },
  workspaces: [
    {
      name: '@repo-knowledge/core',
      private: true,
      version: '0.0.0',
      license: 'Apache-2.0',
    },
  ],
});
test('reject accidental npm publication and incompatible internal versions', () => {
  const { root, workspaces } = fixture();
  assert.deepEqual(validateManifests(root, workspaces), []);
  workspaces[0].private = false;
  workspaces[0].version = '1.0.0';
  const errors = validateManifests(root, workspaces);
  assert.ok(errors.some((error) => error.includes('must be private')));
  assert.ok(errors.some((error) => error.includes('version mismatch')));
});
test('reject undeclared internal packages and unpinned build tools', () => {
  const { root, workspaces } = fixture();
  root.devDependencies = { typescript: '^5.9.3' };
  workspaces[0].dependencies = { '@repo-knowledge/missing': '0.0.0' };
  const errors = validateManifests(root, workspaces);
  assert.ok(errors.some((error) => error.includes('unknown workspace')));
  assert.ok(errors.some((error) => error.includes('pin an exact version')));
});
test('reject CI that drops Windows/Linux or trusts a moving Action tag', () => {
  const workflow = {
    permissions: { contents: 'read' },
    jobs: {
      check: {
        strategy: { matrix: { os: ['windows-latest', 'ubuntu-latest'] } },
        steps: [{ run: 'npm ci' }, { run: 'npm run check' }],
      },
    },
  };
  assert.deepEqual(validateWorkflow(workflow), []);
  workflow.jobs.check.strategy.matrix.os = ['ubuntu-latest'];
  workflow.jobs.check.steps.push({ uses: 'actions/checkout@main' });
  const errors = validateWorkflow(workflow);
  assert.ok(errors.some((error) => error.includes('windows-latest')));
  assert.ok(errors.some((error) => error.includes('full commit SHAs')));
});
