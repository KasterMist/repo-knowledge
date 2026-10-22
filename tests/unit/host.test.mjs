import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHost,
  codexConfiguration,
  nodeCommand,
} from '../../packages/vscode-extension/dist/host.js';

const remote = () => ({
  remoteName: 'ssh-remote',
  platform: 'linux',
  folder: {
    scheme: 'vscode-remote',
    authority: 'ssh-remote+example',
    fsPath: '/work/代码 demo',
  },
  extension: {
    scheme: 'file',
    authority: '',
    fsPath: '/opt/extensions/repo-knowledge',
  },
  storage: {
    scheme: 'vscode-remote',
    authority: 'ssh-remote+example',
    fsPath: '/data/storage',
  },
  configuredStore: '',
});
test('real SSH extension-host file URIs do not require a client-side authority', () => {
  const input = remote();
  input.folder = { ...input.folder, scheme: 'file', authority: '' };
  input.storage = { ...input.storage, scheme: 'file', authority: '' };
  const host = resolveHost(input);
  assert.equal(host.kind, 'ssh-remote');
  assert.equal(host.repository, '/work/代码 demo');
  assert.equal(host.authority, '');
});
test('SSH resolves remote native paths, keeps authority and uses host Node without npm', () => {
  const result = resolveHost(remote());
  assert.equal(result.kind, 'ssh-remote');
  assert.equal(result.authority, 'ssh-remote+example');
  assert.equal(result.repository, '/work/代码 demo');
  assert.equal(nodeCommand('node', true, '/server/node'), '/server/node');
  assert.equal(
    nodeCommand('/custom/node', true, '/server/node'),
    '/custom/node',
  );
  assert.equal(nodeCommand('node', false, 'Code.exe'), 'node');
  assert.throws(() => nodeCommand('C:\\node.exe', true, '/server/node'));
  assert.throws(() => nodeCommand('', true, '/server/node'));
  const config = codexConfiguration(
    '/server/node',
    '/opt/extensions/repo-knowledge/dist/server.cjs',
    result.repository,
    '/data/storage',
  );
  assert.match(config, /command = "\/server\/node"/u);
  assert.ok(config.includes('"/work/代码 demo"'));
  assert.ok(!config.includes('vscode-remote:'));
});
test('SSH rejects local host execution, mismatched authorities, virtual workspaces and Windows store paths', () => {
  for (const mutate of [
    (input) => {
      input.remoteName = undefined;
    },
    (input) => {
      input.storage.authority = 'ssh-remote+other';
    },
    (input) => {
      input.folder.scheme = 'vscode-vfs';
    },
    (input) => {
      input.configuredStore = 'C:\\store';
    },
    (input) => {
      input.configuredStore = 'relative/store';
    },
    (input) => {
      input.remoteName = 'wsl';
    },
    (input) => {
      input.platform = 'win32';
    },
  ]) {
    const input = remote();
    mutate(input);
    assert.throws(() => resolveHost(input));
  }
});
test('native Windows and Linux remain supported without SSH metadata', () => {
  for (const [platform, path] of [
    ['win32', 'C:\\work\\repo'],
    ['linux', '/work/repo'],
  ]) {
    const uri = { scheme: 'file', authority: '', fsPath: path };
    assert.equal(
      resolveHost({
        remoteName: undefined,
        platform,
        folder: uri,
        extension: uri,
        storage: uri,
        configuredStore: '',
      }).kind,
      'native',
    );
  }
});

test('VS Code internal user-data storage is native-path backed while virtual folders remain rejected', () => {
  const input = remote();
  input.storage = {
    scheme: 'vscode-userdata',
    authority: '',
    fsPath: '/data/user-data',
  };
  assert.equal(resolveHost(input).storage, '/data/user-data');
  input.folder.scheme = 'vscode-userdata';
  assert.throws(() => resolveHost(input));
});
