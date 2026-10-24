import * as vscode from 'vscode';
import {
  scanRepository,
  saveScanPlan,
  scanOptionsSchema,
  defaultScanOptions,
  type ScanOptions,
  type ScanPlan,
} from '@repo-knowledge/core';
import type { KnowledgeDocuments } from './documents.js';
import type { ResolveTarget, KnowledgeTarget } from './workbench.js';

interface ScanNode {
  folder?: vscode.WorkspaceFolder;
}
export class ScanWorkbench implements vscode.Disposable {
  private readonly pending = new Map<string, ScanPlan>();
  private readonly disposables: vscode.Disposable[] = [];
  constructor(
    private readonly resolve: ResolveTarget,
    private readonly documents: KnowledgeDocuments,
  ) {
    for (const [name, action] of [
      [
        'planGeneration',
        (node?: ScanNode, input?: unknown) => this.preview(node, input),
      ],
      ['saveGenerationPlan', (node?: ScanNode) => this.save(node)],
    ] as const)
      this.disposables.push(
        vscode.commands.registerCommand(
          `repoKnowledge.${name}`,
          async (node, input) => {
            try {
              if (!vscode.workspace.isTrusted)
                throw new Error('Scan planning requires a trusted workspace.');
              return await action(node, input);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : 'Scan planning failed';
              void vscode.window.showErrorMessage(`Repo Knowledge: ${message}`);
              return { error: true, message };
            }
          },
        ),
      );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('repoKnowledge')) this.pending.clear();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.pending.clear()),
    );
  }
  private key(target: KnowledgeTarget): string {
    return JSON.stringify([target.root, target.store]);
  }
  private async options(): Promise<ScanOptions | undefined> {
    const include = await vscode.window.showInputBox({
      title: '生成范围 / Include globs',
      prompt:
        '相对 POSIX glob，以逗号分隔；支持 *、**、?。本步骤仅规划，不调用模型。',
      value: defaultScanOptions.include.join(','),
    });
    if (include === undefined) return;
    const exclude = await vscode.window.showInputBox({
      title: '排除范围 / Exclude globs',
      prompt: '以逗号分隔；凭据、工具目录和符号链接始终排除。',
      value: defaultScanOptions.exclude.join(','),
    });
    if (exclude === undefined) return;
    const language = await vscode.window.showQuickPick(
      [
        { label: '简体中文', value: 'zh-CN' as const },
        { label: 'English', value: 'en' as const },
      ],
      { title: '生成语言 / Output language' },
    );
    if (!language) return;
    const maxFiles = await vscode.window.showInputBox({
      title: '最多读取文件数 / Max files',
      value: '50',
      validateInput: (value) =>
        /^\d+$/u.test(value) && Number(value) >= 1 && Number(value) <= 200
          ? undefined
          : '请输入 1–200 的整数',
    });
    if (maxFiles === undefined) return;
    const kib = await vscode.window.showInputBox({
      title: '总读取上限 KiB / Total KiB',
      prompt: '最多 2048 KiB；每文件另限 64 KiB。尚不会上传源码或调用模型。',
      value: '128',
      validateInput: (value) =>
        /^\d+$/u.test(value) && Number(value) >= 1 && Number(value) <= 2048
          ? undefined
          : '请输入 1–2048 的整数',
    });
    if (kib === undefined) return;
    const split = (text: string) =>
      text
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    return scanOptionsSchema.parse({
      ...defaultScanOptions,
      include: split(include),
      exclude: split(exclude),
      language: language.value,
      maxFiles: Number(maxFiles),
      maxTotalBytes: Number(kib) * 1024,
    });
  }
  private async cancellable<T>(
    title: string,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      async (_progress, token) => {
        const controller = new AbortController();
        const listener = token.onCancellationRequested(() =>
          controller.abort(),
        );
        if (token.isCancellationRequested) controller.abort();
        try {
          return await action(controller.signal);
        } finally {
          listener.dispose();
        }
      },
    );
  }
  async preview(node?: ScanNode, input?: unknown) {
    const target = await this.resolve(node?.folder);
    if (!target) return;
    // Explicit command arguments support other extensions and real editor fixtures.
    // They only initiate a bounded local scan, never generation or publication.
    const options =
      input === undefined
        ? await this.options()
        : scanOptionsSchema.parse(input);
    if (!options) return;
    this.pending.delete(this.key(target));
    const plan = await this.cancellable(
      'Repo Knowledge: 静态扫描规划 / Scan plan',
      (signal) => scanRepository(target.root, target.store, options, signal),
    );
    const uri = this.documents.create(
      'generation-plan.json',
      JSON.stringify(plan, null, 2),
    );
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(uri),
      { preview: true },
    );
    this.pending.set(this.key(target), plan);
    void vscode.window.showInformationMessage(
      `扫描规划：${plan.files.length} 文件，${plan.summary.selectedBytes} bytes${plan.summary.limited ? '，达到限额或存在未覆盖内容' : ''}。未调用模型、未生成知识；检查后可运行 Save Generation Plan。`,
    );
    return { uri, plan };
  }
  async save(node?: ScanNode) {
    const target = await this.resolve(node?.folder);
    if (!target) return;
    const plan = this.pending.get(this.key(target));
    if (!plan)
      throw new Error(
        '请先运行 Plan Knowledge Generation 并检查当前仓库规划 / Preview a plan for this repository first.',
      );
    const result = await this.cancellable(
      'Repo Knowledge: 重检并保存规划 / Verify plan',
      (signal) => saveScanPlan(target.root, target.store, plan, signal),
    );
    this.pending.delete(this.key(target));
    void vscode.window.showInformationMessage(
      '规划已保存，仅含路径、指纹和统计；尚未生成或发布 / Plan saved; no generation or publication.',
    );
    return result;
  }
  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.pending.clear();
  }
}
