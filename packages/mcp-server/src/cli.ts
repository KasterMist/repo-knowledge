import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KnowledgeStore } from '@repo-knowledge/core';
import { createServer } from './index.js';

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== '--repository' ||
    args[2] !== '--store' ||
    !args[1] ||
    !args[3]
  )
    throw new Error(
      'Usage: node server.cjs --repository <absolute-path> --store <absolute-path>',
    );
  const store = new KnowledgeStore(args[1], args[3]);
  await store.snapshot();
  const server = createServer(store);
  const close = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await server.connect(new StdioServerTransport());
}
main().catch(() => {
  process.stderr.write(
    'Repo Knowledge startup failed. Check Node version, absolute --repository/--store paths and schemaVersion 1 knowledge.json.\n',
  );
  process.exitCode = 1;
});
