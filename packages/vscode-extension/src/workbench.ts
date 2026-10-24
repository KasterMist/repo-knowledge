import * as vscode from 'vscode';
import { KnowledgeStore, type Card } from '@repo-knowledge/core';
import { KnowledgeDocuments } from './documents.js';
import { PublicationWorkbench } from './publication-workbench.js';
import { ScanWorkbench } from './scan-workbench.js';

export interface KnowledgeTarget {
  root: string;
  store: string;
  knowledge: KnowledgeStore;
  uriForFile(path: string): vscode.Uri;
}
export type ResolveTarget = (
  folder?: vscode.WorkspaceFolder,
) => Promise<KnowledgeTarget | undefined>;
type Mode = 'wiki' | 'cards';
export class KnowledgeNode extends vscode.TreeItem {
  constructor(
    readonly kind: 'repository' | 'scope' | 'card' | 'evidence' | 'message',
    label: string,
    readonly folder: vscode.WorkspaceFolder,
    readonly target?: KnowledgeTarget,
    readonly cardId?: string,
    readonly prefix = '',
    readonly evidenceIndex = 0,
    readonly snapshotRevision = '',
  ) {
    super(
      label,
      ['repository', 'scope', 'card'].includes(kind)
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = `knowledge-${kind}`;
    this.iconPath = new vscode.ThemeIcon(
      kind === 'repository'
        ? 'repo'
        : kind === 'scope'
          ? 'folder'
          : kind === 'card'
            ? 'book'
            : kind === 'evidence'
              ? 'references'
              : 'info',
    );
    if (kind === 'card')
      this.command = {
        command: 'repoKnowledge.openCard',
        title: 'Open card',
        arguments: [this],
      };
    if (kind === 'evidence')
      this.command = {
        command: 'repoKnowledge.openEvidence',
        title: 'Open source evidence',
        arguments: [this],
      };
  }
}
class KnowledgeTree
  implements vscode.TreeDataProvider<KnowledgeNode>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<
    KnowledgeNode | undefined
  >();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(
    readonly mode: Mode,
    private readonly resolve: ResolveTarget,
  ) {}
  refresh(): void {
    this.changed.fire(undefined);
  }
  getTreeItem(node: KnowledgeNode): vscode.TreeItem {
    return node;
  }
  async getChildren(node?: KnowledgeNode): Promise<KnowledgeNode[]> {
    if (!vscode.workspace.isTrusted) return [];
    if (!node)
      return (vscode.workspace.workspaceFolders ?? []).map(
        (folder) => new KnowledgeNode('repository', folder.name, folder),
      );
    if (node.kind === 'message' || node.kind === 'evidence') return [];
    try {
      const target = node.target ?? (await this.resolve(node.folder));
      if (!target) return [];
      if (node.kind === 'card') {
        const result = await target.knowledge.read(node.cardId!);
        return result.evidence.map((evidence, index) => {
          const item = new KnowledgeNode(
            'evidence',
            `${evidence.path}:${evidence.startLine}–${evidence.endLine}`,
            node.folder,
            target,
            node.cardId,
            '',
            index,
            result.snapshotRevision,
          );
          item.description = evidence.status;
          return item;
        });
      }
      const { snapshot } = await target.knowledge.snapshot();
      const cards = [...snapshot.cards].sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      );
      const makeCard = (card: Card) => {
        const item = new KnowledgeNode(
          'card',
          card.title,
          node.folder,
          target,
          card.id,
        );
        item.description = `r${card.revision} · ${card.kind}`;
        return item;
      };
      if (!cards.length)
        return [
          new KnowledgeNode('message', '暂无知识卡片 / No cards', node.folder),
        ];
      if (this.mode === 'cards') return cards.map(makeCard);
      const groups = new Map<string, Card[]>();
      const leaves: Card[] = [];
      for (const card of cards) {
        const scope = card.scope[0]!;
        if (scope === node.prefix) {
          leaves.push(card);
          continue;
        }
        if (node.prefix && !scope.startsWith(node.prefix + '/')) continue;
        const remainder = scope.slice(node.prefix ? node.prefix.length + 1 : 0);
        const next = [node.prefix, remainder.split('/')[0]]
          .filter(Boolean)
          .join('/');
        const group = groups.get(next) ?? [];
        group.push(card);
        groups.set(next, group);
      }
      return [
        ...[...groups.keys()]
          .sort()
          .map(
            (prefix) =>
              new KnowledgeNode(
                'scope',
                prefix.split('/').at(-1)!,
                node.folder,
                target,
                undefined,
                prefix,
              ),
          ),
        ...leaves.map(makeCard),
      ];
    } catch (error) {
      return [
        new KnowledgeNode(
          'message',
          error instanceof Error ? error.message : 'Cannot read store',
          node.folder,
        ),
      ];
    }
  }
  dispose(): void {
    this.changed.dispose();
  }
}

