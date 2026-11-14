// Extension activation, UI and packaging are introduced in M1 / T07.
import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { mkdir, open, cp, realpath, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveHost, codexConfiguration, nodeCommand } from './host.js';
import {
  KnowledgeStore,
  ImpactBaselines,
  bindRepositoryContext,
} from '@repo-knowledge/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { KnowledgeWorkbench } from './workbench.js';
import { BackendWorkbench } from './backend-workbench.js';
import { GenerationWorkbench } from './generation-workbench.js';
import { ImpactNavigation } from './impact-navigation.js';
import { HomeWorkbench } from './home-workbench.js';
import { GenerationPanelWorkbench } from './generation-panel.js';
import { WikiWorkbench } from './wiki-workbench.js';

export function activate(context: vscode.ExtensionContext) {
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
  const selected = async (selectedFolder?: vscode.WorkspaceFolder) => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length)
      throw new Error('Open a native or Remote SSH repository folder first.');
    const folder =
      selectedFolder ??
      (folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick());
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
  const workbench = new KnowledgeWorkbench(selected);
  context.subscriptions.push(workbench);
  const wikiReader = new WikiWorkbench(selected);
  context.subscriptions.push(wikiReader);
  const home = new HomeWorkbench(selected);
  context.subscriptions.push(home);
  const impactNavigation = new ImpactNavigation(workbench.documents);
  context.subscriptions.push(impactNavigation);
  const backend = new BackendWorkbench(
    selected,
    workbench.documents,
    context.globalStorageUri,
  );
  context.subscriptions.push(backend);
  const generation = new GenerationWorkbench(
    selected,
    workbench,
    backend,
    context.globalStorageUri,
  );
  context.subscriptions.push(generation);
  const generationPanel = new GenerationPanelWorkbench(
    selected,
    workbench,
    generation,
  );
  context.subscriptions.push(generationPanel);
  for (const mode of [
    'captureDependencyBaseline',
    'reviewKnowledgeChanges',
  ] as const) {
    register(mode, async () => {
      const target = await selected();
      if (!target) return;
      if (vscode.workspace.textDocuments.some((document) => document.isDirty))
        throw new Error(
          '请先保存或自行取消未保存的编辑 / Save or discard dirty editors before impact review.',
        );
      const baselines = new ImpactBaselines(target.knowledge);
      const plan =
        mode === 'captureDependencyBaseline'
          ? workbench.scanning.generationPlan(target)
          : undefined;
      if (mode === 'captureDependencyBaseline' && !plan)
        throw new Error(
          '请先运行 Plan Knowledge Generation 检查范围 / Preview a plan first.',
        );
      const choices =
        mode === 'reviewKnowledgeChanges' ? await baselines.list() : [];
      if (mode === 'reviewKnowledgeChanges' && !choices.length)
        throw new Error(
          '没有依赖基线 / No dependency baselines; capture one first.',
        );
      const picked =
        mode === 'reviewKnowledgeChanges'
          ? await vscode.window.showQuickPick(
              choices.map((value) => ({
                label: value.plan.createdAt,
                description: value.plan.id,
                id: value.plan.id,
              })),
              { title: '选择依赖基线 / Select dependency baseline' },
            )
          : undefined;
      if (mode === 'reviewKnowledgeChanges' && !picked) return;
      return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Repo Knowledge: 静态依赖分析 / Static impact',
          cancellable: true,
        },
        async (_progress, token) => {
          const controller = new AbortController();
          const listeners = [
            token.onCancellationRequested(() => controller.abort()),
            vscode.workspace.onDidChangeConfiguration((e) => {
              if (e.affectsConfiguration('repoKnowledge')) controller.abort();
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() =>
              controller.abort(),
            ),
          ];
          if (token.isCancellationRequested) controller.abort();
          try {
            if (plan) {
              const result = await baselines.save(plan, controller.signal);
              void vscode.window.showInformationMessage(
                '已保存依赖基线；未调用模型或发布 / Dependency baseline saved.',
              );
              return result;
            }
            const report = await baselines.review(
              picked!.id,
              controller.signal,
            );
            const uri = workbench.documents.create(
              'knowledge-impact.json',
              JSON.stringify(report, null, 2),
            );
            const baseline = await baselines.read(picked!.id);
            impactNavigation.remember(uri, {
              target,
              revision: baseline.snapshotRevision,
              files: [
                ...new Set([
                  ...report.changes.map((c) => c.path),
                  ...report.cards.flatMap((c) => c.evidence.map((e) => e.path)),
                ]),
              ],
              cards: report.cards.map((c) => c.id),
            });
            await vscode.window.showTextDocument(
              await vscode.workspace.openTextDocument(uri),
              { preview: false },
            );
            return report;
          } finally {
            listeners.forEach((listener) => listener.dispose());
          }
        },
      );
    });
  }
  register('bindRepositoryContext', async () => {
    const target = await selected();
    if (!target) return;
    if (vscode.workspace.textDocuments.some((document) => document.isDirty))
      throw new Error('Save dirty editors before binding repository context.');
    const answer = await vscode.window.showWarningMessage(
      '将外部知识存储绑定到当前 Git 工作树和分支。旧规划、候选和历史不可采用；请使用新存储。 / Bind this external store to the current Git worktree and branch?',
      { modal: true },
      '绑定 / Bind',
    );
    if (answer !== '绑定 / Bind') return;
    const result = await bindRepositoryContext(target.root, target.store);
    void vscode.window.showInformationMessage(
      'Repo Knowledge: Repository context bound; no model started.',
    );
    return result;
  });
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
    // A startup validation failure closes STDIO before MCP can return an error.
    // Surface the actionable store error instead of only "Connection closed".
    await target.knowledge.snapshot();
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
      version: '0.1.0',
    });
    const deadline = setTimeout(() => {
      void transport.close();
    }, 15000);
    try {
      try {
        await client.connect(transport);
      } catch {
        throw new Error(
          'Standalone MCP could not connect. Check repoKnowledge.nodeExecutable on this host and the bundled server installation.',
        );
      }
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
  return {
    workbench,
    backend,
    generation,
    generationPanel,
    impactNavigation,
    wikiReader,
  };
}
