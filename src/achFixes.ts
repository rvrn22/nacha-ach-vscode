import type { AchDocument, AchRecord } from './achDocument';
import type { AchDiagnostic } from './achTypes';

export type AchTextEdit = {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  newText: string;
  title: string;
  diagnosticCode?: string;
};

export type AchFixMode = 'all' | 'derived';

const directFixTitles: Record<string, string> = {
  'ACH-FIELD-PRIORITY-CODE': 'Set Priority Code to 01',
  'ACH-FIELD-RECORD-SIZE': 'Set Record Size to 094',
  'ACH-FIELD-BLOCKING-FACTOR': 'Set Blocking Factor to 10',
  'ACH-FIELD-FORMAT-CODE': 'Set Format Code to 1',
  'ACH-FIELD-ORIGINATOR-STATUS': 'Set Originator Status Code to 1',
  'ACH-FIELD-ROUTING-CHECK-DIGIT': 'Correct routing check digit',
  'ACH-REVERSAL-DESCRIPTION': 'Format Company Entry Description as REVERSAL',
  'ACH-MICRO-DESCRIPTION': 'Format Company Entry Description as ACCTVERIFY',
  'ACH-FIELD-BATCH-ENTRY-COUNT': 'Recalculate batch Entry/Addenda Count',
  'ACH-FIELD-BATCH-HASH': 'Recalculate batch Entry Hash',
  'ACH-FIELD-BATCH-DEBIT': 'Recalculate batch debit total',
  'ACH-FIELD-BATCH-CREDIT': 'Recalculate batch credit total',
  'ACH-FIELD-FILE-BATCH-COUNT': 'Recalculate file Batch Count',
  'ACH-FIELD-FILE-BLOCK-COUNT': 'Recalculate file Block Count',
  'ACH-FIELD-FILE-ENTRY-COUNT': 'Recalculate file Entry/Addenda Count',
  'ACH-FIELD-FILE-HASH': 'Recalculate file Entry Hash',
  'ACH-FIELD-FILE-DEBIT': 'Recalculate file debit total',
  'ACH-FIELD-FILE-CREDIT': 'Recalculate file credit total',
  'ACH-RELATION-SERVICE-CLASS': 'Synchronize Service Class Code',
  'ACH-RELATION-COMPANY-ID': 'Synchronize Company Identification',
  'ACH-RELATION-ODFI-ID': 'Synchronize Originating DFI Identification',
  'ACH-RELATION-BATCH-NUMBER': 'Synchronize Batch Number',
  'ACH-RELATION-BATCH-ENTRY-COUNT': 'Recalculate batch Entry/Addenda Count',
  'ACH-RELATION-BATCH-HASH': 'Recalculate batch Entry Hash',
  'ACH-RELATION-BATCH-DEBIT': 'Recalculate batch debit total',
  'ACH-RELATION-BATCH-CREDIT': 'Recalculate batch credit total',
  'ACH-RELATION-FILE-BATCH-COUNT': 'Recalculate file Batch Count',
  'ACH-RELATION-FILE-BLOCK-COUNT': 'Recalculate file Block Count',
  'ACH-RELATION-FILE-ENTRY-COUNT': 'Recalculate file Entry/Addenda Count',
  'ACH-RELATION-FILE-HASH': 'Recalculate file Entry Hash',
  'ACH-RELATION-FILE-DEBIT': 'Recalculate file debit total',
  'ACH-RELATION-FILE-CREDIT': 'Recalculate file credit total',
  'ACH-RELATION-ADDENDA-INDICATOR': 'Synchronize Addenda Record Indicator',
  'ACH-RELATION-ADDENDA-SEQUENCE': 'Correct Addenda Sequence Number',
  'ACH-RELATION-ADDENDA-ENTRY-SEQUENCE': 'Synchronize addenda Entry Detail Sequence Number',
  'ACH-RELATION-ADDENDA-TRACE': 'Synchronize Return/NOC Addenda Trace Number',
  'ACH-RELATION-TERMINAL-ADDENDA-TRACE': 'Synchronize terminal addenda Trace Number',
  'ACH-IAT-ADDENDA-COUNT': 'Recalculate IAT addenda count',
  'ACH-ATX-ADDENDA-COUNT': 'Recalculate ATX addenda count',
  'ACH-ENR-ADDENDA-COUNT': 'Recalculate ENR addenda count',
};

