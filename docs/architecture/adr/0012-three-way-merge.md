# ADR 0012: Captured proposal bases and explicit three-way resolution

Status: accepted for T19 development, unreleased. Date: 2026-11-11.

## Decision

New persisted proposals and drafts use schemaVersion 2: the existing proposal
fields plus `baseCard`, captured from the actual validated canonical snapshot.
MCP proposal inputs remain unchanged; stale inputs still fail REVISION_CONFLICT.
The server captures provenance, rather than trusting a model-supplied base.
Canonical/card/history schemas are unchanged. Format 1 records remain readable
and may follow their existing revision-checked path, but cannot three-way merge.

`mergeCards(base,current,proposed)` compares title, kind, body, tags, scope and
evidence independently. If one side changed, retain its change; identical changes
agree. Competing changes produce a conflict and retain current content by default.
Bodies and arrays are atomic: no semantic, line-level or automatic array union.
IDs must match, the suggestion must increment its captured base revision, and
current cannot predate the base. Different contents at the same base/current
revision are rejected. Result revision is current + 1. A default conflict result
is not a resolution or permission to publish.

Explicit Merge Proposal into Draft first opens read-only base/current/proposed,
merged and conflicts. Repeating against the same reviewed token asks confirmation
to create a draft. It never starts a model or publishes. Previously published
sources are refused; a changed preview requires another review.

Immutable `merge-reviews/UUID.json` format 1 stores the review ID, source proposal
ID and text fingerprint, current canonical digest, context token, four cards and
conflict fields. The draft has the same UUID, a captured current base and optional
`merge:{reviewId,resolvedFields}`. Conflicts start unacknowledged. The user edits
the proposed result and explicitly lists every conflicting field as resolved.
Keeping current is a valid deliberate resolution. Submission requires the exact
conflict set without duplicates; removing the merge metadata does not bypass the
receipt. Source proposal changes, mismatched IDs/base and changed Git context
fail closed. Existing current snapshot/revision/evidence validation still applies.

Submission creates a new ordinary format 2 candidate capturing the actual current
base. Existing diff, confirmed publication, history and monotonic rollback apply.
The original suggestion, receipt and human version are retained. No auto-resubmit,
auto-publish or overwrite of the canonical snapshot is introduced.

## Bounds and failure behavior

Use existing contained regular-file metadata reads (1 MiB), exclusive mode-0600
writes with sync and maximum 200 drafts/reviews. Receipt is saved before draft;
a crash may leave an unreferenced receipt, never a partial canonical publication.
Do not delete provenance to resume; preserve the whole store and start a fresh
explicit merge after inspecting failure. Listing is not background generation.
Git binding also refuses legacy merge metadata when adopting a new store.

These are local consistency checks, not signatures or tamper-proof provenance.
Users who deliberately edit immutable metadata or bypass the extension can defeat
the contract. Card content remains untrusted data, not executable instructions.
Existing external checkout race limits from ADR 0011 remain.

## Migration and downgrade

No automatic rewrite of existing files or invented base reconstruction. Existing
format 1 candidates without a base must be recreated against current knowledge
after manually comparing their preserved suggestion. Do not label current content
as an older base. New accepted proposals capture bases automatically.

Older strict readers reject format 2 proposals/drafts and ignore merge-reviews;
they do not implement this protection. Back up the entire store before upgrade.
Downgrade only against an independent backup, never run old/new writers on the
same active store. Keep new records and receipts intact for return to the new
version. This change is development-only, with no release/Marketplace upload.

## Validation

Self-authored tests cover disjoint/identical/conflicting field changes, atomic
arrays, captured-base integrity, legacy refusal, unacknowledged/removed resolution
metadata, stale snapshots/evidence and preservation through confirmed publication
and rollback. Packaged-host report tests and exact-head dual-platform CI are
separate from maintainer Windows/Remote SSH confirmation-dialog acceptance.
