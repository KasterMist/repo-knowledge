# Changelog

## Unreleased

- Add an explicitly confirmed Generate Knowledge Candidate development command: restricted version/model/config preflight, individually disabled inherited MCP, external ephemeral readonly thread, selected-source transfer and reviewed-candidate save. Preserve model/provider/login and canonical knowledge. Real Windows inference attempts failed upstream; successful generation and T16 checkpoints/retry remain unverified. Cancellation is propagated through candidate saving; no automatic publication or retry.

- Add an explicit single-turn JSON collector with scoped early events, authoritative output checks, byte/event/deadline/observed-usage limits and best-effort interruption. Forced transport cleanup targets owned wrapper descendants on Windows/Linux. The collector does not publish or retry; observed usage is not a hard cost cap. Persistent generation checkpoints remain pending.

- Add validated new-card candidate storage, batch diff/confirmation, shared-lock creation publication, current-head batch removal and retained IDs against replay/reuse. Keep canonical schema 1 and existing-card revision semantics; add version-2 creation history with explicit marker recovery and upgrade/downgrade guidance. Real model generation remains pending.

- Add in-memory generation source/output contracts: revalidated selected-source packets, encoded byte limits, structured new-page schema, source-range/hash binding and rejection of existing IDs or changed human knowledge. No model invocation.

- Add a bounded Codex STDIO client and explicit host-side Diagnose Generation Backend command, with cancellation, deadlines, streaming UTF-8, request correlation, server-request denial and redacted configuration/account reports. Diagnostics start no model thread; real generation remains pending.

- Start M3/T14 with user-invoked bounded static scan planning, POSIX include/exclude scope, language selection, coverage/skip counters, cancellation and immutable external metadata-only plan save/revalidation. No model call or knowledge generation yet.

- Complete scoped M2 acceptance: Windows-native and Remote SSH publication/rollback, matching MCP r3/current, independent history/content verification and Windows/Linux packaged multi-root isolation. This remains unreleased; generation is M3.

- M2 browsing development: source-scope Wiki/card trees, immutable card documents and validated Unicode source navigation. No new release or model generation.
- Improve Chinese/code-symbol lexical ranking and add a 15-card Top-5 evaluation with documented semantic misses.
- Add durable human drafts, dirty-editor guards, immutable candidate diffs and explicitly confirmed single-card publication. Recheck bases/evidence, serialize writers and atomically replace the canonical snapshot with immutable history; support monotonic rollback and explicit prepared-marker recovery. Keep schemaVersion 1 and the four MCP tools unchanged.

## 0.1.0-alpha.1 — 2026-10-23

- First [GitHub-only alpha](https://github.com/KasterMist/repo-knowledge/releases/tag/v0.1.0-alpha.1); product/VSIX 0.1.0, knowledge schemaVersion 1. No Marketplace publication.
- Evidence-backed cards, lexical search, source freshness and standalone MCP status/search/read/propose tools; proposals remain pending and cannot overwrite canonical knowledge or source.
- Six VS Code commands, external storage and a self-authored three-card demo. Windows-native and Windows Remote SSH to Linux official Codex acceptance complete; Linux desktop Codex remains unverified.
- Versioned packaging and manually triggered release with exact-source CI, one payload, Windows/Linux installation, draft-byte checks and anonymous public download/install verification.
- Correct JSON response negotiation for binary uploads and keep private draft inspection in the write-scoped publish job. Offline replay covers read-only preflight and guarded empty-draft recovery.
- No Wiki generation or complete review/publication UI yet; M2 is next. Future generation and model updates remain user-initiated and require reviewed publication.
