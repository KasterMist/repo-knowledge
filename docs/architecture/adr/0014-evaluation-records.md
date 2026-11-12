# ADR 0014: Offline observational evaluation records

Status: accepted for T21 preparation, 2026-11-12.

## Decision

Evaluation tooling lives in `scripts/evaluation.mjs`, outside the product. It
creates only self-authored static source and external schema-1 knowledge stores
in a new OS temporary directory. It neither starts Codex nor executes the source.
No product command, model request, credential or configuration change is added.

The reviewer maintains a separate version-1 observation JSON with fixed fixture
and prompt hashes, host/arm identity, independent-conversation labels, observed
versions, timestamp, evidence provenance, transcript checksums, nullable metrics
and manually judged criteria. This is experimental metadata, not a knowledge
store or telemetry. It is never automatically uploaded. A checksum establishes
artifact identity, not that a human's observation or rating is true.

Missing/unperformed results remain unknown. Duplicate arms/conversations, drift,
out-of-bound data and fabricated completion without evidence fail validation.
Completed but contaminated observations remain visible and ineligible. Tool use
reported only by an agent/user is distinguished from reviewer-observed calls.
An eligible natural run may make zero calls; that is a result, not a validator
failure. Aggregate coverage does not certify quality or statistical significance.

## Migration and rollback

Version 1 is new and optional. Existing product stores, jobs, proposals and
configuration are unchanged and require no migration. Unknown versions fail
closed; a later protocol revision must use a new version and preserve original
records rather than silently regrade them. Rollback removes only the evaluation
scripts/docs; keep experiment records separately for audit. Temporary directories
are not deleted automatically. Never recursively delete a path supplied by a
record; review the exact owned temporary directory before manual cleanup.

The optional `environment.reasoningEffort` field is an additive version-1
extension: existing four-field environments remain readable, while omitted/null
effort cannot establish comparable environments. New observations should record
the actual effort or null, never guess it. Earlier readers may reject the extra
field; preserve such records when rolling back rather than deleting metadata.

## Limits

Directory separation is procedural, not an OS access-control sandbox. Baseline
is valid only if the reviewer confirms no knowledge tools/other stores, previous
conversation or scoring material were used. Tool registration and server
instructions are part of the knowledge treatment and must be disclosed. Human
rationale supplied only to the knowledge arms is additional information, so its
recovery measures information access, not a pure retrieval-speed improvement.
