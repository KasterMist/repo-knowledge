import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wikiReviewHtml,
  wikiReviewMessage,
} from '../../packages/vscode-extension/dist/wiki-review-view.js';
test('graphical Wiki review escapes repository data and refuses mutation/path messages', () => {
  for (const message of [
    { action: 'publish' },
    { action: 'migration', path: 'x' },
    { action: 'candidate', id: '../escape' },
    null,
    { action: 'rollback', id: 'a'.repeat(36), command: 'exec' },
  ])
    assert.equal(wikiReviewMessage(message), undefined);
  assert.equal(wikiReviewMessage({ action: 'migration' }).action, 'migration');
  const html = wikiReviewHtml(
    '<script>bad()</script>',
    [{ id: '00000000-0000-4000-8000-000000000001', title: '<img src=x>' }],
    [],
    'a'.repeat(32),
  );
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(html.includes("default-src 'none'"));
  assert.doesNotMatch(html, /innerHTML|command:|data-action="publish"/u);
  assert.match(html, /只读审阅/u);
  const target = wikiReviewHtml('fixture', [], [], 'a'.repeat(32), {
    operation: 'create-wiki',
    reason: '<img src=x>',
    retainedMetadata: { entries: 1, revision: 'x' },
    before: { schemaVersion: 1, cards: [] },
    after: {
      schemaVersion: 2,
      cards: [
        {
          title: '<script>title</script>',
          revision: 1,
          body: '**review** <script>bad()</script>',
        },
      ],
      articles: [],
    },
  });
  assert.match(target, /当前/u);
  assert.match(target, /审阅目标（尚未写入）/u);
  assert.match(target, /<strong>review<\/strong>/u);
  assert.doesNotMatch(target, /<script>bad|<img src=x>/u);
});