const derivedCodes = new Set([
  'ACH-FIELD-BATCH-ENTRY-COUNT',
  'ACH-FIELD-BATCH-HASH',
  'ACH-FIELD-BATCH-DEBIT',
  'ACH-FIELD-BATCH-CREDIT',
  'ACH-FIELD-FILE-BATCH-COUNT',
  'ACH-FIELD-FILE-BLOCK-COUNT',
  'ACH-FIELD-FILE-ENTRY-COUNT',
  'ACH-FIELD-FILE-HASH',
  'ACH-FIELD-FILE-DEBIT',
  'ACH-FIELD-FILE-CREDIT',
  'ACH-RELATION-SERVICE-CLASS',
  'ACH-RELATION-COMPANY-ID',
  'ACH-RELATION-ODFI-ID',
  'ACH-RELATION-BATCH-NUMBER',
  'ACH-RELATION-BATCH-ENTRY-COUNT',
  'ACH-RELATION-BATCH-HASH',
  'ACH-RELATION-BATCH-DEBIT',
  'ACH-RELATION-BATCH-CREDIT',
  'ACH-RELATION-FILE-BATCH-COUNT',
  'ACH-RELATION-FILE-BLOCK-COUNT',
  'ACH-RELATION-FILE-ENTRY-COUNT',
  'ACH-RELATION-FILE-HASH',
  'ACH-RELATION-FILE-DEBIT',
  'ACH-RELATION-FILE-CREDIT',
  'ACH-RELATION-ADDENDA-INDICATOR',
  'ACH-RELATION-ADDENDA-SEQUENCE',
  'ACH-RELATION-ADDENDA-ENTRY-SEQUENCE',
  'ACH-RELATION-ADDENDA-TRACE',
  'ACH-RELATION-TERMINAL-ADDENDA-TRACE',
  'ACH-IAT-ADDENDA-COUNT',
  'ACH-ATX-ADDENDA-COUNT',
  'ACH-ENR-ADDENDA-COUNT',
]);

function editKey(edit: AchTextEdit): string {
  return `${edit.startLine}:${edit.startCharacter}-${edit.endLine}:${edit.endCharacter}`;
}

function directDiagnosticEdit(document: AchDocument, diagnostic: AchDiagnostic): AchTextEdit | undefined {
  const title = directFixTitles[diagnostic.code];
  if (!title || diagnostic.expected === undefined) { return undefined; }
  const width = diagnostic.end - diagnostic.start;
  if (diagnostic.expected.length !== width) { return undefined; }
  const line = document.lines[diagnostic.line] ?? '';
  if (line.substring(diagnostic.start, diagnostic.end) === diagnostic.expected) { return undefined; }
  return {
    startLine: diagnostic.line,
    startCharacter: diagnostic.start,
    endLine: diagnostic.line,
    endCharacter: diagnostic.end,
    newText: diagnostic.expected,
    title,
    diagnosticCode: diagnostic.code,
  };
}

function unambiguousRecordPaddingEdit(document: AchDocument, diagnostic: AchDiagnostic): AchTextEdit | undefined {
  if (diagnostic.code !== 'ACH-PHYSICAL-RECORD-LENGTH') { return undefined; }
  const record = document.recordByLine.get(diagnostic.line);
  if (!record || record.raw.length >= 94) { return undefined; }
  const safeMinimum = record.kind === 'fileHeader'
    ? 86
    : record.kind === 'fileControl'
      ? document.batches.some(batch => batch.secCode === 'ADV') ? 71 : 55
      : undefined;
  if (safeMinimum === undefined || record.raw.length < safeMinimum) { return undefined; }
  return {
    startLine: record.line,
    startCharacter: record.raw.length,
    endLine: record.line,
    endCharacter: record.raw.length,
    newText: ' '.repeat(94 - record.raw.length),
    title: `Pad ${record.kind === 'fileHeader' ? 'File Header' : 'File Control'} to 94 characters`,
    diagnosticCode: diagnostic.code,
  };
}

