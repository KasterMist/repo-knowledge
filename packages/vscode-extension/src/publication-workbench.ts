import * as vscode from 'vscode';
import { relative, isAbsolute } from 'node:path';
import {
  KnowledgePublication,
  type KnowledgeReview,
} from '@repo-knowledge/core';
import type { KnowledgeDocuments } from './documents.js';
import type {
  KnowledgeTarget,
  ResolveTarget,
  KnowledgeNode,
} from './workbench.js';

type Mode = 'drafts' | 'proposals' | 'history';
export class PublicationNode extends vscode.TreeItem {
  constructor(
    readonly mode: Mode,
    readonly folder: vscode.WorkspaceFolder,
    readonly target?: KnowledgeTarget,
    readonly itemId?: string,
    label = folder.name,
  ) {
    super(
      label,
      itemId
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.contextValue = itemId ? `knowledge-${mode}` : 'knowledge-repository';
    this.iconPath = new vscode.ThemeIcon(
      itemId ? (mode === 'history' ? 'history' : 'git-pull-request') : 'repo',
    );
    if (itemId)
      this.command = {
        command:
          mode === 'drafts'
            ? 'repoKnowledge.openDraft'
            : mode === 'proposals'
              ? 'repoKnowledge.reviewProposal'
              : 'repoKnowledge.openHistory',
        title: 'Open',
        arguments: [this],
      };
  }
}
class PublicationTree
  implements vscode.TreeDataProvider<PublicationNode>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<
    PublicationNode | undefined
  >();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(
    readonly mode: Mode,
    private readonly resolve: ResolveTarget,
  ) {}
  refresh(): void {
    this.changed.fire(undefined);
  }
  getTreeItem(node: PublicationNode): vscode.TreeItem {
    return node;
  }
  async getChildren(node?: PublicationNode): Promise<PublicationNode[]> {
    if (!vscode.workspace.isTrusted) return [];
    if (!node)
      return (vscode.workspace.workspaceFolders ?? []).map(
        (folder) => new PublicationNode(this.mode, folder),
      );
    if (node.itemId) return [];
    try {
      const target = node.target ?? (await this.resolve(node.folder));
      if (!target) return [];
      const publication = new KnowledgePublication(target.knowledge);
      const entries =
        this.mode === 'history'
          ? (await publication.history()).map((h) => ({
              id: h.record.transactionId,
              title: `${h.record.cardId} · r${h.record.beforeRevision} → r${h.record.afterRevision}`,
              state: `${h.record.operation} · ${h.state}`,
              error: '',
            }))
          : await publication.listCandidates(this.mode);
      return entries.map((entry) => {
        const item = new PublicationNode(
          this.mode,
          node.folder,
          target,
          entry.id,
          entry.title,
        );
        item.description = entry.state;
        item.tooltip = entry.error || entry.id;
        return item;
      });
    } catch (error) {
      const item = new PublicationNode(
        this.mode,
        node.folder,
        undefined,
        'error',
        error instanceof Error ? error.message : 'Cannot read store',
      );
      delete item.command;
      item.contextValue = 'knowledge-error';
      return [item];
    }
  }
  dispose(): void {
    this.changed.dispose();
  }
}

