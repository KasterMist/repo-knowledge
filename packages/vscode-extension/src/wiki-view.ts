import type { WikiArticleView, WikiPreviewReader } from '@repo-knowledge/core';
import { escapeHtml as e } from './home-view.js';
import { safeMarkdown } from './safe-markdown.js';

type Catalog = ReturnType<WikiPreviewReader['catalog']>;
export function wikiMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const data = value as Record<string, unknown>,
    keys = Object.keys(data).sort().join(',');
  if (keys === 'action' && data.action === 'refresh')
    return { action: 'refresh' as const };
  if (
    keys === 'action,id' &&
    data.action === 'article' &&
    typeof data.id === 'string' &&
    /^[a-z][a-z0-9-]{0,63}$/u.test(data.id)
  )
    return { action: 'article' as const, id: data.id };
  if (
    keys === 'action,cardId,index,revision' &&
    data.action === 'evidence' &&
    typeof data.cardId === 'string' &&
    /^[a-z][a-z0-9-]{0,63}$/u.test(data.cardId) &&
    Number.isInteger(data.index) &&
    Number(data.index) >= 0 &&
    Number(data.index) < 10 &&
    typeof data.revision === 'string' &&
    /^[a-f0-9]{64}$/u.test(data.revision)
  )
    return {
      action: 'evidence' as const,
      cardId: data.cardId,
      index: data.index as number,
      revision: data.revision,
    };
  return;
}
export const wikiClient = `
const api = acquireVsCodeApi();
document.querySelectorAll('button[data-article]').forEach(button => button.addEventListener('click', () => api.postMessage({ action: 'article', id: button.dataset.article })));
document.querySelectorAll('button[data-card]').forEach(button => button.addEventListener('click', () => api.postMessage({ action: 'evidence', cardId: button.dataset.card, index: Number(button.dataset.index), revision: button.dataset.revision })));
document.getElementById('refresh').addEventListener('click', () => api.postMessage({ action: 'refresh' }));
`;
export function wikiHtml(
  catalog: Catalog,
  view: WikiArticleView | undefined,
  repository: string,
  host: string,
  nonce: string,
  error = '',
) {
  if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error('Invalid webview nonce');
  const tree = (parent: string | null): string =>
    `<ul>${catalog
      .filter((entry) => entry.parentId === parent)
      .map(
        (entry) =>
          `<li><button type="button" data-article="${e(entry.id)}" ${entry.id === view?.article.id ? 'aria-current="page"' : ''}>${e(entry.title)}</button>${tree(entry.id)}</li>`,
      )
      .join('')}</ul>`;
  let content =
    '<p>请选择目录中的文章。没有文章时，请选择有效的文章预览文件。</p>';
  if (view) {
    const state = {
      current: '匹配引用的源码已核验',
      stale: '源码已变化或不可读取，请复核',
      unavailable: '卡片引用已变化或缺失，部分源码不可核验',
      unchecked: '尚无可核验的源码引用',
    }[view.sourceFreshness];
    content = `<h1>${e(view.article.title)}</h1><p>文章 r${view.article.revision} · ${e(view.article.language)} · ${e(state)}</p>${view.needsReview ? '<p class="warning">引用需复核；未替换成新版卡片正文。</p>' : ''}`;
    for (const section of view.sections) {
      content += `<section><h2>${e(section.title)}</h2>`;
      for (const block of section.blocks) {
        const changed = block.bindings.some(
          (binding) => binding.binding !== 'matches',
        );
        if (block.type === 'note') {
          const label = {
            context: '上下文说明',
            inference: '推测，待验证',
            rationale: '人工设计理由记录，非源码证明',
          }[block.kind];
          content += `<div class="note"><p class="muted">${e(label)} · ${block.author === 'model' ? '模型标注' : '人工标注'}（作者身份未认证）${changed ? ' · 引用需复核' : ''}</p>${safeMarkdown(block.body)}</div>`;
        } else if ('card' in block && block.card) {
          const sourceChanged = view.evidence.some(
            (entry) =>
              entry.cardId === block.reference.cardId &&
              entry.status !== 'current',
          );
          content += `<div class="card"><h3>${e(block.card.title)}</h3><p class="muted">${e(block.card.kind)} · ${e(block.card.id)} r${block.card.revision}${sourceChanged ? ' · 源码过期/不可用' : ''}</p>${safeMarkdown(block.card.body)}</div>`;
        } else
          content += `<p class="warning">${e(block.reference.cardId)}：${block.bindings[0]?.binding === 'missing' ? '卡片缺失' : '卡片已变化'}；请复核后重新绑定。</p>`;
      }
      content += '</section>';
      if (Buffer.byteLength(content, 'utf8') > 512 * 1024)
        throw new Error('WIKI_RENDER_LIMIT');
    }
    content += `<h2>源码证据</h2><ul>${view.evidence.map((entry) => `<li><button type="button" data-card="${e(entry.cardId)}" data-index="${entry.index}" data-revision="${e(view.snapshotRevision)}">${e(entry.path)}:${entry.startLine}–${entry.endLine}</button> · ${e(entry.status)}</li>`).join('')}</ul>`;
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<title>Repo Wiki 预览</title><style nonce="${nonce}">
body { font-family:var(--vscode-font-family); color:var(--vscode-foreground); background:var(--vscode-editor-background); padding:20px; line-height:1.6; }
header { border-bottom:1px solid var(--vscode-panel-border); } .layout { display:grid; grid-template-columns:240px minmax(0,1fr); gap:28px; } nav ul { padding-left:16px; list-style:none; } nav button { text-align:left; width:100%; }
button { font:inherit; color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:1px solid transparent; padding:6px 10px; margin:4px 0; cursor:pointer; } button:hover { background:var(--vscode-button-hoverBackground); } [aria-current] { outline:2px solid var(--vscode-focusBorder); } :focus-visible { outline:2px solid var(--vscode-focusBorder); }
.muted { color:var(--vscode-descriptionForeground); } .warning { color:var(--vscode-errorForeground); } .path,article { overflow-wrap:anywhere; } .card,.note { border-left:3px solid var(--vscode-panel-border); padding-left:14px; margin:16px 0; }
pre { overflow:auto; padding:12px; background:var(--vscode-textCodeBlock-background); } code { font-family:var(--vscode-editor-font-family); } table { border-collapse:collapse; } td,th { border:1px solid var(--vscode-panel-border); padding:6px; } blockquote { border-left:3px solid var(--vscode-panel-border); padding-left:12px; } .disabled-link { text-decoration:underline dotted; }
@media(max-width:700px) { .layout { grid-template-columns:1fr; } }
</style></head><body><header><strong>Repo Wiki · 未发布文章预览</strong><p class="path">${e(repository)} · ${e(host)}</p><p class="muted">事实来自当前正式卡片；说明是未发布数据。正文链接/图片禁用。未迁移或发布知识。</p><button id="refresh" type="button">重新核验并刷新</button></header>
<div class="layout"><nav aria-label="文章目录">${tree(null)}</nav><article>${error ? `<p role="alert" class="warning">${e(error)}</p>` : content}</article></div><script nonce="${nonce}">${wikiClient}</script></body></html>`;
}