export function buildPaddingEdit(document: AchDocument): AchTextEdit | undefined {
  if (document.fileControls.length !== 1) { return undefined; }
  const control = document.fileControls[0];
  const recordsAfterControl = document.records.filter(record => record.line > control.line);
  if (recordsAfterControl.some(record => record.kind !== 'padding')) { return undefined; }
  const nonPaddingCount = document.records.filter(record => record.kind !== 'padding').length;
  const desiredPadding = (10 - (nonPaddingCount % 10)) % 10;
  const trailingBlankLines = document.lines.slice(control.line + 1).filter(line => line.length === 0).length;
  if (document.paddingRecords.length === desiredPadding && trailingBlankLines <= 1) { return undefined; }

  const eol = document.text.includes('\r\n') ? '\r\n' : '\n';
  const keepFinalEol = /\r?\n$/.test(document.text);
  const padding = Array(desiredPadding).fill('9'.repeat(94)).join(eol);
  const replacement = desiredPadding > 0
    ? `${eol}${padding}${keepFinalEol ? eol : ''}`
    : keepFinalEol ? eol : '';
  const lastLine = document.lines.length - 1;
  return {
    startLine: control.line,
    startCharacter: control.raw.length,
    endLine: lastLine,
    endCharacter: document.lines[lastLine]?.length ?? 0,
    newText: replacement,
    title: `${document.paddingRecords.length > desiredPadding ? 'Remove' : 'Add'} ACH padding records`,
    diagnosticCode: 'ACH-PHYSICAL-PADDING-COUNT',
  };
}

export function buildNormalizedBlockCountEdit(document: AchDocument): AchTextEdit | undefined {
  const control = document.fileControls.length === 1 ? document.fileControls[0] : undefined;
  if (!control || control.raw.length < 13) { return undefined; }
  const nonPaddingCount = document.records.filter(record => record.kind !== 'padding').length;
  const expected = String(Math.ceil(nonPaddingCount / 10)).padStart(6, '0');
  if (control.raw.substring(7, 13) === expected) { return undefined; }
  return {
    startLine: control.line,
    startCharacter: 7,
    endLine: control.line,
    endCharacter: 13,
    newText: expected,
    title: 'Recalculate file Block Count after padding',
    diagnosticCode: 'ACH-RELATION-FILE-BLOCK-COUNT',
  };
}

export function fixForAchDiagnostic(document: AchDocument, diagnostic: AchDiagnostic): AchTextEdit | undefined {
  if (diagnostic.code === 'ACH-PHYSICAL-PADDING-COUNT') {
    return buildPaddingEdit(document);
  }
  return directDiagnosticEdit(document, diagnostic) ?? unambiguousRecordPaddingEdit(document, diagnostic);
}

export function collectAchFixEdits(
  document: AchDocument,
  diagnostics: AchDiagnostic[],
  mode: AchFixMode = 'all',
): AchTextEdit[] {
  const edits = new Map<string, AchTextEdit>();
  const paddingEdit = mode === 'all' && diagnostics.some(diagnostic => diagnostic.code === 'ACH-PHYSICAL-PADDING-COUNT')
    ? buildPaddingEdit(document)
    : undefined;
  for (const diagnostic of diagnostics) {
    if (mode === 'derived' && !derivedCodes.has(diagnostic.code)) { continue; }
    if (paddingEdit && ['ACH-RELATION-FILE-BLOCK-COUNT', 'ACH-FIELD-FILE-BLOCK-COUNT'].includes(diagnostic.code)) { continue; }
    const edit = fixForAchDiagnostic(document, diagnostic);
    if (edit) { edits.set(editKey(edit), edit); }
  }
  if (paddingEdit) {
    edits.set(editKey(paddingEdit), paddingEdit);
    const blockCountEdit = buildNormalizedBlockCountEdit(document);
    if (blockCountEdit) { edits.set(editKey(blockCountEdit), blockCountEdit); }
  }
  return [...edits.values()].sort((left, right) =>
    left.startLine - right.startLine || left.startCharacter - right.startCharacter,
  );
}

