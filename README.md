# Repo Knowledge

[简体中文](README.zh-CN.md)

Shared repository knowledge for developers and coding agents, targeting VS Code on **Windows and Linux**.

## Status: M1 implementation preview

Implemented: runtime-validated knowledge cards, source freshness checks, lexical search, standalone STDIO MCP tools, immutable update proposals and VS Code commands for browsing, diagnostics and Codex configuration. Includes a self-authored three-card demo.

Build a local VSIX candidate with the commands below. **Official Codex IDE acceptance on Windows and Linux is still required before an alpha release.** Protocol tests alone do not establish that integration. No Wiki generation, automatic publication or Marketplace release is available. See [M1 acceptance](docs/development/m1-acceptance.md) and the [roadmap](docs/product/roadmap.md).

## Planned workflow

Read a structured Wiki, correct shared knowledge cards, let Codex retrieve evidence through MCP, and review incremental updates when source files change. Human edits and source versions must be preserved. This means persistent project knowledge, not model training.

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

The external MCP process requires Node 24.19.x for preview acceptance; set `repoKnowledge.nodeExecutable` to an absolute executable path when Node is not on PATH. VS Code's embedded Node and this external runtime are distinct. Preview compatibility requires actual host acceptance; the declared VS Code minimum is provisional.

## Architecture

- `packages/core`: editor-independent knowledge boundary.
- `packages/mcp-server`: independently launched protocol service.
- `packages/vscode-extension`: editor commands and bundled standalone server.

No model requests or credential reads run in the plugin. Tools read the explicit knowledge store and cited source files. Update proposals write only to the store; they never publish themselves or modify target source. Card content is untrusted data. Do not put secrets in cards or upload private source to bug reports.

## Contributing and licensing

[Contribution guide](CONTRIBUTING.md) · [Support](SUPPORT.md) · [Security](SECURITY.md) · [Release process](docs/development/releasing.md)

Licensed under [Apache-2.0](LICENSE). Copyright 2026 KasterMist and contributors. Independent community project; not affiliated with OpenAI or Qoder.
