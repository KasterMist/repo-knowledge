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

## Remaining gates

- Exact T12 PR head: five CI jobs, including real packaged editor hosts on Windows/Linux and Node 22.22.1 MCP.
- New workbench UI in Windows and Remote SSH: cancel/confirm publication, view history, confirm monotonic rollback and verify MCP observes matching revisions. M1's completed Codex tests remain valid and are not repeated wholesale.
- Independent remote candidate installation/runtime checks and sanitized evidence; public M1 assets remain immutable.
- Update task status after evidence. No M2 completion or new release is claimed while these gates remain open. Installation/steps are in the [workbench guide](../user/workbench.zh-CN.md).
