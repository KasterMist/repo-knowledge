# ADR 0017: Explicit v2 core compatibility before runtime activation

Status: accepted for T27.4a only. Date: 2026-11-15.
Depends on [ADR 0015](0015-wiki-articles.md) and [ADR 0016](0016-wiki-generation-staging.md).

## Decision

Introduce one snapshot boundary shared by KnowledgeStore and every complete
before/after publication-history reader and writer. Core callers can explicitly
construct `KnowledgeStore(repository, store, 'wiki-v2')` for compatibility work.
This accepts strict canonical v1 or v2; the default remains `v1`, accepting only
v1. Invalid modes fail immediately. There is no configuration setting, environment
switch, CLI flag, migration command or automatic schema detection in user entry
points. The editor and shipped standalone MCP still construct default stores.

The opted-in parser validates the prepared bounded v2 schema and refuses any
normalization of card/article/repository values. Unrelated human content must not
be trimmed during card-only publication. V1 parsing retains its existing behavior.
RuntimeSnapshot is an explicit v1/v2 union; card changes carry forward the complete
snapshot rather than reconstructing a v1 object from repository/cards alone.

## Card transaction invariants

Existing card draft/proposal/merge, creation/removal, monotonic rollback and marker
recovery use the same store parser for canonical and history snapshots. They keep
the original article arrays, note whitespace, revisions and bindings. Changing a
card does not rebind any article; old references remain visibly changed/missing.
Rollback increases card revision even when restoring old body text, so it also
does not magically make a pinned old revision current.

History envelope versions are independent of knowledge versions: update journal
1 and creation journal 2 retain their formats. Their existing full-snapshot
equivalence checks now cover articles as well. A card-only history entry that
changes/removes articles or switches knowledge format is invalid even when its
digests were recomputed. Existing v1 committed history is readable in an opted-in
v2 store, while a default v1 store refuses v2 history payloads. Pending old-base
records remain stale; no base hash or record version is rewritten or adopted.

Generation packets, job receipts, incremental receipts, dependency baselines and
review tokens already bind the full canonical snapshot digest. They remain
card-oriented metadata formats; this change does not rename them to v2 or add
article updates. Existing changed-base/context/source refusals still apply.
The MCP factory can accept an explicitly opted-in store for isolated protocol
verification. That is different from enabling v2 in the shipped CLI or proving
official Codex consumption.

## Migration, recovery and next gates

No new persistent format or migration transaction is enabled. Tests create v2
only in self-authored isolated fixtures. Production stores/settings/source and
the public M1 asset remain unchanged. A pre-existing user v2 file is still refused
by current default entry points; do not manually edit schemaVersion to work around
that refusal. Backups include the complete store and raw before/after history.

T27.4b must implement reviewed migration and coherent article/card publication
with explicit base/context/source checks, raw-byte backup, pending-record policy,
shared writer serialization, recoverable journals, retained article exports and
safe rollback. T27.4c must wire all editor/MCP entry points together, expose the
review/confirmation UI, test mixed-version refusal, upgrade and recovery, then
activate the compatible runtime deliberately. Default activation must not be
changed just because opted-in tests pass. The ADR 0015 gates remain authoritative.

T27.5 still owns final real Wiki model, visual and required Remote SSH acceptance;
Linux editor-host CI does not stand in for Linux desktop Codex. No model call or
new end-user compatibility claim is part of this slice.
