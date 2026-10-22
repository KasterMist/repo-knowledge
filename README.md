# Repo Knowledge

[简体中文](README.zh-CN.md)

Shared repository knowledge for developers and coding agents, targeting VS Code on **Windows and Linux**.

## Status: M0 engineering foundation

This repository currently contains an npm/TypeScript workspace, package boundaries, contribution documentation, repository checks and a Windows/Linux CI matrix. Package source files deliberately have no product behavior.

**There is no installable extension, MCP server, Wiki generation or Codex integration yet.** These are tracked in the [roadmap](docs/product/roadmap.md). No Marketplace release is available.

## Planned workflow

Read a structured Wiki, correct shared knowledge cards, let Codex retrieve evidence through MCP, and review incremental updates when source files change. Human edits and source versions must be preserved. This means persistent project knowledge, not model training.

## Development

Use Node.js **24.19.0** and npm **12.2.1** on Windows or Linux:

```text
npm install --global npm@12.2.1
npm ci
npm run check
```

See [CONTRIBUTING](CONTRIBUTING.md) for individual commands and [platform requirements](docs/product/requirements.md) for the support policy. The extension host runtime and external Node runtime are distinct; end-user runtime and minimum editor compatibility will be validated in M1.

## Architecture

- `packages/core`: editor-independent knowledge boundary.
- `packages/mcp-server`: standalone protocol boundary, planned for M1.
- `packages/vscode-extension`: editor UI boundary, planned for M1.

No model requests, credentials, background services or repository scans run in M0. Public fixtures will be used for tests; private source code must not be included in bug reports.

## Contributing and licensing

[Contribution guide](CONTRIBUTING.md) · [Support](SUPPORT.md) · [Security](SECURITY.md) · [Release process](docs/development/releasing.md)

Licensed under [Apache-2.0](LICENSE). Copyright 2026 KasterMist and contributors. Independent community project; not affiliated with OpenAI or Qoder.
