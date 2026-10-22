# Remote SSH implementation and evidence

Date: 2026-10-22. Tracking: [Issue #5](https://github.com/KasterMist/repo-knowledge/issues/5), parent [M1 #3](https://github.com/KasterMist/repo-knowledge/issues/3).

## Observed environment

The maintainer-provided SSH server is Linux x86_64 with Python 3.12.3, VS Code Server and its Node 22.22.1. npm is not present on the inspected noninteractive PATH. Official Codex extension 26.51007.21434 is installed remotely and a remote Codex backend executable is running. This establishes deployment evidence, not MCP tool use in a Codex conversation.

Connection used the local credential file only inside an ignored helper, and verified the server key against existing known_hosts. Credentials, server address, account paths, SSH logs and user configuration are intentionally absent from this public report. No target project was read or executed. All remote writes are limited to the self-authored acceptance demo/cache and installation of this project's candidate extension.

## Passed

- Local Windows shared checks: 11 unit tests and 2 process/actual-VSIX tests, including host isolation, internal vscode-userdata storage and native-path regressions.
- Actual Windows VS Code 1.117.0 isolated-profile candidate: activation, six commands, snapshot editor, Codex TOML preview and a real standalone MCP diagnostic child process.
- Authenticated SSH to actual Linux Node 22.22.1: official SDK handshake, four tools, three cards and source excerpts. Two separate server processes retrieved the same canonical knowledge and each saved a pending proposal; incorrect base revision returned REVISION_CONFLICT.
- Remote canonical knowledge.json remained byte-identical to the original demo after proposals. The candidate installed into the remote VS Code Server. Only the new demo's project-level MCP table was prepared; user-level Codex configuration was not edited.

## Still required

- Record final PR Windows/Linux CI and candidate artifacts.
- In a real Remote SSH editor, verify demo remains remote, snapshot URI routing and all six commands.
- In the official Codex IDE conversation, verify four-tool behavior and a genuinely new-conversation retrieval; capture stale/conflict recovery with the copied demo.
- Retain the native Linux editor gate from M1 where applicable; Linux CI and an SSH protocol test alone do not establish every editor configuration.
- Release alpha only after the actual host/agent gates in [M1 acceptance](m1-acceptance.md).

Use the [Remote SSH guide](../user/remote-ssh.zh-CN.md) for manual steps. Local helper paths and private server coordinates are kept outside tracked source. The plugin itself does not read credentials or implement an SSH client.
