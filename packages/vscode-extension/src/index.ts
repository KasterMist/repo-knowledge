// Extension activation, UI and packaging are introduced in M1 / T07.
import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { mkdir, open, cp, realpath, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveHost, codexConfiguration, nodeCommand } from './host.js';
import { KnowledgeStore } from '@repo-knowledge/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Repo Knowledge');
  context.subscriptions.push(output);
  const register = (name: string, action: () => Promise<unknown>) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(`repoKnowledge.${name}`, async () => {
        if (!vscode.workspace.isTrusted) {
          void vscode.window.showWarningMessage(
            'Repo Knowledge requires a trusted workspace.',
          );
          return;
        }
        try {
          return await action();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Operation failed';
          void vscode.window.showErrorMessage(`Repo Knowledge: ${message}`);
          return { error: true, message };
        }
      }),
    );
  };
  const selected = async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length)
      throw new Error('Open a native or Remote SSH repository folder first.');
    const folder =
      folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick();
    if (!folder) return;
    const configuration = vscode.workspace.getConfiguration(
      'repoKnowledge',
      folder.uri,
    );
    const configured = configuration.get<string>('storeDirectory', '');
    const host = resolveHost({
      remoteName: vscode.env.remoteName,
      platform: process.platform,
      folder: folder.uri,
      extension: context.extensionUri,
      storage: context.globalStorageUri,
      configuredStore: configured,
    });
    const root = await realpath(host.repository);
    const store =
      configured ||
      join(
        host.storage,
        'repositories',
        createHash('sha256').update(root).digest('hex'),
      );
    return {
      root,
      store,
      knowledge: new KnowledgeStore(root, store),
      configuration,
      host,
      uriForFile: (path: string) => vscode.Uri.file(path),
    };
  };
  register('initialize', async () => {
    const target = await selected();
    if (!target) return;
    await mkdir(target.store, { recursive: true });
    const file = join(target.store, 'knowledge.json');
    let handle;
    try {
      handle = await open(file, 'wx');
    } catch {
      throw new Error(
        'Store already exists or is not writable. Use Open Knowledge Snapshot to inspect it.',
      );
    }
    try {
      await handle.writeFile(
        JSON.stringify(
          {
            schemaVersion: 1,
            repository: {
              id: createHash('sha256').update(target.root).digest('hex'),
              sourceRevision: 'unrecorded',
            },
            cards: [],
          },
          null,
          2,
        ) + '\n',
      );
    } finally {
      await handle.close();
    }
    await vscode.window.showTextDocument(target.uriForFile(file));
  });
  register('openSnapshot', async () => {
    const target = await selected();
    if (!target) return;
    await target.knowledge.snapshot();
    await vscode.window.showTextDocument(
      target.uriForFile(join(target.store, 'knowledge.json')),
    );
  });
  register('search', async () => {
    const target = await selected();
    if (!target) return;
    const query = await vscode.window.showInputBox({
      prompt: 'Search shared knowledge / 搜索知识卡片',
      ignoreFocusOut: true,
    });
    if (!query?.trim()) return;
    const result = await target.knowledge.search(query);
    const choice = await vscode.window.showQuickPick(
      result.results.map((card) => ({
        label: card.title,
        description: card.id,
        id: card.id,
      })),
      { placeHolder: 'Choose a card to inspect source evidence' },
    );
    if (!choice) return;
    const resultCard = await target.knowledge.read(choice.id);
    const text = [
      `# ${resultCard.card.title}`,
      `Revision: ${resultCard.card.revision}; source: ${resultCard.stale ? 'STALE — verify before use' : 'current'}`,
      resultCard.card.body,
      ...resultCard.evidence.map(
        (entry) =>
          `## ${entry.path}:${entry.startLine}–${entry.endLine} (${entry.status})\n\n\u0060\u0060\u0060text\n${entry.excerpt}\n\u0060\u0060\u0060`,
      ),
    ].join('\n\n');
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument({
        content: text,
        language: 'markdown',
      }),
    );
  });
  register('codexSetup', async () => {
    const target = await selected();
    if (!target) return;
    await target.knowledge.snapshot();
    const command = nodeCommand(
      target.configuration.get<string>('nodeExecutable', 'node'),
      target.host.kind === 'ssh-remote',
      process.execPath,
    );
    const server = join(context.extensionPath, 'dist', 'server.cjs');
    const config = codexConfiguration(
      command,
      server,
      target.root,
      target.store,
    );
    const guide = [
      '# Connect official Codex',
      'Merge this table into the active Codex config.toml (user-level or trusted project). Replace an existing repo_knowledge table instead of duplicating it. This command does not change your config. Use the Codex MCP server settings to restart the extension after saving.',
      '\u0060\u0060\u0060toml\n' + config + '\u0060\u0060\u0060',
      'Native preview uses external Node 24.19.x on PATH or an absolute repoKnowledge.nodeExecutable setting. Remote SSH uses the remote extension-host Node by default (tested MCP runtime: Node 22.22.1). Paths refer to this installed extension version; regenerate after reinstall/move. One repo_knowledge entry targets one repository. Use distinct table names for multiple repositories.',
      'In a fresh Codex conversation explicitly ask it to call get_knowledge_status, search_knowledge, read_knowledge, then propose_knowledge_update. Inspect the pending proposal JSON before any future publication. Agent calls are not guaranteed every turn.',
      'Official guide: https://learn.chatgpt.com/docs/extend/mcp',
    ].join('\n\n');
    const hostGuide =
      target.host.kind === 'ssh-remote'
        ? `\n\n## Remote SSH execution\n\nThe extension, Node command, repository and knowledge store in this preview are all on the Linux SSH host. Open the active config.toml through the official Codex settings and verify it belongs to the same host before merging this table. Do not paste these Linux paths into a Windows-local Codex backend. No SSH password or tunnel is required by the MCP service itself.\n\nDefault nodeExecutable uses the remote VS Code Server Node binary (${process.version}) in a separate process. If the server installation moves after a VS Code update, regenerate this configuration. An explicit absolute nodeExecutable setting overrides that default. Remote native runtime acceptance includes Node 22.22.1 and the development baseline 24.19.0.\n`
        : '';
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument({
        content: guide + hostGuide,
        language: 'markdown',
      }),
    );
  });
  register('diagnostics', async () => {
    const target = await selected();
    if (!target) return;
    const command = nodeCommand(
      target.configuration.get<string>('nodeExecutable', 'node'),
      target.host.kind === 'ssh-remote',
      process.execPath,
    );
    const transport = new StdioClientTransport({
      command,
      args: [
        join(context.extensionPath, 'dist', 'server.cjs'),
        '--repository',
        target.root,
        '--store',
        target.store,
      ],
      stderr: 'pipe',
    });
    const client = new Client({
      name: 'repo-knowledge-diagnostics',
      version: '0.0.0',
    });
    const deadline = setTimeout(() => {
      void transport.close();
    }, 15000);
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const status = await client.callTool({
        name: 'get_knowledge_status',
        arguments: {},
      });
      if (status.isError)
        throw new Error(
          'Server connected but store/evidence status failed. Check snapshot and repository paths.',
        );
      output.appendLine(
        `Standalone MCP handshake succeeded; ${tools.tools.length} tools discovered.`,
      );
      output.appendLine(
        `Execution host: ${target.host.kind}; ${process.platform}; extension-host Node ${process.version}.`,
      );
      output.appendLine(
        'URI routing: extension-host file scheme; VS Code handles the SSH authority.',
      );
      output.appendLine(
        `MCP command: ${command}. Repository/store use extension-host filesystem paths.`,
      );
      const codex = vscode.extensions.getExtension('openai.chatgpt');
      output.appendLine(
        `Codex installation visible to this host: ${codex ? `kind=${codex.extensionKind}; scheme=${codex.extensionUri.scheme}` : 'not found'}. Verify the active Codex backend location separately.`,
      );
      output.appendLine(
        `Official Codex extension installed: ${vscode.extensions.getExtension('openai.chatgpt')?.packageJSON.version ?? 'not found'}. This does not prove Codex is connected.`,
      );
      output.appendLine(JSON.stringify(status.content));
      output.show(true);
      return {
        protocolConnected: true,
        hostKind: target.host.kind,
        platform: process.platform,
        extensionHostNode: process.version,
        tools: tools.tools.map((tool) => tool.name),
        status: status.content,
      };
    } finally {
      clearTimeout(deadline);
      await client.close();
      await transport.close();
    }
  });
  register('openDemo', async () => {
    if (vscode.env.remoteName && !(await selected())) return;
    const demo = join(context.globalStorageUri.fsPath, 'demo');
    let exists = true;
    try {
      await access(demo);
    } catch {
      exists = false;
    }
    if (!exists) {
      await cp(join(context.extensionPath, 'demo'), demo, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      await mkdir(join(demo, '.vscode'), { recursive: true });
      await writeFile(
        join(demo, '.vscode', 'settings.json'),
        JSON.stringify(
          { 'repoKnowledge.storeDirectory': join(demo, 'knowledge') },
          null,
          2,
        ),
      );
    }
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(demo),
      true,
    );
  });
}
