const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('KasterMist.repo-knowledge');
  assert.ok(extension, 'Packaged extension must be discoverable');
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const command of extension.packageJSON.contributes.commands)
    assert.ok(commands.includes(command.command), command.command);
  const opened = await vscode.commands.executeCommand(
    'repoKnowledge.openSnapshot',
  );
  assert.ok(!opened?.error, opened?.message);
  const document = vscode.window.activeTextEditor?.document;
  assert.equal(path.basename(document?.fileName ?? ''), 'knowledge.json');
  assert.equal(JSON.parse(document.getText()).cards.length, 3);
  assert.equal(
    JSON.parse(document.getText()).repository.id,
    'self-authored-demo',
  );
  if (vscode.env.remoteName) {
    assert.equal(vscode.env.remoteName, 'ssh-remote');
    assert.equal(document.uri.scheme, 'file');
    assert.equal(
      document.uri.authority,
      vscode.workspace.workspaceFolders[0].uri.authority,
    );
  }
  await vscode.commands.executeCommand('repoKnowledge.codexSetup');
  const guide = vscode.window.activeTextEditor?.document.getText() ?? '';
  assert.match(guide, /\[mcp_servers.repo_knowledge\]/u);
  assert.match(guide, /server\.cjs/u);
  const diagnostics = await vscode.commands.executeCommand(
    'repoKnowledge.diagnostics',
  );
  assert.equal(diagnostics?.protocolConnected, true);
  assert.equal(diagnostics.tools.length, 4);
  const workbench = extension.exports.workbench;
  const roots = await workbench.cards.getChildren();
  const cards = await workbench.cards.getChildren(roots[0]);
  assert.equal(cards.length, 3);
  const readNode = cards.find((card) => card.cardId === 'read-fallback');
  assert.ok(readNode);
  const cardUri = await vscode.commands.executeCommand(
    'repoKnowledge.openCard',
    readNode,
  );
  assert.equal(cardUri.scheme, 'repo-knowledge');
  assert.match(
    vscode.window.activeTextEditor.document.getText(),
    /read-fallback/u,
  );
  const evidence = await workbench.cards.getChildren(readNode);
  assert.equal(evidence[0].description, 'current');
  const sourceUri = await vscode.commands.executeCommand(
    'repoKnowledge.openEvidence',
    evidence[0],
  );
  assert.equal(sourceUri.scheme, 'file');
  assert.equal(path.basename(sourceUri.fsPath), '读取.ts');
  assert.equal(vscode.window.activeTextEditor.selection.start.line, 0);
  const wikiRoots = await workbench.wiki.getChildren();
  const scope = await workbench.wiki.getChildren(wikiRoots[0]);
  assert.equal(scope[0].label, 'src');
  const files = await workbench.wiki.getChildren(scope[0]);
  assert.ok(files.some((file) => file.label === '读取.ts'));
  await vscode.commands.executeCommand('repoKnowledge.refreshKnowledge');
  const recovery = [];
  // Only the runner-owned disposable profile may change a machine setting.
  // The remote fallback runner must never modify a maintainer's real profile.
  if (process.env.REPO_KNOWLEDGE_ISOLATED_PROFILE === '1') {
    const folder = vscode.workspace.workspaceFolders[0];
    const configuration = vscode.workspace.getConfiguration(
      'repoKnowledge',
      folder.uri,
    );
    const storeSetting = configuration.inspect('storeDirectory').workspaceValue;
    const nodeSetting = configuration.inspect('nodeExecutable').globalValue;
    const originalStore = configuration.get('storeDirectory');
    const originalSnapshot = await fs.readFile(
      path.join(originalStore, 'knowledge.json'),
    );
    const scratch = path.join(folder.uri.fsPath, '.host-recovery');
    await fs.mkdir(scratch, { recursive: true });
    const selectStore = (value) =>
      configuration.update(
        'storeDirectory',
        value,
        vscode.ConfigurationTarget.Workspace,
      );
    const restoredDiagnostic = async () => {
      const result = await vscode.commands.executeCommand(
        'repoKnowledge.diagnostics',
      );
      assert.equal(result?.protocolConnected, true, result?.message);
    };
    try {
      for (const [name, content, expected] of [
        ['missing-store', undefined, /knowledge\.json/u],
        ['malformed-store', '{', /schemaVersion 1/u],
        ['unknown-schema', '{"schemaVersion":99}', /schemaVersion 1/u],
      ]) {
        const brokenStore = path.join(scratch, name);
        if (content !== undefined) {
          await fs.mkdir(brokenStore, { recursive: true });
          await fs.writeFile(path.join(brokenStore, 'knowledge.json'), content);
        }
        await selectStore(brokenStore);
        const opened = await vscode.commands.executeCommand(
          'repoKnowledge.openSnapshot',
        );
        assert.equal(opened?.error, true);
        assert.match(opened.message, expected);
        const failed = await vscode.commands.executeCommand(
          'repoKnowledge.diagnostics',
        );
        assert.equal(failed?.error, true);
        assert.match(failed.message, expected);
        await selectStore(storeSetting);
        await restoredDiagnostic();
        recovery.push(`${name}: clear error and recovery`);
      }
      const missingNode = path.join(scratch, 'missing-node-executable');
      await configuration.update(
        'nodeExecutable',
        missingNode,
        vscode.ConfigurationTarget.Global,
      );
      const failed = await vscode.commands.executeCommand(
        'repoKnowledge.diagnostics',
      );
      assert.equal(failed?.error, true);
      assert.match(failed.message, /nodeExecutable/u);
      await configuration.update(
        'nodeExecutable',
        nodeSetting,
        vscode.ConfigurationTarget.Global,
      );
      await restoredDiagnostic();
      recovery.push('missing-node: clear error and recovery');
      const emptyStore = path.join(scratch, 'initialized-store');
      await selectStore(emptyStore);
      await vscode.commands.executeCommand('repoKnowledge.initialize');
      const initialized = await fs.readFile(
        path.join(emptyStore, 'knowledge.json'),
      );
      assert.deepEqual(JSON.parse(initialized).cards, []);
      const repeated = await vscode.commands.executeCommand(
        'repoKnowledge.initialize',
      );
      assert.equal(repeated?.error, true);
      assert.match(repeated.message, /already exists/u);
      assert.deepEqual(
        await fs.readFile(path.join(emptyStore, 'knowledge.json')),
        initialized,
      );
      recovery.push('initialize: empty store created; repeat preserves bytes');
    } finally {
      await selectStore(storeSetting);
      await configuration.update(
        'nodeExecutable',
        nodeSetting,
        vscode.ConfigurationTarget.Global,
      );
    }
    await restoredDiagnostic();
    assert.deepEqual(
      await fs.readFile(path.join(originalStore, 'knowledge.json')),
      originalSnapshot,
    );
  }
  await fs.writeFile(
    process.env.REPO_KNOWLEDGE_HOST_RESULT ||
      path.join(
        vscode.workspace.workspaceFolders[0].uri.fsPath,
        'host-result.json',
      ),
    JSON.stringify(
      {
        passed: true,
        vscodeVersion: vscode.version,
        platform: process.platform,
        extensionVersion: extension.packageJSON.version,
        remoteName: vscode.env.remoteName || null,
        protocolConnected: diagnostics.protocolConnected,
        workspaceUriScheme: vscode.workspace.workspaceFolders[0].uri.scheme,
        snapshotUriScheme: document.uri.scheme,
        evidence: [
          'packaged extension activation',
          'command registrations and two knowledge trees',
          'read-only knowledge document and validated source navigation',
          'snapshot editor access',
          'Codex TOML preview',
          'actual standalone MCP diagnostics from extension host',
        ],
        recovery,
        officialCodexAcceptance: 'not tested by this runner',
      },
      null,
      2,
    ),
  );
};
