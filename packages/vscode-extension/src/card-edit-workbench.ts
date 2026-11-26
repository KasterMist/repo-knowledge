import * as vscode from 'vscode';
import { KnowledgePublication } from '@repo-knowledge/core';
import type { PublicationNode } from './publication-workbench.js';
import { randomBytes } from 'node:crypto';
import type { KnowledgeNode, ResolveTarget } from './workbench.js';
import { cardEditHtml, cardEditMessage } from './card-edit-view.js';
import { safeMarkdown } from './safe-markdown.js';

export class CardEditWorkbench implements vscode.Disposable {
  private readonly panels = new Set<vscode.WebviewPanel>();
  private revision = 0;
  private readonly disposables: vscode.Disposable[];
  constructor(
    private readonly resolve: ResolveTarget,
    private readonly refresh: () => void,
  ) {
    const close = () => {
      this.revision++;
      for (const panel of this.panels) panel.dispose();
      this.panels.clear();
    };
    this.disposables = [
      vscode.commands.registerCommand(
        'repoKnowledge.editCardBody',
        (node?: KnowledgeNode) => this.open(node),
      ),
      vscode.commands.registerCommand(
        'repoKnowledge.resumeCardBodyDraft',
        (node?: PublicationNode) => this.open(undefined, node, true),
      ),
      vscode.workspace.onDidChangeWorkspaceFolders(close),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('repoKnowledge')) close();
      }),
    ];
  }
  async open(
    node?: KnowledgeNode,
    draftNode?: PublicationNode,
    resume = false,
  ) {
    if (!vscode.workspace.isTrusted) return;
    const revision = this.revision;
    try {
      const target = await this.resolve(node?.folder ?? draftNode?.folder);
      if (!target) return;
      const publication = new KnowledgePublication(target.knowledge);
      let recovered;
      if (resume) {
        // Resume is explicit; opening an ordinary editor never scans other stores.
        const selected =
          draftNode?.itemId ??
          (
            await vscode.window.showQuickPick(
              (await publication.listCandidates('drafts')).map((item) => ({
                label: item.title,
                description: item.id,
                id: item.id,
              })),
            )
          )?.id;
        if (!selected) return;
        recovered = await publication.readCandidate(selected, 'drafts');
        if (recovered.record.schemaVersion !== 2 || recovered.record.merge)
          throw new Error(
            'Use the merge workflow for this draft; only captured ordinary drafts can reopen here.',
          );
      }
      const id =
        recovered?.input.id ??
        (node?.kind === 'card'
          ? node.cardId
          : (
              await vscode.window.showQuickPick(
                (await target.knowledge.snapshot()).snapshot.cards.map(
                  (card) => ({ label: card.title, id: card.id }),
                ),
              )
            )?.id);
      if (!id) return;
      const current = await target.knowledge.read(id);
      if (recovered && recovered.record.schemaVersion === 2) {
        const original = recovered.record.baseCard;
        if (
          JSON.stringify({
            ...recovered.input.proposedCard,
            body: original.body,
            revision: original.revision,
          }) !== JSON.stringify(original)
        )
          throw new Error(
            'This draft also changes metadata; use the existing draft editor to preserve all fields.',
          );
      }
      const base =
        recovered && recovered.record.schemaVersion === 2
          ? {
              card: recovered.record.baseCard,
              snapshotRevision: recovered.input.baseSnapshot,
            }
          : current;
      if (revision !== this.revision || !vscode.workspace.isTrusted) return;
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
        recovered?.input.proposedCard ?? base.card,
        target.root,
        randomBytes(16).toString('hex'),
        recovered?.input.reason ?? '',
      );
      let lastDraft:
        | { body: string; reason: string; draftId: string; path: string }
        | undefined;
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
          if (edit.action === 'preview') {
            const html = safeMarkdown(edit.body);
            await panel.webview.postMessage({ type: 'preview', html });
            await reply('仅预览输入正文；未核验源码，未保存、提交或发布。');
            return { preview: true, html };
          }
          if (
            vscode.workspace.textDocuments.some(
              (document) =>
                document.isDirty &&
                ['file', 'vscode-remote'].includes(document.uri.scheme),
            )
          )
            throw new Error('Save or discard unsaved editors first.');
          if (edit.action === 'saveDraft') {
            const result =
              lastDraft?.body === edit.body && lastDraft.reason === edit.reason
                ? lastDraft
                : await publication.createDraft(id, {
                    body: edit.body,
                    reason: edit.reason,
                    baseSnapshot: base.snapshotRevision,
                  });
            lastDraft = { ...result, body: edit.body, reason: edit.reason };
            this.refresh();
            await reply(
              '草稿已保存：' +
                result.draftId +
                '。可关闭后恢复；尚未提交或发布。',
            );
            return { draftId: result.draftId, path: result.path };
          }
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
      return {
        handle,
        repository: target.root,
        close: () => panel.dispose(),
        initialBody: recovered?.input.proposedCard.body ?? base.card.body,
      };
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
