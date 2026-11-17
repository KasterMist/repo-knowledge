import type { Card } from '@repo-knowledge/core';
import { escapeHtml as e } from './home-view.js';

export function cardEditMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !== 'action,body,reason' ||
    v.action !== 'submit' ||
    typeof v.body !== 'string' ||
    typeof v.reason !== 'string'
  )
    return;
  if (
    !v.body.trim() ||
    v.body.length > 16000 ||
    !v.reason.trim() ||
    v.reason.length > 2000
  )
    return;
  return { body: v.body, reason: v.reason };
}
export function cardEditHtml(card: Card, root: string, nonce: string) {
  if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error('Invalid nonce');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px}textarea{display:block;box-sizing:border-box;width:100%;margin:12px 0;color:var(--vscode-input-foreground);background:var(--vscode-input-background);font:inherit}button{padding:8px}p{overflow-wrap:anywhere}</style></head><body><h1>编辑卡片正文</h1><p>${e(root)}</p><h2>${e(card.title)} · r${card.revision}</h2><p>保留 ID、类型和源码证据。只保存待审阅候选，正式知识不变；关闭前请保存候选，未提交内容不会持久保存。</p><label for="body">正文</label><textarea id="body" rows="18" maxlength="16000">${e(card.body)}</textarea><label for="reason">修改理由</label><textarea id="reason" rows="3" maxlength="2000"></textarea><button id="submit">保存待审阅候选</button><p id="status" role="status"></p><script nonce="${nonce}">const api=acquireVsCodeApi(),button=document.getElementById('submit');button.addEventListener('click',()=>{button.disabled=true;api.postMessage({action:'submit',body:document.getElementById('body').value,reason:document.getElementById('reason').value});});window.addEventListener('message',event=>{const m=event.data;if(m&&m.type==='result'){document.getElementById('status').textContent=m.message;button.disabled=m.saved===true;}});</script></body></html>`;
}
