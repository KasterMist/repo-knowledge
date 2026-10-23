# Repo Knowledge

[简体中文](README.zh-CN.md)

Shared repository knowledge for developers and coding agents, targeting VS Code on **Windows and Linux**.
Windows VS Code **Remote SSH to Linux is a required workflow**. See the [Remote SSH setup and acceptance guide](docs/user/remote-ssh.zh-CN.md).

## Status: M1 implementation preview

Implemented: runtime-validated knowledge cards, source freshness checks, lexical search, standalone STDIO MCP tools, immutable update proposals and VS Code commands for browsing, diagnostics and Codex configuration. Includes a self-authored three-card demo.

Build a local VSIX candidate with the commands below. **The first alpha targets Windows-native Codex and Windows Remote SSH to Linux; remaining acceptance still gates release.** Native Linux editor-host CI is separate from native Linux desktop Codex, which remains unverified and outside the first alpha's compatibility claim. Protocol tests alone do not establish Codex integration. No Wiki generation, proposal review/publication UI or Marketplace release is available. See the [project task/status checkpoint](docs/development/project-status.zh-CN.md), [M1 acceptance](docs/development/m1-acceptance.md) and the [roadmap](docs/product/roadmap.md).

## Planned workflow

The user decides whether to generate Wiki pages and knowledge cards, selects the scope and explicitly starts generation. Read a structured Wiki, correct shared cards and let Codex retrieve evidence through MCP. Source changes can be checked for staleness; regeneration and incremental updates are also user-initiated and produce candidates for user review and confirmed publication. Human edits and source versions must be preserved. This means persistent project knowledge, not model training.

## Development

Use Node.js **24.19.0** and npm **12.2.1** on Windows or Linux:

```text
npm install --global npm@12.2.1
npm ci
npm run check
npm run build
npm run package:vsix
```

Install the resulting `dist/repo-knowledge-0.0.0.vsix` through VS Code's Install from VSIX command. Run **Repo Knowledge: Open Three-Card Demo**, trust the self-authored demo, then **Search Cards**, **Diagnose Standalone MCP** and **Show Codex MCP Setup**. Merge the generated table into Codex config.toml and restart Codex. The command previews configuration and does not overwrite existing settings. See the [Chinese setup guide](docs/user/quickstart.zh-CN.md).

Native preview uses an external Node 24.19.x executable. On Remote SSH, the default uses the remote VS Code Server Node in a separate process (remote MCP tested on Node 22.22.1), so npm/system installation is unnecessary. An absolute `repoKnowledge.nodeExecutable` overrides the default. The declared VS Code minimum is provisional; real Remote SSH editor/Codex acceptance remains a release gate.

## Architecture

- `packages/core`: editor-independent knowledge boundary.
- `packages/mcp-server`: independently launched protocol service.
- `packages/vscode-extension`: editor commands and bundled standalone server.

No model requests or credential reads run in the plugin. Tools read the explicit knowledge store and cited source files. Update proposals write only to the store; they never publish themselves or modify target source. Card content is untrusted data. Do not put secrets in cards or upload private source to bug reports.

## Contributing and licensing

[Contribution guide](CONTRIBUTING.md) · [Support](SUPPORT.md) · [Security](SECURITY.md) · [Release process](docs/development/releasing.md)

Licensed under [Apache-2.0](LICENSE). Copyright 2026 KasterMist and contributors. Independent community project; not affiliated with OpenAI or Qoder.
