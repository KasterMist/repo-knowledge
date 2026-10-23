# M2 workbench acceptance

Tracking: [Issue #17](https://github.com/KasterMist/repo-knowledge/issues/17). Implementation in progress; M1 public release remains unchanged.

## T11/T13 browsing and retrieval

Native Wiki and card trees use the same schemaVersion 1 store as MCP. Wiki grouping is derived from the first source-scope path, then the card title; it is not a separately authored/generated Wiki hierarchy. Empty and unavailable stores show explicit messages. Each workspace folder resolves its own target; nodes keep that binding. Cards open as read-only virtual Markdown documents. Expand a card to see evidence; navigation reloads the card, checks the snapshot, rejects missing/escaped/invalid references, and opens host file URIs through VS Code. Reading knowledge never runs target code or starts generation.

Lexical search uses NFKC/case normalization, Chinese and code-symbol tokens, weighted fields and deterministic ID tie-breaking. A self-authored evaluation has 15 cards, including twelve distractors, and twenty labeled Chinese/mixed/symbol/fullwidth queries. Actual local Top-5: 20/20. Two separate semantic/paraphrase queries deliberately remain misses; this is not semantic retrieval, and this small fixture is not a real-project quality claim. The test is tests/unit/workbench.test.mjs; CI repeats the evaluation on Windows/Linux.

Actual packaged-editor tests must cover Wiki/cards, read-only documents, Unicode evidence navigation, snapshot changes, missing evidence and Remote SSH host routing. Automated host evidence and maintainer UI reports are recorded separately. No M2 completion or fresh official Codex conversation is claimed yet.

## T12 publication requirements

Implemented in the development candidate: durable human drafts, candidate diff, explicit confirmation, exclusive writer and base/evidence recheck, atomic publication with immutable history, monotonically revised rollback, dirty-editor protection and recovery guidance. Canonical schemaVersion 1 and MCP proposal compatibility are retained; new history/draft layout is defined in [ADR 0005](../architecture/adr/0005-reviewed-publication.md). A successful proposal save does not publish itself. Manual editing uses validated native JSON drafts; creating new cards remains M3.

Local full check passed: 22 unit tests and 4 integration tests. Boundaries include changed review content, stale source, competing writers, complete snapshots under concurrent reads, exact BOM/CRLF backup bytes, monotonic rollback and prepared-marker recovery. An actual running bundled MCP process immediately reads published r2 and rolled-back r3 from the same store. Windows transient rename contention was observed under concurrent readers and addressed with bounded atomic-rename retries, revalidating source and bases on every attempt.

Actual local VS Code 1.117.0 installed the candidate VSIX in an isolated profile: all commands activated; Wiki/cards and source navigation worked; draft editing, dirty-editor rejection, saved submission and immutable diff passed, preserving canonical bytes. This runner does not click publication/rollback confirmation dialogs or claim official Codex acceptance for M2.

## Exact-source CI and Linux SSH runtime

T11/T13 [PR #18](https://github.com/KasterMist/repo-knowledge/pull/18) merged as 3c5a9a3cfdb794dc4d748ef595af09eb531a0817 after five successful jobs in [run 39925551903](https://github.com/KasterMist/repo-knowledge/actions/runs/39925551903). T12 [PR #19](https://github.com/KasterMist/repo-knowledge/pull/19) merged as c40007b8fcd93bc624ebf9052adda62633e35d86; exact head 5e17948ff154c634385d4828eccd48ec1d02dba7 passed all five jobs in [run 39926967493](https://github.com/KasterMist/repo-knowledge/actions/runs/39926967493), including real Windows/Linux packaged editor hosts and Node 22.22.1 MCP.

The actual maintainer-authorized Linux SSH server ran a separate self-authored fixture on VS Code Server Node 22.22.1: durable draft, unchanged pre-publication canonical, publication r2, immediate running MCP r2, monotonic rollback/MCP r3, stale/restored evidence and two committed histories all passed. This runtime runner does not click UI confirmations. The candidate installed with 18 commands and five views. A fresh remote demo and external store were prepared; the prior M1 demo and user-level Codex configuration were preserved.

Unreleased development VSIX SHA-256: `d50bae139c88caa12a68870bf329f9905a969265977da1693d6b4038ae6ca53c`. Local and uploaded remote bytes matched. This is not a new public release; its internal version remains 0.1.0 during development, so identify it by source/hash rather than confusing it with the immutable M1 release. Windows new-UI acceptance uses a separate profile and extensions directory; it does not add temporary global MCP configuration.

The follow-up packaged-host fixture starts a real two-folder workspace with the same card ID in distinct stores. Local VS Code 1.117.0 passed distinct-body reads, a pinned first node after reading the second, and source navigation to the second root. CI now runs both single-root recovery/editing and multi-root isolation; combined sanitized reports preserve the separate evidence. Starting with a workspace file avoids interactive workspace-composition changes in the test runner.

## Remaining gates

- Follow-up multi-root packaged-host fixture and its exact-head CI: two stores with the same card ID must remain isolated.
- New workbench UI in Windows and Remote SSH: cancel/confirm publication, view history, confirm monotonic rollback and verify MCP observes matching revisions. M1's completed Codex tests remain valid and are not repeated wholesale.
- Maintainer click results remain pending in both prepared environments; public M1 assets remain immutable.
- Update task status after evidence. No M2 completion or new release is claimed while these gates remain open. Installation/steps are in the [workbench guide](../user/workbench.zh-CN.md).
