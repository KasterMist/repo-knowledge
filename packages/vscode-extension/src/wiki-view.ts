import type { WikiArticleView, WikiPreviewReader } from '@repo-knowledge/core';
import { escapeHtml as e } from './home-view.js';
import { safeMarkdown } from './safe-markdown.js';

type Catalog = ReturnType<WikiPreviewReader['catalog']>;
export function wikiMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const data = value as Record<string, unknown>,
    keys = Object.keys(data).sort().join(',');
  if (
    keys === 'action' &&
    (data.action === 'refresh' || data.action === 'generate')
  )
    return { action: data.action as 'refresh' | 'generate' };
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
const generate = document.getElementById('generate');
if(generate?.dataset?.action === 'generate') generate.addEventListener('click',()=>api.postMessage({action:'generate'}));
document.querySelectorAll('button[data-article]').forEach(button => button.addEventListener('click', () => api.postMessage({ action: 'article', id: button.dataset.article })));
document.querySelectorAll('button[data-card]').forEach(button => button.addEventListener('click', () => api.postMessage({ action: 'evidence', cardId: button.dataset.card, index: Number(button.dataset.index), revision: button.dataset.revision })));
const search = document.getElementById('wiki-search');
if (typeof search?.value === 'string') search.addEventListener('input', () => {
  const query = search.value.trim().toLocaleLowerCase();
  for (const item of Array.from(document.querySelectorAll('li[data-wiki-entry]')).reverse()) item.hidden = !!query && !item.dataset.title.includes(query) && !Array.from(item.querySelectorAll('li[data-wiki-entry]')).some(child => !child.hidden);
  document.getElementById('search-empty').hidden = Array.from(document.querySelectorAll('li[data-wiki-entry]')).some(item => !item.hidden);
});
document.querySelectorAll('button[data-section]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.section)?.scrollIntoView({behavior:'smooth',block:'start'})));
document.getElementById('refresh').addEventListener('click', () => api.postMessage({ action: 'refresh' }));
`;
export function wikiHtml(
  catalog: Catalog,
  view: (Omit<WikiArticleView, 'preview'> & { preview: boolean }) | undefined,
  repository: string,
  host: string,
  nonce: string,
  error = '',
  candidate = false,
  published = false,
) {
  if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error('Invalid webview nonce');
  const tree = (parent: string | null): string =>
    `<ul>${catalog
      .filter((entry) => entry.parentId === parent)
      .map(
        (entry) =>
          `<li data-wiki-entry data-title="${e(entry.title.toLocaleLowerCase())}"><button type="button" data-article="${e(entry.id)}" ${entry.id === view?.article.id ? 'aria-current="page"' : ''}>${e(entry.title)}</button>${tree(entry.id)}</li>`,
      )
      .join('')}</ul>`;
  let content = published
    ? '<h1>为这个仓库建立 Repo Wiki</h1><p>生成后，你可以在左侧按章节浏览文章，点击阅读正文和源码证据。</p><p>先选择源码范围和预算，确认后生成待审阅内容，再单独发布到正式目录。</p><button id="generate" data-action="generate" type="button">选择范围并生成 Wiki…</button><p class="muted">如果已经生成候选，请在知识工作台审阅并确认发布；未发布内容不会混入正式文章。</p>'
    : '<p>请选择目录中的文章。没有文章时，请选择有效的文章预览文件。</p>';
  if (view) {
    const state = {
      current: '匹配引用的源码已核验',
      stale: candidate
        ? '源码或知识基线已变化，请复核候选'
        : '源码已变化或不可读取，请复核',
      unavailable: '卡片引用已变化或缺失，部分源码不可核验',
      unchecked: '尚无可核验的源码引用',
    }[view.sourceFreshness];
    content = `<h1>${e(view.article.title)}</h1><p>文章 r${view.article.revision} · ${e(view.article.language)} · ${e(state)}</p>${view.needsReview ? '<p class="warning">引用需复核；未替换成新版卡片正文。</p>' : ''}`;
    for (const section of view.sections) {
      content += `<section id="section-${e(section.id)}"><h2>${e(section.title)}</h2>`;
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
          content += `<div class="card"><h3>${e(block.card.title)}</h3><details class="fact-meta"><summary>共享知识卡片${sourceChanged ? ' · 源码需复核' : ''}</summary><p class="muted">${e(block.card.kind)} · ${e(block.card.id)} r${block.card.revision}</p></details>${safeMarkdown(block.card.body)}</div>`;
        } else
          content += `<p class="warning">${e(block.reference.cardId)}：${block.bindings[0]?.binding === 'missing' ? '卡片缺失' : '卡片已变化'}；请复核后重新绑定。</p>`;
      }
      content += '</section>';
      if (Buffer.byteLength(content, 'utf8') > 512 * 1024)
        throw new Error('WIKI_RENDER_LIMIT');
    }
    content += `<details class="source-details"><summary>源码证据${candidate ? '（候选只读；暂不导航）' : ''}</summary><ul>${view.evidence.map((entry) => `<li>${candidate ? `<span>${e(entry.path)}:${entry.startLine}–${entry.endLine}</span>` : `<button type="button" data-card="${e(entry.cardId)}" data-index="${entry.index}" data-revision="${e(view.snapshotRevision)}">${e(entry.path)}:${entry.startLine}–${entry.endLine}</button>`} · ${e(entry.status)}</li>`).join('')}</ul></details>`;
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

body { margin:0; padding:0; line-height:1.85; }
header { padding:14px 28px; } header .path { margin:4px 0;font-size:12px; } header .muted { font-size:12px;max-width:1100px; }
.layout { display:grid;grid-template-columns:260px minmax(0,880px) 180px;gap:0;min-height:75vh;justify-content:center; }
nav { padding:24px 16px;background:var(--vscode-sideBar-background);border-right:1px solid var(--vscode-panel-border);position:sticky;top:0;align-self:start;max-height:95vh;overflow:auto; }
.catalog-heading { font-size:13px;font-weight:600;letter-spacing:.6px;margin-bottom:18px; }
.search-label { display:block;font-size:12px;color:var(--vscode-descriptionForeground); }
input[type=search] { box-sizing:border-box;width:100%;font:inherit;padding:9px 10px;margin:6px 0 16px;border:1px solid var(--vscode-input-border,transparent);background:var(--vscode-input-background);color:var(--vscode-input-foreground); }
nav ul { margin:0;padding-left:14px; } nav>ul { padding-left:0; }
nav button { background:transparent;color:var(--vscode-foreground);border:0;margin:1px 0;padding:8px 10px;border-radius:4px;line-height:1.5; }
nav button:hover { background:var(--vscode-list-hoverBackground); } nav [aria-current] { background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);outline:none;border-left:3px solid var(--vscode-focusBorder); }
article { padding:32px 42px;min-width:0; } article h1 { font-size:30px;line-height:1.35;margin-top:0; } article h2 { font-size:23px;margin-top:36px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:8px; } article h3 { font-size:18px; }
.card { border:0;padding:0;margin:22px 0; } .note { background:var(--vscode-textBlockQuote-background);border-left:3px solid var(--vscode-textBlockQuote-border);padding:12px 18px; }
.fact-meta,.source-details { font-size:12px;color:var(--vscode-descriptionForeground); } summary { cursor:pointer; } .source-details { margin-top:36px;border-top:1px solid var(--vscode-panel-border);padding-top:16px; }
aside { padding:32px 12px;position:sticky;top:0;align-self:start;font-size:12px;border-left:1px solid var(--vscode-panel-border); } aside button { display:block;background:transparent;color:var(--vscode-descriptionForeground);text-align:left; }
section { scroll-margin-top:20px; } [hidden] { display:none !important; }
@media(max-width:1100px) { .layout {grid-template-columns:230px minmax(0,1fr);} aside{display:none;} }
@media(max-width:700px) { .layout{grid-template-columns:1fr;} nav{position:static;max-height:280px;} article{padding:24px;} }
</style></head><body><header><strong>Repo Wiki · ${published ? '已发布知识' : '未发布文章预览'}</strong><p class="path">${e(repository)} · ${e(host)}</p><p class="muted">${published ? '来自正式知识快照；刷新重新读取目录、正文和证据，不生成或修改知识。' : candidate ? '生成候选：事实仅来自同批未发布卡片，不是正式知识；正文需要人工核对。源码/基线变化时标为过期。' : '事实来自当前正式卡片；说明是未发布数据。'}正文链接/图片禁用。本页不迁移或发布知识。</p><button id="refresh" type="button">重新核验并刷新</button></header>
<div class="layout"><nav aria-label="文章目录"><div class="catalog-heading">REPO WIKI <span class="muted">· ${catalog.length} 篇</span></div><label class="search-label" for="wiki-search">搜索文章目录</label><input id="wiki-search" type="search" placeholder="搜索 Repo Wiki" aria-label="搜索 Repo Wiki"><p id="search-empty" hidden>没有匹配的文章</p>${tree(null)}</nav><article>${error ? `<p role="alert" class="warning">${e(error)}</p>` : content}</article><aside aria-label="本页目录"><strong>本页内容</strong>${view?.sections.map((section) => `<button type="button" data-section="section-${e(section.id)}">${e(section.title)}</button>`).join('') ?? ''}</aside></div><script nonce="${nonce}">${wikiClient}</script></body></html>`;
}
