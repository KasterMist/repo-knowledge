# Repo Knowledge

[简体中文](README.zh-CN.md)

Shared repository knowledge for developers and coding agents, targeting VS Code on **Windows and Linux**.
Windows VS Code **Remote SSH to Linux is a required workflow**. See the [Remote SSH setup and acceptance guide](docs/user/remote-ssh.zh-CN.md).

## Status: M1 alpha available

Implemented: runtime-validated knowledge cards, source freshness checks, lexical search, standalone STDIO MCP tools, immutable update proposals and VS Code commands for browsing, diagnostics and Codex configuration. Includes a self-authored three-card demo.

Download [v0.1.0-alpha.1](https://github.com/KasterMist/repo-knowledge/releases/tag/v0.1.0-alpha.1) from GitHub Releases and install repo-knowledge-0.1.0.vsix using Install from VSIX. **M1 is complete for Windows-native Codex and Windows Remote SSH to Linux**, including public-package verification on Windows/Linux. VSIX/product version: 0.1.0; knowledge schema: 1. Native Linux editor-host CI is separate from native Linux desktop Codex, which remains unverified and outside the first alpha's compatibility claim. Protocol tests alone do not establish Codex integration. The published M1 package has no Wiki generation or proposal review/publication UI; there is no Marketplace release. See the [project task/status checkpoint](docs/development/project-status.zh-CN.md), [M1 acceptance](docs/development/m1-acceptance.md) and the [roadmap](docs/product/roadmap.md).

## Planned workflow

M2 implementation and scoped acceptance are complete: source-scope Wiki/card browsing, evidence navigation, durable JSON drafts, proposal diffs, confirmed publication and monotonic rollback. Windows-native and Remote SSH UI results, independent history/content inspection and Windows/Linux packaged-editor CI are recorded in [M2 acceptance](docs/development/m2-acceptance.md). This work is not included in the published M1 package and has no separate M2 release yet. See the [workbench guide](docs/user/workbench.zh-CN.md). User-initiated generation remains M3.

The user decides whether to generate Wiki pages and knowledge cards, selects the scope and explicitly starts generation. Read a structured Wiki, correct shared cards and let Codex retrieve evidence through MCP. Source changes can be checked for staleness; regeneration and incremental updates are also user-initiated and produce candidates for user review and confirmed publication. Human edits and source versions must be preserved. This means persistent project knowledge, not model training.

M3/T14 development now provides explicitly invoked include/exclude/language/byte-limited static scan previews and external metadata-only plans. It does not call a model or generate knowledge. See the [generation guide](docs/user/generation.zh-CN.md) and [M3 checkpoint](docs/development/m3-acceptance.md).

M3 development includes new-card candidate review/publication and an explicitly confirmed Generate Knowledge Candidate command with restricted Codex preflight. Self-authored Windows and Remote SSH editor generation succeeded and saved reviewable candidates with canonical knowledge unchanged. Metadata-only job receipts, explicit retry and recovery, source-confirmation/progress cancellation, and new-batch publication/removal are accepted for the self-authored Windows/Remote SSH scope. M3 scoped acceptance is complete; it remains unreleased. Wiki navigation still uses source scopes; this is not whole-repository multi-pass generation or a separate article hierarchy. No manual import is enabled. See [the generation guide](docs/user/generation.zh-CN.md), [ADR 0007](docs/architecture/adr/0007-reviewed-creation.md) and [ADR 0008](docs/architecture/adr/0008-explicit-codex-generation.md).

T17 development includes immutable external dependency baselines and explicit Capture Dependency Baseline / Review Knowledge Changes commands. Reports include reverse file-to-card dependencies; Windows/Remote SSH no-change report UI is accepted. Conservative possible-rename hints are implemented; changed-file GUI acceptance is complete on Windows/SSH; report-target navigation is accepted on both hosts. See [the increment boundary](docs/development/t17-impact-core.md).

T18 development adds explicit Git worktree/branch store binding and HEAD/index-bound reviewed operations. Existing Git stores require a fresh binding workflow; legacy pending metadata is not automatically adopted. Implementation and scoped acceptance are tracked in [Issue #41](https://github.com/KasterMist/repo-knowledge/issues/41); Windows-native and Remote SSH binding cancellation, confirmed binding, feature-branch refusal and return-to-main recovery are accepted. See [the migration contract](docs/architecture/adr/0011-repository-context.md). No new release.

T19 development adds captured proposal bases, conservative field-level three-way reports and explicitly acknowledged merge drafts. Conflicting fields keep current human content until reviewed; no model or publication is started by merging. Legacy records without a base cannot be merged. Windows-native and Remote SSH report, cancellation, unresolved-conflict refusal, saved resolution and confirmed human-content-preserving publication are accepted; see [the contract](docs/architecture/adr/0012-three-way-merge.md) and [Issue #44](https://github.com/KasterMist/repo-knowledge/issues/44). Unreleased.

T20 development adds an explicitly confirmed Generate Card Update for one existing card and Recover Incremental Result without model work. Selected current-source evidence, captured bases, timing/attempted-turn receipts and existing confirmed publication/rollback are retained. Windows-native and Remote SSH scoped beta acceptance is complete: real updates, timing records, confirmed publication, source-consistent rollback and independent installed-MCP reads. This is not whole-repository regeneration or a new release. See [M4 acceptance](docs/development/m4-acceptance.md). See [ADR 0013](docs/architecture/adr/0013-incremental-attempts.md) and [Issue #47](https://github.com/KasterMist/repo-knowledge/issues/47).

Development adds a unified graphical home and generation form: scope, language and limits, inline source preview, explicit generation confirmation, progress/cancellation, results and recovery. Opening a view never starts model work; candidates still require separate review/publication. Independent human Wiki articles remain T27. T27.1 adds the prepared article model; T27.2 adds a read-only article preview with a hierarchy, restricted Markdown formatting, live canonical-card/evidence checks and host-routed source navigation. T27.3 adds explicit bounded Wiki-and-card candidate generation from the unified form, with a separate labelled reader and no-model recovery of saved results. The active store/MCP remain v1; article publication/migration is still deferred. See the [Wiki generation guide](docs/user/wiki-generation.zh-CN.md). See [the reader guide](docs/user/wiki-preview.zh-CN.md). See [the T27 checkpoint](docs/development/t27-wiki.zh-CN.md). See [T25–T28](docs/product/frontend-delivery.zh-CN.md) and [T26 implementation/evidence](docs/development/t26-generation-panel.zh-CN.md). Unreleased; the published M1 package is unchanged.

## Development

T21 preparation adds an [offline, traceable evaluation protocol](docs/development/t21-evaluation.zh-CN.md) for baseline/natural/explicit knowledge use and independent-conversation reuse. Static fixture preparation and record validation make no model calls. Windows/Remote SSH baseline and natural-task samples are recorded, including a Windows command-scope deviation and unconfirmed MCP use. Bounded programmatic explicit retrieval completed on Windows/Linux with captured MCP events; subsequent evaluation is automated. See [the results and limitations](docs/development/t21-programmatic.zh-CN.md). No general effectiveness claim or new release is made.

Use Node.js **24.19.0** and npm **12.2.1** on Windows or Linux:

```text
npm install --global npm@12.2.1
npm ci
npm run check
npm run build
npm run package:vsix
```

Install the resulting `dist/repo-knowledge-0.1.0.vsix` through VS Code's Install from VSIX command. Run **Repo Knowledge: Open Three-Card Demo**, trust the self-authored demo, then **Search Cards**, **Diagnose Standalone MCP** and **Show Codex MCP Setup**. Merge the generated table into Codex config.toml and restart Codex. The command previews configuration and does not overwrite existing settings. See the [Chinese setup guide](docs/user/quickstart.zh-CN.md).

Native preview uses an external Node 24.19.x executable. On Remote SSH, the default uses the remote VS Code Server Node in a separate process (remote MCP tested on Node 22.22.1), so npm/system installation is unnecessary. An absolute `repoKnowledge.nodeExecutable` overrides the default. The declared VS Code minimum is provisional; the validated editor baseline is 1.117.0. See the acceptance record for official Codex and Remote SSH evidence.

## Architecture

- `packages/core`: editor-independent knowledge boundary.
- `packages/mcp-server`: independently launched protocol service.
- `packages/vscode-extension`: editor commands and bundled standalone server.

The development generation command sends only the explicitly selected saved-source packet after confirmation, using a separate constrained Codex task; it saves reviewable candidates and never publishes automatically. Explicit [Codex backend diagnostics](docs/user/codex-backend.zh-CN.md) remain metadata-only with no thread/model call. Neither flow copies tokens or rewrites login/provider settings. Knowledge tools read the explicit store and cited source files. Update proposals write only to the store and never publish themselves or modify target source. Card content is untrusted data. Do not put secrets in cards or upload private source to bug reports.

## Contributing and licensing

[Contribution guide](CONTRIBUTING.md) · [Support](SUPPORT.md) · [Security](SECURITY.md) · [Release process](docs/development/releasing.md)

Licensed under [Apache-2.0](LICENSE). Copyright 2026 KasterMist and contributors. Independent community project; not affiliated with OpenAI or Qoder.
