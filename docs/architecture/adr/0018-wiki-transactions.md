# ADR 0018: Reviewed Wiki transactions and reversible migration

Status: accepted for T27.4b core operations. Date: 2026-11-15.
Depends on ADR [0015](0015-wiki-articles.md), [0016](0016-wiki-generation-staging.md) and [0017](0017-wiki-runtime-compatibility.md).

## One writer, one snapshot

Extend KnowledgePublication's existing exclusive `.publication.lock`, atomic
same-directory replacement and recoverable before/after history. Do not introduce
a separate Wiki writer or sidecar publication. An explicitly opted-in core store
can preview/confirm migration, joint article/card creation and their rollback.
Default editor/CLI stores stay v1 and no user command/setting is added here.
T27.4c must integrate the UI and activate all compatible entry points together.

New history envelope version 3 has operations `migrate-wiki`, `restore-wiki`,
`create-wiki`, `remove-wiki`, transaction/item IDs, card/article IDs, timestamp,
normalized snapshot fingerprints, **raw** before/after SHA-256 and the sorted
committed transaction IDs that preceded this operation. Envelope version 3 is
independent of canonical knowledge schema 2. Existing journals 1/2 are unchanged.
The raw digest does not normalize CRLF or discard a BOM; `fingerprint` retains its
existing normalized-text meaning. Hashes are consistency checks, not signatures
or authenticated authorship.

Preview returns complete before/after values, operation/reason, retained-metadata
count/revision and a context-bound token. Confirming recomputes it under the same
writer lock. Candidate, source packet, knowledge base, Git HEAD/index/branch,
canonical raw bytes, retained metadata or committed history changes invalidate
the token or are rejected. Recheck before every atomic-replace attempt. Validate
the semantic transition before writing history. Retain the original raw bytes,
exact target bytes and record, sync files, atomically replace canonical knowledge,
then write the committed marker. No model call or target-source write occurs.

## Migration and old pending records

Migration is a separate explicit review of a strict v1 snapshot to v2 with empty
articles. Preserve all card/repository values and refuse normalization. Inventory
proposals, drafts, creations, generation jobs, incremental attempts, merge reviews,
Wiki candidates, plans and dependency baselines: at most 128 regular JSON files,
4 MiB total, with existing per-file/directory limits. Symlinks, unexpected files,
leases, temporaries and unrelated prepared history fail closed. Bind the inventory
to raw content hashes and committed transaction IDs, not only a file count.

Keep old records byte-for-byte in place. Do not relabel, rewrite or automatically
publish them. Their old base generally becomes stale. Existing explicit merge or
new generation may establish a new base; this migration does not do so. Metadata
producers do not all share the canonical writer lock: a late independently saved
proposal remains subject to its own old-base guards, never a second canonical
publication. Back up the complete store, including retained pending records.

A staged Wiki generated before migration can be **explicitly** reviewed afterward
only when the current head is exactly a retained committed empty-article migration
whose before digest matches its saved base. Rebuild the complete source packet,
verify the saved packet using the original base, and revalidate the output against
current sources. The new review identifies `adaptedFromMigration`; it neither
rewrites the envelope nor reuses an unreviewed old token. Any other base change is
refused. Migration must not be hidden inside generation or publication.

## Joint creation and article retention

One target snapshot appends the generated cards and articles together. Preserve
existing cards, article values and human notes. Derive references/authorship using
the generation validator. Append new root articles after existing roots, preserving
their relative order; show that deterministic ordering in the review. Canonical
limits, duplicate/retired IDs, hierarchy and pinned bindings must all validate.
Every generated card is referenced by a fact block, every article has a fact block,
and model prose cannot become human rationale. Generation prompts receive existing
and retired article IDs as well as reserved card IDs. No article bodies or human
notes are added to those ID lists.

Creation rollback removes exactly its article/card batch only at the unmodified
head. The retained creation `after.json` and rollback `before.json` are complete
article exports; never delete them. Card and article IDs remain permanently
reserved. A later card edit preserves articles and leaves old bindings visibly
stale; it cannot be bypassed by removing the original Wiki batch.

Migration restoration writes the retained original bytes only at the untouched
migration target, with no later committed transaction. Even a create/remove cycle
returning identical canonical bytes blocks restoration. Captured predecessor IDs
distinguish this case without timestamp ordering; a newly reviewed migration after
a legitimate restoration may itself be restored. Nonempty article content is never
stripped to make an old binary work, and no rollback crosses a later publication.

## Recovery, compatibility and activation

Prepared v3 history blocks other writers. Explicit recovery compares the expected
current digest with both retained sides: mark committed when applied, aborted when
unapplied, refuse divergence; do not rewrite canonical content during marker
recovery. Validate raw digests, semantic deltas, inverse source links and predecessor
sets. Bound inverse traversal to eight entries and reject cycles. A malformed or
partial history/lock is preserved for inspection rather than silently taken over.

The shared history reader recognizes v3 only with snapshots allowed by its store.
The default v1 editor/MCP runtime is deliberately not activated; old writers refuse
unknown v3 history. After exact v1 restoration, older readers may read cards but
older publication remains unsupported. Preserve the history and use compatible
binaries; never delete v3 records to force old writes. There is no downgrade by
discarding articles. T27.4c must make these rules visible and test editor/MCP
activation, mixed-version refusal and user confirmations before release.

Self-authored transaction/protocol tests are separate from real model quality,
visual inspection and Remote SSH acceptance, which remain T27.5 gates.
