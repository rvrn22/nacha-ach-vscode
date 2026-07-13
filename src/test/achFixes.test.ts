import * as assert from 'assert';
import { parseAchDocument } from '../achDocument';
import {
  applyAchTextEdits,
  buildSequenceRenumberEdits,
  collectAchFixEdits,
  fixForAchDiagnostic,
} from '../achFixes';
import { parseAch } from '../nachaParser';

type FieldValue = [start: number, value: string];

function makeRecord(type: string, fields: FieldValue[] = []): string {
  const characters = Array(94).fill(' ');
  characters[0] = type;
  for (const [start, value] of fields) {
    for (let offset = 0; offset < value.length; offset++) {
      characters[start + offset] = value[offset];
    }
  }
  return characters.join('');
}

function number(value: bigint | number, width: number): string {
  return value.toString().padStart(width, '0');
}

function replaceField(record: string, start: number, value: string): string {
  return record.substring(0, start) + value + record.substring(start + value.length);
}

function header(): string {
  return makeRecord('1', [
    [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260713'],
    [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
  ]);
}

function withPadding(records: string[], paddingOverride?: number, eol = '\n'): string {
  const padding = paddingOverride ?? (10 - (records.length % 10)) % 10;
  return [...records, ...Array(padding).fill('9'.repeat(94))].join(eol);
}

function standardFile(options: {
  addenda?: boolean;
  checkDigit?: string;
  padding?: number;
  batchNumber?: string;
  traceSequence?: string;
  indicator?: string;
  addendaSequence?: string;
  addendaEntrySequence?: string;
} = {}): string {
  const hasAddenda = options.addenda ?? false;
  const batchNumber = options.batchNumber ?? '0000001';
  const traceSequence = options.traceSequence ?? '0000001';
  const indicator = options.indicator ?? (hasAddenda ? '1' : '0');
  const entryCount = hasAddenda ? 2 : 1;
  const batchHeader = makeRecord('5', [
    [1, '200'], [4, 'COMPANY'], [40, '1234567890'], [50, 'PPD'], [53, 'PAYMENT'],
    [69, '260713'], [78, '1'], [79, '06100010'], [87, batchNumber],
  ]);
  const entry = makeRecord('6', [
    [1, '22'], [3, '06100010'], [11, options.checkDigit ?? '4'], [12, '123456789'],
    [29, '0000001234'], [54, 'RECEIVER'], [78, indicator], [79, `06100010${traceSequence}`],
  ]);
  const addenda = makeRecord('7', [
    [1, '05'], [3, 'PAYMENT INFORMATION'], [83, options.addendaSequence ?? '0001'],
    [87, options.addendaEntrySequence ?? traceSequence],
  ]);
  const batchControl = makeRecord('8', [
    [1, '200'], [4, number(entryCount, 6)], [10, '0006100010'], [20, '000000000000'],
    [32, '000000001234'], [44, '1234567890'], [79, '06100010'], [87, batchNumber],
  ]);
  const nonPaddingCount = 5 + (hasAddenda ? 1 : 0);
  const fileControl = makeRecord('9', [
    [1, '000001'], [7, number(Math.ceil(nonPaddingCount / 10), 6)],
    [13, number(entryCount, 8)], [21, '0006100010'], [31, '000000000000'],
    [43, '000000001234'],
  ]);
  return withPadding(
    [header(), batchHeader, entry, ...(hasAddenda ? [addenda] : []), batchControl, fileControl],
    options.padding,
  );
}

function iatFileWithWrongDeclaredCount(): string {
  const trace = '061000100000001';
  const batchHeader = makeRecord('5', [
    [1, '200'], [4, 'IAT             '], [40, '1234567890'], [50, 'IAT'], [69, '260713'],
    [78, '1'], [79, '06100010'], [87, '0000001'],
  ]);
  const entry = makeRecord('6', [
    [1, '22'], [3, '06100010'], [11, '4'], [12, '0006'], [29, '0000001234'],
    [39, 'FOREIGN-ACCOUNT'], [78, '1'], [79, trace],
  ]);
  const fieldsByType: Record<string, FieldValue[]> = {
    '10': [[1, '10'], [3, 'BUS'], [6, '000000000000001234'], [46, 'FOREIGN RECEIVER'], [87, '0000001']],
    '11': [[1, '11'], [3, 'ORIGINATOR NAME'], [38, '123 MAIN STREET'], [87, '0000001']],
    '12': [[1, '12'], [3, 'ATLANTA*GA\\'], [38, 'US*30303\\'], [87, '0000001']],
    '13': [[1, '13'], [3, 'ORIGINATING BANK'], [38, '01'], [40, '061000104'], [74, 'US '], [87, '0000001']],
    '14': [[1, '14'], [3, 'RECEIVING BANK'], [38, '01'], [40, '061000104'], [74, 'US '], [87, '0000001']],
    '15': [[1, '15'], [3, 'RECEIVER-ID'], [18, '456 OAK AVENUE'], [87, '0000001']],
    '16': [[1, '16'], [3, 'MEXICO CITY*CMX\\'], [38, 'MX*01000\\'], [87, '0000001']],
  };
  const addenda = ['10', '11', '12', '13', '14', '15', '16'].map(type => makeRecord('7', fieldsByType[type]));
  const batchControl = makeRecord('8', [
    [1, '200'], [4, '000008'], [10, '0006100010'], [20, '000000000000'],
    [32, '000000001234'], [44, '1234567890'], [79, '06100010'], [87, '0000001'],
  ]);
  const fileControl = makeRecord('9', [
    [1, '000001'], [7, '000002'], [13, '00000008'], [21, '0006100010'],
    [31, '000000000000'], [43, '000000001234'],
  ]);
  return withPadding([header(), batchHeader, entry, ...addenda, batchControl, fileControl]);
}

function fixed(text: string, mode: 'all' | 'derived' = 'all'): string {
  const document = parseAchDocument(text);
  return applyAchTextEdits(text, collectAchFixEdits(document, parseAch(document), mode));
}

suite('ACH Safe Fixes Test Suite', () => {
  test('Corrects only the routing check digit, not the routing number', () => {
    const text = standardFile({ checkDigit: '5' });
    const result = fixed(text);

    assert.strictEqual(result.split('\n')[2].substring(3, 11), '06100010');
    assert.strictEqual(result.split('\n')[2].substring(11, 12), '4');
    assert.strictEqual(parseAch(result).some(diagnostic => diagnostic.code === 'ACH-FIELD-ROUTING-CHECK-DIGIT'), false);
  });

  test('Recalculates and synchronizes batch and file controls', () => {
    const lines = standardFile().split('\n');
    lines[3] = replaceField(lines[3], 1, '225');
    lines[3] = replaceField(lines[3], 4, 'ABCDEF');
    lines[3] = replaceField(lines[3], 10, '9999999999');
    lines[3] = replaceField(lines[3], 32, '000000009999');
    lines[3] = replaceField(lines[3], 44, '9999999999');
    lines[4] = replaceField(lines[4], 1, '000009');
    lines[4] = replaceField(lines[4], 13, 'ABCDEFGH');
    lines[4] = replaceField(lines[4], 21, '9999999999');
    lines[4] = replaceField(lines[4], 43, '000000009999');
    const result = fixed(lines.join('\n'), 'derived');

    const remaining = parseAch(result);
    assert.deepStrictEqual(remaining.filter(diagnostic => diagnostic.category === 'relational'), []);
    assert.strictEqual(remaining.some(diagnostic => ['ACH-FIELD-BATCH-ENTRY-COUNT', 'ACH-FIELD-FILE-ENTRY-COUNT'].includes(diagnostic.code)), false);
  });

  test('Synchronizes addenda indicators, counts, and sequences', () => {
    const text = standardFile({
      addenda: true,
      indicator: '0',
      addendaSequence: '0009',
      addendaEntrySequence: '0000009',
    });
    const result = fixed(text, 'derived');
    const codes = new Set(parseAch(result).map(diagnostic => diagnostic.code));

    assert.strictEqual(codes.has('ACH-RELATION-ADDENDA-INDICATOR'), false);
    assert.strictEqual(codes.has('ACH-RELATION-ADDENDA-SEQUENCE'), false);
    assert.strictEqual(codes.has('ACH-RELATION-ADDENDA-ENTRY-SEQUENCE'), false);

    const iat = fixed(iatFileWithWrongDeclaredCount(), 'derived');
    assert.strictEqual(iat.split('\n')[2].substring(12, 16), '0007');
  });

  test('Normalizes padding without leaving a stale File Block Count', () => {
    const missingPadding = standardFile({ padding: 0 });
    const fixedMissing = fixed(missingPadding);
    assert.strictEqual(fixedMissing.split('\n').filter(line => /^9{94}$/.test(line)).length, 5);
    assert.strictEqual(parseAch(fixedMissing).some(diagnostic => diagnostic.category === 'physical'), false);

    const extraPadding = standardFile({ padding: 15 });
    const fixedExtra = fixed(extraPadding);
    assert.strictEqual(fixedExtra.split('\n').filter(line => /^9{94}$/.test(line)).length, 5);
    assert.strictEqual(fixedExtra.split('\n')[4].substring(7, 13), '000001');
    assert.strictEqual(parseAch(fixedExtra).some(diagnostic => diagnostic.code === 'ACH-RELATION-FILE-BLOCK-COUNT'), false);
  });

  test('Pads only unambiguous optional trailing fields', () => {
    const shortHeader = header().substring(0, 90);
    const headerDocument = parseAchDocument(shortHeader);
    const headerDiagnostic = parseAch(headerDocument).find(diagnostic => diagnostic.code === 'ACH-PHYSICAL-RECORD-LENGTH')!;
    const headerEdit = fixForAchDiagnostic(headerDocument, headerDiagnostic);
    assert.ok(headerEdit);
    assert.strictEqual(applyAchTextEdits(shortHeader, [headerEdit]).length, 94);

    const shortEntry = makeRecord('6').substring(0, 90);
    const entryDocument = parseAchDocument(shortEntry);
    const entryDiagnostic = parseAch(entryDocument).find(diagnostic => diagnostic.code === 'ACH-PHYSICAL-RECORD-LENGTH')!;
    assert.strictEqual(fixForAchDiagnostic(entryDocument, entryDiagnostic), undefined);
  });

  test('Never guesses invalid dates, routing numbers, transaction codes, or SEC codes', () => {
    const lines = standardFile().split('\n');
    lines[0] = replaceField(lines[0], 23, '261332');
    lines[1] = replaceField(lines[1], 50, 'ZZZ');
    lines[2] = replaceField(lines[2], 1, '20');
    lines[2] = replaceField(lines[2], 3, 'X6100010');
    const text = lines.join('\n');
    const document = parseAchDocument(text);
    const diagnostics = parseAch(document);
    const edits = collectAchFixEdits(document, diagnostics);
    const unfixableCodes = ['ACH-FIELD-FILE-CREATION-DATE', 'ACH-SEC-UNKNOWN-CODE', 'ACH-FIELD-TRANSACTION-CODE', 'ACH-FIELD-RDFI-ID'];

    for (const code of unfixableCodes) {
      const diagnostic = diagnostics.find(candidate => candidate.code === code);
      assert.ok(diagnostic, `Expected ${code}`);
      assert.strictEqual(fixForAchDiagnostic(document, diagnostic), undefined);
    }
    assert.strictEqual(edits.some(edit => edit.startLine === 0 && edit.startCharacter === 23), false);
    assert.strictEqual(edits.some(edit => edit.startLine === 1 && edit.startCharacter === 50), false);
    assert.strictEqual(edits.some(edit => edit.startLine === 2 && [1, 3].includes(edit.startCharacter)), false);
  });

  test('Renumbers batches, traces, and addenda only through the explicit operation', () => {
    const text = standardFile({
      addenda: true,
      batchNumber: '0000009',
      traceSequence: '0000042',
      addendaSequence: '0009',
      addendaEntrySequence: '0000042',
    });
    const document = parseAchDocument(text);
    assert.strictEqual(collectAchFixEdits(document, parseAch(document)).some(edit => edit.title === 'Renumber Trace Number'), false);

    const result = applyAchTextEdits(text, buildSequenceRenumberEdits(document));
    const lines = result.split('\n');
    assert.strictEqual(lines[1].substring(87, 94), '0000001');
    assert.strictEqual(lines[2].substring(79, 94), '061000100000001');
    assert.strictEqual(lines[3].substring(83, 87), '0001');
    assert.strictEqual(lines[3].substring(87, 94), '0000001');
    assert.strictEqual(lines[4].substring(87, 94), '0000001');
  });
});
