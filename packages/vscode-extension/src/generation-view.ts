import { escapeHtml } from './home-view.js';
import { generationDefaults } from './generation-session.js';

// Kept as a separate pure string so the shipped browser event loop can be tested offline.
export const generationClient = `
const api = acquireVsCodeApi();
const form = document.getElementById('generation-form');
const fields = ['include', 'exclude', 'language', 'maxFiles', 'maxKiB', 'maxPages'];
const read = () => Object.fromEntries(fields.map(name => [name, document.getElementById(name).value]));
let plan;
function invalidate() {
  plan = undefined;
  document.getElementById('generate').disabled = true;
  document.getElementById('summary').textContent = '表单已变更，请重新预览。';
  document.getElementById('files').replaceChildren();
  api.postMessage({ action: 'invalidate' });
}
form.addEventListener('input', invalidate);
form.addEventListener('change', invalidate);
form.addEventListener('submit', event => { event.preventDefault(); api.postMessage({ action: 'preview', form: read() }); });
document.getElementById('generate').addEventListener('click', () => {
  if (plan) api.postMessage({ action: 'generate', form: read(), planId: plan.id });
});
for (const action of ['cancel', 'recover', 'review'])
  document.getElementById(action).addEventListener('click', () => api.postMessage({ action }));
window.addEventListener('message', event => {
  const state = event.data;
  if (state?.type !== 'generation-state') return;
  const labels = { idle: '请填写范围并预览。', scanning: '正在静态扫描，未调用模型…', previewed: '请检查下方文件清单。', confirming: '等待源码发送确认…', running: '正在生成候选，可取消；尚未发布…', recovering: '正在检查已有任务；仅明确重试后才调用模型…', finished: '操作完成；如有候选，请另行审阅发布。', cancelled: '操作已取消。', failed: '操作失败，未自动重试或发布。' };
  document.getElementById('status').textContent = labels[state.phase] || state.phase;
  fields.forEach(name => document.getElementById(name).disabled = state.busy);
  ['preview', 'recover', 'review'].forEach(name => document.getElementById(name).disabled = state.busy);
  document.getElementById('cancel').disabled = !state.busy;
  plan = state.phase === 'previewed' ? state.plan : undefined;
  document.getElementById('generate').disabled = state.busy || !plan || plan.summary.limited || !plan.files.length;
  document.getElementById('error').textContent = state.error || '';
  document.getElementById('result').textContent = state.result ? JSON.stringify(state.result, null, 2) : '';
  if (plan) {
    document.getElementById('summary').textContent = plan.files.length + ' 个文件 · ' + plan.summary.selectedBytes + ' bytes · ' + (plan.summary.limited ? '覆盖不完整，请缩小范围后重新预览' : '覆盖完整') + ' · 跳过统计 ' + JSON.stringify(plan.summary.skipped);
    const items = plan.files.map(file => {
      const item = document.createElement('li');
      item.textContent = file.path + ' · ' + file.bytes + ' bytes';
      return item;
    });
    document.getElementById('files').replaceChildren(...items);
  } else if (!state.busy) {
    document.getElementById('summary').textContent = '重新生成前请重新预览。';
    document.getElementById('files').replaceChildren();
  }
});`;

export function generationHtml(
  repository: string,
  host: string,
  nonce: string,
) {
  if (!/^[a-f0-9]{32}$/u.test(nonce)) throw new Error('Invalid webview nonce');
  const input = (
    name: keyof typeof generationDefaults,
    title: string,
    extra = '',
  ) =>
    `<label for="${name}">${title}</label><input id="${name}" name="${name}" value="${escapeHtml(generationDefaults[name])}" ${extra}>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<title>生成知识候选</title><style nonce="${nonce}">
body { font-family:var(--vscode-font-family); color:var(--vscode-foreground); background:var(--vscode-editor-background); max-width:960px; margin:auto; padding:24px; }
p { line-height:1.65; } .path, li, pre { overflow-wrap:anywhere; } pre { white-space:pre-wrap; } .muted { color:var(--vscode-descriptionForeground); }
form { display:grid; grid-template-columns:minmax(160px, 1fr) minmax(180px, 3fr); gap:14px; padding:20px; border:1px solid var(--vscode-panel-border); }
input, select { font:inherit; min-width:0; color:var(--vscode-input-foreground); background:var(--vscode-input-background); border:1px solid var(--vscode-input-border, transparent); padding:8px; }
button { font:inherit; cursor:pointer; color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:1px solid transparent; padding:9px 14px; margin:4px 8px 4px 0; }
button:hover { background:var(--vscode-button-hoverBackground); } button:disabled { opacity:.5; cursor:default; } :focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
#error { color:var(--vscode-errorForeground); } #files { max-height:320px; overflow:auto; } .full { grid-column:1 / -1; }
@media (max-width:600px) { form { grid-template-columns:1fr; } }
</style></head><body><h1>生成知识候选 / Generate knowledge</h1>
<p class="path">${escapeHtml(repository)}</p><p class="muted">${escapeHtml(host)}</p>
<p>填写范围，预览并检查源码清单，再确认发送给当前模型。仅生成 Agent 卡片候选；独立 Wiki 文章生成尚在开发。</p>
<form id="generation-form">
${input('include', '包含范围 / Include', 'required maxlength="8192"')}
${input('exclude', '排除范围 / Exclude', 'maxlength="8192"')}
<label for="language">语言 / Language</label><select id="language"><option value="zh-CN">简体中文</option><option value="en">English</option></select>
${input('maxFiles', '最多文件数', 'type="number" min="1" max="200" required')}
${input('maxKiB', '总读取上限 KiB', 'type="number" min="1" max="2048" required')}
<label for="maxPages">最多候选卡片</label><select id="maxPages"><option value="2">2</option><option value="4">4</option><option value="8">8</option></select>
<p class="full muted">相对 POSIX glob，以逗号分隔，支持 *、**、?。每文件最多 64 KiB，敏感路径和符号链接始终排除。单次模型任务最多 60 秒，输出上限 64 KiB；不是精确费用上限。</p>
<div class="full"><button id="preview" type="submit">预览源码范围</button></div></form>
<h2>本次源码清单</h2><p id="summary">尚未扫描；打开页面不会请求模型。</p><ul id="files"></ul>
<button id="generate" type="button" disabled>确认并生成候选</button><button id="cancel" type="button" disabled>取消当前操作</button>
<button id="recover" type="button">找回结果 / 明确重试</button><button id="review" type="button">查看新增待审阅</button>
<p id="status" role="status" aria-live="polite">请填写范围并预览。</p><pre id="error" role="alert"></pre><pre id="result"></pre>
<p class="muted">预览只静态读取文件。生成前另有源码发送确认；已有结果的找回不请求模型，无结果时重试需要再次确认。候选必须另行审阅并确认发布。关闭页面会取消该页面的活动任务，已保存结果仍可找回。</p>
<script nonce="${nonce}">${generationClient}</script></body></html>`;
}
