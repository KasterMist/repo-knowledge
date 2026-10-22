# Contributing

Start with [requirements](docs/product/requirements.md), [architecture](docs/architecture/adr/0001-foundation.md) and the [roadmap](docs/product/roadmap.md).

## Toolchain and checks

Install Node 24.19.0 and npm 12.2.1. Windows PowerShell and Linux terminals use the same commands:

```text
npm ci
npm run check
```

`check` verifies repository metadata/local links/YAML, formatting, lint, strict TypeScript build, policy rejection tests and built-package bootstrap tests. Individual commands: `format:check`, `lint`, `typecheck`, `build`, `test:unit`, `test:integration`, `check:repository`. Run build before running integration tests alone. `npm run format` applies formatting.

Install scripts are disabled in `.npmrc`; dependencies currently require no lifecycle scripts. The root and workspace packages are private to prevent accidental npm publication. M0 has no VSIX packaging, F5 activation or real Codex acceptance script; these belong to M1.

## Workflow

1. Agree on an Issue with user scenario, scope, dependencies and observable acceptance.
2. Branch from main, for example `feat/T06-mcp-read-tools`.
3. Record cross-package and persistent-format decisions in an ADR.
4. Implement one reviewable behavior, including error handling and appropriate tests.
5. Run shared checks, document platform coverage and submit a PR linked to the Issue.
6. Resolve findings and merge after required checks. Update docs and changelog.

Code merged is not the same as a released version. Single-maintainer operation does not require an unavailable second approver. AI-assisted contributions meet the same evidence and licensing requirements.

## Platform policy

Windows native and Linux native are required. Use Node filesystem/path APIs; test paths containing spaces and Chinese characters. Do not assume drive letters, `/bin/bash`, PowerShell, case-insensitive filesystems or identical path casing. CI checks both platforms. WSL, remote SSH and macOS are separate future acceptance targets.

## Tests and public data

Use our fixtures, not third-party builds or private repositories. PR CI does not use paid models, personal credentials or network model calls. Mock/protocol tests do not establish actual Codex IDE compatibility; maintainers separately record real acceptance versions and outcomes.

## Completion criteria

Acceptance evidence, shared checks, documentation and compatibility notes must be present. Unverified behavior stays explicit. Contributions are submitted under the repository's Apache-2.0 license; retain required attribution for reused material.
