import * as vscode from 'vscode';
import {
  applyAchTextEdits,
  buildNormalizedBlockCountEdit,
  fixForAchDiagnostic,
  type AchTextEdit,
} from './achFixes';
import type { AchDocument } from './achDocument';
import type { AchDiagnostic } from './achTypes';

type AnalysisResolver = (document: vscode.TextDocument) => {
  document: AchDocument;
  diagnostics: AchDiagnostic[];
};

export function workspaceEditForAchEdits(uri: vscode.Uri, edits: AchTextEdit[]): vscode.WorkspaceEdit {
  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) {
    workspaceEdit.replace(
      uri,
      new vscode.Range(edit.startLine, edit.startCharacter, edit.endLine, edit.endCharacter),
      edit.newText,
    );
  }
  return workspaceEdit;
}

export class AchCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly resolveAnalysis: AnalysisResolver) { }

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const analysis = this.resolveAnalysis(document);
    const actions: vscode.CodeAction[] = [];
    for (const vscodeDiagnostic of context.diagnostics) {
      const code = typeof vscodeDiagnostic.code === 'string'
        ? vscodeDiagnostic.code
        : typeof vscodeDiagnostic.code === 'object'
          ? vscodeDiagnostic.code.value
          : undefined;
      if (!code) { continue; }
      const diagnostic = analysis.diagnostics.find(candidate =>
        candidate.code === code
        && candidate.line === vscodeDiagnostic.range.start.line
        && candidate.start === vscodeDiagnostic.range.start.character,
      );
      if (!diagnostic) { continue; }
      const edit = fixForAchDiagnostic(analysis.document, diagnostic);
      if (!edit) { continue; }
      const edits = [edit];
      if (diagnostic.code === 'ACH-PHYSICAL-PADDING-COUNT') {
        const blockCount = buildNormalizedBlockCountEdit(analysis.document);
        if (blockCount) { edits.push(blockCount); }
      }
      const action = new vscode.CodeAction(edit.title, vscode.CodeActionKind.QuickFix);
      action.edit = workspaceEditForAchEdits(document.uri, edits);
      action.diagnostics = [vscodeDiagnostic];
      action.isPreferred = true;
      actions.push(action);
    }
    return actions;
  }
}

export class AchFixPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private counter = 0;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  create(source: vscode.Uri, content: string): vscode.Uri {
    const preview = vscode.Uri.from({
      scheme: 'ach-fix-preview',
      path: source.path,
      query: `preview=${++this.counter}`,
    });
    this.contents.set(preview.toString(), content);
    if (this.contents.size > 10) {
      const oldest = this.contents.keys().next().value as string | undefined;
      if (oldest) { this.contents.delete(oldest); }
    }
    return preview;
  }
}

export async function previewAndApplyAchEdits(
  document: vscode.TextDocument,
  edits: AchTextEdit[],
  title: string,
  previewProvider: AchFixPreviewProvider,
): Promise<boolean> {
  if (edits.length === 0) {
    void vscode.window.showInformationMessage(`No ${title.toLowerCase()} are needed.`);
    return false;
  }
  const previewText = applyAchTextEdits(document.getText(), edits);
  const previewUri = previewProvider.create(document.uri, previewText);
  await vscode.commands.executeCommand('vscode.diff', document.uri, previewUri, `${title} Preview`);
  const choice = await vscode.window.showInformationMessage(
    `${edits.length} edit${edits.length === 1 ? '' : 's'} ready. Review the open diff, then apply or cancel.`,
    'Apply Fixes',
    'Cancel',
  );
  if (choice !== 'Apply Fixes') { return false; }
  const applied = await vscode.workspace.applyEdit(workspaceEditForAchEdits(document.uri, edits));
  if (applied) {
    await vscode.window.showTextDocument(document, { preview: false });
  }
  return applied;
}
