import * as assert from 'assert';
import * as vscode from 'vscode';
import { decodeAchField } from '../achDecode';
import { parseAchDocument } from '../achDocument';
import { AchExplorerProvider } from '../achExplorer';
import { fixForAchDiagnostic } from '../achFixes';
import { createAchJsonReport } from '../achReporting';
import { transactionCodes } from '../achRules';
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

function zeroDollarFile(options: {
  secCode?: string;
  transactionCode?: string;
  amount?: bigint;
  addenda?: boolean;
} = {}): string {
  const secCode = options.secCode ?? 'CCD';
  const transactionCode = options.transactionCode ?? '24';
  const amount = options.amount ?? 0n;
  const hasAddenda = options.addenda ?? true;
  const transaction = transactionCodes.get(transactionCode)!;
  const serviceClass = transaction.direction === 'credit' ? '220' : '225';
  const debit = transaction.direction === 'debit' ? amount : 0n;
  const credit = transaction.direction === 'credit' ? amount : 0n;
  const trace = '061000100000001';
  const count = 1 + (hasAddenda ? 1 : 0);
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, serviceClass], [4, 'COMPANY'], [40, '1234567890'], [50, secCode],
      [53, 'REMIT DATA'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', [
      [1, transactionCode], [3, '06100010'], [11, '4'], [12, '123456789'],
      [29, number(amount, 10)], [39, 'ZERO-DOLLAR'], [54, 'RECEIVER'],
      [78, hasAddenda ? '1' : '0'], [79, trace],
    ]),
  ];
  if (hasAddenda) {
    records.push(makeRecord('7', [
      [1, '05'], [3, 'REMITTANCE INFORMATION'], [83, '0001'], [87, trace.substring(8)],
    ]));
  }
  records.push(
    makeRecord('8', [
      [1, serviceClass], [4, number(count, 6)], [10, '0006100010'],
      [20, number(debit, 12)], [32, number(credit, 12)], [44, '1234567890'],
      [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, number(count, 8)], [21, '0006100010'],
      [31, number(debit, 12)], [43, number(credit, 12)],
    ]),
  );
  return [...records, ...Array((10 - (records.length % 10)) % 10).fill('9'.repeat(94))].join('\n');
}

suite('ACH Zero-Dollar Entry Support Test Suite', () => {
  test('Accepts and classifies zero-dollar CCD and CTX entries with addenda', () => {
    for (const secCode of ['CCD', 'CTX']) {
      const document = parseAchDocument(zeroDollarFile({ secCode }));
      const summary = parseAchSummary(document);

      assert.deepStrictEqual(parseAch(document), []);
      assert.strictEqual(document.batches[0].entries[0].isZeroDollar, true);
      assert.strictEqual(summary.batchesWithZeroDollarEntries, 1);
      assert.strictEqual(summary.zeroDollarEntries, 1);
    }
  });

  test('Requires addenda for zero-dollar CCD and CTX entries', () => {
    for (const secCode of ['CCD', 'CTX']) {
      const diagnostics = parseAch(zeroDollarFile({ secCode, addenda: false }));
      assert.ok(diagnostics.some(item => item.code === 'ACH-ZERO-DOLLAR-ADDENDA-REQUIRED'));
    }
  });

  test('Requires a zero amount without offering a control-breaking field-only fix', () => {
    const document = parseAchDocument(zeroDollarFile({ amount: 99n }));
    const diagnostic = parseAch(document).find(item => item.code === 'ACH-ZERO-DOLLAR-AMOUNT');

    assert.ok(diagnostic);
    assert.strictEqual(diagnostic.expected, '0000000000');
    assert.strictEqual(fixForAchDiagnostic(document, diagnostic), undefined);
  });

  test('Treats ACK transaction codes as acknowledgments rather than zero-dollar payments', () => {
    const acknowledgment = parseAchDocument(zeroDollarFile({ secCode: 'ACK', transactionCode: '24', addenda: false }));
    const detail = acknowledgment.batches[0].entries[0].detail;
    const transactionField = detail.fields.find(field => field.name === 'Transaction Code');
    assert.strictEqual(acknowledgment.batches[0].entries[0].isZeroDollar, false);
    assert.strictEqual(acknowledgment.batches[0].entries[0].transactionKind, 'acknowledgment');
    assert.strictEqual(parseAchSummary(acknowledgment).zeroDollarEntries, 0);
    assert.ok(transactionField);
    assert.strictEqual(decodeAchField(detail, transactionField).display, '24 — Checking acknowledgment');

    const invalid = parseAch(zeroDollarFile({ secCode: 'ACK', transactionCode: '29', addenda: false }));
    assert.ok(invalid.some(item => item.code === 'ACH-SEC-TRANSACTION-CODE'));
  });

  test('Retains mandatory IAT addenda validation for zero-dollar IAT entries', () => {
    const batch = makeRecord('5', [
      [1, '200'], [20, 'FF'], [22, '3'], [38, 'US'], [40, '1234567890'],
      [50, 'IAT'], [53, 'REMIT DATA'], [63, 'USD'], [66, 'USD'], [69, '260713'],
      [78, '1'], [79, '06100010'], [87, '0000001'],
    ]);
    const entry = makeRecord('6', [
      [1, '24'], [3, '06100010'], [11, '4'], [12, '0000'], [29, '0000000000'],
      [39, 'FOREIGN-ACCOUNT'], [78, '1'], [79, '061000100000001'],
    ]);
    const document = parseAchDocument([batch, entry].join('\n'));
    const codes = new Set(parseAch(document).map(item => item.code));

    assert.strictEqual(document.batches[0].entries[0].isZeroDollar, true);
    assert.ok(codes.has('ACH-IAT-ADDENDA-RANGE'));
    assert.ok(codes.has('ACH-IAT-MANDATORY-ADDENDA'));
  });

  test('Surfaces zero-dollar counts in the explorer and redacted JSON report', () => {
    const document = parseAchDocument(zeroDollarFile());
    const summary = parseAchSummary(document);
    const provider = new AchExplorerProvider();
    provider.update(vscode.Uri.file('/tmp/zero-dollar.ach'), document, [], summary, true);

    const batch = provider.getChildren()[0].children.find(node => node.kind === 'batch');
    const entry = batch?.children.find(node => node.kind === 'entry');
    assert.strictEqual(entry?.iconPath instanceof vscode.ThemeIcon && entry.iconPath.id, 'symbol-constant');

    const report = createAchJsonReport({
      fileName: 'zero-dollar.ach',
      document,
      diagnostics: [],
      summary,
      profile: nachaValidationProfile,
      generatedAt: '2026-07-13T00:00:00.000Z',
    });
    assert.strictEqual(report.file.batchesWithZeroDollarEntries, 1);
    assert.strictEqual(report.file.zeroDollarEntries, 1);
  });
});
