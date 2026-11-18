import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardEditHtml,
  cardEditMessage,
} from '../../packages/vscode-extension/dist/card-edit-view.js';
test('card editor accepts only body/reason and escapes stored text without command or identity injection', () => {
  for (const value of [
    null,
    { action: 'submit', body: 'x', reason: 'r', id: 'other' },
    { action: 'submit', body: '', reason: 'r' },
    { action: 'submit', body: 'x'.repeat(16001), reason: 'r' },
    { action: 'publish', body: 'x', reason: 'r' },
  ])
    assert.equal(cardEditMessage(value), undefined);
  assert.deepEqual(
    cardEditMessage({ action: 'submit', body: '正文', reason: '澄清' }),
    { action: 'submit', body: '正文', reason: '澄清' },
  );
  const html = cardEditHtml(
    { title: '<img>', revision: 1, body: '</textarea><script>bad()</script>' },
    '<root>',
    'a'.repeat(32),
  );
  assert.match(html, /&lt;\/textarea&gt;/u);
  assert.doesNotMatch(html, /<script>bad|<img>|command:/u);
  assert.match(html, /form-action 'none'/u);
});

test('saved draft action is distinct from candidate submission', () => {
  assert.deepEqual(
    cardEditMessage({ action: 'saveDraft', body: '保存', reason: '稍后继续' }),
    { action: 'saveDraft', body: '保存', reason: '稍后继续' },
  );
  assert.equal(
    cardEditMessage({
      action: 'saveDraft',
      body: '保存',
      reason: '理由',
      path: 'elsewhere',
    }),
    undefined,
  );
});
