# ADR 0013: Explicit one-card incremental updates and attempt receipts

Status: accepted for T20 development, beta acceptance pending. Date: 2026-11-11.

## Decision

Keep first generation new-ID-only. Generate Card Update requires an explicitly
reviewed current scan plan and one selected existing card. Modal confirmation
lists the saved source paths, selected card, language and limits before backend
preflight/source transfer. All dirty editors block; workspace/config changes,
disposal and progress cancellation abort the owned task. New-card generation and
incremental commands share the editor busy guard. Recovery never invokes a model.

The existing restricted Codex turn is shared: known CLI/model configuration,
disabled execution surfaces/inherited MCP/project instructions, external scratch
and executable checks, ephemeral read-only thread and bounded authoritative JSON.
No model/provider/login/proxy change, shell/tool execution or background task is
added. A card's current text and only the confirmed saved-source packet are sent.
Selected source must intersect the card scope. Output contains exactly that stable
ID once; references/scopes must be inside selected current sources. Core assigns
current revision + 1 and current source hashes. A changed source/HEAD/index/branch
or canonical snapshot rejects the result before saving. There is no automatic
merge of a response against knowledge changed during its model turn.

Incremental results use ordinary format-2 proposals with captured baseCard and
existing review/confirmed publication/T19 merge/history. Canonical knowledge is
never written by generation. The existing proposal API gains optional internal
stable-ID and cancellation arguments; MCP inputs are unchanged. IDs are UUIDs,
exclusive writes cannot overwrite existing proposals, and interrupted owned
writes remove only the file they just created after closing its handle.

## Metadata and recovery

External `incremental-attempts/UUID.request.json` format 1 records attempt/time,
card ID/base revision, canonical digest, metadata-only scan plan and packet digest.
It contains no source text, prompts, credentials or provider responses. It is saved
before backend startup. At most 200 attempts/400 entries, with contained regular
files and 1 MiB reads. Git context adoption refuses pre-existing attempt metadata.

`UUID.result.json` format 1 records saved/failed/cancelled, monotonic elapsedMs,
submittedTurnRequests (0 or 1), observedTokens (nullable) and a fixed error code.
The counter means a local turn/start request attempt after local budget validation;
it is not a billed upstream-call count or proof of provider execution. Missing or
delayed token usage is null. One task has a 60-second total deadline, 64 KiB output
and existing packet/event/observed-token limits; these are not a precise price cap.
Failed preflight may leave a request with zero turn requests. An interrupted
result receipt may be missing; do not infer zero usage from missing metadata.

The proposal UUID equals the attempt UUID. Recover Incremental Result reads the
request, any result metrics and the actual proposal/history. It returns no-result,
pending-review, needs-merge, needs-source-refresh or previously-published without
model work or publication. A candidate saved before a receipt failure remains
recoverable by its stable ID; partial/invalid metadata fails closed for manual
inspection. There is no automatic resumption or takeover. A retry is a new explicit
Generate Card Update with fresh confirmation and may incur new usage.

Requests/results are exclusive mode-0600 writes with sync. Crashes can leave
incomplete metadata, not an automatic canonical replacement. Preserve complete
storage on corruption. Digests are consistency checks, not signed provenance;
external filesystem/checkout races retain ADR 0011 limitations.

## Migration and rollback

No automatic migration. Canonical/card/scan/proposal/history formats remain at
their existing versions. Incremental metadata is new format 1; old clients ignore
it and cannot recover these attempts. Format-2 proposal downgrade restrictions
from ADR 0012 still apply. Back up the complete store; old/new writers must not
share an active store. No public beta asset/tag or Marketplace upload is implied.

Knowledge rollback still requires valid source evidence. Restoring old text whose
old source hashes no longer match is refused with STALE_EVIDENCE. For the beta
round-trip test, restore only the self-authored fixture source to its saved original
bytes before reviewing/confirming knowledge rollback. This proves source-consistent
rollback, not arbitrary restoration of outdated facts against changed source.
Deleted/renamed scopes with no selected overlap require deliberate scope/card
maintenance; this first beta is a bounded single-card update, not whole-repository
multi-pass regeneration or semantic dependency analysis.

## Validation

Deterministic self-authored response tests exercise impact detection, validation,
pending proposal, repeated no-model recovery, confirmed publication, unaffected
cards and source-consistent monotonic rollback. Separate JSONL peer tests verify
attempt counting and budget rejection. Mock responses do not establish real model
acceptance. Actual Windows/Remote SSH generation, output quality, timings, review
and rollback remain separate gates, with independent store/MCP inspection.
