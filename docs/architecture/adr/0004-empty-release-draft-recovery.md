# ADR 0004: Explicit recovery of an empty unpublished release draft

Status: accepted for T10. Date: 2026-10-23.

## Context

The first release run created a draft, then the first asset upload failed with HTTP 415. The upload used a binary Accept response representation even though upload responses are JSON. The draft has no assets and no public tag exists. Blind retries would fail the existing-release guard; deleting the draft or weakening protection for every release is unnecessary.

## Decision

Keep binary Content-Type for upload bodies; request JSON upload responses and binary responses only for GET downloads. An offline protocol replay exercises the real publication script without credentials or network traffic and covers this failure.

Add optional reviewed recovery metadata to .github/release.json containing an exact emptyDraftId and previousSourceCommit. Before build, the read-only gate verifies exact-source main CI, absence of a public tag/release and recovery metadata shape. It must not read private drafts: the second run returned 403 because its contents-read token could not access that draft. After both platform installs, the publish job's existing contents-write token must verify the exact ID/tag/source match, draft=true, prerelease=true, published_at=null and zero assets in both embedded and separately queried asset lists. Only then update that empty draft to the new checked source and upload new assets. Any published, nonempty, mismatched or partially uploaded release is rejected. No DELETE or asset replacement operation is introduced, and the build job gains no write permission.

## Migration and rollback

Existing metadata without recovery retains the fresh-release behavior. No knowledge store or schema changes. Recovery metadata is specific to this interrupted preview; remove it in the next release-preparation PR. Reverting the recovery code restores refusal of any existing draft and preserves the draft/assets. After any public tag/assets exist, repair requires investigation and a new version; never move tags or replace public assets.

## Consequences

The repaired workflow must be explicitly dispatched on the corrected main source after all five CI jobs pass. Re-running the old failed job uses the old script and cannot apply the fix. Offline replay is regression evidence; only a real successful upload and public download/install run establishes completed T10 acceptance.
