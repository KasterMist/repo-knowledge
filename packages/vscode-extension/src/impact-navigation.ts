import * as vscode from 'vscode';
import { resolveImpactSource } from '@repo-knowledge/core';
import type { KnowledgeTarget } from './workbench.js';
import type { KnowledgeDocuments } from './documents.js';
interface Entry {
  target: KnowledgeTarget;
  revision: string;
  files: string[];
  cards: string[];
}
export class ImpactNavigation implements vscode.Disposable {
  private readonly reports = new Map<string, Entry>();
  private readonly listeners: vscode.Disposable[];
  constructor(private readonly documents: KnowledgeDocuments) {
    this.listeners = [
      vscode.commands.registerCommand(
        'repoKnowledge.openImpactTarget',
        async (choice?: { kind: string; value: string }) => {
          try {
            return await this.open(choice);
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Impact navigation failed';
            void vscode.window.showErrorMessage(`Repo Knowledge: ${message}`);
            return { error: true, message };
          }
        },
      ),
      vscode.workspace.onDidCloseTextDocument((d) =>
        this.reports.delete(d.uri.toString()),
      ),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.reports.clear()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('repoKnowledge')) this.reports.clear();
      }),
    ];
  }
  remember(uri: vscode.Uri, entry: Entry) {
    if (this.reports.size >= 20)
      this.reports.delete(this.reports.keys().next().value!);
    this.reports.set(uri.toString(), entry);
  }
  private async open(choice?: { kind: string; value: string }) {
    if (!vscode.workspace.isTrusted)
      throw new Error('Impact navigation requires a trusted workspace.');
    const entry = this.reports.get(
      vscode.window.activeTextEditor?.document.uri.toString() ?? '',
    );
    if (!entry)
      throw new Error(
        '请先打开变更报告 / Open a knowledge impact report first.',
      );
    const options = [
      ...entry.files.map((value) => ({
        label: value,
        description: '源码 / Source',
        targetKind: 'file',
        value,
      })),
      ...entry.cards.map((value) => ({
        label: value,
        description: '卡片 / Card',
        targetKind: 'card',
        value,
      })),
    ];
    const selected = choice
      ? options.find(
          (o) => o.targetKind === choice.kind && o.value === choice.value,
        )
      : await vscode.window.showQuickPick(options, {
          title: '报告导航 / Open report target',
        });
    if (!selected) {
      if (choice) throw new Error('Target is not part of this report.');
      return;
    }
    if (
      (await entry.target.knowledge.snapshot()).snapshotRevision !==
      entry.revision
    )
      throw new Error(
        '知识已变化，请重新打开报告 / Knowledge changed; review a fresh report.',
      );
    if (selected.targetKind === 'file') {
      const path = await resolveImpactSource(entry.target.root, selected.value);
      const uri = entry.target.uriForFile(path);
      await vscode.window.showTextDocument(uri, { preview: true });
      return uri;
    }
    const result = await entry.target.knowledge.read(selected.value);
    if (result.snapshotRevision !== entry.revision)
      throw new Error('Knowledge changed during navigation.');
    const uri = this.documents.create(
      'impact-card.json',
      JSON.stringify(result, null, 2),
    );
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(uri),
      { preview: true },
    );
    return uri;
  }
  dispose() {
    this.listeners.forEach((l) => l.dispose());
    this.reports.clear();
  }
}
