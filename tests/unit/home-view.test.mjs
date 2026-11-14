import test from 'node:test';
import assert from 'node:assert/strict';
import {
  homeAction,
  homeActions,
  homeHtml,
} from '../../packages/vscode-extension/dist/home-view.js';

test('home messages accept only explicit bounded actions, never commands or paths', () => {
  for (const action of Object.keys(homeActions))
    assert.equal(homeAction({ action }), action);
  for (const value of [
    null,
    [],
    'generate',
    { action: 'constructor' },
    { action: '__proto__' },
    { action: 'workbench.action.terminal.new' },
    { action: 'plan', path: '../secret' },
    { command: 'repoKnowledge.generateKnowledge' },
  ])
    assert.equal(homeAction(value), undefined);
  assert.equal(homeActions.plan, 'repoKnowledge.openGenerationPanel');
  assert.equal(
    homeAction(
      Object.assign(Object.create({ action: 'plan' }), { path: 'outside' }),
    ),
    undefined,
  );
});

test('home escapes repository data and permits only nonce scripts with no network/resources', () => {
  const html = homeHtml(
    {
      repository: '</p><script>alert(1)</script>',
      host: 'ssh-remote & linux',
      cardCount: 3,
      revision: '"snapshot"',
      problem: '<img src=x onerror=alert(2)>',
    },
    'a'.repeat(32),
  );
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(2)&gt;'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /default-src 'none'/u);
  assert.match(html, /form-action 'none'/u);
  assert.doesNotMatch(html, /https?:|command:|unsafe-inline|eval\(/u);
  assert.match(html, /textContent/u);
  assert.match(html, /role="status"/u);
  assert.throws(() =>
    homeHtml(
      { repository: '', host: '', cardCount: 0, revision: '', problem: '' },
      '" onclick=alert(1)',
    ),
  );
});
