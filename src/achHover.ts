import * as vscode from 'vscode';
import { getAchFieldAtPosition, type AchDocument } from './achDocument';
import { recordTypeDescriptions } from './nachaFields';

type DocumentResolver = (document: vscode.TextDocument) => AchDocument;

export class AchHoverProvider implements vscode.HoverProvider {
  constructor(private readonly resolveDocument: DocumentResolver) { }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): vscode.Hover | undefined {
    if (token.isCancellationRequested) { return undefined; }
    const record = this.resolveDocument(document).recordByLine.get(position.line);
    if (!record || token.isCancellationRequested) { return undefined; }

    const recordDescription = recordTypeDescriptions[record.recordType];
    if (!recordDescription && record.kind !== 'padding') { return undefined; }

    if (record.kind === 'padding') {
      return new vscode.Hover(new vscode.MarkdownString(
        '**Padding Record**\n\nBlocking/filler record used to pad the file to a required block size (multiple of 10 records).',
      ));
    }

    const field = getAchFieldAtPosition(record, position.character);
    if (!field) {
      return new vscode.Hover(new vscode.MarkdownString(
        `**${recordDescription}**${record.secCode ? ` (${record.secCode})` : ''}`,
      ));
    }

    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${field.name}**\n\n`);
    markdown.appendMarkdown(`${field.description}\n\n`);
    markdown.appendMarkdown('---\n\n');
    markdown.appendMarkdown(`**Position:** ${field.start + 1}-${field.end} (${field.end - field.start} chars)\n\n`);
    if (field.value) { markdown.appendCodeblock(field.value, 'text'); }

    return new vscode.Hover(markdown, new vscode.Range(
      position.line,
      field.start,
      position.line,
      field.end,
    ));
  }
}
