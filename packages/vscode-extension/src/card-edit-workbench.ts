import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { KnowledgeNode, ResolveTarget } from './workbench.js';
import { cardEditHtml, cardEditMessage } from './card-edit-view.js';

export class CardEditWorkbench implements vscode.Disposable {
  private readonly panels = new Set<vscode.WebviewPanel>();
  private readonly disposables: vscode.Disposable[];
  constructor(
    private readonly resolve: ResolveTarget,
    private readonly refresh: () => void,
  ) {
    const close = () => {
      for (const panel of this.panels) panel.dispose();
      this.panels.clear();
    };
    this.disposables = [
      vscode.commands.registerCommand(
        'repoKnowledge.editCardBody',
        (node?: KnowledgeNode) => this.open(node),
      ),
      vscode.workspace.onDidChangeWorkspaceFolders(close),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('repoKnowledge')) close();
      }),
    ];
  }
  async open(node?: KnowledgeNode) {
    if (!vscode.workspace.isTrusted) return;
    try {
      const target = await this.resolve(node?.folder);
      if (!target) return;
      const id =
        node?.kind === 'card'
          ? node.cardId
          : (
              await vscode.window.showQuickPick(
                (await target.knowledge.snapshot()).snapshot.cards.map(
                  (card) => ({ label: card.title, id: card.id }),
                ),
              )
            )?.id;
      if (!id) return;
      const base = await target.knowledge.read(id);
      const panel = vscode.window.createWebviewPanel(
        'repoKnowledge.cardEditor',
        '编辑卡片 · ' + base.card.title,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          enableCommandUris: false,
          localResourceRoots: [],
        },
      );
      this.panels.add(panel);
      panel.webview.html = cardEditHtml(
        base.card,
        target.root,
        randomBytes(16).toString('hex'),
      );
      let busy = false,
        saved = false;
      const handle = async (value: unknown) => {
        if (
          !this.panels.has(panel) ||
          !vscode.workspace.isTrusted ||
          busy ||
          saved
        )
          return;
        const edit = cardEditMessage(value);
        const reply = (message: string, success = false) =>
          panel.webview.postMessage({
            type: 'result',
            message,
            saved: success,
          });
        if (!edit) {
          await reply('正文和理由不能为空，且须在长度限制内。');
          return { error: true };
        }
        busy = true;
        try {
          if (
            vscode.workspace.textDocuments.some(
              (document) =>
                document.isDirty &&
                ['file', 'vscode-remote'].includes(document.uri.scheme),
            )
          )
            throw new Error('Save or discard unsaved editors first.');
          const result = await target.knowledge.propose({
            id,
            baseRevision: base.card.revision,
            baseSnapshot: base.snapshotRevision,
            reason: edit.reason,
            proposedCard: {
              ...base.card,
              body: edit.body,
              revision: base.card.revision + 1,
            },
          });
          saved = true;
          this.refresh();
          await reply(
            '候选已保存：' +
              result.proposalId +
              '。请在待审阅列表查看差异并单独确认发布。',
            true,
          );
          return result;
        } catch (error) {
          await reply(
            error instanceof Error ? error.message : 'Cannot save candidate',
          );
          return {
            error: true,
            message:
              error instanceof Error ? error.message : 'Cannot save candidate',
          };
        } finally {
          busy = false;
        }
      };
      const listener = panel.webview.onDidReceiveMessage((value) => {
        void handle(value);
      });
      panel.onDidDispose(() => {
        listener.dispose();
        this.panels.delete(panel);
      });
      return { handle, repository: target.root };
    } catch (error) {
      void vscode.window.showErrorMessage(
        'Repo Knowledge: ' +
          (error instanceof Error ? error.message : 'Cannot edit card'),
      );
      return { error: true };
    }
  }
  dispose() {
    for (const panel of this.panels) panel.dispose();
    this.panels.clear();
    this.disposables.forEach((item) => item.dispose());
  }
}
