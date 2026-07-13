import * as assert from 'assert';
import { decodeAchField } from '../achDecode';
import { parseAchDocument } from '../achDocument';
import { applyAchTextEdits, collectAchFixEdits } from '../achFixes';
import { findRelatedAchRanges } from '../achNavigation';
import { parseAch } from '../nachaParser';

type FieldValue = [start: number, value: string];
type SpecialEntry = 'return' | 'noc' | 'none';

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

function buildSpecialFile(kind: SpecialEntry, amount = kind === 'noc' ? 0n : 1234n): string {
  const secCode = kind === 'noc' ? 'COR' : 'PPD';
  const transactionCode = kind === 'none' ? '21' : '21';
  const trace = '061000100000001';
  const hasAddenda = kind !== 'none';
  const entryCount = hasAddenda ? 2 : 1;
  const credit = amount;
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, '200'], [4, 'COMPANY'], [40, '1234567890'], [50, secCode],
      [53, kind === 'noc' ? 'CORRECTION' : 'RETURN'], [69, '260713'],
      [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', [
      [1, transactionCode], [3, '06100010'], [11, '4'], [12, '123456789'],
      [29, number(amount, 10)], [39, 'ORIGINAL-ENTRY'], [54, 'RECEIVER'],
      [78, hasAddenda ? '1' : '0'], [79, trace],
    ]),
  ];

  if (kind === 'return') {
    records.push(makeRecord('7', [
      [1, '99'], [3, 'R01'], [6, '031300010000123'], [27, '03130001'],
      [35, 'INSUFFICIENT FUNDS'], [79, trace],
    ]));
  } else if (kind === 'noc') {
    records.push(makeRecord('7', [
      [1, '98'], [3, 'C01'], [6, '031300010000123'], [27, '03130001'],
      [35, 'CORRECT-ACCOUNT-01'], [79, trace],
    ]));
  }

  records.push(
    makeRecord('8', [
      [1, '200'], [4, number(entryCount, 6)], [10, '0006100010'],
      [20, '000000000000'], [32, number(credit, 12)], [44, '1234567890'],
      [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, number(entryCount, 8)],
      [21, '0006100010'], [31, '000000000000'], [43, number(credit, 12)],
    ]),
  );
  const padding = (10 - (records.length % 10)) % 10;
  return [...records, ...Array(padding).fill('9'.repeat(94))].join('\n');
}

function buildIatNocFile(): string {
  const trace = '061000100000001';
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, '200'], [4, 'IATCOR'], [20, 'FF'], [22, '3'], [38, 'US'],
      [40, '1234567890'], [50, 'IAT'], [53, 'CORRECTION'], [63, 'USD'],
      [66, 'USD'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', [
      [1, '21'], [3, '06100010'], [11, '4'], [12, '0001'], [29, '0000000000'],
      [39, 'FOREIGN-ACCOUNT'], [78, '1'], [79, trace],
    ]),
    makeRecord('7', [
      [1, '98'], [3, 'C01'], [6, '031300010000123'], [27, '03130001'],
      [35, 'CORRECTED-IAT-ACCOUNT-DATA'], [79, trace],
    ]),
    makeRecord('8', [
      [1, '200'], [4, '000002'], [10, '0006100010'], [20, '000000000000'],
      [32, '000000000000'], [44, '1234567890'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, '00000002'], [21, '0006100010'],
      [31, '000000000000'], [43, '000000000000'],
    ]),
  ];
  return [...records, ...Array(4).fill('9'.repeat(94))].join('\n');
}

