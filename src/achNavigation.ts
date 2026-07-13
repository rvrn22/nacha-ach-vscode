import * as vscode from 'vscode';
import { getAchFieldAtPosition, type AchDocument, type AchRecord, type AchSourceRange } from './achDocument';
import { transactionCodes } from './achRules';

type DocumentResolver = (document: vscode.TextDocument) => AchDocument;

function sourceRange(record: AchRecord, start = 0, end = record.raw.length): AchSourceRange {
  return { line: record.line, start, end: Math.min(end, record.raw.length) };
}

function vscodeRange(range: AchSourceRange): vscode.Range {
  return new vscode.Range(range.line, range.start, range.line, range.end);
}

function recordRange(record: AchRecord): vscode.Range {
  return vscodeRange(sourceRange(record));
}

function hierarchyRange(first: AchRecord, last: AchRecord): vscode.Range {
  return new vscode.Range(first.line, 0, last.line, last.raw.length);
}

function recordSymbol(name: string, detail: string, kind: vscode.SymbolKind, record: AchRecord): vscode.DocumentSymbol {
  return new vscode.DocumentSymbol(name, detail, kind, recordRange(record), recordRange(record));
}

export class AchDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly resolveDocument: DocumentResolver) { }

  provideDocumentSymbols(document: vscode.TextDocument, token?: vscode.CancellationToken): vscode.DocumentSymbol[] {
    if (token?.isCancellationRequested) { return []; }
    const achDocument = this.resolveDocument(document);
    if (achDocument.records.length === 0) { return []; }
    const first = achDocument.records[0];
    const last = achDocument.records.at(-1) ?? first;
    const fileSymbol = new vscode.DocumentSymbol(
      'ACH File',
      `${achDocument.batches.length} batches`,
      vscode.SymbolKind.File,
      hierarchyRange(first, last),
      recordRange(achDocument.fileHeaders[0] ?? first),
    );

    for (const header of achDocument.fileHeaders) {
      if (token?.isCancellationRequested) { return []; }
      fileSymbol.children.push(recordSymbol('File Header', '', vscode.SymbolKind.Struct, header));
    }
    for (let batchIndex = 0; batchIndex < achDocument.batches.length; batchIndex++) {
      if (token?.isCancellationRequested) { return []; }
      const batch = achDocument.batches[batchIndex];
      const batchLast = batch.control ?? batch.records.at(-1) ?? batch.header;
      const batchNumber = batch.header.raw.substring(87, 94).trim() || String(batchIndex + 1);
      const companyName = batch.header.raw.substring(4, 20).trim();
      const batchSymbol = new vscode.DocumentSymbol(
        `Batch ${batchNumber}`,
        [batch.secCode, companyName].filter(Boolean).join(' · '),
        vscode.SymbolKind.Namespace,
        hierarchyRange(batch.header, batchLast),
        recordRange(batch.header),
      );
      batchSymbol.children.push(recordSymbol('Batch Header', batch.secCode, vscode.SymbolKind.Struct, batch.header));

      for (let entryIndex = 0; entryIndex < batch.entries.length; entryIndex++) {
        if (token?.isCancellationRequested) { return []; }
        const entry = batch.entries[entryIndex];
        const entryLast = entry.addenda.at(-1) ?? entry.detail;
        const sequence = entry.detail.raw.substring(87, 94).trim() || String(entryIndex + 1);
        const transactionCode = entry.detail.raw.substring(1, 3);
        const transaction = transactionCodes.get(transactionCode)?.description ?? transactionCode;
        const entrySymbol = new vscode.DocumentSymbol(
          `Entry ${sequence}`,
          transaction,
          vscode.SymbolKind.Object,
          hierarchyRange(entry.detail, entryLast),
          recordRange(entry.detail),
        );
        entrySymbol.children.push(recordSymbol('Entry Detail', transactionCode, vscode.SymbolKind.Field, entry.detail));
        for (const addenda of entry.addenda) {
          entrySymbol.children.push(recordSymbol(
            `Addenda ${addenda.raw.substring(1, 3).trim()}`,
            '',
            vscode.SymbolKind.Property,
            addenda,
          ));
        }
        batchSymbol.children.push(entrySymbol);
      }

      if (batch.control) {
        batchSymbol.children.push(recordSymbol('Batch Control', '', vscode.SymbolKind.Struct, batch.control));
      }
      fileSymbol.children.push(batchSymbol);
    }
    for (const control of achDocument.fileControls) {
      fileSymbol.children.push(recordSymbol('File Control', '', vscode.SymbolKind.Struct, control));
    }
    return [fileSymbol];
  }
}

