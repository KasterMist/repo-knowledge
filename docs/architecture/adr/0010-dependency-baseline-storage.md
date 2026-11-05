# ADR 0010: Explicit immutable dependency baselines

Status: accepted for T17 development; no-change Windows/SSH UI accepted; changed-report UI pending. Date: 2026-11-04.

User-invoked Capture Dependency Baseline saves the reviewed scan and metadata-only card dependencies to external dependency-baselines/PLAN-UUID.json. Format 1 is the existing baseline schema: schemaVersion, plan, snapshotRevision, cards (id/scope/evidence only), and revision checksum. No source, card body, prompt, endpoint or credential is saved. The checksum detects accidental mutation, not forgery.

Files are exclusively created with restrictive permissions and synced; existing records never overwrite. Limit each file to 1 MiB and directory to 100 entries. Cancellation/failure removes only the file owned by this save. A process crash may leave malformed metadata: preserve it for operator inspection, reject it and never silently repair/replace it. Directory/file symlinks or paths inside the source repository are refused. This is not isolation against a malicious filesystem actor.

Review Knowledge Changes explicitly selects a baseline and shows a read-only JSON report, including changed files' reverse evidence/scope dependencies. Canonical changes or another root reject review; incomplete coverage remains unknown. No activation-time scan, watcher, model request, candidate write or publication occurs. Reports are static observations, not atomic repository snapshots or branch isolation. Dirty editors block these commands; cancellation or workspace/configuration changes abort the active scan.

No automatic migration. Older extensions ignore this directory; downgrade retains canonical/job/history formats unchanged. Back up the complete store before archiving baselines. To roll back this feature install the preceding extension, retain baselines for later upgrades, and never delete publication history. Rename inference, guided baseline archive, navigation shortcuts and actual two-platform UI acceptance remain separate T17 work.

Report-only possibleRenames may suggest unique-content matches under complete coverage; add/delete and old missing evidence remain authoritative. No baseline migration or automatic rebinding. No-change capture/select/report UI is accepted on both hosts; changed-report UI remains separate.
