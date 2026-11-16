import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import {
  KnowledgeStore,
  KnowledgePublication,
  WikiCandidates,
} from '@repo-knowledge/core';
import type { ResolveTarget } from './workbench.js';
import { wikiReviewHtml, wikiReviewMessage } from './wiki-review-view.js';
import { WikiConfirmation } from './wiki-confirmation.js';

/** Server-owned review followed by independent native confirmation. */
export class WikiReviewWorkbench implements vscode.Disposable {
  private readonly panels = new Set<vscode.WebviewPanel>();
  private revision = 0;
  private readonly disposables: vscode.Disposable[];
  constructor(private readonly resolve: ResolveTarget) {
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
      const candidates = (await new WikiCandidates(knowledge).list()).map(
        (value) => ({
          id: value.candidate.candidateId,
          title: value.preview.articles
            .map((article) => article.title)
            .join(' · '),
        }),
      );
      const history = (await publication.history())
        .filter(
          (entry) =>
            entry.state === 'committed' &&
            entry.record.schemaVersion === 3 &&
            ['migrate-wiki', 'create-wiki'].includes(entry.record.operation),
        )
        .map((entry) => ({
          id: entry.record.transactionId,
          title: entry.record.operation + ' · ' + entry.record.createdAt,
        }));
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
      render();
      const listener = panel.webview.onDidReceiveMessage(
        async (value: unknown) => {
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
                render(
                  undefined,
                  '操作已完成。请重新打开本页刷新候选和历史；正式知识已由事务记录保护。',
                );
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
              history.some((item) => item.id === message.id)
            )
              render(await publication.previewWikiRollback(message.id));
          } catch (error) {
            render(
              undefined,
              error instanceof Error ? error.message : 'Cannot review Wiki',
            );
          } finally {
            busy = false;
          }
        },
      );
      panel.onDidDispose(() => {
        confirmation.dispose();
        listener.dispose();
        this.panels.delete(panel);
      });
      return {
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
