# Requirements and support targets

## Goal

Create a VS Code plugin that presents repository Wiki pages to people and provides shared, evidence-backed knowledge cards to coding agents through MCP. Start with official Codex IDE integration; preserve source versions and human edits.

## Required platforms

| Environment                               | Requirement                                | M0 validation                                 |
| ----------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| Windows native x64                        | Required from the first functional preview | Local checks and CI job                       |
| Linux native x64 (Ubuntu runner baseline) | Required from the first functional preview | CI job; actual remote result must be recorded |
| WSL / SSH / macOS / ARM64                 | Not claimed supported yet                  | Separate future acceptance                    |

Cross-platform support is a release gate, not a later optional polish task. Add case-sensitive file paths, Unicode and spaces, separator handling, process cancellation and line endings to future functional acceptance. Windows success alone does not establish Linux support.

Development uses Node 24.19.0 and npm 12.2.1. VS Code engine declaration in the scaffold is a provisional floor, not an established compatibility claim. Decide actual end-user runtimes and supported editor/Codex versions through M1 acceptance.

## M0 scope

Independent source repository, license, contribution files, module boundaries, deterministic checks, lockfile and Windows/Linux CI. Governance, Issues and milestone setup are tracked separately from local engineering completion.

M0 has no product features, model calls, credentials, background services or VSIX. M1 validates Codex retrieval and knowledge proposals before investing in generation. Later milestones add initial generation, dependency invalidation, three-way conflict protection and incremental updates.

## Data and evidence

Human-readable Wiki and agent cards must share a canonical knowledge source. Every future conclusion has a source scope/version and evidence or an inference label. Source staleness is explicit. Facts, intended conventions and human design rationale are distinct. Use external storage for read-only target repositories.

## Integration boundary

Configure MCP for Codex explicitly; registering tools in VS Code alone does not establish Codex consumption. No promise of mandatory per-turn context injection or reading the official extension's private session state. Use documented interfaces and record real acceptance separately from mocks.
