# ADR 0002: Versioned snapshot and immutable proposals

Status: accepted for M1 implementation. Date: 2026-10-22.

## Decision

Canonical `knowledge.json` uses schemaVersion 1: repository identity and descriptive sourceRevision, up to 200 cards with stable ID, revision, kind, Markdown body, tags, path scopes and evidence. All fields are runtime validated; unknown versions and fields fail closed. Source revision is provenance metadata, not a guarantee that the checkout matches it. Freshness is computed from SHA-256 of whole UTF-8 source files with CRLF normalized to LF, plus bounded line ranges. Missing, escaped, oversized or changed evidence is explicitly stale.

Store location is explicit and can be outside the target repository. Reads and searches never write to the target. The standalone service reloads the snapshot for each request. Multi-root VS Code selection resolves to explicit absolute repository/store arguments rather than ambient cwd. No database, embedding service or model request is needed.

Proposals require both the current snapshot digest and the card revision, preserve the ID and increment revision by one. Evidence must match current source. Each immutable proposal is written exclusively into `proposals/<UUID>.json`. Concurrent changes can make a saved proposal obsolete: every future reviewer/publisher must recheck its base digest and evidence. M1 provides no publish operation. Filesystem containment checks defend against accidental traversal and existing symlinks; this is not an OS sandbox against a hostile local process racing file replacements.

## Migration and rollback

This is the first persisted format; M0 contained no knowledge data. Export any pre-existing custom notes before converting them. Unsupported versions are rejected, never rewritten. Back up knowledge.json and proposals before upgrades. Rollback restores the previous extension/server and matching snapshot backup. Proposals can be archived without altering canonical knowledge. Future format changes require an explicit versioned converter, backup and inverse/rollback instructions.

## Limits

Lexical search supports substring matching for Chinese and code identifiers; semantic retrieval and retrieval-quality claims are deferred. A successful MCP handshake proves transport compatibility only. Official Codex IDE acceptance on both Windows and Linux remains a separate release gate.