export class KnowledgeWorkbench implements vscode.Disposable {
  readonly documents = new KnowledgeDocuments();
  readonly wiki: KnowledgeTree;
  readonly cards: KnowledgeTree;
  readonly publication: PublicationWorkbench;
  readonly scanning: ScanWorkbench;
  private readonly disposables: vscode.Disposable[] = [];
  constructor(private readonly resolve: ResolveTarget) {
    this.wiki = new KnowledgeTree('wiki', resolve);
    this.cards = new KnowledgeTree('cards', resolve);
    this.scanning = new ScanWorkbench(resolve, this.documents);
    this.disposables.push(this.scanning);
    this.publication = new PublicationWorkbench(resolve, this.documents, () =>
      this.refresh(),
    );
    this.disposables.push(this.publication);
    for (const tree of [this.wiki, this.cards])
      this.disposables.push(
        tree,
        vscode.window.createTreeView(`repoKnowledge.${tree.mode}`, {
          treeDataProvider: tree,
          showCollapseAll: true,
        }),
      );
    this.disposables.push(
      this.documents,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('repoKnowledge')) this.refresh();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
    );
    this.command('refreshKnowledge', () => this.refresh());
    this.command('openWorkbench', () =>
      vscode.commands.executeCommand('workbench.view.extension.repoKnowledge'),
    );
    this.command('openCard', (node) => this.openCard(node));
    this.command('openEvidence', (node) => this.openEvidence(node));
  }
  command(name: string, action: (node?: KnowledgeNode) => unknown): void {
    this.disposables.push(
      vscode.commands.registerCommand(`repoKnowledge.${name}`, async (node) => {
        if (!vscode.workspace.isTrusted)
          throw new Error('Knowledge workbench requires a trusted workspace.');
        try {
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
    this.wiki.refresh();
    this.cards.refresh();
    this.publication.refresh();
  }
  async choose(node?: KnowledgeNode) {
    if (node?.target && node.cardId)
      return { target: node.target, id: node.cardId, folder: node.folder };
    const target = await this.resolve(node?.folder);
    if (!target) return;
    const { snapshot } = await target.knowledge.snapshot();
    const chosen = await vscode.window.showQuickPick(
      snapshot.cards.map((card) => ({
        label: card.title,
        description: card.id,
        id: card.id,
      })),
      { placeHolder: '选择知识卡片 / Choose a card' },
    );
    if (chosen) return { target, id: chosen.id, folder: node?.folder };
  }
  async openCard(node?: KnowledgeNode) {
    const chosen = await this.choose(node);
    if (!chosen) return;
    const result = await chosen.target.knowledge.read(chosen.id);
    const text = [
      `# ${result.card.title}`,
      `ID: ${result.card.id} · revision ${result.card.revision} · ${result.card.kind}`,
      `来源状态 / Evidence: ${result.stale ? 'STALE — 请核对源码' : 'current'}`,
      result.card.body,
      '## 源码证据 / Source evidence',
      ...result.evidence.map((entry) => {
        const fence = '`'.repeat(
          Math.max(
            3,
            ...[...entry.excerpt.matchAll(/`+/gu)].map((m) => m[0].length + 1),
          ),
        );
        return `### ${entry.path}:${entry.startLine}–${entry.endLine} (${entry.status})\n\n${fence}text\n${entry.excerpt}\n${fence}`;
      }),
    ].join('\n\n');
    const uri = this.documents.create(`${chosen.id}.md`, text);
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(uri),
      { preview: true },
    );
    return uri;
  }
  async openEvidence(node?: KnowledgeNode) {
    if (!node?.target || !node.cardId || node.kind !== 'evidence')
      throw new Error('Expand a card and choose its evidence.');
    const location = await node.target.knowledge.evidenceLocation(
      node.cardId,
      node.evidenceIndex,
      node.snapshotRevision,
    );
    const editor = await vscode.window.showTextDocument(
      node.target.uriForFile(location.path),
    );
    const range = new vscode.Range(
      location.startLine - 1,
      0,
      location.endLine - 1,
      0,
    );
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    return editor.document.uri;
  }
  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
