# M1 acceptance and release gate

Date: 2026-10-22. Tracking: [Issue #3](https://github.com/KasterMist/repo-knowledge/issues/3). This document distinguishes implemented behavior, protocol evidence and actual Codex IDE evidence.

## Automated evidence

Run `npm ci`, `npm run check`, `npm run package:vsix`. Unit tests cover unknown schemas, duplicate IDs, bounded fields, traversal, stale evidence, CRLF normalization, missing/oversized stores, revision conflicts, immutable candidates and symlink containment. Integration tests launch the bundled server from a Unicode/space directory without node_modules, exercise all four tools with the official SDK client and reopen a fresh process. These do not invoke Codex or a model.

Local Windows checks passed 7 unit tests and 2 integration tests, including the extracted VSIX service. The actual VSIX also installed in an isolated Windows VS Code 1.117.0 profile and passed activation, six command registrations, snapshot editor access and Codex TOML preview using tests/extension-host.cjs. It did not exercise an official Codex conversation. Final commit and remote Windows/Linux results must be linked in the PR before merging. No native Linux desktop or real Codex IDE result is claimed by this record.

To repeat the host test, use `node scripts/run-host-check.mjs <Code-executable> <VS-Code-cli.js>` with your installed editor's paths. It creates an isolated profile under .tmp and keeps result.json for inspection; it does not use your normal profile or credentials. The runner disables workspace trust only in that disposable profile containing our demo. Use an actual trusted workspace for the separate official Codex acceptance below.

## Actual host acceptance (required on both platforms)

Record OS/architecture, VS Code version, official openai.chatgpt extension version, external Node version, source commit, VSIX SHA-256 and test date. Use the self-authored demo only. Remove local usernames, absolute personal paths, account details and credentials from evidence.

1. Install the actual VSIX in an isolated VS Code profile. Verify extension activation, demo opening, search results, snapshot access and standalone diagnostics.
2. Merge the generated MCP table into that environment's Codex config, restart Codex and confirm four tools are discoverable.
3. Ask a Codex conversation to call status, search “读取”, read read-fallback and explain the result using its current source excerpt. Check all three cards can be retrieved.
4. Ask Codex to clarify the empty-string case through propose_knowledge_update. Verify a pending proposal file exists and canonical knowledge.json is byte-identical.
5. Deliberately send the old/wrong base revision. Confirm REVISION_CONFLICT and no extra accepted proposal.
6. Start a genuinely new Codex conversation. Retrieve the same knowledge without copying the previous chat. This tests persisted knowledge reuse, not model training.
7. Edit only the copied demo source. Confirm changed/stale evidence. Confirm an update citing the old source hash is rejected. Restore the copied source afterward.
8. Test missing Node, unavailable store and malformed snapshot recovery. Record explicit tool calls separately from optional natural agent retrieval.

| Gate                                   | Windows native                 | Linux native               |
| -------------------------------------- | ------------------------------ | -------------------------- |
| Automated checks                       | Local passed; final CI pending | CI pending                 |
| Packaged extension isolated activation | Passed: VS Code 1.117.0, win32 | Pending                    |
| Official Codex four-tool loop          | Pending                        | Pending                    |
| Official Codex new-conversation reuse  | Pending                        | Pending                    |
| Alpha VSIX release                     | Blocked on host acceptance     | Blocked on host acceptance |

Do not close T09/T10 or label this as Qoder-equivalent integration before these results are recorded. A local candidate package is not an alpha release. No scheduled work, paid model CI or user credential collection is required.

## References

- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
- [Official TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)
- [VS Code extension bundling](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [VS Code extension testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
