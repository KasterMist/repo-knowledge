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
    assert.equal(document.uri.scheme, 'vscode-remote');
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
        evidence: [
          'packaged extension activation',
          'six command registrations',
          'snapshot editor access',
          'Codex TOML preview',
          'actual standalone MCP diagnostics from extension host',
        ],
        officialCodexAcceptance: 'not tested by this runner',
      },
      null,
      2,
    ),
  );
};
