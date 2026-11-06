# T17: static impact core increment

The later storage increment adds external immutable metadata baselines, reverse file/card dependencies and explicit editor commands. See [ADR 0010](../architecture/adr/0010-dependency-baseline-storage.md) and [the user guide](../user/knowledge-changes.zh-CN.md). Two-platform positive command UI acceptance, rename inference and navigation shortcuts remain open. The original in-memory increment below is historical.

This first increment is in-memory only. It introduces captureDependencyBaseline and reviewDependencyImpact, not an editor command or a persisted index. Capture explicitly verifies a reviewed scan and binds metadata dependencies to the canonical snapshot hash. It retains card IDs, scopes and source references, never card bodies or source text. A checksum detects accidental baseline mutation, not malicious forgery.

Review rescans using the same bounds/options and refuses another root or changed canonical knowledge. Direct changed/missing/out-of-range evidence is distinguished from potentially affected scopes and unknown coverage. Additions under a directory scope flag potential impact even when cited sources remain current. Incomplete inventories never imply missing files or an all-current result. References outside selected coverage remain unknown. Exact file scopes do not imply dependencies on sibling files.

This is a bounded static observation, not an atomic repository snapshot, semantic call graph or branch/worktree isolation. Rename inference, reverse dependency presentation, durable baselines and VS Code commands remain in T17/T18. Persistent format work must add an ADR, migration and downgrade policy before writing baselines. This increment writes no knowledge/candidates, runs no source/model and adds no watcher.

Self-authored tests cover unchanged metadata, direct changes/deletion, directory-scope additions, checksum tampering and incomplete coverage. Full-suite results and GitHub delivery are tracked in Issue #35. T17 remains open; M3 acceptance is retained without repeating its UI tests.

Storage increment validation: pinned Node 24.19.0 full check passed 73 unit and 4 integration tests. Actual isolated Windows VS Code 1.117.0 installed the package and registered commands with existing recovery checks passing. Positive capture/select/report GUI interactions are not covered by that runner and remain pending.

## Accepted baseline UI and conservative rename increment (2026-11-05)

The maintainer supplied actual Windows and Remote SSH reports: complete coverage, no changes, three current cards/current evidence, zero model requests, no publication. Independent local core and remote SFTP inspection found one valid saved baseline per host with current source/canonical hashes. This accepts capture/select/read-only no-change reporting; no repeat is required.

Reports now add possibleRenames only for complete coverage and a content hash unique in both entire inventories. Changes still retain added/deleted entries, and old-path evidence remains missing/invalid. Copies or incomplete coverage never create a rename suggestion. This is not Git history inference or automatic reference repair. Existing baseline format 1 is unchanged; older baselines remain readable. Pinned full check passed 75 unit and 4 integration tests. Changed-file report GUI acceptance and navigation shortcuts remain open in Issue #35.

## Changed-report UI and navigation increment (2026-11-06)

The maintainer confirms Windows/SSH composite changed-report results match the requested modified/deleted/added/possible-rename and direct-invalid versus scope-potential states, with no model or publication. This is maintainer-reported UI evidence on the previously statically verified independent fixtures; do not repeat it.

Open Impact Report Target navigates only from an active registered report to its allowlisted current file or card. Memory contexts are capped at 20 and cleared on report close/workspace/config changes. Snapshot mismatch rejects stale navigation. Relative-path validation, every-component symlink checks and root containment protect source opening; a deleted source reports missing without redirecting to a suggested rename. Cards show current structured knowledge and evidence freshness. No persisted formats or model/publication behavior change. Positive navigation UI acceptance remains pending, T17 stays open.

Navigation validation: pinned full check passed 76 unit/4 integration tests. Actual isolated Windows VS Code 1.117.0 passed source/card jumps, missing-file messaging and refusal of a target outside the registered report. Tests bind a real canonical revision, as production reports do. Two-platform interactive target selection remains pending; previous changed/no-change report acceptance is retained.

The initial Windows CI unit assertion compared a canonical path against an 8.3 temporary-directory alias. It now compares real paths; source containment/refusal behavior is unchanged. Exact-head replacement CI must pass before merge.
