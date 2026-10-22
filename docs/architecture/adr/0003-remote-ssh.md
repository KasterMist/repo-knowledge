# ADR 0003: Execute beside the repository on Remote SSH

Status: accepted implementation direction; real Remote SSH editor/agent acceptance is a release gate. Date: 2026-10-22.

## Context and decision

Windows VS Code connected through Remote SSH to a Linux repository is a required workflow. Install Repo Knowledge as a workspace extension on that SSH host. Core, source reads, knowledge/proposal storage and the independent STDIO MCP child all execute there. The Windows client displays the UI. No public HTTP service, credential forwarding or plugin-managed SSH login is required.

Keep VS Code URI routing separate from Node filesystem paths. Validate env.remoteName, platform and workspace/extension/storage URI roles. Accept native file workspaces and Linux ssh-remote hosts. Preserve the remote authority when opening knowledge files and demo folders in the editor. Reject mixed SSH authorities, a remote URI in a local host, other virtual workspaces and Windows configured storage paths on Linux. VS Code's internally provided vscode-userdata storage URI is allowed with its absolute host filesystem path; that exception does not allow virtual workspace folders.

On Remote SSH, the default nodeExecutable value uses process.execPath: the real VS Code Server Node binary in a separate MCP process. This avoids requiring npm or system-level installation. An explicit absolute remote Node setting takes precedence. Native Windows keeps its external Node command. Native development remains pinned to Node 24.19.0; actual remote MCP acceptance also covers the installed Node 22.22.1. Regenerate MCP configuration if a VS Code Server upgrade changes the binary path.

The generated TOML contains absolute remote filesystem paths. Configure the Codex backend on the same host; inspect its active config through the official settings UI. A local Windows Codex backend cannot execute these Linux paths directly. Installed extension metadata and a successful protocol probe do not prove the active Codex conversation has consumed the tools. Do not silently add an SSH proxy or alter the user's global Codex configuration.

## Validation and privacy

Unit tests cover host/path isolation and native regressions. Actual SSH acceptance uses an isolated self-authored demo and official SDK client to the remote Node STDIO process. Credentials, host addresses, account paths, user configuration and private repositories are excluded from public source and evidence. Real editor routing, official Codex tool calls and new-conversation reuse must be recorded separately.

## Migration and rollback

Knowledge schemaVersion 1 is unchanged; no data migration is needed. Back up existing stores before changing settings. Rollback the VSIX and remove or restore only the corresponding MCP table. No global settings are automatically rewritten. Cached acceptance demos can be retained or removed by the maintainer separately from any target repository.
