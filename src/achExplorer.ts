import * as vscode from 'vscode';
import { decodeAchField, isSensitiveAchField, maskAchValue } from './achDecode';
import type { AchBatch, AchDocument, AchEntry, AchField, AchRecord } from './achDocument';
import { transactionCodes } from './achRules';
import { formatAchCents, type AchSummary } from './nachaParser';
import type { AchDiagnostic } from './achTypes';

type ExplorerNodeKind = 'file' | 'group' | 'batch' | 'entry' | 'record' | 'field' | 'padding';

export class AchExplorerNode extends vscode.TreeItem {
  readonly children: AchExplorerNode[] = [];
  parent?: AchExplorerNode;
  line?: number;
  start?: number;
  end?: number;

  constructor(
    label: string,
    readonly kind: ExplorerNodeKind,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
    this.contextValue = `achExplorer.${kind}`;
  }

  add(child: AchExplorerNode): void {
    child.parent = this;
    this.children.push(child);
  }
}

const recordLabels: Record<string, string> = {
  fileHeader: 'File Header',
  batchHeader: 'Batch Header',
  entryDetail: 'Entry Detail',
  addenda: 'Addenda',
  batchControl: 'Batch Control',
  fileControl: 'File Control',
  padding: 'Padding',
  unknown: 'Unknown Record',
};

function trimmed(record: AchRecord, start: number, end: number): string {
  return record.raw.substring(start, end).trim();
}

function setSourceCommand(node: AchExplorerNode, uri: vscode.Uri, line: number, start: number, end: number): void {
  node.line = line;
  node.start = start;
  node.end = end;
  node.command = {
    command: 'nacha-file-parser.revealRange',
    title: 'Reveal in ACH File',
    arguments: [uri, line, start, end],
  };
}

function diagnosticsForLines(diagnostics: AchDiagnostic[], lines: Iterable<number>): AchDiagnostic[] {
  const lineSet = new Set(lines);
  return diagnostics.filter(diagnostic => lineSet.has(diagnostic.line));
}

function addDiagnosticBadge(node: AchExplorerNode, diagnostics: AchDiagnostic[], baseDescription?: string): void {
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 0).length;
  const warnings = diagnostics.filter(diagnostic => diagnostic.severity === 1).length;
  const badge = errors > 0
    ? `${errors} error${errors === 1 ? '' : 's'}`
    : warnings > 0
      ? `${warnings} warning${warnings === 1 ? '' : 's'}`
      : undefined;
  node.description = [baseDescription, badge].filter(Boolean).join(' · ');
  if (errors > 0) {
    node.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground'));
  } else if (warnings > 0) {
    node.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
  }
}

function entryAmount(entry: AchEntry): string | undefined {
  const raw = entry.detail.raw.substring(29, 39);
  return /^\d{10}$/.test(raw) ? `$${formatAchCents(BigInt(raw))}` : undefined;
}

function entryAccount(entry: AchEntry, maskSensitiveValues: boolean): string | undefined {
  const field = entry.detail.fields.find(candidate => isSensitiveAchField(candidate.name));
  if (!field?.value) { return undefined; }
  return maskSensitiveValues ? maskAchValue(field.value) : field.value;
}

function batchAmounts(batch: AchBatch): { debit: bigint; credit: bigint } {
  let debit = 0n;
  let credit = 0n;
  for (const entry of batch.entries) {
    const amount = entry.detail.raw.substring(29, 39);
    const rule = transactionCodes.get(entry.detail.raw.substring(1, 3));
    if (!rule || !/^\d{10}$/.test(amount)) { continue; }
    if (rule.direction === 'credit') { credit += BigInt(amount); }
    else { debit += BigInt(amount); }
  }
  return { debit, credit };
}

export class AchExplorerProvider implements vscode.TreeDataProvider<AchExplorerNode> {
  private readonly changeEmitter = new vscode.EventEmitter<AchExplorerNode | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private roots: AchExplorerNode[] = [];
  private readonly recordNodeByLine = new Map<number, AchExplorerNode>();
  private readonly fieldNodesByLine = new Map<number, AchExplorerNode[]>();

  getTreeItem(element: AchExplorerNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AchExplorerNode): AchExplorerNode[] {
    return element ? element.children : this.roots;
  }

  getParent(element: AchExplorerNode): AchExplorerNode | undefined {
    return element.parent;
  }

  clear(): void {
    this.roots = [];
    this.recordNodeByLine.clear();
    this.fieldNodesByLine.clear();
    this.changeEmitter.fire();
  }

