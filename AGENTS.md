# Contributor guidance

This is the Repo Knowledge plugin engineering repository. Windows and Linux are required targets.

- Read README.md, docs/product/requirements.md and the relevant roadmap task first.
- Keep core independent of VS Code. MCP must eventually run outside the editor process.
- Do not claim future behavior or mock tests prove real Codex integration.
- Use TypeScript strict, npm workspaces and the committed lockfile. Do not add another package manager.
- Use Node APIs for scripts and argument arrays for subprocesses; no platform-specific shell commands in npm scripts.
- Run npm run check for implementation changes. Add meaningful boundary/failure tests when changing contracts.
- Use self-authored fixtures. Do not execute target repositories, kernels, tests, builds or benchmarks.
- Never copy credentials, user configuration or private source into commits, logs, issues or model fixtures.
- No scheduled/background model work. New model requests must be explicit and bounded.
- Changes to persistent formats need an ADR, migration and rollback plan.
- Keep English and Chinese README status and commands synchronized.