suite('ACH Return and Notification of Change Test Suite', () => {
  test('Accepts valid domestic Return and NOC files', () => {
    assert.deepStrictEqual(parseAch(buildSpecialFile('return')), []);
    assert.deepStrictEqual(parseAch(buildSpecialFile('noc')), []);
    assert.deepStrictEqual(parseAch(buildIatNocFile()), []);
  });

  test('Parses Return and NOC addenda with their distinct field layouts', () => {
    const returnAddenda = parseAchDocument(buildSpecialFile('return')).batches[0].entries[0].addenda[0];
    const nocDocument = parseAchDocument(buildSpecialFile('noc'));
    const nocAddenda = nocDocument.batches[0].entries[0].addenda[0];
    const secField = nocDocument.batches[0].header.fields.find(field => field.name === 'Standard Entry Class');

    assert.deepStrictEqual(returnAddenda.fields.map(field => field.name), [
      'Record Type Code', 'Addenda Type Code', 'Return Reason Code', 'Original Entry Trace Number',
      'Date of Death', 'Original Receiving DFI Identification', 'Addenda Information', 'Trace Number',
    ]);
    assert.strictEqual(nocAddenda.fields.find(field => field.name === 'Corrected Data')?.range.start, 35);
    assert.strictEqual(nocAddenda.fields.find(field => field.name === 'Corrected Data')?.range.end, 64);
    assert.ok(secField);
    assert.strictEqual(decodeAchField(nocDocument.batches[0].header, secField).display, 'COR — Notification of Change');
  });

  test('Validates Return-specific codes, original fields, date, and trace linkage', () => {
    const lines = buildSpecialFile('return').split('\n');
    lines[3] = replaceField(lines[3], 3, 'X01');
    lines[3] = replaceField(lines[3], 6, 'X31300010000123');
    lines[3] = replaceField(lines[3], 21, '260713');
    lines[3] = replaceField(lines[3], 27, 'X3130001');
    lines[3] = replaceField(lines[3], 79, '061000100000002');
    const codes = new Set(parseAch(lines.join('\n')).map(diagnostic => diagnostic.code));

    assert.ok(codes.has('ACH-RETURN-REASON-CODE'));
    assert.ok(codes.has('ACH-RETURN-NOC-ORIGINAL-TRACE'));
    assert.ok(codes.has('ACH-RETURN-DATE-OF-DEATH'));
    assert.ok(codes.has('ACH-RETURN-NOC-ORIGINAL-RDFI'));
    assert.ok(codes.has('ACH-RELATION-ADDENDA-TRACE'));

    const deathLines = buildSpecialFile('return').split('\n');
    deathLines[3] = replaceField(deathLines[3], 3, 'R14');
    assert.ok(parseAch(deathLines.join('\n')).some(diagnostic => diagnostic.code === 'ACH-RETURN-DATE-OF-DEATH'));
  });

  test('Validates NOC corrected data, reserved fields, amount, and required special addenda', () => {
    const lines = buildSpecialFile('noc', 1n).split('\n');
    lines[3] = replaceField(lines[3], 3, 'R01');
    lines[3] = replaceField(lines[3], 21, 'NOTBLK');
    lines[3] = replaceField(lines[3], 35, ' '.repeat(29));
    const codes = new Set(parseAch(lines.join('\n')).map(diagnostic => diagnostic.code));

    assert.ok(codes.has('ACH-NOC-CHANGE-CODE'));
    assert.ok(codes.has('ACH-NOC-RESERVED'));
    assert.ok(codes.has('ACH-NOC-CORRECTED-DATA-REQUIRED'));
    assert.ok(codes.has('ACH-NOC-AMOUNT-ZERO'));
    assert.ok(parseAch(buildSpecialFile('none')).some(diagnostic => diagnostic.code === 'ACH-RETURN-ADDENDA-REQUIRED'));
  });

  test('Fixes and highlights the complete 15-digit Return/NOC addenda trace', () => {
    const lines = buildSpecialFile('return').split('\n');
    lines[3] = replaceField(lines[3], 79, '999999990000002');
    const text = lines.join('\n');
    const document = parseAchDocument(text);
    const diagnostics = parseAch(document);
    const fixed = applyAchTextEdits(text, collectAchFixEdits(document, diagnostics, 'derived'));
    const related = findRelatedAchRanges(document, 3, 80);

    assert.strictEqual(fixed.split('\n')[3].substring(79, 94), '061000100000001');
    assert.ok(related.some(range => range.line === 2 && range.start === 79 && range.end === 94));
    assert.ok(related.some(range => range.line === 3 && range.start === 79 && range.end === 94));
  });

  test('Uses the IAT-specific Return amount and NOC corrected-data widths', () => {
    const batch = makeRecord('5', [[4, 'IAT             '], [50, 'IAT']]);
    const entry = makeRecord('6');
    const iatReturn = makeRecord('7', [[1, '99']]);
    const iatNoc = makeRecord('7', [[1, '98']]);
    const document = parseAchDocument([batch, entry, iatReturn, iatNoc].join('\n'));
    const returnFields = document.batches[0].entries[0].addenda[0].fields;
    const nocFields = document.batches[0].entries[0].addenda[1].fields;

    assert.deepStrictEqual(
      returnFields.find(field => field.name === 'Original Forward Entry Payment Amount')?.range,
      { line: 2, start: 35, end: 45 },
    );
    assert.strictEqual(nocFields.find(field => field.name === 'Corrected Data')?.range.end, 70);
  });
});
