import test from 'node:test';
import assert from 'node:assert/strict';
import {
  impactAction,
  impactHtml,
} from '../../packages/vscode-extension/dist/impact-view.js';
test('impact maintenance actions use only bounded host-owned indexes and escape report content', () => {
  assert.deepEqual(impactAction({ action: 'update', index: 0 }, 1), {
    action: 'update',
    index: 0,
  });
  for (const value of [
    { action: 'publish', index: 0 },
    { action: 'edit', index: 1 },
    { action: 'edit', index: -1 },
    { action: 'edit', index: 0, path: 'other' },
    { action: 'edit', index: 0.5 },
    null,
  ])
    assert.equal(impactAction(value, 1), undefined);
  const html = impactHtml(
    [{ id: '<script>bad()</script>', state: '<img src=x>' }],
    false,
    'a'.repeat(32),
  );
  assert.doesNotMatch(html, /<script>bad|<img|command:/u);
  assert.match(html, /不完整/u);
  assert.match(html, /form-action 'none'/u);
});
