import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { ResolveTarget } from './workbench.js';
import {
  homeAction,
  homeActions,
  homeHtml,
  type HomeState,
} from './home-view.js';

export class HomeWorkbench implements vscode.Disposable {
  private readonly panels = new Set<vscode.WebviewPanel>();
  private readonly disposables: vscode.Disposable[];
  constructor(private readonly resolve: ResolveTarget) {
    this.disposables = [
      vscode.commands.registerCommand('repoKnowledge.openHome', () =>
        this.open(),
      ),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.close()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('repoKnowledge')) this.close();
      }),
    ];
  }
  async open() {
    if (!vscode.workspace.isTrusted) return;
    const folders = vscode.workspace.workspaceFolders;
    const folder =
      folders?.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick();
    if (!folder) return;
    try {
      const target = await this.resolve(folder);
      if (!target) return;
      const state: HomeState = {
        repository: target.root,
        host: `${vscode.env.remoteName ?? 'native'} · ${process.platform}`,
        cardCount: 0,
        revision: '',
        problem: '',
      };
      try {
        const { snapshot, snapshotRevision } =
          await target.knowledge.snapshot();
        state.cardCount = snapshot.cards.length;
        state.revision = snapshotRevision;
      } catch (error) {
        state.problem =
          error instanceof Error ? error.message : 'Cannot read knowledge';
      }
      // The selected host owns all paths. Never construct remote authorities in HTML.
      const panel = vscode.window.createWebviewPanel(
        'repoKnowledge.home',
        `Repo Knowledge · ${folder.name}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          enableCommandUris: false,
          localResourceRoots: [],
        },
      );
      this.panels.add(panel);
      panel.webview.html = homeHtml(state, randomBytes(16).toString('hex'));
      let busy = false;
      const messages = panel.webview.onDidReceiveMessage(
        async (message: unknown) => {
          const action = homeAction(message);
          if (
            !action ||
            busy ||
            !vscode.workspace.isTrusted ||
            !this.panels.has(panel)
          )
            return;
          busy = true;
          let failed = false;
          try {
            const result = await vscode.commands.executeCommand<{
              error?: boolean;
            }>(homeActions[action], { folder });
            failed = result?.error === true;
          } catch {
            failed = true;
            void vscode.window.showErrorMessage(
              'Repo Knowledge: 无法打开所选操作 / Could not open the selected action.',
            );
          } finally {
            busy = false;
            if (this.panels.has(panel))
              void panel.webview.postMessage({ type: 'finished', failed });
          }
        },
      );
      panel.onDidDispose(() => {
        messages.dispose();
        this.panels.delete(panel);
      });
      return {
        repository: target.root,
        cardCount: state.cardCount,
        problem: state.problem,
      };
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Repo Knowledge: ${error instanceof Error ? error.message : 'Could not open workbench'}`,
      );
      return { error: true };
    }
  }
  private close() {
    for (const panel of this.panels) panel.dispose();
    this.panels.clear();
  }
  dispose() {
    this.close();
    this.disposables.forEach((item) => item.dispose());
  }
}
