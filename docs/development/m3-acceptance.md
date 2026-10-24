# M3 generation acceptance checkpoint

Tracking: [Issue #22](https://github.com/KasterMist/repo-knowledge/issues/22). M2 is complete; M3 is in progress. Date: 2026-10-24.

## T14 static plan implementation

Core scan/verify/save and explicit editor plan/save commands are implemented. Schema and external-store compatibility are defined in [ADR 0006](../architecture/adr/0006-static-generation-plan.md); user steps are in the [generation guide](../user/generation.zh-CN.md). No model call or canonical write occurs in this work package.

Local full check: 28 unit tests and 4 integration tests passed. Six new static-scan tests cover credential/metadata/store exclusions, Unicode and case-sensitive globs, raw-byte/file limits, invalid UTF-8 and NUL files, changed source/new inventory/different root/edited plan, pre-start and in-flight cancellation, immutable metadata-only save, symlink directories and aliases pointing back into the source tree. These are self-authored fixtures, not target repository execution.

Actual local VS Code 1.117.0 installed the candidate VSIX and passed command registration, immutable two-source scan preview and explicit external plan save without canonical changes. Actual Linux SSH Node 22.22.1 passed a separate fresh fixture: two selected sources, immutable external save, changed-source rejection, cancellation and unchanged canonical bytes, with zero model requests. Remaining T14 gates: exact-head five CI jobs and the scoped new wizard UI report (can be combined with later M3 generation UI acceptance). Do not close M3 from this slice.

## T15/T16 integration boundary

Official sources checked on 2026-10-24: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). The documented options include a programmatic app-server lifecycle, per-turn outputSchema, account/read without token refresh, and a shell_tool feature toggle. These are candidate integration surfaces; no inference request, executable compatibility or account entitlement has been verified for this project yet.

The adapter must use a separate explicit task, not private VS Code extension session APIs. Preserve user model/provider selection; diagnose identity without reading/copying tokens. A read-only sandbox alone is not proof that target code cannot execute. Before real generation, constrain available tools and the source packet, bound input/output/time/calls and validate results into reviewed new-card candidates. Model output remains untrusted. Generation never publishes itself. Real cancellation/failure recovery and Windows/Remote SSH generation remain open gates.
