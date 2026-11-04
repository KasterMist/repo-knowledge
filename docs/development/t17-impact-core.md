# T17: static impact core increment

This first increment is in-memory only. It introduces captureDependencyBaseline and reviewDependencyImpact, not an editor command or a persisted index. Capture explicitly verifies a reviewed scan and binds metadata dependencies to the canonical snapshot hash. It retains card IDs, scopes and source references, never card bodies or source text. A checksum detects accidental baseline mutation, not malicious forgery.

Review rescans using the same bounds/options and refuses another root or changed canonical knowledge. Direct changed/missing/out-of-range evidence is distinguished from potentially affected scopes and unknown coverage. Additions under a directory scope flag potential impact even when cited sources remain current. Incomplete inventories never imply missing files or an all-current result. References outside selected coverage remain unknown. Exact file scopes do not imply dependencies on sibling files.

This is a bounded static observation, not an atomic repository snapshot, semantic call graph or branch/worktree isolation. Rename inference, reverse dependency presentation, durable baselines and VS Code commands remain in T17/T18. Persistent format work must add an ADR, migration and downgrade policy before writing baselines. This increment writes no knowledge/candidates, runs no source/model and adds no watcher.

Self-authored tests cover unchanged metadata, direct changes/deletion, directory-scope additions, checksum tampering and incomplete coverage. Full-suite results and GitHub delivery are tracked in Issue #35. T17 remains open; M3 acceptance is retained without repeating its UI tests.
