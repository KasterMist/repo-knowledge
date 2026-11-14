import {
  defaultScanOptions,
  scanOptionsSchema,
  CodexBackendError,
  KnowledgeError,
  type ScanOptions,
  type ScanPlan,
} from '@repo-knowledge/core';

export interface GenerationForm {
  include: string;
  exclude: string;
  language: string;
  maxFiles: string;
  maxKiB: string;
  maxPages: string;
}
export const generationDefaults: GenerationForm = {
  include: defaultScanOptions.include.join(','),
  exclude: defaultScanOptions.exclude.join(','),
  language: 'zh-CN',
  maxFiles: '50',
  maxKiB: '128',
  maxPages: '2',
};
function exact(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function parseGenerationForm(value: unknown) {
  const keys = Object.keys(generationDefaults);
  if (
    !exact(value, keys) ||
    keys.some(
      (key) =>
        typeof value[key] !== 'string' || (value[key] as string).length > 8192,
    )
  )
    throw new Error('INVALID_FORM: 请检查生成表单字段。');
  const form = value as unknown as GenerationForm;
  if (
    !/^\d{1,3}$/u.test(form.maxFiles) ||
    !/^\d{1,4}$/u.test(form.maxKiB) ||
    !['2', '4', '8'].includes(form.maxPages)
  )
    throw new Error(
      'INVALID_FORM: 文件数 1–200；大小 1–2048 KiB；卡片数 2/4/8。',
    );
  const split = (text: string) =>
    text
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  const options = scanOptionsSchema.parse({
    ...defaultScanOptions,
    include: split(form.include),
    exclude: split(form.exclude),
    language: form.language,
    maxFiles: Number(form.maxFiles),
    maxTotalBytes: Number(form.maxKiB) * 1024,
  });
  return { options, maxPages: Number(form.maxPages) };
}
type Message =
  | { action: 'preview'; form: unknown }
  | { action: 'generate'; form: unknown; planId: string }
  | { action: 'cancel' | 'invalidate' | 'recover' | 'review' };
export function generationMessage(value: unknown): Message | undefined {
  if (!value || typeof value !== 'object') return;
  const action = (value as Record<string, unknown>).action;
  if (typeof action !== 'string') return;
  if (
    ['cancel', 'invalidate', 'recover', 'review'].includes(action) &&
    exact(value, ['action'])
  )
    return value as Message;
  if (action === 'preview' && exact(value, ['action', 'form']))
    return { action, form: value.form };
  if (
    action === 'generate' &&
    exact(value, ['action', 'form', 'planId']) &&
    typeof value.planId === 'string' &&
    /^[a-f0-9-]{36}$/u.test(value.planId)
  )
    return { action, form: value.form, planId: value.planId };
  return;
}
export interface GenerationInteraction {
  signal: AbortSignal;
  maxPages?: number;
  expectedPlanId?: string;
  phase?(phase: string): void;
}
interface Operations {
  preview(options: ScanOptions, signal: AbortSignal): Promise<ScanPlan>;
  generate(
    interaction: GenerationInteraction,
    recover: boolean,
  ): Promise<unknown>;
  review(): Promise<unknown>;
}
export interface GenerationPanelState {
  type: 'generation-state';
  phase: string;
  busy: boolean;
  plan?: ScanPlan;
  error?: string;
  result?: unknown;
}
export function generationError(error: unknown): string {
  if (error instanceof CodexBackendError)
    return `${error.code} (${error.phase}; ${error.reason}; HTTP ${error.httpStatusCode ?? 'unavailable'})。未发布、未自动重试。`;
  return error instanceof Error ? error.message : 'Generation failed';
}
/** One view owns one explicit, cancellable operation and its reviewed input. */
export class GenerationSession {
  private active: AbortController | undefined;
  private disposed = false;
  private reviewed: { plan: ScanPlan; key: string } | undefined;
  state: GenerationPanelState = {
    type: 'generation-state',
    phase: 'idle',
    busy: false,
  };
  constructor(
    private readonly operations: Operations,
    private readonly emit: (state: GenerationPanelState) => void,
  ) {}
  private send(state: GenerationPanelState) {
    this.state = state;
    if (!this.disposed) this.emit(structuredClone(state));
  }
  async handle(value: unknown): Promise<void> {
    const message = generationMessage(value);
    if (!message || this.disposed) return;
    if (message.action === 'cancel') {
      this.active?.abort();
      return;
    }
    if (message.action === 'invalidate') {
      this.reviewed = undefined;
      this.active?.abort();
      if (!this.active)
        this.send({ type: 'generation-state', phase: 'idle', busy: false });
      return;
    }
    if (this.active) return;
    const controller = new AbortController();
    this.active = controller;
    const phase = (phase: string) =>
      this.send({ ...this.state, phase, busy: true });
    try {
      if (message.action === 'preview') {
        this.reviewed = undefined;
        this.send({ type: 'generation-state', phase: 'scanning', busy: true });
        const parsed = parseGenerationForm(message.form);
        const plan = await this.operations.preview(
          parsed.options,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        this.reviewed = { plan, key: JSON.stringify(parsed) };
        this.send({
          type: 'generation-state',
          phase: 'previewed',
          busy: false,
          plan,
        });
      } else if (message.action === 'generate') {
        const parsed = parseGenerationForm(message.form);
        const reviewed = this.reviewed;
        if (
          !reviewed ||
          reviewed.plan.id !== message.planId ||
          reviewed.key !== JSON.stringify(parsed)
        )
          throw new Error(
            'PREVIEW_REQUIRED: 表单已变更或预览失效，请重新预览。',
          );
        if (reviewed.plan.summary.limited || !reviewed.plan.files.length)
          throw new Error(
            'INCOMPLETE_PLAN: 请缩小范围，取得非空且完整的预览。',
          );
        phase('confirming');
        const result = await this.operations.generate(
          {
            signal: controller.signal,
            expectedPlanId: reviewed.plan.id,
            maxPages: parsed.maxPages,
            phase,
          },
          false,
        );
        // A completed save wins a late cancel. Never hide a durable result.
        this.reviewed = undefined;
        this.send({
          type: 'generation-state',
          phase: (result as { cancelled?: boolean } | undefined)?.cancelled
            ? 'cancelled'
            : 'finished',
          busy: false,
          result,
        });
      } else if (message.action === 'recover') {
        this.send({
          type: 'generation-state',
          phase: 'recovering',
          busy: true,
        });
        const result = await this.operations.generate(
          { signal: controller.signal, phase },
          true,
        );
        this.reviewed = undefined;
        this.send({
          type: 'generation-state',
          phase: (result as { cancelled?: boolean } | undefined)?.cancelled
            ? 'cancelled'
            : 'finished',
          busy: false,
          result,
        });
      } else {
        await this.operations.review();
      }
    } catch (error) {
      this.reviewed = undefined;
      const cancelled =
        controller.signal.aborted ||
        (error instanceof CodexBackendError && error.code === 'CANCELLED') ||
        (error instanceof KnowledgeError &&
          ['SCAN_CANCELLED', 'GENERATION_CANCELLED'].includes(error.code));
      this.send({
        type: 'generation-state',
        phase: cancelled ? 'cancelled' : 'failed',
        busy: false,
        error: cancelled
          ? '已取消。若已有任务记录，可找回结果；重试仍需确认。'
          : generationError(error),
      });
    } finally {
      this.active = undefined;
    }
  }
  dispose() {
    this.disposed = true;
    this.reviewed = undefined;
    this.active?.abort();
  }
}
