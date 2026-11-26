import { escapeHtml as e } from './home-view.js';
export function impactAction(value: unknown, count: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !== 'action,index' ||
    !['edit', 'update'].includes(String(v.action)) ||
    !Number.isInteger(v.index) ||
    (v.index as number) < 0 ||
    (v.index as number) >= count
  )
    return;
  return { action: v.action as 'edit' | 'update', index: v.index as number };
}
export function impactHtml(
  cards: readonly { id: string; state: string }[],
  complete: boolean,
  nonce: string,
) {
  if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error('Invalid nonce');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:24px}li{margin:16px 0;overflow-wrap:anywhere}button{margin:6px;padding:6px}</style></head><body><h1>知识变化与维护</h1><p>范围覆盖：${complete ? '完整' : '不完整，不能据此排除遗漏影响'}。完整变化与证据见同时打开的 JSON 报告。</p><p>编辑只保存草稿或候选。生成更新前须先通过 Plan Knowledge Generation 审阅当前源码范围，随后另行确认发送；不会自动发布。状态是打开报告时的结果，源码可能继续变化。</p><ul>${cards.map((c, i) => `<li>${e(c.id)} · ${e(c.state)}<button data-action="edit" data-index="${i}">编辑正文</button><button data-action="update" data-index="${i}">生成单卡更新…</button></li>`).join('')}</ul><p id="status" role="status"></p><script nonce="${nonce}">const api=acquireVsCodeApi();for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>{for(const b of document.querySelectorAll('button'))b.disabled=true;api.postMessage({action:button.dataset.action,index:Number(button.dataset.index)});});window.addEventListener('message',event=>{if(event.data?.type==='result'){document.getElementById('status').textContent=event.data.message;for(const b of document.querySelectorAll('button'))b.disabled=false;}});</script></body></html>`;
}
