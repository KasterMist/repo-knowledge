# M3 generation acceptance checkpoint

Tracking: [Issue #22](https://github.com/KasterMist/repo-knowledge/issues/22). M2 is complete; M3 is in progress. Updated: 2026-10-26.

## T14 static plan implementation

Core scan/verify/save and explicit editor plan/save commands are implemented. Schema and external-store compatibility are defined in [ADR 0006](../architecture/adr/0006-static-generation-plan.md); user steps are in the [generation guide](../user/generation.zh-CN.md). No model call or canonical write occurs in this work package.

Local full check: 28 unit tests and 4 integration tests passed. Six new static-scan tests cover credential/metadata/store exclusions, Unicode and case-sensitive globs, raw-byte/file limits, invalid UTF-8 and NUL files, changed source/new inventory/different root/edited plan, pre-start and in-flight cancellation, immutable metadata-only save, symlink directories and aliases pointing back into the source tree. These are self-authored fixtures, not target repository execution.

Actual local VS Code 1.117.0 installed the candidate VSIX and passed command registration, immutable two-source scan preview and explicit external plan save without canonical changes. Actual Linux SSH Node 22.22.1 passed a separate fresh fixture: two selected sources, immutable external save, changed-source rejection, cancellation and unchanged canonical bytes, with zero model requests. [PR #23](https://github.com/KasterMist/repo-knowledge/pull/23) merged as 36d36849f12d251cf2d4e20e156a24f4c64cf3c8 after exact head eeb70a5502bffe1e01d74cb468915e2a5a3ba6db passed all five jobs in [run 40054942294](https://github.com/KasterMist/repo-knowledge/actions/runs/40054942294). The initial Windows run caught short/long-path error classification; the fix preserves containment and makes the rejection consistent.

Fresh native and remote wizard demos use separate external stores, without changes to prior M2 acceptance data or user-level Codex configuration. Uploaded/installed T14 development VSIX SHA-256: `7fd290fc9f245bf714f03341e3532d1abcfc02d88b365afd0bac4bc1cb77025d`.

On 2026-10-24 the maintainer reported that both scope/language/limits wizards and explicit plan saves succeeded. Independent read-only inspection used the core verifyScanPlan boundary against the current source files and confirmed:

| Check                                  | Windows native                       | Remote SSH to Linux                  |
| -------------------------------------- | ------------------------------------ | ------------------------------------ |
| Valid saved plans                      | 1                                    | 2                                    |
| Included paths in every plan           | src/cache.ts, src/读取.ts            | src/cache.ts, src/读取.ts            |
| Language / maximum files / total bytes | zh-CN / 10 / 131072                  | zh-CN / 10 / 131072                  |
| Coverage and source revalidation       | limited=false, current               | limited=false, current               |
| Canonical knowledge bytes              | Equal to original self-authored demo | Equal to original self-authored demo |

UI interaction is maintainer-reported; saved metadata, manifest/source revalidation and canonical byte comparisons were independently inspected. Both saved stores are external to their respective target demo roots; remote plans were inspected over SSH, not through a local path. Multiple saved plans are retained as immutable UUID files. No target source was executed or modified by this inspection. T14 meets its scoped exit conditions; no T14 manual gate remains. These steps do not start a model, generate knowledge or publish. T15/T16 and M3 remain incomplete.

## T15/T16 integration boundary

Official sources checked on 2026-10-24: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). The documented options include a programmatic app-server lifecycle, per-turn outputSchema, account/read without token refresh, and a shell_tool feature toggle. These are candidate integration surfaces; no inference request, executable compatibility or account entitlement has been verified for this project yet.

The adapter must use a separate explicit task, not private VS Code extension session APIs. Preserve user model/provider selection; diagnose identity without reading/copying tokens. A read-only sandbox alone is not proof that target code cannot execute. Before real generation, constrain available tools and the source packet, bound input/output/time/calls and validate results into reviewed new-card candidates. Model output remains untrusted. Generation never publishes itself. Real cancellation/failure recovery and Windows/Remote SSH generation remain open gates.

The installed Windows Codex CLI 0.162.0-alpha.17.2 exported its public app-server schemas. A separate read-only protocol probe successfully initialized, read effective configuration with shell_tool=false and called account/read with refreshToken=false; a ChatGPT account was present. It created no thread, issued zero model requests and copied no tokens or user configuration. This is protocol/configuration evidence, not model entitlement or successful generation. The public adapter must diagnose the explicitly selected executable rather than assume every installed CLI has identical capabilities.

The independent SSH app-server probe initialized and read configuration, but account/read did not succeed: a 15-second attempt timed out, and a bounded longer attempt returned an RPC rejection. No model turn was started and no raw account/config/token data is included in public evidence. This is not evidence that the existing Codex extension is logged out. T15 must provide bounded actionable diagnostics in the actual extension host, whose environment can differ from an SSH process, and separately verify execution restrictions and structured generation. Do not rewrite login/provider settings or copy tokens to bypass this uncertainty.

## Next implementation order

1. T14 is accepted; retain this evidence and do not repeat the wizard or M2 publication acceptance without a relevant change. Continue from T15 below, keeping planning separate from generation acceptance.
2. Implement an editor-independent bounded app-server client and explicit generation-backend diagnostic, including fragmented messages, early exit, cancellation and RPC errors. Preserve configured model/provider and avoid private extension session APIs.
3. Define the source-packet and structured-output contract, new-card candidate schema and review UI. Bind every reference to the selected file hash/range and reject changed sources, duplicate IDs or existing-card overwrite. Do not present a saved candidate as published knowledge.
4. Before enabling first-generation publication, add an ADR and shared-lock/recovery tests covering new-card creation and rollback, without regressing M2's revision or human-content protection.
5. Add bounded real generation, cancellation/checkpoints/retry and Windows/Remote SSH acceptance. Only then close T15/T16 and M3; release remains a separately versioned task.

## T15 client/diagnostic implementation (2026-10-26)

The bounded editor-independent CodexStdioClient and the explicit Diagnose Generation Backend command are implemented. Protocol/resource/privacy details are in [the client boundary](codex-client.md); settings and safe result interpretation are in [the user guide](../user/codex-backend.zh-CN.md). This is a T15 foundation slice, not a complete generation adapter: no turn output collection, source packet, structured new-card candidate or generation/publication command is enabled.

The repository-pinned Node 24.19.0 full check passed 34 unit and 4 integration tests. The local managed runtime cache had advanced to 24.22.1; a portable official 24.19.0 binary was verified against its published SHA-256 manifest and used for the pinned check. Existing unit/integration behavior remained passing. Six new protocol-peer tests validate streaming UTF-8, response correlation, denied server requests, safe report shape, error categories, process/deadline/cancel behavior and resource limits. Peer fixtures never contact a model.

Actual Windows VS Code 1.117.0 installed the candidate, registered all commands and passed an explicit missing-host-executable error path, restoring the test-only setting. Existing planning, draft, source navigation and MCP recovery also passed; this host runner does not claim the new live backend GUI path passed.

The implemented core client also ran against real Codex without creating a thread: native Windows reported configured, shellToolsDisabled=true, accountRead=true, account=present/authMode=chatgpt; actual Linux SSH Node 22.22.1 reported initialized/configurationRead/shellToolsDisabled=true but REQUEST_TIMEOUT at account/read. Both report generationVerified=false, modelRequests=0 and threadCreated=false. The SSH timeout is an actionable unverified diagnostic, not proof that the existing IDE login is absent.

The maintainer also ran the prepared diagnostic candidate (`78cbefc2a3833e005e66e29e276f871fc3048349937574f818446493f2109b0c`) from both actual extension hosts. Windows used the explicit test-profile setting, Remote SSH discovered the installed host extension binary; both reported configured, initialized/configurationRead/shellToolsDisabled/accountRead=true, account=present/authMode=chatgpt, error=null, generationVerified=false, modelRequests=0 and threadCreated=false. These GUI results are maintainer-reported, separate from the independent core probes. The actual remote-host success supersedes the independent SSH probe as the current host-readiness evidence; it does not establish the root cause of the earlier probe timeout or prove model access.

Storage parent canonicalization was subsequently shared with the existing T14 helper, so the diagnostic rejects parent aliases into the target before directory creation; the pinned full suite, including the existing alias boundary tests, passed. No account/model configuration was changed for that hardening. The client/diagnostic slice merged in PR #26 as ec8f0ddc5f8568dec634a9a994b471b2a4a3c3e3 after exact head afa3e06234648320a6478771af1f47c9ebccae88 passed all five jobs in run 40289618291. No client/host diagnostic gate remains for this slice. T14/M2 and the successful host diagnostics need not be repeated without relevant changes. Continue the source-packet/new-card candidate and publication contracts before attempting real generation. M3 stays open.

## T15 source/output contract implementation

The in-memory [generation contract](generation-contract.md) is implemented: a freshly verified plan produces only selected normalized sources and relative metadata, capped at 128 KiB encoded JSON and bound to the canonical digest. The structured schema admits at most eight new pages; runtime checks assign current evidence hashes, reject nonselected/invalid ranges, existing/duplicate IDs and changed input or human knowledge. Empty/incomplete/whitespace-only selections, cancellation and excess encoded input are rejected. No source packet or candidate is persisted or transmitted, no model is called and no new cards are published.

Four self-authored tests cover these contracts; the pinned Node 24.19.0 full check passed 38 unit and 4 integration tests, including the whitespace-only guard. Exact head 309ae2e2d8353d72785f5a747d6a7ee10ce26617 passed all five jobs in run 40292546952; PR #27 merged as d9f7f6af2768bdad28a69029468a181e7c4495d5 and local main was synchronized. Client diagnostics are already accepted; real generation, new-card candidate storage/review/publication, execution-tool restrictions and T16 limits/recovery remain open. Do not repeat T14 or successful backend diagnosis for this pure data increment.
