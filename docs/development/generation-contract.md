# In-memory generation source and output contract

Date: 2026-10-26. T15 data-validation slice; no model invocation or publication entry point. Tracking: [Issue #22](https://github.com/KasterMist/repo-knowledge/issues/22).

## Source packet

buildGenerationPacket accepts an explicit KnowledgeStore and a reviewed T14 plan. It revalidates scope/source inventory before and after reading, requires a nonempty fully covered selection and at least some non-whitespace context, rejects symlinks/escaped sources and binds the current canonical snapshot. Only the selected relative filenames and normalized UTF-8 contents enter the packet; absolute repository/store paths do not. Its encoded JSON is limited to 128 KiB, independent of T14's larger scan-byte ceiling. This byte ceiling is not a token or monetary budget.

The in-memory schemaVersion 1 packet has repositoryId, planId/planRevision, baseSnapshot, output language, sorted existingIds, sources (path/hash/line count/content), and packetRevision binding all these fields. It is an API object, not a saved plan or a new persisted knowledge format. The code neither saves nor sends source text. Callers must still preview/confirm transfer and enforce the final serialized model-request budget before any turn.

## Structured output

The output schema has packetRevision and one to eight pages. Each page shares the canonical title/kind/body/tags/scope shape but supplies only relative path/startLine/endLine evidence selectors. The validator assigns revision 1 and source hashes from the packet; model-supplied revision/hash fields are rejected. Duplicate or existing active IDs cannot overwrite human knowledge. Page scopes must contain selected sources; cited file and 1–200-line ranges must actually exist in the selected packet. The resulting total cannot exceed 200 canonical cards.

The generated JSON Schema helps structure a future model reply; runtime validation additionally enforces custom path, uniqueness, selected-source and fingerprint constraints. It is not proof that every narrative claim is factually correct or that arbitrary Markdown links are trustworthy. Human review remains required. validateCurrentGeneration rebuilds the packet and rejects changed source or canonical knowledge instead of silently rebasing over human edits.

## Boundaries and next steps

These helpers return canonical-shaped new cards in memory only. They do not create a proposal file, publish, open a model thread or run source code. A separate KnowledgePublication.saveCreation boundary persists validated new-card batches and supports explicit review/publication/removal under [ADR 0007](../architecture/adr/0007-reviewed-creation.md). The [explicit Codex adapter](../architecture/adr/0008-explicit-codex-generation.md) now connects these helpers after source confirmation and restricted preflight. It preserves M2's existing-card update semantics rather than passing new IDs to the old update API. Successful real generation, T16 checkpoints/retry and end-to-end acceptance remain open.

Self-authored tests cover two-file Unicode packets, JSON Schema construction, exact evidence hash assignment and unchanged canonical bytes; malformed references, unknown fields, mixed packets, duplicate/existing IDs, edited packets, source/knowledge changes, empty/incomplete/whitespace-only scope, encoded input limit and cancellation. Actual model quality and provider access are separate future acceptance gates.