export class AchFoldingRangeProvider implements vscode.FoldingRangeProvider {
  constructor(private readonly resolveDocument: DocumentResolver) { }

  provideFoldingRanges(document: vscode.TextDocument, _context?: vscode.FoldingContext, token?: vscode.CancellationToken): vscode.FoldingRange[] {
    if (token?.isCancellationRequested) { return []; }
    const achDocument = this.resolveDocument(document);
    const ranges: vscode.FoldingRange[] = [];
    for (const batch of achDocument.batches) {
      if (token?.isCancellationRequested) { return []; }
      const last = batch.control ?? batch.records.at(-1);
      if (last && last.line > batch.header.line) {
        ranges.push(new vscode.FoldingRange(batch.header.line, last.line, vscode.FoldingRangeKind.Region));
      }
      for (const entry of batch.entries) {
        const lastAddenda = entry.addenda.at(-1);
        if (lastAddenda) {
          ranges.push(new vscode.FoldingRange(entry.detail.line, lastAddenda.line, vscode.FoldingRangeKind.Region));
        }
      }
    }
    if (achDocument.paddingRecords.length > 1) {
      ranges.push(new vscode.FoldingRange(
        achDocument.paddingRecords[0].line,
        achDocument.paddingRecords.at(-1)?.line ?? achDocument.paddingRecords[0].line,
        vscode.FoldingRangeKind.Region,
      ));
    }
    return ranges;
  }
}

export class AchInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.changeEmitter.event;

  constructor(
    private readonly resolveDocument: DocumentResolver,
    private readonly hintsEnabled: (document: vscode.TextDocument) => boolean = document =>
      vscode.workspace.getConfiguration('nachaFileParser', document.uri).get<boolean>('showFieldInlayHints', false),
  ) { }

  refresh(): void {
    this.changeEmitter.fire();
  }

  provideInlayHints(document: vscode.TextDocument, range: vscode.Range, token?: vscode.CancellationToken): vscode.InlayHint[] {
    if (token?.isCancellationRequested) { return []; }
    if (!this.hintsEnabled(document)) { return []; }
    const achDocument = this.resolveDocument(document);
    const hints: vscode.InlayHint[] = [];
    for (const record of achDocument.records) {
      if (token?.isCancellationRequested) { return []; }
      if (record.line < range.start.line || record.line > range.end.line || record.kind === 'padding') { continue; }
      for (const field of record.fields) {
        if (field.range.start >= record.raw.length) { continue; }
        const hint = new vscode.InlayHint(
          new vscode.Position(record.line, field.range.start),
          `${field.name}:`,
          vscode.InlayHintKind.Type,
        );
        hint.paddingRight = true;
        hint.tooltip = `${field.description} · positions ${field.start + 1}-${field.end}`;
        hints.push(hint);
      }
    }
    return hints;
  }
}

export function findMatchingAchRange(document: AchDocument, line: number): AchSourceRange | undefined {
  const record = document.recordByLine.get(line);
  if (!record) { return undefined; }
  if (record.kind === 'fileHeader') {
    const control = document.fileControls[0];
    return control ? sourceRange(control) : undefined;
  }
  if (record.kind === 'fileControl') {
    const header = document.fileHeaders[0];
    return header ? sourceRange(header) : undefined;
  }
  for (const batch of document.batches) {
    if (record.line === batch.header.line) {
      return batch.control ? sourceRange(batch.control) : undefined;
    }
    if (record.line === batch.control?.line) {
      return sourceRange(batch.header);
    }
    for (const entry of batch.entries) {
      if (record.line === entry.detail.line) {
        const addenda = entry.addenda[0];
        return addenda ? sourceRange(addenda) : undefined;
      }
      if (entry.addenda.some(addenda => addenda.line === record.line)) {
        return sourceRange(entry.detail);
      }
    }
  }
  return undefined;
}

function contains(character: number, start: number, end: number): boolean {
  return character >= start && character < end;
}

