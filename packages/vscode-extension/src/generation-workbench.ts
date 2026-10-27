import * as vscode from 'vscode';
import { mkdir, mkdtemp, rmdir } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import {
  generateKnowledgeCandidate,
  resolveStoragePath,
  CodexBackendError,
} from '@repo-knowledge/core';
import type { BackendWorkbench } from './backend-workbench.js';
import type { KnowledgeWorkbench, KnowledgeTarget } from './workbench.js';

interface Target extends KnowledgeTarget {
  configuration: vscode.WorkspaceConfiguration;
}
type Resolver = (
  folder?: vscode.WorkspaceFolder,
) => Promise<Target | undefined>;
const contains = (root: string, path: string) => {
  const value = relative(root, path);
  return (
    value === '' ||
    (!isAbsolute(value) &&
      value !== '..' &&
      !value.startsWith('../') &&
      !value.startsWith('..\\'))
  );
};
export class GenerationWorkbench implements vscode.Disposable {
  private readonly command: vscode.Disposable;
  private busy = false;
  private readonly lifetime = new AbortController();
  private readonly changes: vscode.Disposable[];
  private revision = 0;
  private active: AbortController | undefined;
  constructor(
    private readonly resolve: Resolver,
    private readonly workbench: KnowledgeWorkbench,
    private readonly backend: BackendWorkbench,
    private readonly storage: vscode.Uri,
  ) {
    this.command = vscode.commands.registerCommand(
      'repoKnowledge.generateKnowledge',
      async (node?: { folder?: vscode.WorkspaceFolder }) => {
        try {
          return await this.generate(node?.folder);
        } catch (error) {
          const message =
            error instanceof CodexBackendError
              ? `${error.code} (${error.phase}; ${error.reason}; HTTP ${error.httpStatusCode ?? 'unavailable'})。未发布知识。请保留错误分类核对当前宿主的模型连接；不必据此重新登录。`
              : error instanceof Error
                ? error.message
                : 'Generation failed';
          void vscode.window.showErrorMessage(`Repo Knowledge: ${message}`);
          return { error: true, message };
        }
      },
    );
    const changed = () => {
      this.revision++;
      this.active?.abort();
    };
    this.changes = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('repoKnowledge')) changed();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(changed),
    ];
  }
  async generate(folder?: vscode.WorkspaceFolder) {
    if (!vscode.workspace.isTrusted)
      throw new Error('Generation requires a trusted workspace.');
    if (this.busy)
      throw new Error(
        '当前已有生成任务；请先完成或取消 / A generation task is already active.',
      );
    this.busy = true;
    try {
      return await this.run(folder);
    } finally {
      this.busy = false;
    }
  }
  private async run(folder?: vscode.WorkspaceFolder) {
    const revision = this.revision;
    const target = await this.resolve(folder);
    if (!target) return;
    const plan = this.workbench.scanning.generationPlan(target);
    if (!plan)
      throw new Error(
        '请先运行 Plan Knowledge Generation 并检查当前仓库的只读规划 / Preview a plan for this repository first.',
      );
    if (plan.summary.limited || !plan.files.length)
      throw new Error('生成需要非空且覆盖完整的规划；请缩小范围后重新规划。');
    const clean = () => {
      if (
        vscode.workspace.textDocuments.some(
          (document) =>
            document.isDirty &&
            (contains(target.root, document.uri.fsPath) ||
              contains(target.store, document.uri.fsPath)),
        )
      )
        throw new Error(
          '仓库或知识目录有未保存的编辑。请先保存或自行取消修改 / Save or discard dirty source/knowledge editors before generation.',
        );
    };
    clean();
    const pages = await vscode.window.showQuickPick(
      [2, 4, 8].map((value) => ({
        label: `最多 ${value} 张 / Up to ${value} pages`,
        value,
      })),
      { title: '生成候选数量 / Candidate pages' },
    );
    if (!pages) return { cancelled: true };
    const executable = await this.backend.executable(
      target.configuration.get<string>('codexExecutable', ''),
    );
    const choice = await vscode.window.showWarningMessage(
      `将以下 ${plan.files.length} 个文件的已保存文本发送给当前宿主已配置的 Codex 模型/提供方：\n${plan.files.map((file) => file.path).join('\n')}\n语言：${plan.options.language}；最多 ${pages.value} 张；一次任务、总时限 60 秒、输出上限 64 KiB。用量统计可能延迟，并非精确费用上限。\n不运行源码；仅保存待审阅候选，不自动发布。确认开始？`,
      { modal: true },
      '开始生成 / Generate',
    );
    if (choice !== '开始生成 / Generate') return { cancelled: true };
    if (revision !== this.revision)
      throw new Error(
        '配置或工作区已变化，请重新规划 / Configuration or workspace changed; preview a fresh plan.',
      );
    clean();
    const active = new AbortController();
    this.active = active;
    try {
      const storage = await resolveStoragePath(this.storage.fsPath);
      if (contains(target.root, storage))
        throw new Error(
          'Generation scratch storage must be outside the target repository.',
        );
      await mkdir(storage, { recursive: true });
      const scratch = await mkdtemp(join(storage, 'generation-'));
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Repo Knowledge: 生成待审阅候选 / Generate candidate',
            cancellable: true,
          },
          async (_progress, token) => {
            const controller = new AbortController(),
              listener = token.onCancellationRequested(() =>
                controller.abort(),
              );
            if (token.isCancellationRequested) controller.abort();
            try {
              return await generateKnowledgeCandidate({
                command: executable.command,
                cwd: scratch,
                knowledge: target.knowledge,
                plan,
                maxPages: pages.value,
                timeoutMs: 60000,
                signal: AbortSignal.any([
                  controller.signal,
                  this.lifetime.signal,
                  active.signal,
                ]),
              });
            } finally {
              listener.dispose();
            }
          },
        );
        this.workbench.scanning.consumeGenerationPlan(target);
        this.workbench.refresh();
        void vscode.window.showInformationMessage(
          `已保存 ${result.pages} 张待审阅卡片；尚未发布。请打开 New Cards 检查全部差异，再单独确认发布。`,
        );
        return result;
      } finally {
        await rmdir(scratch).catch(() => {});
      }
    } finally {
      this.active = undefined;
    }
  }
  dispose(): void {
    this.lifetime.abort();
    this.changes.forEach((listener) => listener.dispose());
    this.command.dispose();
  }
}
