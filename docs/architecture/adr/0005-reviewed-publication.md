# ADR 0005: Reviewed single-card publication and monotonic rollback

Status: accepted for M2 implementation. Date: 2026-10-23.

## Decision

Keep canonical knowledge.json and MCP proposal schemaVersion 1 unchanged. Add an editor-independent KnowledgePublication boundary. MCP still exposes only search/read/status/propose; publication is an explicit editor action after a read-only diff and modal confirmation. Neither source changes nor candidate submission publish anything or call a model.

Human edits start in external-store drafts/UUID.json. Drafts use the existing saved-proposal envelope (schemaVersion, proposalId, createdAt and proposal input); submitting validates the saved draft and creates an immutable proposal. Drafts remain available after submission. Existing canonical content is copied, not reconstructed from a partial form. The first UI edits this validated JSON in the native editor. Creating cards and authoring a separate generated Wiki hierarchy are M3 work.

The reviewer binds candidate content and current snapshot digest in a review token. Publishing acquires .publication.lock exclusively, rechecks the candidate, base revision, snapshot and current source evidence, writes immutable history/UUID/{before.json,after.json,record.json}, syncs files, and atomically renames a same-directory temporary snapshot over knowledge.json. before.json preserves original bytes, including BOM and CRLF. record.json schemaVersion 1 records transactionId, operation (publish/rollback), itemId, cardId, createdAt, beforeSnapshot/afterSnapshot digests and beforeRevision/afterRevision. A committed or aborted marker contains afterSnapshot plus LF. Missing markers mean prepared. History validates hashes and exactly one card revision increment; unknown or inconsistent records stop publication.

Rollback only applies to the current committed history head. It restores the previous card content as a new revision, so old proposal bases cannot become valid again. It does not roll back source files. Restored evidence must still match current source. Drafts/proposals/history never enter the target repository unless the user explicitly chose such a store.

Readers remain lock-free and see a complete old or new canonical file. Publication writers cooperate through the exclusive lock. Each bounded metadata file is at most 1 MiB; each metadata directory lists at most 200 entries. Back up and archive before reaching limits. This is not protection against a hostile local process swapping paths during filesystem operations; retain ADR 0002's boundary. File sync and atomic rename reduce interruption risk but are not a guarantee against every OS/storage power-loss behavior.

## Recovery

Never steal an existing lock automatically. If a process terminates, preserve a backup of the store and inspect the lock owner/process before an operator removes a stale lock. A prepared transaction blocks further writes. Explicit recovery checks the current snapshot: matching afterSnapshot adds committed; matching beforeSnapshot adds aborted; neither match refuses recovery and requires manual inspection. Recovery never rewrites knowledge.json. Incomplete/corrupt journal files require backup-assisted manual repair; no guessed reconstruction.

## Migration and rollback

No converter or canonical rewrite runs on extension activation. M1 stores are read directly; drafts and history directories are created only by explicit editing/publication. Back up the entire external store before upgrade. M1 can read an M2 canonical snapshot with schemaVersion 1 and ignores extra metadata; it cannot publish or interpret M2 history. To downgrade, retain history/drafts intact and reinstall the prior extension. Restoring an old snapshot backup is a separate explicit maintenance operation; stop writers first and preserve the newer store for recovery. Do not delete published release assets or change their tags.

## Verification

Use self-authored fixtures for draft isolation, stale/revision conflicts, changed review tokens, concurrent writers/readers, exact-byte history, monotonic rollback and prepared-marker recovery. Packaged editor tests cover durable draft editing, dirty editors, candidate diff and unchanged canonical bytes; real user confirmation and Remote SSH UI acceptance are tracked separately from core automation.