export class PublicationWorkbench implements vscode.Disposable {
  readonly drafts: PublicationTree;
  readonly proposals: PublicationTree;
  readonly history: PublicationTree;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly reviews = new Map<string, KnowledgeReview>();
  constructor(
    private readonly resolve: ResolveTarget,
    private readonly documents: KnowledgeDocuments,
    private readonly refreshAll: () => void,
  ) {
    this.drafts = new PublicationTree('drafts', resolve);
    this.proposals = new PublicationTree('proposals', resolve);
    this.history = new PublicationTree('history', resolve);
    for (const tree of [this.drafts, this.proposals, this.history])
      this.disposables.push(
        tree,
        vscode.window.createTreeView(`repoKnowledge.${tree.mode}`, {
          treeDataProvider: tree,
        }),
      );
    this.command('editCard', (node) =>
      this.editCard(node as KnowledgeNode | undefined),
    );
    this.command('openDraft', (node) =>
      this.openDraft(node as PublicationNode | undefined),
    );
    this.command('submitDraft', (node) =>
      this.submitDraft(node as PublicationNode | undefined),
    );
    this.command('reviewProposal', (node) =>
      this.reviewProposal(node as PublicationNode | undefined),
    );
    this.command('publishProposal', (node) =>
      this.publishProposal(node as PublicationNode | undefined),
    );
    this.command('openHistory', (node) =>
      this.openHistory(node as PublicationNode | undefined),
    );
    this.command('rollbackKnowledge', (node) =>
      this.rollback(node as PublicationNode | undefined),
    );
    this.command('recoverPublication', (node) =>
      this.recover(node as PublicationNode | undefined),
    );
  }
  private command(
    name: string,
    action: (node?: PublicationNode | KnowledgeNode) => unknown,
  ) {
    this.disposables.push(
      vscode.commands.registerCommand(`repoKnowledge.${name}`, async (node) => {
        try {
          if (!vscode.workspace.isTrusted)
            throw new Error('Knowledge editing requires a trusted workspace.');
          return await action(node);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Operation failed';
          void vscode.window.showErrorMessage(`Repo Knowledge: ${message}`);
          return { error: true, message };
        }
      }),
    );
  }
  refresh(): void {
    for (const tree of [this.drafts, this.proposals, this.history])
      tree.refresh();
  }
  private clean(target: KnowledgeTarget): void {
    const dirty = vscode.workspace.textDocuments.find((document) => {
      if (!document.isDirty) return false;
      const path = relative(target.store, document.uri.fsPath);
      return (
        path === '' ||
        (!isAbsolute(path) &&
          path !== '..' &&
          !path.startsWith('../') &&
          !path.startsWith('..\\'))
      );
    });
    if (dirty)
      throw new Error(
        '知识目录有未保存的编辑。请先保存或自行取消修改，再审阅 / Save or discard dirty knowledge editors before review.',
      );
  }
  private async choose(mode: Mode, node?: PublicationNode) {
    const target = node?.target ?? (await this.resolve(node?.folder));
    if (!target) return;
    const publication = new KnowledgePublication(target.knowledge);
    if (node?.itemId && node.mode === mode)
      return { target, publication, id: node.itemId };
    const entries =
      mode === 'history'
        ? (await publication.history()).map((h) => ({
            label: `${h.record.cardId} r${h.record.afterRevision}`,
            description: h.state,
            id: h.record.transactionId,
          }))
        : (await publication.listCandidates(mode)).map((c) => ({
            label: c.title,
            description: c.state,
            id: c.id,
          }));
    const chosen = await vscode.window.showQuickPick(entries, {
      placeHolder: '选择知识条目 / Choose knowledge item',
    });
    if (chosen) return { target, publication, id: chosen.id };
  }
  private key(target: KnowledgeTarget, id: string): string {
    return JSON.stringify([target.root, target.store, id]);
  }
  private async diff(target: KnowledgeTarget, review: KnowledgeReview) {
    const before = this.documents.create(
      `${review.before.id}-before.json`,
      JSON.stringify(review.before, null, 2),
    );
    const after = this.documents.create(
      `${review.after.id}-after.json`,
      JSON.stringify(review.after, null, 2),
    );
    await vscode.commands.executeCommand(
      'vscode.diff',
      before,
      after,
      `${review.operation}: ${review.before.title} · r${review.before.revision} → r${review.after.revision}`,
    );
    this.reviews.set(this.key(target, review.itemId), review);
    return { before, after };
  }
  async editCard(node?: KnowledgeNode) {
    const target = node?.target ?? (await this.resolve(node?.folder));
    if (!target) return;
    let id = node?.kind === 'card' ? node.cardId : undefined;
    if (!id) {
      const { snapshot } = await target.knowledge.snapshot();
      id = (
        await vscode.window.showQuickPick(
          snapshot.cards.map((c) => ({ label: c.title, id: c.id })),
        )
      )?.id;
    }
    if (!id) return;
    const draft = await new KnowledgePublication(target.knowledge).createDraft(
      id,
    );
    this.refreshAll();
    await vscode.window.showTextDocument(target.uriForFile(draft.path));
    return draft;
  }
  async openDraft(node?: PublicationNode) {
    const chosen = await this.choose('drafts', node);
    if (!chosen) return;
    const draft = await chosen.publication.readCandidate(chosen.id, 'drafts');
    return vscode.window.showTextDocument(chosen.target.uriForFile(draft.path));
  }
  async submitDraft(node?: PublicationNode) {
    const chosen = await this.choose('drafts', node);
    if (!chosen) return;
    this.clean(chosen.target);
    const result = await chosen.publication.submitDraft(chosen.id);
    this.refreshAll();
    void vscode.window.showInformationMessage(
      '候选已保存，尚未发布 / Candidate saved; review and publish separately.',
    );
    return result;
  }
  async reviewProposal(node?: PublicationNode) {
    const chosen = await this.choose('proposals', node);
    if (!chosen) return;
    this.clean(chosen.target);
    return this.diff(
      chosen.target,
      await chosen.publication.previewProposal(chosen.id),
    );
  }
  async publishProposal(node?: PublicationNode) {
    const chosen = await this.choose('proposals', node);
    if (!chosen) return;
    this.clean(chosen.target);
    let review = this.reviews.get(this.key(chosen.target, chosen.id));
    if (!review || review.operation !== 'publish') {
      review = await chosen.publication.previewProposal(chosen.id);
      await this.diff(chosen.target, review);
      void vscode.window.showInformationMessage(
        '请检查差异，然后再次运行 Publish Reviewed Proposal / Review the diff, then run Publish again.',
      );
      return { reviewRequired: true };
    }
    const choice = await vscode.window.showWarningMessage(
      `确认发布 ${review.before.title}：r${review.before.revision} → r${review.after.revision}？\n${review.reason}\n只更新知识快照，不修改源码。请先检查差异。`,
      { modal: true },
      '发布 / Publish',
    );
    if (choice !== '发布 / Publish') return { cancelled: true };
    this.clean(chosen.target);
    const result = await chosen.publication.publish(chosen.id, review.token);
    this.reviews.delete(this.key(chosen.target, chosen.id));
    this.refreshAll();
    void vscode.window.showInformationMessage(
      `知识已发布 / Published r${result.revision}`,
    );
    return result;
  }
  async openHistory(node?: PublicationNode) {
    const chosen = await this.choose('history', node);
    if (!chosen) return;
    const entry = await chosen.publication.readHistory(chosen.id);
    const before = this.documents.create('snapshot-before.json', entry.before);
    const after = this.documents.create('snapshot-after.json', entry.after);
    await vscode.commands.executeCommand(
      'vscode.diff',
      before,
      after,
      `${entry.record.operation} · ${entry.state}`,
    );
    return { before, after };
  }
  async rollback(node?: PublicationNode) {
    const chosen = await this.choose('history', node);
    if (!chosen) return;
    this.clean(chosen.target);
    let review = this.reviews.get(this.key(chosen.target, chosen.id));
    if (!review || review.operation !== 'rollback') {
      review = await chosen.publication.previewRollback(chosen.id);
      await this.diff(chosen.target, review);
      void vscode.window.showInformationMessage(
        '请检查回退差异，然后再次运行 Roll Back Knowledge / Review the diff, then run rollback again.',
      );
      return { reviewRequired: true };
    }
    if (
      (await vscode.window.showWarningMessage(
        `恢复 ${review.before.title} 的历史内容，并创建 r${review.after.revision}？源码不回退。`,
        { modal: true },
        '回退 / Roll back',
      )) !== '回退 / Roll back'
    )
      return { cancelled: true };
    this.clean(chosen.target);
    const result = await chosen.publication.rollback(chosen.id, review.token);
    this.reviews.delete(this.key(chosen.target, chosen.id));
    this.refreshAll();
    return result;
  }
  async recover(node?: PublicationNode) {
    const chosen = await this.choose('history', node);
    if (!chosen) return;
    this.clean(chosen.target);
    const snapshot = await chosen.target.knowledge.snapshot();
    await this.openHistory(
      new PublicationNode(
        'history',
        node?.folder ?? vscode.workspace.workspaceFolders![0]!,
        chosen.target,
        chosen.id,
      ),
    );
    if (
      (await vscode.window.showWarningMessage(
        '仅在当前快照匹配记录前后任一版本时，补齐中断事务标记；不会覆盖快照。确认恢复检查？',
        { modal: true },
        '恢复标记 / Recover',
      )) !== '恢复标记 / Recover'
    )
      return { cancelled: true };
    this.clean(chosen.target);
    const result = await chosen.publication.recover(
      chosen.id,
      snapshot.snapshotRevision,
    );
    this.refreshAll();
    return result;
  }
  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.reviews.clear();
  }
}