  update(
    uri: vscode.Uri,
    document: AchDocument,
    diagnostics: AchDiagnostic[],
    summary: AchSummary,
    maskSensitiveValues: boolean,
    entryLimit = 1000,
  ): void {
    this.recordNodeByLine.clear();
    this.fieldNodesByLine.clear();

    const fileName = vscode.workspace.asRelativePath(uri, false) || uri.path.split('/').at(-1) || 'ACH File';
    const fileNode = new AchExplorerNode(fileName, 'file', vscode.TreeItemCollapsibleState.Expanded);
    fileNode.id = `${uri.toString()}#file`;
    fileNode.iconPath = new vscode.ThemeIcon('file-binary');
    const reversalText = summary.reversalBatches > 0 ? ` · ${summary.reversalEntries} reversal entries` : '';
    const prenoteText = summary.prenoteEntries > 0 ? ` · ${summary.prenoteEntries} prenotes` : '';
    const summaryText = `${summary.batches} batches · ${summary.entries} entries${reversalText}${prenoteText} · $${formatAchCents(summary.totalCreditCents)} CR · $${formatAchCents(summary.totalDebitCents)} DR`;
    addDiagnosticBadge(fileNode, diagnostics, summaryText);

    for (const header of document.fileHeaders) {
      fileNode.add(this.createRecordNode(uri, header, diagnostics, maskSensitiveValues));
    }
    const entryBudget = { remaining: Math.max(0, entryLimit) };
    for (let index = 0; index < document.batches.length; index++) {
      fileNode.add(this.createBatchNode(uri, document.batches[index], index, diagnostics, maskSensitiveValues, entryBudget));
    }
    for (const control of document.fileControls) {
      fileNode.add(this.createRecordNode(uri, control, diagnostics, maskSensitiveValues));
    }
    if (document.paddingRecords.length > 0) {
      const padding = new AchExplorerNode(`Padding · ${document.paddingRecords.length} record${document.paddingRecords.length === 1 ? '' : 's'}`, 'padding', vscode.TreeItemCollapsibleState.None);
      padding.id = `${uri.toString()}#padding`;
      padding.iconPath = new vscode.ThemeIcon('dash');
      const first = document.paddingRecords[0];
      setSourceCommand(padding, uri, first.line, 0, first.raw.length);
      addDiagnosticBadge(padding, diagnosticsForLines(diagnostics, document.paddingRecords.map(record => record.line)));
      fileNode.add(padding);
    }
    if (document.orphanRecords.length > 0) {
      const group = new AchExplorerNode('Unattached Records', 'group', vscode.TreeItemCollapsibleState.Collapsed);
      group.id = `${uri.toString()}#orphans`;
      group.iconPath = new vscode.ThemeIcon('question');
      for (const record of document.orphanRecords) {
        group.add(this.createRecordNode(uri, record, diagnostics, maskSensitiveValues));
      }
      addDiagnosticBadge(group, diagnosticsForLines(diagnostics, document.orphanRecords.map(record => record.line)));
      fileNode.add(group);
    }

    this.roots = [fileNode];
    this.changeEmitter.fire();
  }

  nodeAt(line: number, character: number): AchExplorerNode | undefined {
    const field = this.fieldNodesByLine.get(line)?.find(node =>
      node.start !== undefined && node.end !== undefined && character >= node.start && character < node.end,
    );
    return field ?? this.recordNodeByLine.get(line);
  }

  private createBatchNode(
    uri: vscode.Uri,
    batch: AchBatch,
    index: number,
    diagnostics: AchDiagnostic[],
    maskSensitiveValues: boolean,
    entryBudget: { remaining: number },
  ): AchExplorerNode {
    const batchNumber = trimmed(batch.header, 87, 94) || String(index + 1);
    const secCode = batch.secCode || 'Unknown SEC';
    const purpose = batch.isReversal ? ' · REVERSAL' : '';
    const node = new AchExplorerNode(`Batch ${batchNumber} · ${secCode}${purpose}`, 'batch', vscode.TreeItemCollapsibleState.Collapsed);
    node.id = `${uri.toString()}#batch-${batch.header.line}`;
    node.iconPath = new vscode.ThemeIcon(batch.isReversal ? 'discard' : 'layers');
    setSourceCommand(node, uri, batch.header.line, 0, batch.header.raw.length);
    const amounts = batchAmounts(batch);
    const amountDescription = `$${formatAchCents(amounts.credit)} CR · $${formatAchCents(amounts.debit)} DR`;
    addDiagnosticBadge(node, diagnosticsForLines(diagnostics, batch.records.map(record => record.line)), `${batch.entries.length} entries · ${amountDescription}`);

    node.add(this.createRecordNode(uri, batch.header, diagnostics, maskSensitiveValues));
    const visibleEntryCount = Math.min(batch.entries.length, entryBudget.remaining);
    for (let entryIndex = 0; entryIndex < visibleEntryCount; entryIndex++) {
      node.add(this.createEntryNode(uri, batch.entries[entryIndex], entryIndex, diagnostics, maskSensitiveValues));
    }
    entryBudget.remaining -= visibleEntryCount;
    const hiddenEntryCount = batch.entries.length - visibleEntryCount;
    if (hiddenEntryCount > 0) {
      const hidden = new AchExplorerNode(
        `${hiddenEntryCount} additional entr${hiddenEntryCount === 1 ? 'y' : 'ies'} hidden by explorer limit`,
        'group',
        vscode.TreeItemCollapsibleState.None,
      );
      hidden.id = `${uri.toString()}#batch-${batch.header.line}-hidden-entries`;
      hidden.iconPath = new vscode.ThemeIcon('ellipsis');
      hidden.tooltip = 'Increase nachaFileParser.explorerEntryLimit to display more entries.';
      node.add(hidden);
    }
    if (batch.orphanRecords.length > 0) {
      const group = new AchExplorerNode('Unattached Batch Records', 'group', vscode.TreeItemCollapsibleState.Collapsed);
      group.id = `${uri.toString()}#batch-${batch.header.line}-orphans`;
      for (const record of batch.orphanRecords) {
        group.add(this.createRecordNode(uri, record, diagnostics, maskSensitiveValues));
      }
      addDiagnosticBadge(group, diagnosticsForLines(diagnostics, batch.orphanRecords.map(record => record.line)));
      node.add(group);
    }
    if (batch.control) {
      node.add(this.createRecordNode(uri, batch.control, diagnostics, maskSensitiveValues));
    }
    return node;
  }

