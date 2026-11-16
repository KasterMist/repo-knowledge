import type { WikiReview } from '@repo-knowledge/core';
import { escapeHtml as e } from './home-view.js';
import { safeMarkdown } from './safe-markdown.js';

export function wikiReviewMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).join(',') === 'action' &&
    (v.action === 'migration' ||
      v.action === 'confirm' ||
      v.action === 'refresh')
  )
    return { action: v.action as 'migration' | 'confirm' | 'refresh' };
  if (
    Object.keys(v).sort().join(',') === 'action,id' &&
    ['candidate', 'rollback'].includes(String(v.action)) &&
    typeof v.id === 'string' &&
    /^[a-f0-9-]{36}$/u.test(v.id)
  )
    return { action: v.action as 'candidate' | 'rollback', id: v.id };
  return;
}
export const wikiReviewClient = `const api=acquireVsCodeApi(); document.querySelectorAll('button[data-action]').forEach(b=>b.addEventListener('click',()=>api.postMessage(b.dataset.id?{action:b.dataset.action,id:b.dataset.id}:{action:b.dataset.action})));`;
export function wikiReviewHtml(
  root: string,
  candidates: { id: string; title: string }[],
  history: { id: string; title: string; actionable?: boolean }[],
  nonce: string,
  review?: WikiReview,
  error = '',
) {
  if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error('Invalid nonce');
  const list = (
    items: { id: string; title: string; actionable?: boolean }[],
    action: string,
  ) =>
    items
      .map((item) =>
        item.actionable === false
          ? `<p>${e(item.title)}（历史记录）</p>`
          : `<button data-action="${action}" data-id="${e(item.id)}">${e(item.title)}</button>`,
      )
      .join('') || '<p>没有条目。</p>';
  const side = (snapshot: WikiReview['before']) =>
    `<p>格式 ${snapshot.schemaVersion} · ${snapshot.cards.length} 张卡片 · ${snapshot.schemaVersion === 2 ? snapshot.articles.length : 0} 篇文章</p>${snapshot.cards.map((card) => `<section><h3>${e(card.title)} · r${card.revision}</h3>${safeMarkdown(card.body)}</section>`).join('')}${snapshot.schemaVersion === 2 ? snapshot.articles.map((article) => `<section><h3>${e(article.title)} · r${article.revision}</h3>${article.sections.map((section) => `<h4>${e(section.title)}</h4>${section.blocks.map((block) => (block.type === 'card' ? `<p>共享卡片：${e(block.reference.cardId)} · r${block.reference.revision}</p>` : `<p>${e(block.kind)} / ${e(block.author)}</p>${safeMarkdown(block.body)}`)).join('')}`).join('')}</section>`).join('') : ''}`;
  const content = review
    ? `<h2>${e(review.operation)}</h2><p>${e(review.reason)}</p><p>保留元数据 ${review.retainedMetadata.entries} 项；${review.adaptedFromMigration ? '旧候选已按迁移记录重新核验。' : ''}</p><div class="columns"><div><h2>当前</h2>${side(review.before)}</div><div><h2>审阅目标（尚未写入）</h2>${side(review.after)}</div></div>`
    : '<p>选择操作查看当前与目标的差异。</p>';
  if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024)
    throw new Error('WIKI_REVIEW_LIMIT');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;overflow-wrap:anywhere}button{font:inherit;margin:6px;padding:8px;color:var(--vscode-button-foreground);background:var(--vscode-button-background)}.columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{border:1px solid var(--vscode-panel-border);padding:12px;margin:12px 0}pre{white-space:pre-wrap}@media(max-width:700px){.columns{grid-template-columns:1fr}}</style></head><body><h1>Wiki 图形审阅</h1><p>${e(root)}</p><p>先审阅，再点击独立确认并接受弹窗；取消不写入。打开页面和审阅不会调用模型。</p><button data-action="refresh">刷新候选与历史</button><button data-action="migration">审阅格式迁移</button><h2>文章＋卡片候选</h2>${list(candidates, 'candidate')}<h2>历史回退目标</h2>${list(history, 'rollback')}<p role="alert">${e(error)}</p>${content}${review ? '<button data-action="confirm">确认已审阅目标 / Confirm reviewed target</button>' : ''}<script nonce="${nonce}">${wikiReviewClient}</script></body></html>`;
}
