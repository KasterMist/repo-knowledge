# ADR 0001: Cross-platform TypeScript workspace

Status: accepted for M0. Date: 2026-10-22.

## Context

Windows and Linux must run the same engineering workflow. The eventual MCP service must not require the editor process, and knowledge rules must not be duplicated in UI and protocol implementations.

## Decision

Use npm workspaces and strict TypeScript, with core, mcp-server and vscode-extension package boundaries. M0 entry points are deliberately empty. Add the generator adapter when generation work begins rather than shipping a misleading no-op backend.

Pin Node 24.19.0, npm 12.2.1 and dependency versions with a committed lockfile. Scripts use Node APIs and `process.execPath` with argument arrays. CI requires Windows and Ubuntu jobs, read-only token permissions and immutable Action refs.

M0 policy tests reject accidental package publication, inconsistent versions and removal of a required CI platform. Integration tests copy actual build outputs into an isolated Unicode/space path and import them in a fresh process, without relying on shell syntax or editor APIs.

## Consequences

No runnable product or VSIX is available in M0. Knowledge schema, MCP operations, extension activation, generation, migrations and actual Codex integration must be implemented and tested in subsequent tasks. Root/internal packages stay private; public GitHub source does not imply npm publication.
