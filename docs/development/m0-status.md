# M0 implementation and verification

Date: 2026-10-22. Maintainer: KasterMist. Required targets: Windows and Linux.

## Engineering scope

- T01: independent npm workspace, lockfile, pinned tools, strict TypeScript package boundaries.
- T02: Apache-2.0 license, bilingual README, contribution/support/security/conduct files.
- T03: shared checks, negative policy tests, Unicode/space-path process test, Windows/Linux CI.
- T04: public repository exists, GitHub authorization is repaired, Windows/Linux CI and label/milestone initialization passed. Governance is complete with independently observed branch/check metadata and maintainer-confirmed administration settings; see the [M0 tracking issue](https://github.com/KasterMist/repo-knowledge/issues/1).

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

Protect main using all five current CI contexts listed in the [governance record](github-governance.zh-CN.md), with PR-based changes and no force push/deletion. Do not require an unavailable second reviewer in a one-maintainer project. Configure type/area/priority labels, M0–M5 milestones and private security reporting. Verification of these settings is separate from checking workflow files.

## Publication follow-up

Rechecked after maintainer settings were saved on 2026-10-23: public main metadata reports protected=true and all five required CI contexts match, with GitHub Actions app_id=15368. Administration-detail reads return 403; PR requirements, force-push/deletion restrictions, single-maintainer approval settings and private vulnerability reporting are recorded from the maintainer's explicit confirmation, not independently observed API details. Required-check enforcement is non_admins; routine delivery still waits for all checks through a PR without an administrator bypass.

[Repository setup run 39714766445](https://github.com/KasterMist/repo-knowledge/actions/runs/39714766445) succeeded and initialized the configured labels and M0–M5 milestones. The earlier browser timeout and protected=false observation are superseded by the saved-settings evidence above. M0 exit conditions are complete. [M1 Issue #3](https://github.com/KasterMist/repo-knowledge/issues/3) remains separate and tracks real Codex IDE integration acceptance before an alpha VSIX release.
