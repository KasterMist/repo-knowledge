# M3 generation acceptance checkpoint

Tracking: [Issue #22](https://github.com/KasterMist/repo-knowledge/issues/22). M2 is complete; M3 is in progress. Date: 2026-10-24.

## T14 static plan implementation

Core scan/verify/save and explicit editor plan/save commands are implemented. Schema and external-store compatibility are defined in [ADR 0006](../architecture/adr/0006-static-generation-plan.md); user steps are in the [generation guide](../user/generation.zh-CN.md). No model call or canonical write occurs in this work package.

Local full check: 28 unit tests and 4 integration tests passed. Six new static-scan tests cover credential/metadata/store exclusions, Unicode and case-sensitive globs, raw-byte/file limits, invalid UTF-8 and NUL files, changed source/new inventory/different root/edited plan, pre-start and in-flight cancellation, immutable metadata-only save, symlink directories and aliases pointing back into the source tree. These are self-authored fixtures, not target repository execution.

Actual local VS Code 1.117.0 installed the candidate VSIX and passed command registration, immutable two-source scan preview and explicit external plan save without canonical changes. Actual Linux SSH Node 22.22.1 passed a separate fresh fixture: two selected sources, immutable external save, changed-source rejection, cancellation and unchanged canonical bytes, with zero model requests. [PR #23](https://github.com/KasterMist/repo-knowledge/pull/23) merged as 36d36849f12d251cf2d4e20e156a24f4c64cf3c8 after exact head eeb70a5502bffe1e01d74cb468915e2a5a3ba6db passed all five jobs in [run 40054942294](https://github.com/KasterMist/repo-knowledge/actions/runs/40054942294). The initial Windows run caught short/long-path error classification; the fix preserves containment and makes the rejection consistent.

Fresh native and remote wizard demos are prepared, with a separate external store and no changes to prior M2 acceptance data or user-level Codex configuration. Uploaded/installed T14 development VSIX SHA-256: `7fd290fc9f245bf714f03341e3532d1abcfc02d88b365afd0bac4bc1cb77025d`. Remaining T14 gate: maintainer scope/language/limits wizard and explicit save feedback, followed by independent saved-plan inspection. These UI steps never start a model. Do not close M3 from this slice.

## T15/T16 integration boundary

Official sources checked on 2026-10-24: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). The documented options include a programmatic app-server lifecycle, per-turn outputSchema, account/read without token refresh, and a shell_tool feature toggle. These are candidate integration surfaces; no inference request, executable compatibility or account entitlement has been verified for this project yet.

The adapter must use a separate explicit task, not private VS Code extension session APIs. Preserve user model/provider selection; diagnose identity without reading/copying tokens. A read-only sandbox alone is not proof that target code cannot execute. Before real generation, constrain available tools and the source packet, bound input/output/time/calls and validate results into reviewed new-card candidates. Model output remains untrusted. Generation never publishes itself. Real cancellation/failure recovery and Windows/Remote SSH generation remain open gates.

The installed Windows Codex CLI 0.162.0-alpha.17.2 exported its public app-server schemas. A separate read-only protocol probe successfully initialized, read effective configuration with shell_tool=false and called account/read with refreshToken=false; a ChatGPT account was present. It created no thread, issued zero model requests and copied no tokens or user configuration. This is protocol/configuration evidence, not model entitlement or successful generation. The public adapter must diagnose the explicitly selected executable rather than assume every installed CLI has identical capabilities.

The independent SSH app-server probe initialized and read configuration, but account/read did not succeed: a 15-second attempt timed out, and a bounded longer attempt returned an RPC rejection. No model turn was started and no raw account/config/token data is included in public evidence. This is not evidence that the existing Codex extension is logged out. T15 must provide bounded actionable diagnostics in the actual extension host, whose environment can differ from an SSH process, and separately verify execution restrictions and structured generation. Do not rewrite login/provider settings or copy tokens to bypass this uncertainty.

## Next implementation order

1. Finish the small T14 wizard check; keep this separate from generation acceptance.
2. Implement an editor-independent bounded app-server client and explicit generation-backend diagnostic, including fragmented messages, early exit, cancellation and RPC errors. Preserve configured model/provider and avoid private extension session APIs.
3. Define the source-packet and structured-output contract, new-card candidate schema and review UI. Bind every reference to the selected file hash/range and reject changed sources, duplicate IDs or existing-card overwrite. Do not present a saved candidate as published knowledge.
4. Before enabling first-generation publication, add an ADR and shared-lock/recovery tests covering new-card creation and rollback, without regressing M2's revision or human-content protection.
5. Add bounded real generation, cancellation/checkpoints/retry and Windows/Remote SSH acceptance. Only then close T15/T16 and M3; release remains a separately versioned task.
