import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { ResolveTarget } from './workbench.js';
import type { KnowledgeWorkbench } from './workbench.js';
import type { GenerationWorkbench } from './generation-workbench.js';
import { GenerationSession } from './generation-session.js';
import { generationHtml } from './generation-view.js';

export class GenerationPanelWorkbench implements vscode.Disposable {
  private readonly panels = new Map<vscode.WebviewPanel, GenerationSession>();
  private readonly disposables: vscode.Disposable[];
  private revision = 0;
  constructor(
    private readonly resolve: ResolveTarget,
    private readonly workbench: KnowledgeWorkbench,
    private readonly generation: GenerationWorkbench,
  ) {
    this.disposables = [
      vscode.commands.registerCommand(
        'repoKnowledge.openGenerationPanel',
        (node?: { folder?: vscode.WorkspaceFolder }) => this.open(node?.folder),
      ),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.close()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('repoKnowledge')) this.close();
      }),
    ];
  }
  async open(selected?: vscode.WorkspaceFolder) {
    if (!vscode.workspace.isTrusted) return;
    const revision = this.revision;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const folder =
      selected ??
      (folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick());
    if (
      !folder ||
      !folders.some((value) => value.uri.toString() === folder.uri.toString())
    )
      return;
    try {
      const target = await this.resolve(folder);
      if (!target || revision !== this.revision) return;
      const panel = vscode.window.createWebviewPanel(
        'repoKnowledge.generation',
        `生成知识 · ${folder.name}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          enableCommandUris: false,
          localResourceRoots: [],
          retainContextWhenHidden: true,
        },
      );
      const session = new GenerationSession(
        {
          preview: async (options, signal) => {
            const result = await this.workbench.scanning.preview(
              { folder },
              options,
              { signal, reveal: false },
            );
            if (!result) throw new Error('Scan cancelled');
            return result.plan;
          },
          generate: (interaction, recover) =>
            this.generation.generate(folder, recover, interaction),
          review: async () =>
            await vscode.commands.executeCommand(
              'repoKnowledge.creations.focus',
            ),
        },
        (state) => {
          if (this.panels.has(panel)) void panel.webview.postMessage(state);
        },
      );
      this.panels.set(panel, session);
      panel.webview.html = generationHtml(
        target.root,
        `${vscode.env.remoteName ?? 'native'} · ${process.platform}`,
        randomBytes(16).toString('hex'),
      );
      const messages = panel.webview.onDidReceiveMessage((message: unknown) => {
        if (vscode.workspace.isTrusted && this.panels.has(panel))
          void session.handle(message);
      });
      panel.onDidDispose(() => {
        messages.dispose();
        session.dispose();
        this.panels.delete(panel);
      });
      // Session exposes the same guarded actions to host tests; no model bypass.
      return { repository: target.root, session };
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Repo Knowledge: ${error instanceof Error ? error.message : 'Cannot open generation panel'}`,
      );
      return { error: true };
    }
  }
  private close() {
    this.revision++;
    for (const [panel, session] of this.panels) {
      session.dispose();
      panel.dispose();
    }
    this.panels.clear();
  }
  dispose() {
    this.close();
    this.disposables.forEach((item) => item.dispose());
  }
}
