# Remote SSH implementation and evidence

Date: 2026-10-22. Tracking: [Issue #5](https://github.com/KasterMist/repo-knowledge/issues/5), parent [M1 #3](https://github.com/KasterMist/repo-knowledge/issues/3).

## Observed environment

The maintainer-provided SSH server is Linux x86_64 with Python 3.12.3, VS Code Server and its Node 22.22.1. npm is not present on the inspected noninteractive PATH. Official Codex extension 26.51007.21434 is installed remotely and a remote Codex backend executable is running. This establishes deployment evidence, not MCP tool use in a Codex conversation.

Connection used the local credential file only inside an ignored helper, and verified the server key against existing known_hosts. Credentials, server address, account paths, SSH logs and user configuration are intentionally absent from this public report. No target project was read or executed. All remote writes are limited to the self-authored acceptance demo/cache and installation of this project's candidate extension.

## Passed

- Local Windows shared checks: 11 unit tests and 2 process/actual-VSIX tests, including host isolation, internal vscode-userdata storage and native-path regressions.
- Actual Windows VS Code 1.117.0 isolated-profile candidate: activation, six commands, snapshot editor, Codex TOML preview and a real standalone MCP diagnostic child process.
- Authenticated SSH to actual Linux Node 22.22.1: official SDK handshake, four tools, three cards and source excerpts. Two separate server processes retrieved the same canonical knowledge and each saved a pending proposal; incorrect base revision returned REVISION_CONFLICT.
- Remote canonical knowledge.json remained byte-identical to the original demo after proposals. The candidate installed into the remote VS Code Server. Only the new demo's project-level MCP table was prepared; user-level Codex configuration was not edited.

## User-reported URI regression and fix

The actual Remote SSH diagnostic command exposed "Cannot identify the SSH authority for editor file routing." The remote extension host legitimately receives file URIs without a client-side authority. The original unit fixture used untransformed vscode-remote URIs and missed this case. A new regression test reproduced the exact message before the fix and passes afterward. Snapshot/demo opening now submits Uri.file to the VS Code API; VS Code performs the client/server URI transform. The real-host runner also checks file URIs as seen by the remote extension host. See ADR 0003 for the corrected contract. The updated full checks passed 12 unit tests and 2 integration tests, and the exact host-resolution case also passed on the actual Linux Node 22.22.1 runtime.

After installing the fix and reloading the Remote SSH window, the maintainer reported a successful actual VS Code diagnostic: STDIO handshake completed, four tools discovered, execution host ssh-remote/Linux with Node 22.22.1, and the new extension-host file routing message. The official Codex extension was visible as kind=2, scheme=file, version 26.51007.21434. The self-authored demo returned schemaVersion 1 and all three revision-1 cards with stale=false. Personal Node/account paths from the submitted output are omitted. This confirms the real Remote SSH extension diagnostic, not knowledge tool use by an official Codex conversation. Snapshot/demo UI opening and the separate Codex conversation gates still need evidence.

## Maintainer-reported official Codex retrieval

On 2026-10-22 the maintainer supplied two successful official Codex conversation responses from the Remote SSH acceptance workflow. Both report actual calls to get_knowledge_status, search_knowledge with query “读取”, and read_knowledge with id read-fallback. Status reported all three cards as stale=false; search returned read-fallback and cache-storage; read returned revision 1, stale=false and current source evidence.

The response cites src/读取.ts line 5, `return cache.get(key) ?? '未找到';`, and distinguishes a stored empty string (preserved) from an undefined cache miss (fallback “未找到”). The submitted response labels its code fence Kotlin; the demo file is TypeScript. This presentation error does not change the cited expression or its interpretation. The maintainer reports no source execution or knowledge modification.

This is maintainer-reported actual Codex retrieval evidence, not an independently captured tool trace. The earlier unavailable-tools report is superseded for these successful calls; the configuration change that enabled discovery was not supplied, so no root cause is asserted. The maintainer explicitly confirmed these first two responses came from the same conversation. They do not establish independent reuse; the separate new-conversation result below does.

The URI fix in [PR #7](https://github.com/KasterMist/repo-knowledge/pull/7) passed Windows, Linux and the separate Node 22.22.1 remote-runtime job in [CI run 39760269686](https://github.com/KasterMist/repo-knowledge/actions/runs/39760269686). Its merged source commit is 5858676d0c093afb0a9157a66c7e47043c6fa530. The manually installed candidate SHA-256 is f487a2aa198fae5c27b00356e9680b72b7acb0644f0d5b300ac08c5c9427f7fd.

## Proposal and snapshot preservation

The maintainer subsequently reported a successful official Codex propose_knowledge_update call returning pending-review, followed by REVISION_CONFLICT when baseRevision was deliberately changed from 1 to 2. An independent read-only SSH/SFTP check found the reported proposal 22d9318c-d1bd-4e54-9a8c-a4722df8d556: baseRevision 1, unchanged card ID, proposed revision 2, and wording explicitly mentioning empty strings. The canonical snapshot remains byte-identical to the original fixture, SHA-256 2079e0d56b253b5e9e199592411f464df8094deb2d70998b068bd64bd88301e9, with published card revision 1. The rejected-call error is maintainer-reported; the saved candidate and unchanged snapshot were independently checked. This completes the reported four-tool loop in that conversation.

## Independent new conversation

In response to the explicit instruction to start a new official Codex conversation, the maintainer supplied a further successful result on 2026-10-22: get_knowledge_status returned read-fallback revision 1 with stale=false; search_knowledge for “读取” found the card; read_knowledge returned current evidence. The new conversation correctly explained that `??` preserves the cached empty string and reported no source execution, build or tests. This passes the maintainer-reported Remote SSH new-conversation retrieval gate. The unpublished revision-2 proposal did not replace the canonical revision-1 card. Native Windows/Linux Codex gates are separate.

## Remote stale-evidence protocol recovery

An official SDK client connected over the authenticated SSH transport to the remote standalone MCP process. The check temporarily replaced `??` with `||` only in the self-authored copied demo source. Both status and read reported stale evidence, with read evidence status changed. A proposal retaining the original source hash was rejected with STALE_EVIDENCE. The check restored the exact original source bytes in a finally-protected workflow; read returned fresh again, the snapshot hash was unchanged and the proposal count did not increase. No source was executed. This is an independently run remote protocol check, not an official Codex IDE conversation test of stale recovery.

## Official Codex stale-evidence recovery

The maintainer subsequently completed the same stale-recovery scenario in an official Codex IDE conversation: status and read returned stale=true/changed after the temporary demo edit; propose_knowledge_update using the saved original evidence returned STALE_EVIDENCE; after restoring the original file, read returned stale=false/current. The maintainer reports no source execution, builds, tests or direct knowledge.json changes. An independent read-only SFTP check then confirmed the source matches the saved original bytes, the canonical snapshot matches the original fixture bytes, and three pending proposal files remain. The error and intermediate tool states are maintainer-reported; the restored bytes and final storage state were independently checked. This passes the Remote SSH official Codex stale-recovery gate.

## Remote editor command acceptance completed (2026-10-23)

On 2026-10-23 the maintainer confirmed actual Search Cards with Chinese query and card selection, Open Knowledge Snapshot and Show Codex MCP Setup all opened their expected content while the window remained connected to SSH. Together with the prior real diagnostic, these cover four command interactions. This feedback predates the diagnostic recovery improvement; it does not claim a remote run of the new isolated recovery suite.

The maintainer then ran the two remaining commands. Initialize External Store rejected the existing store with the expected “Store already exists or is not writable” message. Open Three-Card Demo opened a new window still connected to SSH, and Open Knowledge Snapshot displayed three cards there. A subsequent independent SFTP read confirmed the original acceptance demo source and canonical snapshot match their baseline bytes; its pending proposal count remains three. Together with prior search/snapshot/setup/diagnostic checks, all six remote command interactions have maintainer evidence.

The Remote SSH-specific work package is complete. Windows-native acceptance, repository governance and alpha asset publication remain tracked in [M1 acceptance](m1-acceptance.md); completing this remote work package does not close M1 or create a Release. The maintainer explicitly excluded unverified Linux desktop Codex from the first-alpha compatibility claim while retaining real native Linux editor-host CI and this Remote SSH coverage.

Use the [Remote SSH guide](../user/remote-ssh.zh-CN.md) for manual steps. Local helper paths and private server coordinates are kept outside tracked source. The plugin itself does not read credentials or implement an SSH client.
