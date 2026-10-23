import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';

// Immutable views: editing a displayed card cannot bypass proposal review.
export class KnowledgeDocuments
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly values = new Map<string, string>();
  private readonly provider =
    vscode.workspace.registerTextDocumentContentProvider(
      'repo-knowledge',
      this,
    );
  private readonly closed = vscode.workspace.onDidCloseTextDocument(
    (document) => {
      if (document.uri.scheme === 'repo-knowledge')
        this.values.delete(document.uri.toString());
    },
  );
  create(name: string, text: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: 'repo-knowledge',
      path: `/${randomUUID()}/${name}`,
    });
    this.values.set(uri.toString(), text);
    return uri;
  }
  provideTextDocumentContent(uri: vscode.Uri): string {
    const text = this.values.get(uri.toString());
    if (text === undefined)
      throw new Error('Knowledge view expired; reopen it from the workbench.');
    return text;
  }
  dispose(): void {
    this.provider.dispose();
    this.closed.dispose();
    this.values.clear();
  }
}
