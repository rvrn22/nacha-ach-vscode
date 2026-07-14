import * as assert from 'assert';
import { decodeAchField } from '../achDecode';
import { parseAchDocument } from '../achDocument';
import { applyAchTextEdits, buildSequenceRenumberEdits, collectAchFixEdits } from '../achFixes';
import { nachaValidationProfile, parseAch, parseAchSummary } from '../nachaParser';

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

const credit = 123456789012n;
const debit = 100000000001n;
const hash = 12200020n;

function advEntry(transactionCode: string, amount: bigint, sequence: number): string {
  return makeRecord('6', [
    [1, transactionCode], [3, '06100010'], [11, '4'], [12, 'ADV-ACCOUNT'],
    [27, number(amount, 12)], [39, '061000104'], [48, '2607A'], [53, 'A'],
    [54, `ADVICE RECEIVER ${sequence}`], [76, 'OP'], [78, '0'], [79, '06100010'],
    [87, '195'], [90, number(sequence, 4)],
  ]);
}

function advFile(): string {
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, '280'], [4, 'ACH OPERATOR'], [40, '1234567890'], [50, 'ADV'],
      [53, 'ACCOUNTING'], [69, '260713'], [78, '0'], [79, '06100010'], [87, '0000001'],
    ]),
    advEntry('81', credit, 1),
    advEntry('82', debit, 2),
    makeRecord('8', [
      [1, '280'], [4, '000002'], [10, number(hash, 10)],
      [20, number(debit, 20)], [40, number(credit, 20)], [60, 'OPERATOR CONTROL'],
      [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, '00000002'], [21, number(hash, 10)],
      [31, number(debit, 20)], [51, number(credit, 20)],
    ]),
  ];
  return [...records, ...Array(4).fill('9'.repeat(94))].join('\n');
}

