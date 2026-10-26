import * as vscode from 'vscode';
import { join, isAbsolute, relative } from 'node:path';
import { lstat, mkdtemp, mkdir, rmdir } from 'node:fs/promises';
import {
  diagnoseCodexBackend,
  resolveStoragePath,
  type BackendDiagnostic,
} from '@repo-knowledge/core';
import type { KnowledgeDocuments } from './documents.js';
import type { KnowledgeTarget } from './workbench.js';

interface BackendTarget extends KnowledgeTarget {
  configuration: vscode.WorkspaceConfiguration;
}
type BackendResolver = (
  folder?: vscode.WorkspaceFolder,
) => Promise<BackendTarget | undefined>;
export class BackendWorkbench implements vscode.Disposable {
  private readonly command: vscode.Disposable;
  constructor(
    private readonly resolve: BackendResolver,
    private readonly documents: KnowledgeDocuments,
    private readonly storage: vscode.Uri,
  ) {
    this.command = vscode.commands.registerCommand(
      'repoKnowledge.diagnoseGenerationBackend',
      async (node?: { folder?: vscode.WorkspaceFolder }) => {
        try {
          if (!vscode.workspace.isTrusted)
            throw new Error(
              'Generation backend diagnostics require a trusted workspace.',
            );
          return await this.diagnose(node?.folder);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Backend diagnostic failed';
          void vscode.window.showErrorMessage(`Repo Knowledge: ${message}`);
          return { error: true, message };
        }
      },
    );
  }
  private async executable(
    configured: string,
  ): Promise<{ command: string; source: 'setting' | 'installed-extension' }> {
    let command = configured,
      source: 'setting' | 'installed-extension' = 'setting';
    if (!command) {
      const extension = vscode.extensions.getExtension('openai.chatgpt');
      if (!extension || extension.extensionUri.scheme !== 'file')
        throw new Error(
          '未找到当前宿主的 Codex 可执行文件。请在本机/远端设置 repoKnowledge.codexExecutable 为该宿主上的绝对路径 / Set an absolute host-side Codex executable.',
        );
      if (
        process.arch !== 'x64' ||
        !['win32', 'linux'].includes(process.platform)
      )
        throw new Error(
          '当前自动发现仅验证 Windows/Linux x64；请设置明确的宿主可执行文件路径。',
        );
      command = join(
        extension.extensionUri.fsPath,
        'bin',
        process.platform === 'win32' ? 'windows-x86_64' : 'linux-x86_64',
        process.platform === 'win32' ? 'codex.exe' : 'codex',
      );
      source = 'installed-extension';
    }
    if (
      !isAbsolute(command) ||
      (process.platform === 'win32' && /\.(cmd|bat|ps1)$/iu.test(command))
    )
      throw new Error(
        'codexExecutable 必须是可直接启动的绝对路径；不使用 shell 包装脚本。',
      );
    let info;
    try {
      info = await lstat(command);
    } catch {
      throw new Error(
        '配置的 Codex 可执行文件在当前宿主不存在。请检查本机与 SSH 路径 / Codex executable not found on this host.',
      );
    }
    if (!info.isFile() && !info.isSymbolicLink())
      throw new Error('Codex executable is not a file.');
    return { command, source };
  }
  private guidance(report: BackendDiagnostic): string {
    if (report.status === 'configured')
      return '独立进程已确认配置和账户状态；尚未验证模型访问或生成。已有 Codex 聊天不受此诊断控制。';
    if (report.status === 'not-authenticated')
      return '独立进程未报告已配置账户。请核对当前宿主的 CLI 登录方式；本插件不会启动登录或复制令牌。';
    if (report.error?.code === 'CANCELLED')
      return '诊断已取消；未创建模型对话。';
    if (report.error?.code === 'REQUEST_TIMEOUT')
      return '后端请求超时。保留阶段和错误码，核对当前宿主环境与 CLI 可用性；不能据此推定官方扩展已退出登录。';
    if (report.error?.code === 'RPC_REJECTED')
      return '后端拒绝该阶段请求。错误分类供排查，不展示原始错误或凭据；不能把安装可见性当作生成已连接。';
    return '后端诊断未完成。请根据阶段/错误码检查可执行文件和协议兼容性；现有知识检索与快照保持不变。';
  }
  async diagnose(folder?: vscode.WorkspaceFolder) {
    if (!vscode.workspace.isTrusted)
      throw new Error(
        'Generation backend diagnostics require a trusted workspace.',
      );
    const target = await this.resolve(folder);
    if (!target) return;
    const executable = await this.executable(
      target.configuration.get<string>('codexExecutable', ''),
    );
    const storage = await resolveStoragePath(this.storage.fsPath);
    const location = relative(target.root, storage);
    if (
      location === '' ||
      (!isAbsolute(location) &&
        location !== '..' &&
        !location.startsWith('../') &&
        !location.startsWith('..\\'))
    )
      throw new Error(
        'Backend diagnostic storage must be outside the target repository.',
      );
    await mkdir(storage, { recursive: true });
    const scratch = await mkdtemp(join(storage, 'backend-diagnostic-'));
    const report = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Repo Knowledge: 生成后端诊断 / Backend diagnostic',
        cancellable: true,
      },
      async (_progress, token) => {
        const controller = new AbortController(),
          listener = token.onCancellationRequested(() => controller.abort());
        if (token.isCancellationRequested) controller.abort();
        try {
          return await diagnoseCodexBackend(
            executable.command,
            scratch,
            controller.signal,
          );
        } finally {
          listener.dispose();
          // Remove only our empty scratch directory; never recursively delete backend output.
          await rmdir(scratch).catch(() => {});
        }
      },
    );
    const view = {
      executionHost: vscode.env.remoteName ?? 'native',
      platform: process.platform,
      extensionHostNode: process.version,
      executableSource: executable.source,
      ...report,
      guidance: this.guidance(report),
    };
    const uri = this.documents.create(
      'generation-backend-diagnostic.json',
      JSON.stringify(view, null, 2),
    );
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(uri),
      { preview: true },
    );
    return { uri, ...view };
  }
  dispose(): void {
    this.command.dispose();
  }
}
