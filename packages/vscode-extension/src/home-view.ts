// Pure rendering/message boundary: repository text never becomes HTML or a command.
export const homeActions = {
  plan: 'repoKnowledge.planGeneration',
  generate: 'repoKnowledge.generateKnowledge',
  recover: 'repoKnowledge.recoverGeneration',
  wiki: 'repoKnowledge.wiki.focus',
  cards: 'repoKnowledge.cards.focus',
  proposals: 'repoKnowledge.creations.focus',
} as const;
export type HomeAction = keyof typeof homeActions;
export function homeAction(message: unknown): HomeAction | undefined {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return;
  const value = message as Record<string, unknown>;
  if (
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, 'action') ||
    typeof value.action !== 'string'
  )
    return;
  if (Object.hasOwn(homeActions, value.action))
    return value.action as HomeAction;
  return;
}
export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
export interface HomeState {
  repository: string;
  host: string;
  cardCount: number;
  revision: string;
  problem: string;
}
export function homeHtml(state: HomeState, nonce: string): string {
  if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error('Invalid webview nonce');
  const button = (action: HomeAction, text: string) =>
    `<button type="button" data-action="${action}">${escapeHtml(text)}</button>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<title>Repo Knowledge</title><style nonce="${nonce}">
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; max-width: 960px; margin: auto; }
h1 { font-size: 26px; } h2 { font-size: 19px; } p { line-height: 1.65; } .muted { color: var(--vscode-descriptionForeground); } .path { overflow-wrap: anywhere; }
section { border: 1px solid var(--vscode-panel-border); padding: 20px; margin: 16px 0; border-radius: 6px; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid transparent; padding: 9px 14px; margin: 4px 8px 4px 0; cursor: pointer; font: inherit; }
button:hover { background: var(--vscode-button-hoverBackground); } button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; } button:disabled { opacity: .55; cursor: wait; }
#status { min-height: 1.5em; } .problem { color: var(--vscode-errorForeground); }
</style></head><body>
<h1>Repo Knowledge</h1><p>代码库知识工作台 · Repository knowledge</p>
<p class="path">${escapeHtml(state.repository)}</p><p class="muted">${escapeHtml(state.host)}</p>
<p class="problem">${escapeHtml(state.problem)}</p>
<section><h2>共享知识 / Shared knowledge</h2><p>正式卡片 ${state.cardCount} 张 · 快照 <span class="path">${escapeHtml(state.revision || '尚未读取')}</span></p>
${button('wiki', 'Repo Wiki · 源码范围导航')}${button('cards', 'Agent 知识卡片')}
<p class="muted">目前 Wiki 使用卡片的源码范围导航；独立文章目录与阅读器尚在开发。</p></section>
<section><h2>生成知识 / Generate knowledge</h2><p>先选择范围并检查源码清单，再明确确认发送给当前模型。生成结果只保存为待审阅候选。</p>
${button('plan', '1. 选择范围与预览')}${button('generate', '2. 生成卡片候选')}${button('proposals', '3. 查看新增待审阅')}
<p class="muted">本阶段按钮复用现有向导。打开主页不会启动模型；候选不会自动发布。</p>
${button('recover', '找回结果 / 明确重试')}</section>
<p id="status" role="status" aria-live="polite"></p>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
document.querySelectorAll('button[data-action]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('button').forEach(item => item.disabled = true);
  document.getElementById('status').textContent = '正在打开所选操作…';
  api.postMessage({ action: button.dataset.action });
}));
window.addEventListener('message', event => {
  if (event.data?.type !== 'finished') return;
  document.querySelectorAll('button').forEach(item => item.disabled = false);
  document.getElementById('status').textContent = event.data.failed ? '操作未完成，请查看编辑器提示。' : '操作已结束。再次打开主页可刷新知识状态。';
});
</script></body></html>`;
}
