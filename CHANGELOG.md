# Changelog

## Unreleased

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