function addUnique(ranges: AchSourceRange[], candidate: AchSourceRange | undefined): void {
  if (!candidate) { return; }
  if (!ranges.some(range => range.line === candidate.line && range.start === candidate.start && range.end === candidate.end)) {
    ranges.push(candidate);
  }
}

export function findRelatedAchRanges(document: AchDocument, line: number, character: number): AchSourceRange[] {
  const record = document.recordByLine.get(line);
  if (!record) { return []; }
  const field = getAchFieldAtPosition(record, character);
  if (!field) { return []; }
  const ranges: AchSourceRange[] = [field.range];

  if (record.kind === 'fileControl') {
    const advFile = document.batches.some(batch => batch.secCode === 'ADV');
    const aggregateMappings: Array<[number, number, number, number]> = [
      [13, 21, 4, 10],
      [21, 31, 10, 20],
      advFile ? [31, 51, 20, 40] : [31, 43, 20, 32],
      advFile ? [51, 71, 40, 60] : [43, 55, 32, 44],
    ];
    for (const [fileStart, fileEnd, batchStart, batchEnd] of aggregateMappings) {
      if (contains(character, fileStart, fileEnd)) {
        for (const batch of document.batches) {
          if (batch.control) { addUnique(ranges, sourceRange(batch.control, batchStart, batchEnd)); }
        }
      }
    }
    if (contains(character, 1, 7)) {
      for (const batch of document.batches) { addUnique(ranges, sourceRange(batch.header, 0, 1)); }
    }
  }

  for (const batch of document.batches) {
    const inBatch = batch.records.some(candidate => candidate.line === line);
    if (!inBatch) { continue; }
    const pairs: Array<[number, number, number, number]> = [
      [1, 4, 1, 4],
      [79, 87, 79, 87],
      [87, 94, 87, 94],
    ];
    if (batch.secCode !== 'ADV') { pairs.push([40, 50, 44, 54]); }
    for (const [headerStart, headerEnd, controlStart, controlEnd] of pairs) {
      if (record.line === batch.header.line && contains(character, headerStart, headerEnd) && batch.control) {
        addUnique(ranges, sourceRange(batch.control, controlStart, controlEnd));
      }
      if (record.line === batch.control?.line && contains(character, controlStart, controlEnd)) {
        addUnique(ranges, sourceRange(batch.header, headerStart, headerEnd));
      }
    }

    if (record.line === batch.control?.line) {
      const fileMappings: Array<[number, number, number, number]> = [
        [4, 10, 13, 21],
        [10, 20, 21, 31],
        batch.secCode === 'ADV' ? [20, 40, 31, 51] : [20, 32, 31, 43],
        batch.secCode === 'ADV' ? [40, 60, 51, 71] : [32, 44, 43, 55],
      ];
      for (const [batchStart, batchEnd, fileStart, fileEnd] of fileMappings) {
        if (contains(character, batchStart, batchEnd)) {
          for (const control of document.fileControls) {
            addUnique(ranges, sourceRange(control, fileStart, fileEnd));
          }
        }
      }
    }

    for (const entry of batch.entries) {
      const entryLines = new Set(entry.records.map(candidate => candidate.line));
      if (!entryLines.has(line)) { continue; }
      const fullAddendaTrace = record.kind === 'addenda'
        && ['02', '98', '99'].includes(record.raw.substring(1, 3))
        && field.name === 'Trace Number';
      const standardAddendaTrace = record.kind === 'addenda'
        && !['02', '98', '99'].includes(record.raw.substring(1, 3))
        && character >= 87;
      if ((record.line === entry.detail.line && field.name === 'Trace Number') || fullAddendaTrace || standardAddendaTrace) {
        addUnique(ranges, sourceRange(entry.detail, 79, 94));
        for (const addenda of entry.addenda) {
          const fullTrace = ['02', '98', '99'].includes(addenda.raw.substring(1, 3));
          addUnique(ranges, sourceRange(addenda, fullTrace ? 79 : 87, 94));
        }
      }
      if (record.line === entry.detail.line && field.name === 'Addenda Record Indicator') {
        for (const addenda of entry.addenda) { addUnique(ranges, sourceRange(addenda, 0, 3)); }
      }
    }
  }
  return ranges;
}

export function toVscodeRanges(ranges: AchSourceRange[]): vscode.Range[] {
  return ranges.map(vscodeRange);
}
