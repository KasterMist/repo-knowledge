# ADR 0006: Explicit bounded static generation plans

Status: accepted for M3/T14. Date: 2026-10-24.

## Decision

Add an editor-independent static scan boundary and two explicit editor commands: Plan Knowledge Generation and Save Generation Plan. Activation, saves, source changes and branch changes never scan or generate. T14 does not start Codex, call a model, transfer source, create knowledge candidates or publish.

Users choose include/exclude POSIX globs, intended output language, maximum selected file count and total bytes. The initial UI limits each file to 64 KiB; the core accepts up to 256 KiB, 200 files and 2 MiB total. Hard traversal limits are 10,000 directory entries and depth 32. Globs support only *, ** and ? with case-sensitive matching, including on Windows; unsupported shell syntax/traversal is rejected. No target shell command, build or test is invoked.

Always exclude common credential files, repository/agent/editor metadata and tool environments. Skip symlinks, including contained links, rather than traversing them. The configured knowledge store is excluded, even when inside the repository. Nonregular files, invalid UTF-8, NUL-containing binary content, unreadable files and budget limits have separate counters. Counts for mandatory exclusions do not expose private filenames in saved plans. This is a conservative filter, not proof that remaining text contains no secrets. Later generation must separately preview and confirm transfer of selected text.

The preview is an immutable virtual JSON document. Explicit save re-scans before persisting an immutable external-store plans/UUID.json with schemaVersion 1. The envelope has id, createdAt, repositoryId (SHA-256 of resolved root path), options, selected files (relative path, normalized source SHA-256, raw byte length, line count), summary (visited entries, selected bytes, limited flag and skipped counters), and manifestRevision. The manifest digest binds repositoryId/options/files/summary, excluding id/time. It is not a Git commit or a cryptographic authorization token. Any changed scope, source, included file set or coverage counters requires a new reviewed plan.

Saving requires an external directory; resolve existing parent links before creating a missing path so a configured alias cannot create directories inside the target. Check the plans directory for existing symlinks, use exclusive files and cap it at 200 entries. A failed/cancelled save removes only its newly created UUID file. No canonical snapshot is required and none is written. Future generation must validate the plan again and reject unsupported/incomplete inputs rather than claiming full coverage. The current static read boundary is not an OS sandbox against hostile concurrent filesystem replacement.

## Compatibility, migration and recovery

knowledge.json and the four MCP tools are unchanged. No plans directory is created automatically. M1/M2 ignore the additional metadata. No migration is needed for an existing store; back it up before upgrading. Unsupported plan schemas are rejected. Plans contain metadata only and can be archived or removed explicitly without changing canonical knowledge or proposals. To downgrade, reinstall M2 and retain or archive plans. To resume a cancelled scan, invoke planning again; T14 has no model job to resume and does not reuse a partial scan as a complete plan.

## Verification

Use only self-authored fixtures: Unicode/case-sensitive globs, mandatory exclusions, invalid UTF-8/binary files, limits, cancellation, changed sources/new files/different roots, immutable external save and existing symlink/ancestor alias rejection. Real packaged Windows/Linux editor hosts validate explicit command preview and external save, keeping canonical bytes unchanged. Node 22.22.1 and Remote SSH runtime verification are separate from model-generation acceptance.
