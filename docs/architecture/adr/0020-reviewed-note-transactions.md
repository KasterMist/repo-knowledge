# ADR 0020: Reviewed human note publication and monotonic rollback

Status: accepted for core API only. Date: 2026-11-26.

## Decision

Add explicit `edit-note` and `rollback-note` operations to the strict schemaVersion 3 Wiki journal. They reuse its immutable before/after raw backups, digests, retained transaction inventory, shared writer lock, atomic canonical replacement, markers and explicit recovery. A note operation records zero card IDs and exactly one article ID. Its semantic validator permits exactly one human note body difference and article revision +1; all cards, bindings, metadata, authors, other notes and articles must remain equal. A nonempty body and full v2 structure remain validated by the snapshot schema. It never impersonates a creation/removal batch.

`previewWikiNote` produces a bounded before/after review and token; `publishWikiNote` requires that token under the existing lock and revalidates immediately before replacement. Tokens bind candidate bytes, canonical raw bytes and retained metadata/history. Each article binding must match, and referenced cards must have current source evidence. These checks do not prove historical intent. Note candidates join the Wiki inventory so active temporary remnants block publication until inspected. No model calls occur.

Rollback is separately previewed and confirmed using the original committed edit transaction ID. It requires the unmodified committed head with no intervening committed write. It restores the original note body while incrementing the current article revision. The inverse journal links the source transaction, validates its committed state/raw backups, and verifies that the resulting snapshot equals the original before snapshot except for the monotonic article revision. Shared recovery handles a missing marker after replacement without silently rewriting canonical knowledge.

## Compatibility and downgrade

No activation-time migration. Existing schemaVersion 1/2 snapshots and old history operations retain their meaning. Older journal readers reject the new operation names; after any note publication they must not be used to write/recover this store. Preserve the entire store and use a compatible build. Rolling back note content retains both history entries and does not make old readers safe; do not delete audit history to downgrade. Creating inert candidates alone retains ADR 0019's downgrade policy.

## Scope

Core API only. Existing generic Wiki rollback commands do not select note operations; the future editor must use separate note review/confirmation entry points. Public GUI/Remote SSH acceptance remains open. No runtime background work, automatic publication or release is introduced.
