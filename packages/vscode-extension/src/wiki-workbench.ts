import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import {
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
  constructor(private readonly resolve: ResolveTarget) {
    this.disposables = [
      vscode.commands.registerCommand(
        'repoKnowledge.openWikiPreview',
        (node?: { folder?: vscode.WorkspaceFolder }, text?: string) =>
          this.open(node?.folder, text),
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
      if (text === undefined && candidateId === undefined) {
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
      const reader =
        candidateId === undefined
          ? await WikiPreviewReader.open(target.knowledge, text!)
          : await WikiCandidateReader.open(target.knowledge, candidateId);
      if (revision !== this.revision) return;
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
      let disposed = false,
        busy = false;
      let current: { id: string; revision: string } | undefined;
      const render = async (id?: string) => {
        const view = id ? await reader.read(id) : undefined;
        if (disposed) return;
        const html = wikiHtml(
          reader.catalog(),
          view,
          target.root,
          `${vscode.env.remoteName ?? 'native'} · ${process.platform}`,
          randomBytes(16).toString('hex'),
          '',
          candidateId !== undefined,
        );
        current = view
          ? { id: view.article.id, revision: view.snapshotRevision }
          : undefined;
        panel.webview.html = html;
        return view;
      };
      const handle = async (value: unknown) => {
        const message = wikiMessage(value);
        if (!message || disposed || busy || !vscode.workspace.isTrusted) return;
        busy = true;
        try {
          if (message.action === 'article') return await render(message.id);
          if (message.action === 'refresh')
            return await render(current?.id ?? reader.catalog()[0]?.id);
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
              reader.catalog(),
              undefined,
              target.root,
              vscode.env.remoteName ?? 'native',
              randomBytes(16).toString('hex'),
              error instanceof Error ? error.message : 'Cannot read article',
              candidateId !== undefined,
            );
          return { error: true };
        } finally {
          busy = false;
        }
      };
      const messages = panel.webview.onDidReceiveMessage((message: unknown) => {
        void handle(message);
      });
      const dispose = () => {
        disposed = true;
        messages.dispose();
      };
      this.panels.set(panel, dispose);
      panel.onDidDispose(() => {
        dispose();
        this.panels.delete(panel);
      });
      try {
        await render(
          reader.catalog().find((entry) => entry.parentId === null)?.id,
        );
      } catch (error) {
        dispose();
        panel.dispose();
        throw error;
      }
      return { reader, handle, repository: target.root };
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
  }
  dispose() {
    this.close();
    this.disposables.forEach((item) => item.dispose());
  }
}
