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
  await vscode.commands.executeCommand('repoKnowledge.openSnapshot');
  const document = vscode.window.activeTextEditor?.document;
  assert.equal(path.basename(document?.fileName ?? ''), 'knowledge.json');
  assert.equal(JSON.parse(document.getText()).cards.length, 3);
  await vscode.commands.executeCommand('repoKnowledge.codexSetup');
  const guide = vscode.window.activeTextEditor?.document.getText() ?? '';
  assert.match(guide, /\[mcp_servers.repo_knowledge\]/u);
  assert.match(guide, /server\.cjs/u);
  await fs.writeFile(
    process.env.REPO_KNOWLEDGE_HOST_RESULT,
    JSON.stringify(
      {
        passed: true,
        vscodeVersion: vscode.version,
        platform: process.platform,
        extensionVersion: extension.packageJSON.version,
        evidence: [
          'packaged extension activation',
          'six command registrations',
          'snapshot editor access',
          'Codex TOML preview',
        ],
        officialCodexAcceptance: 'not tested by this runner',
      },
      null,
      2,
    ),
  );
};
