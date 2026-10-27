# Bounded Codex text-turn collector

Date: 2026-10-27. T15/T16 transport slice; tracking [Issue #22](https://github.com/KasterMist/repo-knowledge/issues/22).

## Explicit lifecycle

collectCodexTextTurn accepts an initialized, exclusively owned CodexStdioClient, a caller-created thread ID, explicit text, output JSON Schema and limits. It submits turn/start once, observes scoped events and closes the client on success or failure. It does not create/configure a thread, select a model/provider, discover credentials, save a checkpoint/candidate or publish knowledge. No editor command calls it yet. Callers must establish tool restrictions and confirm the selected source transfer before invoking it; this API is not a sandbox.

The transport permits one notification observer. Without one, diagnostic notifications are still discarded and server requests receive the existing fixed rejection. With an observer, server requests fail closed without approvals or token refresh. Notifications may arrive before the start response; the collector binds and checks the thread/turn identity across both. It rejects foreign identities, unexpected tool/hook/reroute events, duplicate/ambiguous/conflicting replies and noncompleted states. Tool-event detection is reactive: it is not proof that a backend-side tool could never have run. The future adapter must independently constrain execution before any model turn.

Only an authoritative completed agent message with final_answer or an omitted legacy phase becomes output, and it must parse as JSON. Commentary/partial answers cannot become the result. Reasoning events are scoped/counted but never retained in the return value. JSON parsing is not knowledge validation: a future adapter must still call validateCurrentGeneration and saveCreation, binding selected-source hashes, ranges and canonical knowledge. A collected reply is not a saved or published Wiki.

## Limits and cancellation

Default limits: 30-second whole-turn deadline (maximum 60 seconds), 192 KiB serialized turn parameters, 64 KiB each of aggregate agent-message deltas and completed messages, 1,024 notifications and 16,000 observed total tokens. The hard ceilings are 192 KiB input, 128 KiB output, 2,048 notifications and 100,000 observed tokens. Existing transport stdout/stderr/message/inflight limits still apply. The deadline includes a missing/delayed start acknowledgement, not only streamed output.

Cancellation, deadline or failure requests turn/interrupt when a turn ID is known, with at most 250 ms acknowledgement grace. Then the owned transport closes. Normal close gives EOF a one-second grace before forced cleanup; Windows attempts taskkill /PID of the owned child /T /F with a one-second helper deadline, while Linux kills its owned process group. This addresses CLI wrapper descendants and does not enumerate unrelated user processes. Escaped processes and remote billing cancellation are not guaranteed by local process termination. Tests verify a self-authored ordinary descendant, not every possible process arrangement.

There are no automatic retries or resumed conversations. submittedTurns=1 counts the submitted API turn, not backend inference requests or billable calls. Token usage notifications can arrive late or be absent; observedTokens=null means unavailable. Token stopping is reactive, and byte/time/turn limits are not a guaranteed token or money ceiling. Provider-side hard spend limits, generation-job checkpoints and explicit retry/adoption semantics remain T16 work. Cancellation/failure here produces no persisted partial knowledge.

## Tool-policy investigation

Official [app-server events](https://learn.chatgpt.com/docs/app-server) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) were checked on 2026-10-27. The installed CLI 0.162.0-alpha.17.2 also exported its public schemas. The existing shell_tool=false diagnostic alone does not establish a complete generation policy.

A bounded offline investigation used a disposable Codex home and loopback-only mock Responses provider with no authentication, no target source and no real model inference. The candidate process-local profile disabled shell/unified execution, code-mode host, apps/plugins discovery, browser/computer/image/workspace tools, agents, hooks, memory/goals and auxiliary tools, with readonly sandbox and web search disabled. For the installed bundled gpt-6.1-sol catalog entry, the captured outbound mock request had tools=[] and no Authorization header. An unknown-model fallback instead exposed request_user_input, so the result is explicitly model/capability dependent. Fixtures were stopped and user login/configuration was unchanged.

This is local mock-provider evidence, not actual authenticated app-server generation or a production allowlist for arbitrary Codex versions/models/providers. The candidate profile must still be encoded and checked against effective configuration, inherited MCP/plugins/hooks and current-host capabilities before the UI generation entry point is enabled. Do not substitute prompt instructions or a boolean claimed by a caller for this gate. Windows/Remote SSH real generation and new-batch modal acceptance remain open.

## Verification

Seven self-authored protocol tests cover early events, identity mismatches, rejected tools/hooks/server requests, authoritative JSON, resource limits, missing/delayed acknowledgements, failure/exit/cancel and owned wrapper-descendant cleanup. They contact no Codex/model service and execute no target code. Existing diagnostics and candidate/publication fixtures remain regression gates. Exact-head Windows/Linux checks, actual packaged-editor hosts and Node 22.22.1 runtime results are tracked in Issue #22.