function addReplacement(
  edits: AchTextEdit[],
  record: AchRecord,
  start: number,
  end: number,
  expected: string,
  title: string,
): void {
  if (record.raw.length < end || record.raw.substring(start, end) === expected) { return; }
  edits.push({
    startLine: record.line,
    startCharacter: start,
    endLine: record.line,
    endCharacter: end,
    newText: expected,
    title,
  });
}

/**
 * Builds an explicit, preview-only renumbering operation. It is intentionally
 * excluded from "Apply all safe fixes" because trace values may be referenced
 * by systems outside the file even though their format is mechanically derived.
 */
export function buildSequenceRenumberEdits(document: AchDocument): AchTextEdit[] {
  const edits: AchTextEdit[] = [];
  let entrySequence = 1;
  for (let batchIndex = 0; batchIndex < document.batches.length; batchIndex++) {
    const batch = document.batches[batchIndex];
    const batchNumber = String(batchIndex + 1).padStart(7, '0');
    addReplacement(edits, batch.header, 87, 94, batchNumber, 'Renumber Batch Header');
    if (batch.control) { addReplacement(edits, batch.control, 87, 94, batchNumber, 'Renumber Batch Control'); }

    if (batch.secCode === 'ADV') {
      for (let entryIndex = 0; entryIndex < batch.entries.length; entryIndex++) {
        addReplacement(
          edits,
          batch.entries[entryIndex].detail,
          90,
          94,
          String(entryIndex + 1).padStart(4, '0'),
          'Renumber ADV Sequence Within Batch',
        );
      }
      continue;
    }

    const odfi = batch.header.raw.substring(79, 87);
    if (!/^\d{8}$/.test(odfi)) { continue; }
    for (const entry of batch.entries) {
      const sequence = String(entrySequence++).padStart(7, '0');
      addReplacement(edits, entry.detail, 79, 94, `${odfi}${sequence}`, 'Renumber Trace Number');
      for (let addendaIndex = 0; addendaIndex < entry.addenda.length; addendaIndex++) {
        const addenda = entry.addenda[addendaIndex];
        const addendaType = addenda.raw.substring(1, 3);
        if (['02', '98', '99'].includes(addendaType)) {
          addReplacement(
            edits,
            addenda,
            79,
            94,
            `${odfi}${sequence}`,
            addendaType === '02' ? 'Synchronize terminal addenda trace number' : 'Synchronize Return/NOC addenda trace number',
          );
        } else {
          addReplacement(edits, addenda, 87, 94, sequence, 'Synchronize addenda entry sequence');
        }
        if (addendaType === '05') {
          addReplacement(edits, addenda, 83, 87, String(addendaIndex + 1).padStart(4, '0'), 'Renumber Addenda Sequence');
        }
      }
    }
  }
  return edits;
}

function lineOffsets(text: string): number[] {
  const offsets = [0];
  const expression = /\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(text)) !== null) {
    offsets.push(match.index + match[0].length);
  }
  return offsets;
}

export function applyAchTextEdits(text: string, edits: AchTextEdit[]): string {
  const offsets = lineOffsets(text);
  const withOffsets = edits.map(edit => ({
    edit,
    start: (offsets[edit.startLine] ?? text.length) + edit.startCharacter,
    end: (offsets[edit.endLine] ?? text.length) + edit.endCharacter,
  })).sort((left, right) => right.start - left.start || right.end - left.end);

  let result = text;
  for (const { edit, start, end } of withOffsets) {
    result = result.substring(0, start) + edit.newText + result.substring(end);
  }
  return result;
}
