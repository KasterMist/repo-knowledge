# ADR 0011: Explicit worktree/branch binding and reviewed context

Status: accepted for T18 development, unreleased. Date: 2026-11-10.

## Decision

An initialized Git repository must use an external store explicitly bound with
`Bind Repository Context`. The immutable `repository-context.json` format 1 is
`{schemaVersion:1, identity:SHA256}`. Identity hashes canonical selected root,
worktree root, Git directory, common directory and symbolic branch (or detached
HEAD). Linked worktrees, moved/copied roots and different branches do not share
bindings. Advancing HEAD on the same symbolic branch preserves store identity.
The user selects a separate store for each context; no automatic rebinding or
branch checkout occurs. Non-Git directories retain their existing behavior.

Core reads bounded metadata directly: `.git` directory/gitdir file, `commondir`,
HEAD, loose/packed branch ref and binary index. It executes no Git command,
hook, filter, target code or network request. Symlink metadata leaves, malformed
refs and oversized metadata fail closed. The shared bounded reader limits each
metadata file to 1 MiB, including the index. Unsupported repositories must not
be treated as verified. These fingerprints are consistency checks, not signatures
or protection against a hostile concurrent filesystem writer.

Git scan plans retain schemaVersion 1 and add optional `context` with identity
and revision digests. The revision hashes identity, HEAD, resolved commit and
index bytes. Context participates in the manifest checksum. A scan checks context
before and after inventory. Revalidation requires exact context and the same
selected saved-source inventory/hashes. Generation jobs and creation publication
already revalidate plans; this therefore covers generation, retry and publication.
Dependency impact review compares identity only so it can report changed source
and commits on the same branch. It still refuses cross-context baselines.

All knowledge snapshot consumers, including MCP, check binding. Publication review
tokens include the context revision; atomic replacement retries recheck context
as well as existing snapshot/evidence validation. Unsaved editor checks remain
separate. Selected dirty source changes are detected by source hashes, including
when Git status would still say modified. Unselected saved files are outside the
generation contract; this is not a global dirty-state inventory. Git index rewrites
may conservatively invalidate a plan even with equivalent staged content.

No filesystem-wide transaction with external checkout is possible here. Checks
are bounded observations with a residual race after the final check. Do not claim
atomic checkout isolation or whole-repository semantic dependency tracking.

## Migration and rollback

No automatic migration. Back up the entire old store. Initialize a fresh external
store, bind explicitly to the intended worktree/branch, then create fresh plans,
candidates and dependency baselines. Binding refuses nonempty old plans, jobs,
drafts, proposals, creations or history: their original branch is unknowable.
An existing canonical snapshot alone can be explicitly adopted by binding; this
does not certify its facts, which retain ordinary evidence freshness checks.
Binding does not alter `knowledge.json` or copy private paths into public data.

Old non-Git plans remain valid in non-Git directories. Old context-free Git plans
are refused; rescan rather than editing JSON or inventing a context. Context-bearing
plans are rejected by older strict readers. Canonical/card/proposal/history
schemas remain unchanged. Older versions ignore the binding and cannot enforce
its guarantees: downgrade only against a separately backed-up store, never use
old and new writers concurrently, and retain the bound store unchanged for return.
Do not delete/edit the binding to bypass a mismatch. A moved worktree gets a fresh
store. No public release or Marketplace upload is part of this change.

## Validation

Self-authored boundary fixtures cover explicit binding, branch return, copied and
linked worktrees, unborn/packed/detached HEAD, index changes, scoped dirty source,
legacy rejection and stale review refusal with unchanged canonical bytes.
Windows/Linux CI and actual packaged editor tests are required; interactive
Windows/Remote SSH binding/confirmation acceptance is recorded separately.
