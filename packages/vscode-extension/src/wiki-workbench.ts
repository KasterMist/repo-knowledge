import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import {
  PublishedWikiReader,
  WikiPreviewReader,
  WikiCandidateReader,
  loadWikiPreviewText,
} from '@repo-knowledge/core';
import type { ResolveTarget } from './workbench.js';
import { wikiHtml, wikiMessage } from './wiki-view.js';

export class WikiWorkbench implements vscode.Disposable {
  private readonly panels = new Map<vscode.WebviewPanel, () => void>();
  private readonly disposables: vscode.Disposable[];
  private revision = 0;
  private readonly published = new Map<
    string,
    {
      panel: vscode.WebviewPanel;
      handle: (value: unknown) => Promise<unknown>;
      reader: PublishedWikiReader | WikiPreviewReader | WikiCandidateReader;
      repository: string;
    }
  >();
  constructor(private readonly resolve: ResolveTarget) {
    this.disposables = [
      vscode.commands.registerCommand(
        'repoKnowledge.openWikiPreview',
        (node?: { folder?: vscode.WorkspaceFolder }, text?: string) =>
          this.open(node?.folder, text),
      ),
      vscode.commands.registerCommand(
        'repoKnowledge.openPublishedWiki',
        (node?: { folder?: vscode.WorkspaceFolder; articleId?: string }) =>
          this.open(node?.folder, undefined, undefined, true, node?.articleId),
      ),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.close()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('repoKnowledge')) this.close();
      }),
    ];
  }
  openCandidate(folder: vscode.WorkspaceFolder, id: string) {
    return this.open(folder, undefined, id);
  }
  async open(
    selected?: vscode.WorkspaceFolder,
    text?: string,
    candidateId?: string,
    published = false,
    articleId?: string,
  ) {
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
      !folders.some((entry) => entry.uri.toString() === folder.uri.toString())
    )
      return;
    try {
      const target = await this.resolve(folder);
      if (!target) return;
      if (!published && text === undefined && candidateId === undefined) {
        const files = await vscode.window.showOpenDialog({
          canSelectMany: false,
          defaultUri: vscode.Uri.file(target.root),
          filters: { 'Wiki preview JSON': ['json'] },
          title: '选择未发布 Wiki 预览；不导入、不迁移',
        });
        if (!files?.[0]) return { cancelled: true };
        if (
          files[0].scheme !== 'file' &&
          !(
            vscode.env.remoteName &&
            files[0].scheme === folder.uri.scheme &&
            files[0].authority === folder.uri.authority
          )
        )
          throw new Error('Select a file on this extension host.');
        text = await loadWikiPreviewText(files[0].fsPath);
      }
      const reader = published
        ? new PublishedWikiReader(target.knowledge)
        : candidateId === undefined
          ? await WikiPreviewReader.open(target.knowledge, text!)
          : await WikiCandidateReader.open(target.knowledge, candidateId);
      if (revision !== this.revision) return;
      const key = JSON.stringify([
        folder.uri.toString(),
        target.root,
        target.store,
      ]);
      const existing = published ? this.published.get(key) : undefined;
      if (existing) {
        await existing.handle(
          articleId
            ? { action: 'article', id: articleId }
            : { action: 'refresh' },
        );
        if (revision !== this.revision) return;
        existing.panel.reveal(vscode.ViewColumn.One);
        return existing;
      }
      const panel = vscode.window.createWebviewPanel(
        'repoKnowledge.wikiPreview',
        `Repo Wiki · ${folder.name}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          enableCommandUris: false,
          localResourceRoots: [],
        },
      );
      let disposed = false;
      let current: { id: string; revision: string } | undefined;
      const catalog = async () => {
        if (reader instanceof PublishedWikiReader) return reader.catalog();
        return { articles: reader.catalog(), snapshotRevision: undefined };
      };
      const render = async (id?: string) => {
        const directory = await catalog();
        const selectedId =
          id ?? directory.articles.find((entry) => entry.parentId === null)?.id;
        const view = selectedId ? await reader.read(selectedId) : undefined;
        if (
          published &&
          (await catalog()).snapshotRevision !== directory.snapshotRevision
        )
          throw new Error('Published Wiki changed; refresh before reading.');
        if (
          published &&
          view &&
          view.snapshotRevision !== directory.snapshotRevision
        )
          throw new Error('Published Wiki changed; refresh before reading.');
        if (disposed) return;
        const html = wikiHtml(
          directory.articles,
          view,
          target.root,
          `${vscode.env.remoteName ?? 'native'} · ${process.platform}`,
          randomBytes(16).toString('hex'),
          '',
          candidateId !== undefined,
          published,
        );
        current = view
          ? { id: view.article.id, revision: view.snapshotRevision }
          : undefined;
        panel.webview.html = html;
        return view;
      };
      const processMessage = async (value: unknown) => {
        const message = wikiMessage(value);
        if (!message || disposed || !vscode.workspace.isTrusted) return;
        try {
          if (message.action === 'generate') {
            if (!published) return;
            return await vscode.commands.executeCommand(
              'repoKnowledge.openGenerationPanel',
              { folder },
            );
          }
          if (message.action === 'article') return await render(message.id);
          if (message.action === 'refresh') return await render(current?.id);
          if (!current || message.revision !== current.revision)
            throw new Error('Refresh before opening evidence.');
          if (candidateId !== undefined)
            throw new Error(
              'Wiki candidate evidence is text only; no publication or navigation yet.',
            );
          const location = await reader.evidence(
            current.id,
            message.cardId,
            message.index,
            message.revision,
          );
          if (disposed) return;
          const editor = await vscode.window.showTextDocument(
            target.uriForFile(location.path),
          );
          const range = new vscode.Range(
            location.startLine - 1,
            0,
            location.endLine - 1,
            0,
          );
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
          if (location.status !== 'current')
            void vscode.window.showWarningMessage(
              'Repo Wiki: 源码已变化，请刷新并复核。',
            );
          return editor.document.uri;
        } catch (error) {
          current = undefined;
          if (!disposed)
            panel.webview.html = wikiHtml(
              [],
              undefined,
              target.root,
              vscode.env.remoteName ?? 'native',
              randomBytes(16).toString('hex'),
              error instanceof Error ? error.message : 'Cannot read article',
              candidateId !== undefined,
              published,
            );
          return { error: true };
        }
      };
      let queue: Promise<unknown> = Promise.resolve();
      const handle = (value: unknown) => {
        const next = queue.then(() => processMessage(value));
        queue = next.catch(() => {});
        return next;
      };
      const messages = panel.webview.onDidReceiveMessage((message: unknown) => {
        void handle(message);
      });
      const dispose = () => {
        disposed = true;
        messages.dispose();
      };
      this.panels.set(panel, dispose);
      const session = { panel, reader, handle, repository: target.root };
      if (published) this.published.set(key, session);
      panel.onDidDispose(() => {
        dispose();
        this.panels.delete(panel);
        if (this.published.get(key)?.panel === panel)
          this.published.delete(key);
      });
      try {
        await render(articleId);
      } catch (error) {
        dispose();
        panel.dispose();
        throw error;
      }
      return session;
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Repo Knowledge: ${error instanceof Error ? error.message : 'Cannot open Wiki preview'}`,
      );
      return { error: true };
    }
  }
  private close() {
    this.revision++;
    for (const [panel, dispose] of this.panels) {
      dispose();
      panel.dispose();
    }
    this.panels.clear();
    this.published.clear();
  }
  dispose() {
    this.close();
    this.disposables.forEach((item) => item.dispose());
  }
}