  private createEntryNode(
    uri: vscode.Uri,
    entry: AchEntry,
    index: number,
    diagnostics: AchDiagnostic[],
    maskSensitiveValues: boolean,
  ): AchExplorerNode {
    const transactionCode = trimmed(entry.detail, 1, 3);
    const transaction = transactionCodes.get(transactionCode);
    const traceSequence = trimmed(entry.detail, 87, 94) || String(index + 1);
    const node = new AchExplorerNode(`Entry ${traceSequence} · ${transaction?.description ?? transactionCode}`, 'entry', vscode.TreeItemCollapsibleState.Collapsed);
    node.id = `${uri.toString()}#entry-${entry.detail.line}`;
    node.iconPath = new vscode.ThemeIcon(entry.isPrenote ? 'preview' : 'symbol-field');
    setSourceCommand(node, uri, entry.detail.line, 0, entry.detail.raw.length);
    const description = [entryAmount(entry), entryAccount(entry, maskSensitiveValues), `${entry.addenda.length} addenda`].filter(Boolean).join(' · ');
    addDiagnosticBadge(node, diagnosticsForLines(diagnostics, entry.records.map(record => record.line)), description);

    node.add(this.createRecordNode(uri, entry.detail, diagnostics, maskSensitiveValues));
    for (const addenda of entry.addenda) {
      node.add(this.createRecordNode(uri, addenda, diagnostics, maskSensitiveValues));
    }
    return node;
  }

  private createRecordNode(
    uri: vscode.Uri,
    record: AchRecord,
    diagnostics: AchDiagnostic[],
    maskSensitiveValues: boolean,
  ): AchExplorerNode {
    const label = record.kind === 'addenda'
      ? `${recordLabels[record.kind]} ${trimmed(record, 1, 3) || ''}`.trim()
      : recordLabels[record.kind];
    const state = record.fields.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
    const node = new AchExplorerNode(label, 'record', state);
    node.id = `${uri.toString()}#record-${record.line}`;
    node.iconPath = new vscode.ThemeIcon(record.kind.includes('Control') ? 'checklist' : 'symbol-structure');
    setSourceCommand(node, uri, record.line, 0, record.raw.length);
    addDiagnosticBadge(node, diagnostics.filter(diagnostic => diagnostic.line === record.line), `line ${record.line + 1}`);
    this.recordNodeByLine.set(record.line, node);

    for (const field of record.fields) {
      node.add(this.createFieldNode(uri, record, field, diagnostics, maskSensitiveValues));
    }
    return node;
  }

  private createFieldNode(
    uri: vscode.Uri,
    record: AchRecord,
    field: AchField,
    diagnostics: AchDiagnostic[],
    maskSensitiveValues: boolean,
  ): AchExplorerNode {
    const decoded = decodeAchField(record, field, maskSensitiveValues);
    const rawDisplay = decoded.raw.trim() || '<blank>';
    const fieldDescription = rawDisplay === decoded.display ? decoded.display : `${rawDisplay} → ${decoded.display}`;
    const node = new AchExplorerNode(field.name, 'field', vscode.TreeItemCollapsibleState.None);
    node.id = `${uri.toString()}#field-${record.line}-${field.start}`;
    node.description = fieldDescription;
    node.iconPath = new vscode.ThemeIcon(decoded.masked ? 'lock' : 'symbol-property');
    setSourceCommand(node, uri, record.line, field.range.start, field.range.end);

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${field.name}**\n\n${field.description}\n\n`);
    tooltip.appendMarkdown(`Position ${field.start + 1}-${field.end}\n\n`);
    tooltip.appendCodeblock(decoded.raw, 'text');
    if (decoded.masked) { tooltip.appendMarkdown('\nSensitive value masked by ACH Explorer settings.'); }
    node.tooltip = tooltip;

    const fieldDiagnostics = diagnostics.filter(diagnostic =>
      diagnostic.line === record.line
      && diagnostic.start < field.range.end
      && diagnostic.end > field.range.start,
    );
    addDiagnosticBadge(node, fieldDiagnostics, fieldDescription);
    const lineFields = this.fieldNodesByLine.get(record.line) ?? [];
    lineFields.push(node);
    this.fieldNodesByLine.set(record.line, lineFields);
    return node;
  }
}
