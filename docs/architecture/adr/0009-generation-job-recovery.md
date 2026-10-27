# ADR 0009: Explicit generation job recovery and stable candidate identity

Status: accepted for M3 development; Windows/Remote SSH result-recovery UI accepted; missing-result retry/progress cancellation pending. Date: 2026-10-27.

## Decision

After source-transfer confirmation, persist a bounded metadata-only job receipt before starting its producer. Store generation-jobs/UUID.json with schemaVersion 1, jobId, createdAt, the reviewed T14 plan, packetRevision, baseSnapshot, maxPages and timeoutMs. The receipt contains no source packet, prompt, output body, endpoint, executable path, account or token. The job UUID is also its creation-candidate UUID. Existing creation schema 1 and publication journals remain unchanged.

Recover or Retry Generation Job is explicit. It lists saved receipts for the current external store/repository. If the candidate already exists, verify its plan, packet/base, page count and current creation review, then return the same candidate without a model request. A candidate already in committed creation history is reported as previously published, including after removal; it is never regenerated or republished. A stale or invalid saved result is an error, not permission to regenerate it.

Only a job with no candidate can be retried. The user sees its selected files/language/bounds and must confirm a new attempt, with new potential usage. This restarts the bounded producer; it does not continue a model conversation or reuse an upstream thread. Recheck the current packet under an exclusive per-job lease, then recheck it inside the adapter before backend preflight/source transfer. Source/base changes require a fresh plan and job. Each confirmed attempt is bounded; there is no automatic retry or guaranteed aggregate billing limit across user-authorized attempts.

The creation candidate is the durable completed-result checkpoint. If interruption occurs after candidate sync but before UI success, recovery adopts that existing result. Partial model output is never checkpointed or adopted. Failure/cancel before a complete candidate leaves the receipt for an explicit retry. No recovery operation publishes knowledge.

## Concurrency and failure

Create generation-jobs/UUID.lease exclusively, sync it, and remove the owned lease in normal completion/failure cleanup. One producer may run per job; competing attempts return JOB_BUSY. A process crash may leave a lease. Never infer abandonment from elapsed time, a PID or window state, and never take it over automatically. A complete valid result can still be adopted without deleting that lease. If there is no result, stop: an operator must verify the original backend has stopped and preserve a complete store backup before manually removing only that job's lease. A user can instead review a fresh plan for a separate job; warn that an unresolved old backend may still incur usage. Guided abandoned-lease recovery is outside this slice.

Receipts are immutable, exclusively created and fsynced. There is no cross-file filesystem transaction: a crash while creating a receipt can leave invalid metadata. Reject malformed/oversized/identity-mismatched metadata and preserve it for inspection; never repair it by launching a model. Files/directories must resolve inside the external store, without symlink metadata. Repository identity binds a receipt to its original canonical root. Limit receipt creation to 100 jobs and reject metadata listings over 600 entries; preserve complete storage when archiving, including associated candidates/history.

## Migration and rollback

No activation-time migration or model activity. Older candidates without job receipts remain available through New Cards, but cannot be claimed as a completed job or retroactively assigned a receipt. Existing plan/canonical/creation/history formats are unchanged. Older plugin versions ignore generation-jobs; downgrade cannot use its recovery command. Preserve all receipts, leases, candidates and history when backing up or upgrading again. Do not delete creation history or reuse removed identities. Disable the new flow by reinstalling the prior plugin; this does not cancel an unresolved backend process or restore a published snapshot automatically.

## Verification

Self-authored tests cover metadata-only receipts, repeated recovery without another producer, interrupted-after-save adoption, explicit retry after failure, concurrent/abandoned leases, pre-cancelled work, stale-result/source/base refusal, repository binding, metadata identity and symlink containment. Adapter packet mismatch fails before backend preflight. Packaged-editor checks cover command registration and empty-job refusal without model activity. These tests do not establish actual GUI cancellation/recovery clicks, server-crash handling or a hard fee cap. M3 still requires those scoped acceptance results and new-batch publication/removal review.
