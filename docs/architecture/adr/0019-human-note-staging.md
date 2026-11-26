# ADR 0019: Immutable human Wiki note candidates

Status: accepted for inert core staging only. Date: 2026-11-26.

## Decision

Explicit core calls may save format `wiki-note-candidate`, schemaVersion 1 in `wiki-note-candidates/<uuid>.json` inside the configured store. Each strict record contains its UUID, timestamp, SHA-256 identity of resolved repository/store paths, complete captured v2 base snapshot and the strict note-edit request. The full base preserves review context and original human prose; it can contain private knowledge and must follow the store's backup/access policy. No raw source or credentials are added.

Only an existing human note body may change. Canonical snapshot, card proposals and publication history are untouched. A separately created instance can list/read candidates, revalidate the complete captured edit, and compare its base to current canonical knowledge. Changed bases remain readable as `changed`, never silently rebased. `current` is a knowledge comparison, not proof of current source evidence or historical intent. Identity is a local routing guard, not a signature against malicious local editing.

Records are bounded to 1 MiB, requests to 8000 body / 2000 reason characters; save refuses inventories at 100 entries, list refuses inventories over 200. Concurrent saves may cross the advisory inventory threshold; each file is exclusively named. Save writes/syncs a private temporary file, rechecks canonical base and store identity, then hard-links the complete file without overwriting a destination. Directory/file symlinks and escapes are refused. Filesystem failures propagate. A crash before link can leave an ignored temporary file; after link the complete candidate survives cleanup failure. No automatic recursive cleanup or adoption occurs. Trusted local filesystem assumptions match existing staging; path checks do not isolate hostile concurrent filesystem mutations.

## Migration and rollback

No startup migration or automatic activation. Existing v1/v2 snapshots and history versions do not change. Older builds ignore this dedicated directory. Downgrade by preserving the entire store and reinstalling the previous extension; inert candidate files may remain for later recovery. Backup/export before any manual removal. No public UI, MCP mutation, model request, publisher or rollback operation is enabled by this increment.

## Next gate

Before exposing an article editor, define reviewed note publication and monotonic rollback history in a separate ADR, bind review receipts to exact candidate/canonical/source state, use the existing writer lock and atomic/recovery discipline, and add graphically independent confirmation. Do not disguise note edits as create-wiki/remove-wiki history or overwrite those records. Tests cover restart/read, canonical-byte preservation, stale bases, foreign-store rejection, forged fields and escaping staging directories.
