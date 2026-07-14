import * as assert from 'assert';
import { transactionCodes } from '../achRules';
import {
  formatAchCents,
  parseAch,
  parseAchSummary,
  unblockedValidationProfile,
} from '../nachaParser';

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

function padNumber(value: bigint | number, width: number): string {
  return value.toString().padStart(width, '0');
}

function withPadding(records: string[]): string {
  const paddingCount = (10 - (records.length % 10)) % 10;
  return [...records, ...Array(paddingCount).fill('9'.repeat(94))].join('\n');
}

function fileHeader(): string {
  return makeRecord('1', [
    [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
    [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
  ]);
}

function buildStandardFile(options: {
  secCode?: string;
  transactionCode?: string;
  amount?: bigint;
  addenda?: boolean;
  indicator?: string;
  addendaSequence?: string;
  entrySequence?: string;
  addendaType?: string;
} = {}): string {
  const secCode = options.secCode ?? 'PPD';
  const transactionCode = options.transactionCode ?? '22';
  const amount = options.amount ?? 1234n;
  const hasAddenda = options.addenda ?? false;
  const trace = '061000100000001';
  const transactionRule = transactionCodes.get(transactionCode);
  const debit = transactionRule?.direction === 'debit' ? amount : 0n;
  const credit = transactionRule?.direction === 'credit' ? amount : 0n;
  const entryCount = hasAddenda ? 2 : 1;

  const batchHeader = makeRecord('5', [
    [1, '200'], [4, 'COMPANY'], [40, '1234567890'], [50, secCode],
    [53, 'PAYMENT'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
  ]);
  const entry = makeRecord('6', [
    [1, transactionCode], [3, '06100010'], [11, '4'], [12, '123456789'],
    [29, padNumber(amount, 10)], [39, 'IDENTIFIER'], [54, 'RECEIVER'],
    [78, options.indicator ?? (hasAddenda ? '1' : '0')], [79, trace],
  ]);
  const addenda = makeRecord('7', [
    [1, options.addendaType ?? '05'], [3, 'PAYMENT INFORMATION'],
    [83, options.addendaSequence ?? '0001'],
    [87, options.entrySequence ?? trace.substring(8)],
  ]);
  const batchControl = makeRecord('8', [
    [1, '200'], [4, padNumber(entryCount, 6)], [10, '0006100010'],
    [20, padNumber(debit, 12)], [32, padNumber(credit, 12)],
    [44, '1234567890'], [79, '06100010'], [87, '0000001'],
  ]);

  const nonPaddingCount = 5 + (hasAddenda ? 1 : 0);
  const fileControl = makeRecord('9', [
    [1, '000001'], [7, padNumber(Math.ceil(nonPaddingCount / 10), 6)],
    [13, padNumber(entryCount, 8)], [21, '0006100010'],
    [31, padNumber(debit, 12)], [43, padNumber(credit, 12)],
  ]);
  return withPadding([
    fileHeader(), batchHeader, entry, ...(hasAddenda ? [addenda] : []), batchControl, fileControl,
  ]);
}

function buildIatFile(addendaTypes: string[] = ['10', '11', '12', '13', '14', '15', '16'], declaredCount = addendaTypes.length): string {
  const trace = '061000100000001';
  const batchHeader = makeRecord('5', [
    [1, '200'], [20, 'FF'], [22, '3'], [38, 'US'], [40, '1234567890'], [50, 'IAT'],
    [53, 'PAYMENT'], [63, 'USD'], [66, 'USD'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
  ]);
  const entry = makeRecord('6', [
    [1, '22'], [3, '06100010'], [11, '4'], [12, padNumber(declaredCount, 4)],
    [29, '0000005000'], [39, 'FOREIGN-ACCOUNT'], [78, '1'], [79, trace],
  ]);
  const fieldsByType: Record<string, FieldValue[]> = {
    '10': [[1, '10'], [3, 'BUS'], [6, '000000000000005000'], [46, 'FOREIGN RECEIVER'], [87, trace.substring(8)]],
    '11': [[1, '11'], [3, 'ORIGINATOR NAME'], [38, '123 MAIN STREET'], [87, trace.substring(8)]],
    '12': [[1, '12'], [3, 'ATLANTA*GA\\'], [38, 'US*30303\\'], [87, trace.substring(8)]],
    '13': [[1, '13'], [3, 'ORIGINATING BANK'], [38, '01'], [40, '061000104'], [74, 'US '], [87, trace.substring(8)]],
    '14': [[1, '14'], [3, 'RECEIVING BANK'], [38, '01'], [40, '061000104'], [74, 'US '], [87, trace.substring(8)]],
    '15': [[1, '15'], [3, 'RECEIVER-ID'], [18, '456 OAK AVENUE'], [87, trace.substring(8)]],
    '16': [[1, '16'], [3, 'MEXICO CITY*CMX\\'], [38, 'MX*01000\\'], [87, trace.substring(8)]],
  };
  const addenda = addendaTypes.map(type => makeRecord('7', fieldsByType[type] ?? [[1, type], [87, trace.substring(8)]]));
  const count = 1 + addenda.length;
  const batchControl = makeRecord('8', [
    [1, '200'], [4, padNumber(count, 6)], [10, '0006100010'],
    [20, '000000000000'], [32, '000000005000'], [44, '1234567890'],
    [79, '06100010'], [87, '0000001'],
  ]);
  const nonPaddingCount = 5 + addenda.length;
  const fileControl = makeRecord('9', [
    [1, '000001'], [7, padNumber(Math.ceil(nonPaddingCount / 10), 6)],
    [13, padNumber(count, 8)], [21, '0006100010'], [31, '000000000000'],
    [43, '000000005000'],
  ]);
  return withPadding([fileHeader(), batchHeader, entry, ...addenda, batchControl, fileControl]);
}

function replaceField(record: string, start: number, value: string): string {
  return record.substring(0, start) + value + record.substring(start + value.length);
}

suite('ACH Validation Rule Engine Test Suite', () => {
  test('Accepts a fully blocked valid file', () => {
    assert.deepStrictEqual(parseAch(buildStandardFile()), []);
    assert.deepStrictEqual(parseAch(buildIatFile()), []);
  });

  test('Provides stable metadata and suppresses field cascades for short records', () => {
    const diagnostics = parseAch('101 short');
    const length = diagnostics.find(diagnostic => diagnostic.code === 'ACH-PHYSICAL-RECORD-LENGTH');

    assert.ok(length);
    assert.strictEqual(length.category, 'physical');
    assert.strictEqual(length.profile, 'nacha-default');
    assert.strictEqual(length.expected, '94');
    assert.strictEqual(diagnostics.some(diagnostic => diagnostic.category === 'field'), false);
  });

  test('Validates real dates and 24-hour times', () => {
    const lines = buildStandardFile().split('\n');
    lines[0] = replaceField(lines[0], 23, '261332');
    lines[0] = replaceField(lines[0], 29, '2460');
    lines[1] = replaceField(lines[1], 69, '260230');
    const codes = new Set(parseAch(lines.join('\n')).map(diagnostic => diagnostic.code));

    assert.ok(codes.has('ACH-FIELD-FILE-CREATION-DATE'));
    assert.ok(codes.has('ACH-FIELD-FILE-CREATION-TIME'));
    assert.ok(codes.has('ACH-FIELD-EFFECTIVE-DATE'));
  });

  test('Uses explicit transaction codes and SEC compatibility rules', () => {
    const incompatible = parseAch(buildStandardFile({ transactionCode: '42', secCode: 'PPD' }));
    const unknown = parseAch(buildStandardFile({ transactionCode: '20' }));

    assert.ok(incompatible.some(diagnostic => diagnostic.code === 'ACH-SEC-TRANSACTION-CODE'));
    assert.ok(unknown.some(diagnostic => diagnostic.code === 'ACH-FIELD-TRANSACTION-CODE'));
  });

  test('Detects a missing File Control even when padding records are present', () => {
    const lines = buildStandardFile().split('\n');
    lines.splice(4, 1);
    const diagnostics = parseAch(lines.join('\n'));

    assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'ACH-STRUCTURE-MISSING-FILE-CONTROL'));
    assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'ACH-STRUCTURE-PADDING-PLACEMENT'));
  });

  test('Validates addenda indicator, sequence, and entry linkage', () => {
    const diagnostics = parseAch(buildStandardFile({
      addenda: true,
      indicator: '0',
      addendaSequence: '0002',
      entrySequence: '0000002',
    }));
    const codes = new Set(diagnostics.map(diagnostic => diagnostic.code));
    const invalidType = parseAch(buildStandardFile({ addenda: true, addendaType: '07' }));

    assert.ok(codes.has('ACH-RELATION-ADDENDA-INDICATOR'));
    assert.ok(codes.has('ACH-RELATION-ADDENDA-SEQUENCE'));
    assert.ok(codes.has('ACH-RELATION-ADDENDA-ENTRY-SEQUENCE'));
    assert.ok(invalidType.some(diagnostic => diagnostic.code === 'ACH-SEC-ADDENDA-TYPE'));
  });

  test('Validates actual IAT addenda count, range, presence, and order', () => {
    const diagnostics = parseAch(buildIatFile(['10', '11', '12', '14', '15', '16'], 7));
    const codes = new Set(diagnostics.map(diagnostic => diagnostic.code));

    assert.ok(codes.has('ACH-IAT-ADDENDA-COUNT'));
    assert.ok(codes.has('ACH-IAT-ADDENDA-RANGE'));
    assert.ok(codes.has('ACH-IAT-MANDATORY-ADDENDA'));
  });

  test('Includes related header locations for control mismatches', () => {
    const lines = buildStandardFile().split('\n');
    lines[3] = replaceField(lines[3], 44, '9999999999');
    const diagnostic = parseAch(lines.join('\n')).find(item => item.code === 'ACH-RELATION-COMPANY-ID');

    assert.ok(diagnostic);
    assert.strictEqual(diagnostic.expected, '1234567890');
    assert.strictEqual(diagnostic.actual, '9999999999');
    assert.strictEqual(diagnostic.related?.[0].line, 1);
  });

  test('Supports an institution profile that accepts unblocked files', () => {
    const unblocked = buildStandardFile().split('\n').slice(0, 5).join('\n');
    const diagnostics = parseAch(unblocked, unblockedValidationProfile);

    assert.strictEqual(diagnostics.some(diagnostic => diagnostic.code === 'ACH-PHYSICAL-BLOCK-MULTIPLE'), false);
    assert.strictEqual(diagnostics.some(diagnostic => diagnostic.code === 'ACH-PHYSICAL-PADDING-COUNT'), false);
  });

  test('Keeps summaries and currency formatting in exact bigint cents', () => {
    const summary = parseAchSummary(buildStandardFile({ amount: 9999999999n }));

    assert.strictEqual(typeof summary.totalCreditCents, 'bigint');
    assert.strictEqual(summary.totalCreditCents, 9999999999n);
    assert.strictEqual(summary.totalDebitCents, 0n);
    assert.strictEqual(formatAchCents(summary.totalCreditCents), '99999999.99');
    assert.strictEqual(formatAchCents(-123n), '-1.23');
  });
});
