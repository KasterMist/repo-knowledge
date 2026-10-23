# M1 acceptance and release gate

Date: 2026-10-22. Tracking: [Issue #3](https://github.com/KasterMist/repo-knowledge/issues/3). This document distinguishes implemented behavior, protocol evidence and actual Codex IDE evidence.

## Automated evidence

Run `npm ci`, `npm run check`, `npm run package:vsix`. Unit tests cover unknown schemas, duplicate IDs, bounded fields, traversal, stale evidence, CRLF normalization, missing/oversized stores, revision conflicts, immutable candidates and symlink containment. Integration tests launch the bundled server from a Unicode/space directory without node_modules, exercise all four tools with the official SDK client and reopen a fresh process. These do not invoke Codex or a model.

Initial local Windows checks passed 7 unit tests and 2 integration tests, including the extracted VSIX service; the subsequent URI fix expanded the unit suite to 12 tests. The actual VSIX also installed in an isolated Windows VS Code 1.117.0 profile and passed activation, six command registrations, snapshot editor access and Codex TOML preview using tests/extension-host.cjs. That Windows host test did not exercise an official Codex conversation. The separately reported Remote SSH official Codex results below do not establish native Linux desktop or native Windows Codex acceptance.

To repeat the host test, use `node scripts/run-host-check.mjs <Code-executable> <VS-Code-cli.js>` with your installed editor's paths. It creates an isolated profile under .tmp and keeps result.json for inspection; it does not use your normal profile or credentials. The runner disables workspace trust only in that disposable profile containing our demo. Use an actual trusted workspace for the separate official Codex acceptance below.

## Actual host acceptance and first-alpha scope

On 2026-10-23 the maintainer explicitly selected Windows-native Codex plus Windows Remote SSH to Linux for the first alpha. Real Linux VS Code host CI validates the packaged editor on Linux; native Linux desktop Codex is still unverified and excluded from the first alpha's compatibility claim. It remains a future acceptance item. The Windows-native Codex and remaining Remote SSH/recovery/artifact/governance gates are unchanged.

Implementation commit `aff6cab794a2197197b802671d8908f575ad47fa` passed both Windows and Linux [CI run 39740920964](https://github.com/KasterMist/repo-knowledge/actions/runs/39740920964), including locked installation, shared checks, actual VSIX packaging and extracted-server tests. Both platform candidates and their SHA256SUMS were uploaded as workflow artifacts with seven-day retention. [PR #4](https://github.com/KasterMist/repo-knowledge/pull/4) contains the implementation. The subsequent Remote SSH URI fix passed Windows/Linux and Node 22.22.1 checks in [CI run 39760269686](https://github.com/KasterMist/repo-knowledge/actions/runs/39760269686). Remote IDE results are recorded below; native-platform manual gates remain separate.

Record OS/architecture, VS Code version, official openai.chatgpt extension version, external Node version, source commit, VSIX SHA-256 and test date. Use the self-authored demo only. Remove local usernames, absolute personal paths, account details and credentials from evidence.

1. Install the actual VSIX in an isolated VS Code profile. Verify extension activation, demo opening, search results, snapshot access and standalone diagnostics.
2. Merge the generated MCP table into that environment's Codex config, restart Codex and confirm four tools are discoverable.
3. Ask a Codex conversation to call status, search “读取”, read read-fallback and explain the result using its current source excerpt. Check all three cards can be retrieved.
4. Ask Codex to clarify the empty-string case through propose_knowledge_update. Verify a pending proposal file exists and canonical knowledge.json is byte-identical.
5. Deliberately send the old/wrong base revision. Confirm REVISION_CONFLICT and no extra accepted proposal.
6. Start a genuinely new Codex conversation. Retrieve the same knowledge without copying the previous chat. This tests persisted knowledge reuse, not model training.
7. Edit only the copied demo source. Confirm changed/stale evidence. Confirm an update citing the old source hash is rejected. Restore the copied source afterward.
8. Test missing Node, unavailable store and malformed snapshot recovery. Record explicit tool calls separately from optional natural agent retrieval.

| Gate                                   | Windows native                                     | Linux native                                     |
| -------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| Automated checks                       | Passed: CI run 39740920964                         | Passed: CI run 39740920964                       |
| Packaged extension isolated activation | Passed: VS Code 1.117.0, win32                     | Passed: VS Code 1.117.0, Xvfb CI run 39894411784 |
| Official Codex four-tool loop          | Passed: maintainer report and saved proposal check | Unverified; deferred for first alpha             |
| Official Codex new-conversation reuse  | Passed: maintainer report                          | Unverified; deferred for first alpha             |
| Official Codex stale/recovery          | Passed: direct MCP report, independent byte check  | Unverified; deferred for first alpha             |
| Alpha VSIX release                     | Pending versioning and publication                 | Desktop Codex excluded from alpha claim          |

Do not close T09/T10 before the scoped alpha gates are complete, or label this as Qoder-equivalent integration. In the table above, native Linux desktop Codex Pending means unverified and deferred under the explicit scope decision, rather than an additional first-alpha gate. A local candidate package is not an alpha release. No scheduled work, paid model CI or user credential collection is required.

## Remote SSH official Codex acceptance

The Remote SSH official Codex proposal/conflict check was reported successful. Read-only server verification confirmed the saved revision-2 candidate and byte-identical revision-1 canonical snapshot. The maintainer then reported successful retrieval of the revision-1 card in response to an explicit new-conversation test. Both the remote four-tool loop and new-conversation reuse are recorded. A separate remote SDK check verified stale detection, STALE_EVIDENCE rejection, exact source restoration and no snapshot/proposal mutation. The maintainer subsequently reported the same successful stale detection/rejection/restoration sequence in official Codex; a further independent SFTP check confirmed the restored source and unchanged canonical snapshot. These reports pass the remote official Codex retrieval, proposal/conflict, new-conversation and stale-recovery scenarios, with raw intermediate tool states remaining maintainer-reported.

Remote SSH from Windows to Linux is an additional required execution path, not implied by Linux runner success. See [Remote SSH evidence](remote-ssh-acceptance.md) and its [manual guide](../user/remote-ssh.zh-CN.md). The actual Remote SSH extension diagnostic also passed. These results do not establish native Windows or native Linux Codex acceptance. Windows-native evidence is recorded in the follow-up below; T10 remains open until the versioned artifact is published and verified.

## Editor error/recovery checks (2026-10-23)

An expanded real Windows VS Code 1.117.0 isolated-profile test first reproduced a diagnostic failure: a missing store returned only MCP error -32000: Connection closed, while Open Knowledge Snapshot correctly identified knowledge.json. Preflight snapshot validation now preserves the store error before starting MCP. Missing Node independently reproduced the same generic message; failed connections now point to repoKnowledge.nodeExecutable on the execution host and the bundled server installation. No raw child stderr, environment variables or user configuration are printed.

The actual rebuilt VSIX passed missing-store, malformed JSON, unknown schemaVersion and missing-node checks. Each case returned an actionable error and reconnected successfully after restoring its setting. Initialize External Store created an empty snapshot; a second initialization was rejected without changing bytes. Final configuration restoration and byte-identical original demo knowledge were checked. The full shared check also passed 12 unit and 2 integration tests.

Machine-scoped test settings may be changed only when REPO_KNOWLEDGE_ISOLATED_PROFILE=1 is set by the disposable-profile runner; remote fallback tests do not change a maintainer's global settings. The profile disables unrelated extensions, updates and AI features. No models, accounts or target-project code are involved. This validates command execution in a real editor host, not an official Codex conversation.

The editor-host CI matrix runs scripts/run-ci-host-check.mjs on Windows and Ubuntu: the pinned @vscode/test-electron 3.1.0 downloads VS Code 1.117.0, installs the actual VSIX into an isolated profile and runs the same host checks. Linux uses xvfb-run. Only sanitized result JSON is uploaded as a seven-day artifact; CI results must be checked before marking native Linux host acceptance complete. This follows Microsoft's [extension testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension) and [headless CI](https://code.visualstudio.com/api/working-with-extensions/continuous-integration) guidance.

The actual Linux editor-host job passed on implementation head 25908c6ed38c6bcf08d437c1829e232dd3e67cb4 in [run 39894411784](https://github.com/KasterMist/repo-knowledge/actions/runs/39894411784), including VSIX installation, real host commands, all recovery cases and non-overwriting initialization. Two CI setup failures were corrected first: create the download-cache parent in clean checkouts, and use the official test runner's Electron sandbox flags only for the disposable Linux GitHub Actions process. Product runtime and user sandbox settings are unchanged. This establishes native Linux packaged-editor acceptance; it does not establish native Linux official Codex conversation acceptance.

The maintainer also confirmed actual Remote SSH Search Cards (query “读取” and card selection), Open Knowledge Snapshot and Show Codex MCP Setup all opened their expected content while remaining connected to SSH. Open Three-Card Demo's new-window behavior and remote initialization still need explicit evidence. The maintainer confirmed there is no separate Linux desktop; the existing server/Remote SSH evidence does not satisfy the original native Linux Codex desktop gate. Any change to that release gate requires an explicit scope decision.

That scope decision was subsequently supplied as recorded at the start of this document. A Windows-native four-tool report was explicitly described as a direct STDIO protocol check, not use of tools exposed in an official Codex conversation; it therefore does not complete Windows-native Codex acceptance. Project-only configuration did not appear in the inspected CLI catalog; an explicit one-off server override did. The maintainer authorized a temporary user-level table restricted to the self-authored demo, with backup and removal after acceptance. This temporary handoff is not a plugin feature or an automatic edit of user settings. No claim is made that project trust alone explains the configuration-loading failure.

## Windows-native official Codex follow-up (2026-10-23)

After the maintainer-approved temporary MCP table was discovered by the official CLI and the Windows acceptance window was reloaded, the maintainer explicitly reported direct use of the conversation-exposed MCP tools, without a shell/SDK/STDIO substitute: status, Chinese search, all three current revision-1 cards, a pending revision-2 read-fallback proposal and REVISION_CONFLICT for baseRevision 2. The separate attempt with baseRevision 0 was rejected by parameter validation, not counted as the revision-conflict case. Independent filesystem inspection found proposal 3a962454-b279-4320-bb90-6025bc07b807 and confirmed the canonical revision-1 snapshot is byte-identical to the original fixture.

The maintainer also confirmed successful direct-tool retrieval in a separate new Windows conversation: read-fallback revision 1, stale=false/current. That conversation initially did not edit source because the acceptance wording restricted it to knowledge MCP tools, which intentionally have no source-write operation. This is an acceptance-instruction limitation, not a product stale-detection failure; the Windows IDE stale scenario remains pending until explicitly exercised. Native Linux desktop Codex remains excluded under the approved first-alpha scope.

### Windows stale/recovery completion and cleanup

The initial file-I/O attempts made no changes: the acceptance shell could not resolve the local demo path. The local maintainer tool therefore saved original bytes and temporarily changed only the self-authored fixture from ?? to ||. The official Codex conversation directly called MCP status/read and reported stale=true, changed evidence and the || excerpt; a proposal carrying the previously saved source hash returned STALE_EVIDENCE. No SDK/STDIO substitute was used for these Codex calls.

The maintainer tool restored the original bytes. An independent filesystem check confirmed the source matches the fixture, canonical knowledge.json still has SHA-256 2079e0d56b253b5e9e199592411f464df8094deb2d70998b068bd64bd88301e9 and the proposal count remains two (the prior protocol proposal and accepted Codex proposal). Codex then directly read read-fallback and confirmed revision=1, stale=false/current and the restored ?? excerpt. Intermediate MCP outcomes are maintainer-reported, while final byte/proposal checks were independently performed. No demo source was executed.

After acceptance, the authorized temporary user-level acceptance table was removed with a concurrency guard and parsed verification that unrelated configuration is preserved. The original private backup remains outside the repository. A fresh official CLI catalog returned success and no longer listed the acceptance server. This is cleanup evidence, not a fresh Codex conversation test. The temporary user-level handoff is not automatic plugin configuration; users still explicitly configure MCP.

T09 is complete for Windows-native Codex and Windows Remote SSH to Linux. M0 governance is complete with the evidence categories in the governance record. T10 remains pending versioning, release assets, checksums, public download and installation verification. Earlier pending statements above describe intermediate attempts and are superseded by this completion record. Native Linux desktop Codex remains unverified and excluded from this alpha claim.

## 0.1.0 release preparation (not publication)

Local full checks passed 15 unit tests and 2 integration tests, including release metadata rejection, tampered-payload detection, packaged manifest/server version 0.1.0 and immutable manual publication ordering. The actual 0.1.0 VSIX was installed in a disposable Windows VS Code 1.117.0 profile; activation, six commands, standalone MCP, all four error recoveries and non-overwriting initialization passed. This runner does not repeat or claim a new official Codex conversation. The GitHub release workflow and public download/install jobs still require actual execution before T10 is complete.

## References

- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
- [Official TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)
- [VS Code extension bundling](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [VS Code extension testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
