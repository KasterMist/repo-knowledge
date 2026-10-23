# Changelog

## Unreleased

- Keep the release build gate read-only: defer private draft inspection to the existing contents-write publish job. Add read-only token replay for the second-run HTTP 403 failure.

- Fix GitHub asset upload HTTP 415 by requesting JSON responses for binary POST bodies; keep binary response negotiation for GET downloads. Add offline publication replay and exact empty-draft recovery guards (ADR 0004).

## 0.1.0-alpha.1 — release preparation

- Product/VSIX version 0.1.0; GitHub-only prerelease tag v0.1.0-alpha.1. Publication is pending the manual release workflow, not implied by this entry.
- Complete scoped Windows-native and Windows Remote SSH to Linux official Codex acceptance and temporary-configuration cleanup; native Linux desktop Codex remains unverified.
- Derive artifact names from validated release metadata, check packaged/server versions and reject checksum mismatches.
- Add a manually dispatched GitHub release workflow: exact-source five-check gate, one payload, Windows/Linux install validation, draft-byte verification and anonymous public download/install checks. No Marketplace publishing or model calls.

- Diagnose unavailable/malformed knowledge stores before MCP startup so validation failures remain actionable; failed connections now point to the host's nodeExecutable setting and bundled server.
- Add isolated editor error/recovery and non-overwriting initialization checks, with pinned VS Code 1.117.0 Windows/Linux host CI and sanitized result artifacts.

- Fix Remote SSH diagnostics and editor opening when VS Code exposes file URIs inside the remote extension host; delegate authority mapping to VS Code instead of requiring or fabricating it.

- Remote SSH implementation preview: preserve remote editor URI authority, isolate host filesystem paths and use the existing remote VS Code Server Node for independent MCP startup.
- Real Linux SSH protocol loop and native Windows host regression; actual Remote SSH editor/Codex conversations remain a release gate.

- M0: npm workspaces and strict TypeScript package boundaries.
- Shared engineering checks and policy failure tests.
- Windows/Linux CI matrix and Unicode/space-path bootstrap fixture.
- Apache-2.0 licensing, bilingual project status and contribution/release documentation.

- M1 implementation preview: schemaVersion 1 snapshots, bounded evidence reads, lexical search and freshness checks.
- Standalone MCP search/read/status and revision-checked update proposals; published knowledge is never overwritten by tools.
- VS Code card search, external-store initialization, demo, standalone diagnostics and Codex configuration preview.
- Bundled VSIX candidate with third-party notices. Official Codex IDE Windows/Linux acceptance remains required; no alpha or Marketplace release is claimed.
