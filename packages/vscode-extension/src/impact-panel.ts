import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { KnowledgeTarget } from './workbench.js';
import { impactAction, impactHtml } from './impact-view.js';
export class ImpactPanel implements vscode.Disposable {
  private readonly panels = new Set<vscode.WebviewPanel>();
  private readonly listeners: vscode.Disposable[];
  constructor() {
    this.listeners = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.close()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('repoKnowledge')) this.close();
      }),
    ];
  }
  async open(
    target: KnowledgeTarget,
    report: {
      cards: { id: string; state: string }[];
      coverageComplete: boolean;
    },
  ) {
    if (!vscode.workspace.isTrusted) return;
    const folder = vscode.workspace.getWorkspaceFolder(
      target.uriForFile(target.root),
    );
    if (!folder)
      throw new Error('Report repository is no longer in this workspace.');
    const revision = (await target.knowledge.snapshot()).snapshotRevision;
    const panel = vscode.window.createWebviewPanel(
      'repoKnowledge.impact',
      '知识变化与维护',
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [] },
    );
    this.panels.add(panel);
    panel.webview.html = impactHtml(
      report.cards,
      report.coverageComplete,
      randomBytes(16).toString('hex'),
    );
    let busy = false;
    const listener = panel.webview.onDidReceiveMessage(async (value) => {
      if (busy || !this.panels.has(panel) || !vscode.workspace.isTrusted)
        return;
      const action = impactAction(value, report.cards.length);
      if (!action) return;
      busy = true;
      let message = '操作已结束；候选仍需独立审阅确认。';
      try {
        if ((await target.knowledge.snapshot()).snapshotRevision !== revision)
          throw Error('知识已变化，请重新审阅变化报告。');
        if (!this.panels.has(panel) || !vscode.workspace.isTrusted) return;
        const cardId = report.cards[action.index]!.id;
        await vscode.commands.executeCommand(
          action.action === 'edit'
            ? 'repoKnowledge.editCardBody'
            : 'repoKnowledge.generateKnowledgeUpdate',
          { folder, kind: 'card', cardId },
        );
      } catch (error) {
        message = error instanceof Error ? error.message : '无法打开维护操作';
      } finally {
        busy = false;
        if (this.panels.has(panel))
          await panel.webview.postMessage({ type: 'result', message });
      }
    });
    panel.onDidDispose(() => {
      listener.dispose();
      this.panels.delete(panel);
    });
  }
  private close() {
    for (const panel of this.panels) panel.dispose();
    this.panels.clear();
  }
  dispose() {
    this.close();
    this.listeners.forEach((l) => l.dispose());
  }
}
