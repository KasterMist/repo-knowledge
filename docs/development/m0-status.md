# M0 implementation and verification

Date: 2026-10-22. Maintainer: KasterMist. Required targets: Windows and Linux.

## Engineering scope

- T01: independent npm workspace, lockfile, pinned tools, strict TypeScript package boundaries.
- T02: Apache-2.0 license, bilingual README, contribution/support/security/conduct files.
- T03: shared checks, negative policy tests, Unicode/space-path process test, Windows/Linux CI.
- T04: public repository exists, GitHub authorization is repaired and the [M0 tracking issue](https://github.com/KasterMist/repo-knowledge/issues/1) is open. Source is public on main; Windows/Linux CI and label/milestone initialization passed. Branch protection and private vulnerability reporting remain open.

## Actual local evidence

Windows native, Node 24.19.0, npm 12.2.1:

- Lockfile install (`npm ci`): passed using the locally prepared official npm toolchain and cache.
- `node scripts/check.mjs` (the same runner as `npm run check`): passed.
- Repository policy/YAML/local document links, formatting, lint and strict TypeScript build: passed.
- Unit tests: 3 passed; negative cases reject publication/version errors, undeclared dependencies and dropping required CI targets.
- Process integration: 1 passed from a temporary directory containing spaces and Chinese characters.
- Windows sandbox initially denied Node's test subprocess with EPERM. A controlled unsandboxed run completed successfully; this was not a test assertion failure.

[PR #2](https://github.com/KasterMist/repo-knowledge/pull/2) merged as `7a5531cbd5177bd6a5f0a509d6fa9c30947040ff`. [CI run 39714021216](https://github.com/KasterMist/repo-knowledge/actions/runs/39714021216) passed both `check (windows-latest)` and `check (ubuntu-latest)`, including installation, build and tests. No plugin functionality, real Codex integration, model calls, VSIX or release tag is claimed in M0.

## Authorization recovery

The maintainer completed GitHub app/repository authorization. The connection now returns an installation for KasterMist, and real LICENSE creation plus M0 Issue creation succeed. The earlier `403 Resource not accessible by integration` no longer reproduces for these operations. No tokens were shared. Source upload uses the authorized GitHub connector; local Git network reachability is a separate concern.

## Required repository settings

After both CI jobs have reported, protect main using required contexts `check (windows-latest)` and `check (ubuntu-latest)` with PR-based changes and no force push/deletion. Do not require an unavailable second reviewer in a one-maintainer project. Configure type/area/priority labels, M0–M5 milestones and private security reporting. Verification of these settings is separate from checking workflow files.

## Publication follow-up

[Repository setup run 39714766445](https://github.com/KasterMist/repo-knowledge/actions/runs/39714766445) succeeded and initialized the configured labels and M0–M5 milestones. The browser branch-protection form repeatedly timed out before saving; protection is not claimed as enabled. Private vulnerability reporting has not been verified. Keep M0 Issue #1 open for these governance items. [M1 Issue #3](https://github.com/KasterMist/repo-knowledge/issues/3) tracks real Codex IDE integration acceptance before an alpha VSIX release.
