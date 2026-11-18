import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { KnowledgePublication, fingerprint } from '@repo-knowledge/core';
import type { ResolveTarget } from './workbench.js';
import type { PublicationNode } from './publication-workbench.js';
import { escapeHtml as e } from './home-view.js';

/** Each field choice is acknowledged explicitly; identity and evidence are host-owned. */
export class CardMergeWorkbench implements vscode.Disposable {
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
        'repoKnowledge.resolveCardConflict',
        (node?: PublicationNode) => this.open(node),
      ),
      vscode.workspace.onDidChangeWorkspaceFolders(close),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('repoKnowledge')) close();
      }),
    ];
  }
  async open(node?: PublicationNode) {
    if (!vscode.workspace.isTrusted) return;
    const revision = this.revision;
    try {
      const target = await this.resolve(node?.folder);
      if (!target) return;
      const publication = new KnowledgePublication(target.knowledge);
      const id =
        node?.itemId ??
        (
          await vscode.window.showQuickPick(
            (await publication.listCandidates()).map((item) => ({
              label: item.title,
              description: item.state,
              id: item.id,
            })),
          )
        )?.id;
      if (!id) return;
      const review = await publication.previewMerge(id),
        token = fingerprint(JSON.stringify(review));
      if (revision !== this.revision || !vscode.workspace.isTrusted) return;
      const panel = vscode.window.createWebviewPanel(
        'repoKnowledge.cardMerge',
        '卡片冲突处理',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          enableCommandUris: false,
          localResourceRoots: [],
        },
      );
      this.panels.add(panel);
      const nonce = randomBytes(16).toString('hex');
      const fields = review.conflicts
        .map(
          (field) =>
            `<fieldset><legend>${e(field)}</legend><h3>原始基线</h3><pre>${e(JSON.stringify(review.base[field], null, 2))}</pre><h3>当前人工内容</h3><pre>${e(JSON.stringify(review.current[field], null, 2))}</pre><h3>建议内容</h3><pre>${e(JSON.stringify(review.proposed[field], null, 2))}</pre><label>明确选择 <select data-field="${e(field)}"><option value="">尚未处理</option value="current">保留当前</option><option value="proposed">采用建议</option>${field === 'body' ? '<option value="manual">使用下方手工正文</option>' : ''}</select></label>${field === 'body' ? `<textarea id="body" rows="12" maxlength="16000">${e(review.current.body)}</textarea>` : ''}</fieldset>`,
        )
        .join('');
      panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><style nonce="${nonce}">body{padding:24px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)}pre{white-space:pre-wrap;overflow-wrap:anywhere}textarea{display:block;width:95%}fieldset{margin-bottom:20px}</style></head><body><h1>审阅并解决卡片冲突</h1><p>${e(target.root)} · ${e(review.current.title)}</p><p>先检查三方内容。每个冲突须明确选择；默认保留当前正文。只保存草稿，需另行提交、审阅并确认发布。</p>${fields || '<p>没有冲突；草稿将使用安全合并结果。</p>'}<button id="save">保存已处理草稿</button><p id="status" role="status"></p><script nonce="${nonce}">const api=acquireVsCodeApi(),save=document.getElementById('save');save.onclick=()=>{save.disabled=true;const choices={};for(const select of document.querySelectorAll('select[data-field]'))choices[select.dataset.field]=select.value;api.postMessage({action:'resolve',choices,body:document.getElementById('body')?.value??''});};window.addEventListener('message',event=>{if(event.data?.type==='result'){document.getElementById('status').textContent=event.data.message;save.disabled=event.data.saved===true;}});</script></body></html>`;
      let busy = false,
        saved = false;
      const handle = async (value: unknown) => {
        if (
          busy ||
          saved ||
          !this.panels.has(panel) ||
          !vscode.workspace.isTrusted
        )
          return;
        busy = true;
        try {
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw Error('Invalid merge message');
          const v = value as Record<string, unknown>;
          if (
            Object.keys(v).sort().join(',') !== 'action,body,choices' ||
            v.action !== 'resolve' ||
            !v.choices ||
            typeof v.choices !== 'object' ||
            Array.isArray(v.choices) ||
            typeof v.body !== 'string' ||
            v.body.length > 16000
          )
            throw Error('Invalid merge message');
          const choices = v.choices as Record<string, unknown>;
          if (
            Object.keys(choices).sort().join(',') !==
            [...review.conflicts].sort().join(',')
          )
            throw Error('请逐项处理所有冲突。');
          const resolutions: Record<string, unknown> = {};
          for (const field of review.conflicts) {
            const choice = choices[field];
            if (choice === 'current' || choice === 'proposed')
              resolutions[field] = review[choice][field];
            else if (field === 'body' && choice === 'manual' && v.body.trim())
              resolutions[field] = v.body;
            else throw Error('请明确选择每个冲突字段。');
          }
          if (
            vscode.workspace.textDocuments.some(
              (doc) =>
                doc.isDirty &&
                ['file', 'vscode-remote'].includes(doc.uri.scheme),
            )
          )
            throw Error('Save or discard unsaved editors first.');
          const result = await publication.createMergeDraft(
            id,
            token,
            resolutions,
          );
          saved = true;
          this.refresh();
          await panel.webview.postMessage({
            type: 'result',
            saved: true,
            message:
              '已保存处理后的草稿：' +
              result.draftId +
              '。请单独提交候选和审阅发布。',
          });
          return result;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Merge failed';
          await panel.webview.postMessage({
            type: 'result',
            saved: false,
            message,
          });
          return { error: true, message };
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
        conflicts: review.conflicts,
        close: () => panel.dispose(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Merge failed';
      void vscode.window.showErrorMessage('Repo Knowledge: ' + message);
      return { error: true, message };
    }
  }
  dispose() {
    for (const panel of this.panels) panel.dispose();
    this.panels.clear();
    this.disposables.forEach((item) => item.dispose());
  }
}
