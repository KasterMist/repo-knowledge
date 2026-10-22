// Extension activation, UI and packaging are introduced in M1 / T07.
import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { mkdir, open, cp, realpath, writeFile, access } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { KnowledgeStore } from '@repo-knowledge/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export function codexConfiguration(
  command: string,
  server: string,
  repository: string,
  store: string,
): string {
  return [
    '[mcp_servers.repo_knowledge]',
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify([server, '--repository', repository, '--store', store])}`,
    'startup_timeout_sec = 15',
    'tool_timeout_sec = 30',
    '',
  ].join('\n');
}
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Repo Knowledge');
  context.subscriptions.push(output);
  const register = (name: string, action: () => Promise<void>) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(`repoKnowledge.${name}`, async () => {
        if (!vscode.workspace.isTrusted) {
          void vscode.window.showWarningMessage(
            'Repo Knowledge requires a trusted local workspace.',
          );
          return;
        }
        try {
          await action();
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Repo Knowledge: ${error instanceof Error ? error.message : 'Operation failed'}`,
          );
        }
      }),
    );
  };
  const selected = async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length)
      throw new Error('Open a local repository folder first.');
    const folder =
      folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick();
    if (!folder) return;
    if (folder.uri.scheme !== 'file')
      throw new Error(
        'Only native local Windows/Linux workspaces are supported in this preview.',
      );
    const root = await realpath(folder.uri.fsPath);
    const configuration = vscode.workspace.getConfiguration(
      'repoKnowledge',
      folder.uri,
    );
    const configured = configuration.get<string>('storeDirectory', '');
    if (configured && !isAbsolute(configured))
      throw new Error('storeDirectory must be absolute.');
    const store =
      configured ||
      join(
        context.globalStorageUri.fsPath,
        'repositories',
        createHash('sha256').update(root).digest('hex'),
      );
    return {
      root,
      store,
      knowledge: new KnowledgeStore(root, store),
      configuration,
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
    await vscode.window.showTextDocument(vscode.Uri.file(file));
  });
  register('openSnapshot', async () => {
    const target = await selected();
    if (!target) return;
    await target.knowledge.snapshot();
    await vscode.window.showTextDocument(
      vscode.Uri.file(join(target.store, 'knowledge.json')),
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
    const command = target.configuration.get<string>('nodeExecutable', 'node');
    const server = join(context.extensionPath, 'dist', 'server.cjs');
    const config = codexConfiguration(
      command,
      server,
      target.root,
      target.store,
    );
    const guide = `# Connect official Codex\n\nMerge this table into your Codex config.toml (user-level or trusted project). Replace an existing repo_knowledge table instead of duplicating it. This command does not change your config. Use the Codex MCP server settings to restart the extension after saving.\n\n\u0060\u0060\u0060toml\n${config}\u0060\u0060\u0060\n\nRequires external Node 24.19.x (development baseline) on PATH or an absolute repoKnowledge.nodeExecutable setting. Paths refer to this installed extension version; regenerate after reinstall/move. One repo_knowledge entry targets one repository. Use distinct table names if connecting multiple repositories.\n\nIn a fresh Codex conversation explicitly ask it to call get_knowledge_status, search_knowledge, read_knowledge, then propose_knowledge_update. Inspect the pending proposal JSON before any future publication. Agent calls are not guaranteed every turn.\n\nOfficial guide: https://learn.chatgpt.com/docs/extend/mcp\n`;
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument({
        content: guide,
        language: 'markdown',
      }),
    );
  });
  register('diagnostics', async () => {
    const target = await selected();
    if (!target) return;
    const command = target.configuration.get<string>('nodeExecutable', 'node');
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
        `Official Codex extension installed: ${vscode.extensions.getExtension('openai.chatgpt')?.packageJSON.version ?? 'not found'}. This does not prove Codex is connected.`,
      );
      output.appendLine(JSON.stringify(status.content));
      output.show(true);
    } finally {
      clearTimeout(deadline);
      await client.close();
      await transport.close();
    }
  });
  register('openDemo', async () => {
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
