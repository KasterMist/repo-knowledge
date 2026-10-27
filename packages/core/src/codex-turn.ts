import { z } from 'zod';
import { CodexStdioClient, CodexBackendError } from './codex-client.js';

const id = z.string().min(1).max(200);
export const textTurnBudgetSchema = z.strictObject({
  timeoutMs: z.int().min(1).max(60000).default(30000),
  inputBytes: z
    .int()
    .min(1)
    .max(192 * 1024)
    .default(192 * 1024),
  outputBytes: z
    .int()
    .min(1)
    .max(128 * 1024)
    .default(64 * 1024),
  notifications: z.int().min(1).max(2048).default(1024),
  observedTokenLimit: z.int().min(1).max(100000).default(16000),
});
export type TextTurnBudget = z.input<typeof textTurnBudgetSchema>;
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
const failure = (code: string) =>
  new CodexBackendError(code, 'generation-turn');

/**
 * Collect exactly one explicitly requested turn on an already configured thread.
 * This is NOT a tool sandbox: callers must establish execution restrictions first.
 * The transport is exclusively owned and is always closed, including on failure.
 */
export async function collectCodexTextTurn(
  client: CodexStdioClient,
  threadId: string,
  input: string,
  outputSchema: Record<string, unknown>,
  options: TextTurnBudget = {},
  signal?: AbortSignal,
): Promise<{
  text: string;
  output: unknown;
  observedTokens: number | null;
  submittedTurns: 1;
}> {
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let turnId: string | undefined;
  let interrupt = false;
  let abort: (() => void) | undefined;
  try {
    const budget = textTurnBudgetSchema.parse(options);
    id.parse(threadId);
    if (signal?.aborted) throw failure('CANCELLED');
    const params = {
      threadId,
      input: [{ type: 'text', text: input }],
      outputSchema,
    };
    if (!input.trim() || bytes(JSON.stringify(params)) > budget.inputBytes)
      throw failure('INPUT_LIMIT');
    let settled = false,
      seen = 0,
      deltaBytes = 0,
      completedBytes = 0;
    let final: { id: string; text: string } | undefined;
    let observedTokens: number | null = null;
    const items = new Set<string>();
    let resolveDone!: () => void;
    let rejectDone!: (error: CodexBackendError) => void;
    let rejectFatal!: (error: CodexBackendError) => void;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    const fatal = new Promise<never>((_resolve, reject) => {
      rejectFatal = reject;
    });
    // Events can precede the turn/start response. Attach a rejection handler now.
    void done.catch(() => {});
    void fatal.catch(() => {});
    const reject = (error: CodexBackendError) => {
      settled = true;
      interrupt = true;
      rejectDone(error);
      rejectFatal(error);
    };
    const bind = (value: unknown) => {
      const parsed = id.parse(value);
      if (turnId && turnId !== parsed) throw failure('TURN_MISMATCH');
      turnId = parsed;
    };
    const inspectItem = (input: unknown, completed: boolean) => {
      const item = z
        .object({ id, type: z.string() })
        .passthrough()
        .parse(input);
      if (!['userMessage', 'agentMessage', 'reasoning'].includes(item.type))
        throw failure('UNEXPECTED_TURN_ITEM');
      if (!completed || item.type !== 'agentMessage') return;
      if (items.has(item.id)) throw failure('DUPLICATE_TURN_ITEM');
      items.add(item.id);
      const message = z
        .object({
          text: z.string(),
          phase: z
            .enum(['commentary', 'partial_answer', 'final_answer'])
            .nullish(),
        })
        .parse(item);
      completedBytes += bytes(message.text);
      if (completedBytes > budget.outputBytes) throw failure('OUTPUT_LIMIT');
      if (message.phase && message.phase !== 'final_answer') return;
      if (final) throw failure('AMBIGUOUS_TURN_OUTPUT');
      final = { id: item.id, text: message.text };
    };
    unsubscribe = client.observe((method, input) => {
      if (settled) return;
      try {
        if (++seen > budget.notifications) throw failure('EVENT_LIMIT');
        // Do not retain warnings, user configuration or reasoning content.
        if (
          ![
            'turn/started',
            'turn/completed',
            'item/started',
            'item/completed',
            'item/agentMessage/delta',
            'item/reasoning/textDelta',
            'item/reasoning/summaryTextDelta',
            'item/reasoning/summaryPartAdded',
            'thread/tokenUsage/updated',
            'error',
          ].includes(method)
        ) {
          if (
            method.startsWith('item/') ||
            method.startsWith('hook/') ||
            method.startsWith('turn/') ||
            method === 'model/rerouted'
          )
            throw failure('UNEXPECTED_TURN_EVENT');
          return;
        }
        const params = z.record(z.string(), z.unknown()).parse(input);
        if (params.threadId !== threadId) throw failure('THREAD_MISMATCH');
        if (method === 'turn/started' || method === 'turn/completed') {
          const turn = z
            .object({
              id,
              status: z.string(),
              items: z.array(z.unknown()).optional(),
            })
            .parse(params.turn);
          bind(turn.id);
          if (method === 'turn/started') {
            if (turn.status !== 'inProgress')
              throw failure('INVALID_TURN_STATE');
            for (const item of turn.items ?? []) inspectItem(item, false);
            return;
          }
          for (const item of turn.items ?? []) {
            inspectItem(item, false);
            const record = z.record(z.string(), z.unknown()).parse(item);
            if (
              record.type === 'agentMessage' &&
              final &&
              final.id === record.id &&
              record.text !== final.text
            )
              throw failure('CONFLICTING_TURN_OUTPUT');
          }
          if (turn.status !== 'completed')
            throw failure(
              turn.status === 'interrupted'
                ? 'TURN_INTERRUPTED'
                : 'TURN_FAILED',
            );
          if (!final) throw failure('MISSING_TURN_OUTPUT');
          settled = true;
          resolveDone();
          return;
        }
        bind(params.turnId);
        if (method === 'error') throw failure('TURN_FAILED');
        if (method.startsWith('item/reasoning/')) return;
        if (method === 'item/started' || method === 'item/completed') {
          inspectItem(params.item, method === 'item/completed');
        } else if (method === 'item/agentMessage/delta') {
          const value = z
            .object({ itemId: id, delta: z.string() })
            .parse(params);
          deltaBytes += bytes(value.delta);
          if (deltaBytes > budget.outputBytes) throw failure('OUTPUT_LIMIT');
        } else {
          const usage = z
            .object({ total: z.object({ totalTokens: z.int().min(0) }) })
            .parse(params.tokenUsage);
          if (
            observedTokens !== null &&
            usage.total.totalTokens < observedTokens
          )
            throw failure('INVALID_TOKEN_USAGE');
          observedTokens = usage.total.totalTokens;
          if (observedTokens > budget.observedTokenLimit)
            throw failure('TOKEN_LIMIT');
        }
      } catch (error) {
        reject(
          error instanceof CodexBackendError
            ? error
            : failure('INVALID_TURN_EVENT'),
        );
      }
    }, reject);
    timer = setTimeout(() => reject(failure('TURN_TIMEOUT')), budget.timeoutMs);
    abort = () => reject(failure('CANCELLED'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const start = client.request('turn/start', params);
    // Race both phases: cancellation must not wait for a slow start response.
    const response = await Promise.race([start, fatal]);
    // A separate rejected event must interrupt a start request immediately.
    const turn = z
      .object({ turn: z.object({ id, status: z.string() }) })
      .parse(response).turn;
    bind(turn.id);
    if (!['inProgress', 'completed'].includes(turn.status))
      throw failure('INVALID_TURN_STATE');
    await Promise.race([done, fatal]);
    if (!final) throw failure('MISSING_TURN_OUTPUT');
    let output: unknown;
    try {
      output = JSON.parse(final.text);
    } catch {
      throw failure('INVALID_TURN_JSON');
    }
    return { text: final.text, output, observedTokens, submittedTurns: 1 };
  } catch (error) {
    interrupt = true;
    throw error instanceof CodexBackendError
      ? error
      : failure('INVALID_TURN_RESPONSE');
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
    unsubscribe?.();
    if (interrupt && turnId) {
      // Best effort only; process closure is the bounded fallback, not proof of billing cancellation.
      let grace: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client
            .request('turn/interrupt', { threadId, turnId })
            .catch(() => {}),
          new Promise<void>((resolve) => {
            grace = setTimeout(resolve, 250);
          }),
        ]);
      } finally {
        if (grace) clearTimeout(grace);
      }
    }
    await client.close();
  }
}
