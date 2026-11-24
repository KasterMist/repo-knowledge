import type { Card } from '@repo-knowledge/core';
import { escapeHtml as e } from './home-view.js';

export function cardEditMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !== 'action,body,reason' ||
    !['submit', 'saveDraft', 'preview'].includes(String(v.action)) ||
    typeof v.body !== 'string' ||
    typeof v.reason !== 'string'
  )
    return;
  if (
    !v.body.trim() ||
    v.body.length > 16000 ||
    (v.action !== 'preview' && !v.reason.trim()) ||
    v.reason.length > 2000
  )
    return;
  return {
    action: v.action as 'submit' | 'saveDraft' | 'preview',
    body: v.body,
    reason: v.reason,
  };
}
export function cardEditHtml(
  card: Card,
  root: string,
  nonce: string,
  reason = '',
) {
  if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error('Invalid nonce');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px}textarea{display:block;box-sizing:border-box;width:100%;margin:12px 0;color:var(--vscode-input-foreground);background:var(--vscode-input-background);font:inherit}button{padding:8px}p{overflow-wrap:anywhere}</style></head><body><h1>编辑卡片正文</h1><p>${e(root)}</p><h2>${e(card.title)} · r${card.revision}</h2><p>保留 ID、类型和源码证据。只保存待审阅候选，正式知识不变；可先保存草稿，关闭后通过“恢复卡片正文草稿”继续。保存草稿不会提交候选或发布；未保存的输入仍会丢失。</p><label for="body">正文</label><textarea id="body" rows="18" maxlength="16000">${e(card.body)}</textarea><label for="reason">修改理由</label><textarea id="reason" rows="3" maxlength="2000">${e(reason)}</textarea><button id="preview">预览正文</button><section aria-label="正文预览"><p id="previewNotice">预览未生成；预览不会核验源码或保存知识。</p><div id="previewBody"></div></section><button id="saveDraft">保存草稿</button><button id="submit">保存待审阅候选</button><p id="status" role="status"></p><script nonce="${nonce}">const api=acquireVsCodeApi(),button=document.getElementById('submit');const draftButton=document.getElementById('saveDraft'),previewButton=document.getElementById('preview');document.getElementById('body').addEventListener('input',()=>{document.getElementById('previewNotice').textContent='正文已修改，请重新预览。';document.getElementById('previewBody').replaceChildren();});for(const [control,action] of [[button,'submit'],[draftButton,'saveDraft'],[previewButton,'preview']])control.addEventListener('click',()=>{button.disabled=true;draftButton.disabled=true;previewButton.disabled=true;document.getElementById('body').readOnly=true;document.getElementById('reason').readOnly=true;api.postMessage({action,body:document.getElementById('body').value,reason:document.getElementById('reason').value});});window.addEventListener('message',event=>{const m=event.data;if(m&&m.type==='preview'){document.getElementById('previewBody').innerHTML=m.html;document.getElementById('previewNotice').textContent='正文预览（未核验源码、未保存）';}if(m&&m.type==='result'){document.getElementById('body').readOnly=m.saved===true;document.getElementById('reason').readOnly=m.saved===true;previewButton.disabled=m.saved===true;document.getElementById('status').textContent=m.message;button.disabled=m.saved===true;draftButton.disabled=m.saved===true;}});</script></body></html>`;
}
