import test from 'node:test';
import assert from 'node:assert/strict';
import { WikiConfirmation } from '../../packages/vscode-extension/dist/wiki-confirmation.js';
test('confirmation requires server-owned review, cancellation preserves it and context loss refuses commit', async () => {
  const c = new WikiConfirmation();
  let writes = 0;
  const commit = async () => {
    writes++;
  };
  await assert.rejects(
    c.confirm(
      async () => true,
      () => {},
      commit,
    ),
  );
  const review = { token: 'server-owned' };
  c.stage(review);
  assert.equal(
    (
      await c.confirm(
        async () => false,
        () => {},
        commit,
      )
    ).cancelled,
    true,
  );
  assert.equal(writes, 0);
  await c.confirm(
    async () => true,
    () => {},
    commit,
  );
  assert.equal(writes, 1);
  await assert.rejects(
    c.confirm(
      async () => true,
      () => {},
      commit,
    ),
  );
  c.stage(review);
  await assert.rejects(
    c.confirm(
      async () => {
        c.dispose();
        return true;
      },
      () => {},
      commit,
    ),
  );
  assert.equal(writes, 1);
});
