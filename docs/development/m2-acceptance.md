# M2 workbench acceptance

Tracking: [Issue #17](https://github.com/KasterMist/repo-knowledge/issues/17). Implementation in progress; M1 public release remains unchanged.

## T11/T13 browsing and retrieval

Native Wiki and card trees use the same schemaVersion 1 store as MCP. Wiki grouping is derived from the first source-scope path, then the card title; it is not a separately authored/generated Wiki hierarchy. Empty and unavailable stores show explicit messages. Each workspace folder resolves its own target; nodes keep that binding. Cards open as read-only virtual Markdown documents. Expand a card to see evidence; navigation reloads the card, checks the snapshot, rejects missing/escaped/invalid references, and opens host file URIs through VS Code. Reading knowledge never runs target code or starts generation.

Lexical search uses NFKC/case normalization, Chinese and code-symbol tokens, weighted fields and deterministic ID tie-breaking. A self-authored evaluation has 15 cards, including twelve distractors, and twenty labeled Chinese/mixed/symbol/fullwidth queries. Actual local Top-5: 20/20. Two separate semantic/paraphrase queries deliberately remain misses; this is not semantic retrieval, and this small fixture is not a real-project quality claim. The test is tests/unit/workbench.test.mjs; CI repeats the evaluation on Windows/Linux.

Actual packaged-editor tests must cover Wiki/cards, read-only documents, Unicode evidence navigation, snapshot changes, missing evidence and Remote SSH host routing. Automated host evidence and maintainer UI reports are recorded separately. No M2 completion or fresh official Codex conversation is claimed yet.

## T12 publication requirements

Remaining: durable human drafts, candidate diff, explicit confirmation, exclusive writer and base/evidence recheck, atomic publication with immutable history, monotonically revised rollback, dirty-editor protection and recovery guidance. Canonical schemaVersion 1 and MCP proposal compatibility are retained; new history/draft formats need an ADR. A successful proposal save must not publish itself.
