# ADR 0007: Reviewed new-card batches and retained creation identities

Status: accepted for the M3 creation boundary. Date: 2026-10-26.

## Decision

Keep canonical knowledge.json schemaVersion 1 and all four MCP tools unchanged. Extend KnowledgePublication with explicit new-card candidate and batch-publication operations. Saving a candidate does not publish; publication requires a read-only batch diff, a second explicit command and modal confirmation. The generation adapter is not enabled by this change.

An external-store creations/UUID.json file has schemaVersion 1, candidateId, createdAt, the complete metadata-only T14 plan, packetRevision, baseSnapshot and one to eight validated canonical-shaped cards at revision 1. It contains no source packet/text or absolute repository/store paths. Card text remains untrusted and may itself quote code. Each file is bounded to 1 MiB and the directory to 200 entries. Only an explicit save after current-source/canonical validation creates this file; opening or saving source never does so.

Review and publication rebuild the source packet from the saved plan, compare packet/base digests, validate selected paths, ranges, hashes, IDs and total canonical limits, and bind the saved candidate text in the review token. Existing cards are preserved. A candidate is not automatically rebased over changed source or human knowledge. The creation API saves validated results from an upstream generator; it does not provide a model, manual import, provider access or complete T16 cancellation/retry support.

Creation and existing-card updates share .publication.lock and the same snapshot transaction writer. Preserve exact before bytes, sync before/after/record files, and atomically replace knowledge.json only after another source/base/candidate recheck. Readers remain lock-free. File/OS limitations from ADR 0005 still apply; this is not a hostile-process filesystem sandbox or a power-loss guarantee.

## History and rollback

Existing record.json schemaVersion 1 updates remain readable and retain monotonic single-card rollback. New records use schemaVersion 2 with transactionId, operation (create/remove-created), itemId, ordered cardIds, createdAt and beforeSnapshot/afterSnapshot. A create record must append exactly the identified revision-1 batch without any other changes. A removal record must remove exactly its identified revision-1 batch without other changes. The same committed/aborted marker format and explicit prepared-state recovery apply to both versions. Malformed/unknown history blocks all publishers.

Rollback of a create removes its entire batch only while the current canonical digest still equals the committed creation's after digest. Committed history must contain no transaction based on that creation digest: even an intervening create/remove round trip returning to identical bytes blocks this removal. Intervening cooperative knowledge edits, including unrelated-card changes, therefore cannot be discarded. This does not detect an external operator manually changing and restoring files outside the transaction writer. A remove-created transaction cannot itself be rolled back or used as an implicit redo. Its confirmation states the deletion and retained identities explicitly. Internal transaction result revision 0 denotes batch removal, never a stored card revision.

All IDs in committed create records remain reserved, including after removal. A new candidate cannot reuse them; an already published candidate cannot be published again. A create transaction with a committed removal cannot be removed again even if an operator later restores identical bytes. This retained history prevents resetting an identity to r1 and revalidating old candidates after creation/removal. Prepared history blocks publication until recovered; aborted creations do not reserve identities.

## Recovery, upgrade and downgrade

There is no activation-time migration or canonical rewrite. Existing M1/M2 stores can be read directly; creations/ and version-2 history appear only through explicit candidate saving and publication. Back up the complete store before upgrading. Recovery only adds the appropriate marker when the current snapshot matches one side; neither matching refuses recovery. A stale lock or incomplete journal still requires the operator process/backup inspection in ADR 0005. Never guess, silently steal a lock, delete history to clear an error, or automatically rewrite canonical knowledge.

M1/M2 can read the schema-1 canonical file. An M2 publisher encountering version-2 history fails closed; it cannot interpret batch rollback/recovery. For downgrade, stop writers and preserve the whole newer store, then either use the old version for retrieval only or explicitly select a complete pre-upgrade store backup for writing. Do not delete version-2 records to make an older publisher proceed. Never archive creation history away from an active store: it is the reserved-ID ledger. At the 200-history-entry limit stop writing and back up the whole store; compacting or migrating this ledger requires a future format decision and is not implemented here. Published release assets remain immutable.

## Verification

Self-authored tests cover unchanged canonical bytes on save/review/cancelled-token paths, batch creation/removal, duplicate/replayed/retired identities, evidence/candidate/base changes, shared-lock contention with M2, preserving later human edits, marker recovery, traversal and symlink rejection. Packaged Windows/Linux editor tests cover the new tree, read-only batch diff and first-publish review requirement. These automated checks do not claim actual modal clicks, real model generation or Remote SSH user acceptance of the new batch UI.