suite('ACH Automated Accounting Advice Test Suite', () => {
  test('Parses and accepts the distinct ADV entry and control layouts', () => {
    const document = parseAchDocument(advFile());
    const summary = parseAchSummary(document);
    const entry = document.batches[0].entries[0].detail;
    const batchControl = document.batches[0].control!;
    const fileControl = document.fileControls[0];

    assert.deepStrictEqual(parseAch(document), []);
    assert.strictEqual(entry.fields.find(field => field.name === 'Amount')?.range.start, 27);
    assert.strictEqual(entry.fields.find(field => field.name === 'Sequence Number Within Batch')?.range.start, 90);
    assert.strictEqual(batchControl.fields.find(field => field.name === 'Total Debit Entry Dollar Amount')?.range.end, 40);
    assert.strictEqual(fileControl.fields.find(field => field.name === 'Total Credit Entry Dollar Amount')?.range.start, 51);
    assert.strictEqual(summary.totalCreditCents, credit);
    assert.strictEqual(summary.totalDebitCents, debit);
  });

  test('Decodes ADV service, SEC, transaction, amount, and advice routing values', () => {
    const document = parseAchDocument(advFile());
    const header = document.batches[0].header;
    const entry = document.batches[0].entries[0].detail;

    assert.strictEqual(
      decodeAchField(header, header.fields.find(field => field.name === 'Service Class Code')!).display,
      '280 — Automated Accounting Advices',
    );
    assert.strictEqual(
      decodeAchField(header, header.fields.find(field => field.name === 'Standard Entry Class')!).display,
      'ADV — Automated Accounting Advice',
    );
    assert.strictEqual(
      decodeAchField(entry, entry.fields.find(field => field.name === 'Transaction Code')!).display,
      '81 — Credit for ACH debits originated',
    );
    assert.strictEqual(
      decodeAchField(entry, entry.fields.find(field => field.name === 'Advice Routing Number')!).display,
      '061000104 — routing number',
    );
  });

  test('Validates ADV service, transaction, routing, date, and sequence semantics', () => {
    const lines = advFile().split('\n');
    lines[1] = replaceField(lines[1], 1, '220');
    lines[2] = replaceField(lines[2], 1, '22');
    lines[2] = replaceField(lines[2], 47, '9');
    lines[2] = replaceField(lines[2], 79, 'BAD-RTNG');
    lines[2] = replaceField(lines[2], 87, '367');
    lines[3] = replaceField(lines[3], 90, '0009');
    const codes = new Set(parseAch(lines.join('\n')).map(item => item.code));

    assert.ok(codes.has('ACH-ADV-SERVICE-CLASS'));
    assert.ok(codes.has('ACH-SEC-TRANSACTION-CODE'));
    assert.ok(codes.has('ACH-ADV-ADVICE-ROUTING-CHECK-DIGIT'));
    assert.ok(codes.has('ACH-ADV-OPERATOR-ROUTING'));
    assert.ok(codes.has('ACH-ADV-JULIAN-DATE'));
    assert.ok(codes.has('ACH-ADV-SEQUENCE'));
  });

  test('Repairs ADV batch and file controls using their 20-digit amount fields', () => {
    const lines = advFile().split('\n');
    lines[4] = replaceField(lines[4], 20, '0'.repeat(20));
    lines[4] = replaceField(lines[4], 40, '0'.repeat(20));
    lines[5] = replaceField(lines[5], 31, '0'.repeat(20));
    lines[5] = replaceField(lines[5], 51, '0'.repeat(20));
    const text = lines.join('\n');
    const document = parseAchDocument(text);
    const diagnostics = parseAch(document);
    const fixed = applyAchTextEdits(text, collectAchFixEdits(document, diagnostics, 'derived'));
    const fixedLines = fixed.split('\n');

    assert.strictEqual(fixedLines[4].substring(20, 40), number(debit, 20));
    assert.strictEqual(fixedLines[4].substring(40, 60), number(credit, 20));
    assert.strictEqual(fixedLines[5].substring(31, 51), number(debit, 20));
    assert.strictEqual(fixedLines[5].substring(51, 71), number(credit, 20));
    assert.deepStrictEqual(parseAch(fixed, nachaValidationProfile), []);
  });

  test('Renumbers only the four-digit ADV sequence without overwriting its suffix fields', () => {
    const lines = advFile().split('\n');
    lines[2] = replaceField(lines[2], 90, '9999');
    lines[3] = replaceField(lines[3], 90, '9998');
    const text = lines.join('\n');
    const document = parseAchDocument(text);
    const beforeSuffixes = lines.slice(2, 4).map(line => line.substring(79, 90));
    const fixed = applyAchTextEdits(text, buildSequenceRenumberEdits(document)).split('\n');

    assert.deepStrictEqual(fixed.slice(2, 4).map(line => line.substring(79, 90)), beforeSuffixes);
    assert.strictEqual(fixed[2].substring(90, 94), '0001');
    assert.strictEqual(fixed[3].substring(90, 94), '0002');
  });

  test('Rejects mixing ADV and standard batches with incompatible File Control layouts', () => {
    const lines = advFile().split('\n');
    const standardBatch = [
      makeRecord('5', [
        [1, '220'], [4, 'COMPANY'], [40, '1234567890'], [50, 'CCD'],
        [53, 'PAYMENT'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000002'],
      ]),
      makeRecord('6', [
        [1, '22'], [3, '06100010'], [11, '4'], [12, 'ACCOUNT'], [29, '0000000100'],
        [54, 'RECEIVER'], [78, '0'], [79, '061000100000003'],
      ]),
      makeRecord('8', [
        [1, '220'], [4, '000001'], [10, '0006100010'], [20, '000000000000'],
        [32, '000000000100'], [44, '1234567890'], [79, '06100010'], [87, '0000002'],
      ]),
    ];
    lines.splice(5, 0, ...standardBatch);

    assert.ok(parseAch(lines.join('\n')).some(item => item.code === 'ACH-ADV-MIXED-FILE'));
  });
});
