import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { KnowledgeStore, KnowledgePublication } from '@repo-knowledge/core';
import type { ResolveTarget } from './workbench.js';
import { wikiReviewHtml, wikiReviewMessage } from './wiki-review-view.js';
import { wikiReviewLists } from './wiki-review-lists.js';
import { WikiConfirmation } from './wiki-confirmation.js';

/** Server-owned review followed by independent native confirmation. */
export class WikiReviewWorkbench implements vscode.Disposable {
  private readonly panels = new Set<vscode.WebviewPanel>();
  private revision = 0;
  private readonly disposables: vscode.Disposable[];
  constructor(
    private readonly resolve: ResolveTarget,
    private readonly onWrite: () => void = () => {},
  ) {
    const close = () => {
      this.revision++;
      for (const panel of this.panels) panel.dispose();
      this.panels.clear();
    };
    this.disposables = [
      vscode.commands.registerCommand(
        'repoKnowledge.openWikiReview',
        (node?: { folder?: vscode.WorkspaceFolder }) => this.open(node?.folder),
      ),
      vscode.workspace.onDidChangeWorkspaceFolders(close),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('repoKnowledge')) close();
      }),
    ];
  }
  async open(selected?: vscode.WorkspaceFolder) {
    if (!vscode.workspace.isTrusted) return;
    const revision = this.revision,
      folders = vscode.workspace.workspaceFolders ?? [];
    const folder =
      selected ??
      (folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick());
    if (
      !folder ||
      !folders.some((item) => item.uri.toString() === folder.uri.toString())
    )
      return;
    try {
      const target = await this.resolve(folder);
      if (!target) return;
      const knowledge = new KnowledgeStore(
          target.root,
          target.store,
          'wiki-v2',
        ),
        publication = new KnowledgePublication(knowledge);
      let { candidates, history } = await wikiReviewLists(knowledge);
      if (revision !== this.revision || !vscode.workspace.isTrusted) return;
      const panel = vscode.window.createWebviewPanel(
        'repoKnowledge.wikiReview',
        'Wiki 图形审阅',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          enableCommandUris: false,
          localResourceRoots: [],
        },
      );
      this.panels.add(panel);
      const confirmation = new WikiConfirmation();
      let busy = false;
      const render = (
        review?: Parameters<typeof wikiReviewHtml>[4],
        error = '',
      ) => {
        confirmation.stage(review);
        if (this.panels.has(panel))
          panel.webview.html = wikiReviewHtml(
            target.root,
            candidates,
            history,
            randomBytes(16).toString('hex'),
            review,
            error,
          );
      };
      const refresh = async (notice = '') => {
        // Invalidate old review and inventory before I/O: failure cannot leave old targets actionable.
        candidates = [];
        history = [];
        render(undefined, notice || '正在刷新列表…');
        try {
          const latest = await wikiReviewLists(knowledge);
          if (!this.panels.has(panel) || revision !== this.revision) return;
          candidates = latest.candidates;
          history = latest.history;
          render(undefined, notice + ' 候选和历史已刷新。');
          return { candidates: candidates.length, history: history.length };
        } catch {
          render(
            undefined,
            (notice ? notice + ' ' : '') +
              '列表刷新失败；请点击刷新重试，勿重复提交已完成操作。',
          );
          return { error: true };
        }
      };
      render();
      const handle = async (value: unknown) => {
        const message = wikiReviewMessage(value);
        if (
          !message ||
          busy ||
          !this.panels.has(panel) ||
          !vscode.workspace.isTrusted
        )
          return;
        busy = true;
        try {
          if (message.action === 'refresh') return await refresh();
          if (message.action === 'confirm') {
            const result = await confirmation.confirm(
              async (review) =>
                (await vscode.window.showWarningMessage(
                  `${review.operation}\n${review.reason}\n保留元数据 ${review.retainedMetadata.entries} 项。确认写入已审阅目标？`,
                  { modal: true },
                  '确认写入 / Confirm',
                )) === '确认写入 / Confirm',
              () => {
                if (
                  !this.panels.has(panel) ||
                  revision !== this.revision ||
                  !vscode.workspace.isTrusted
                )
                  throw new Error('Workspace changed.');
                if (
                  vscode.workspace.textDocuments.some(
                    (document) => document.isDirty,
                  )
                )
                  throw new Error(
                    'Save or discard unsaved editors before publication.',
                  );
              },
              (review) =>
                review.operation === 'migrate-wiki'
                  ? publication.migrateWiki(review.itemId, review.token)
                  : review.operation === 'create-wiki'
                    ? publication.publishWikiCreation(
                        review.itemId,
                        review.token,
                      )
                    : publication.rollbackWiki(review.itemId, review.token),
            );
            if (!(result as { cancelled?: boolean })?.cancelled) {
              this.onWrite();
              await refresh('操作已完成。');
            }
          } else if (message.action === 'migration')
            render(await publication.previewWikiMigration());
          else if (
            message.action === 'candidate' &&
            candidates.some((item) => item.id === message.id)
          )
            render(await publication.previewWikiCreation(message.id));
          else if (
            message.action === 'rollback' &&
            history.some((item) => item.id === message.id && item.actionable)
          )
            render(await publication.previewWikiRollback(message.id));
        } catch (error) {
          render(
            undefined,
            error instanceof Error ? error.message : 'Cannot review Wiki',
          );
          return { error: true };
        } finally {
          busy = false;
        }
      };
      const listener = panel.webview.onDidReceiveMessage((value: unknown) => {
        void handle(value);
      });
      panel.onDidDispose(() => {
        confirmation.dispose();
        listener.dispose();
        this.panels.delete(panel);
      });
      return {
        handle,
        repository: target.root,
        candidates: candidates.length,
        history: history.length,
      };
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Repo Knowledge: ${error instanceof Error ? error.message : 'Cannot open Wiki review'}`,
      );
      return { error: true };
    }
  }
  dispose() {
    this.revision++;
    for (const panel of this.panels) panel.dispose();
    this.panels.clear();
    this.disposables.forEach((item) => item.dispose());
  }
}
