import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseAchDocument } from '../achDocument';
import { AchExplorerProvider } from '../achExplorer';
import { applyAchTextEdits, fixForAchDiagnostic } from '../achFixes';
import { transactionCodes } from '../achRules';
import { createAchJsonReport } from '../achReporting';
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

function reversalFile(options: {
  description?: string;
  transactionCode?: string;
  amount?: bigint;
} = {}): string {
  const description = options.description ?? 'REVERSAL';
  const transactionCode = options.transactionCode ?? '27';
  const amount = options.amount ?? 1234n;
  const transaction = transactionCodes.get(transactionCode)!;
  const debit = transaction.direction === 'debit' ? amount : 0n;
  const credit = transaction.direction === 'credit' ? amount : 0n;
  const serviceClass = transaction.direction === 'debit' ? '225' : '220';
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, serviceClass], [4, 'COMPANY'], [40, '1234567890'], [50, 'PPD'],
      [53, description], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', [
      [1, transactionCode], [3, '06100010'], [11, '4'], [12, '123456789'],
      [29, number(amount, 10)], [39, 'ORIGINAL-ENTRY'], [54, 'RECEIVER'],
      [78, '0'], [79, '061000100000001'],
    ]),
    makeRecord('8', [
      [1, serviceClass], [4, '000001'], [10, '0006100010'],
      [20, number(debit, 12)], [32, number(credit, 12)], [44, '1234567890'],
      [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, '00000001'], [21, '0006100010'],
      [31, number(debit, 12)], [43, number(credit, 12)],
    ]),
  ];
  return [...records, ...Array(5).fill('9'.repeat(94))].join('\n');
}

suite('ACH Reversal Support Test Suite', () => {
  test('Classifies and accepts a correctly formatted reversal batch', () => {
    const document = parseAchDocument(reversalFile());
    const summary = parseAchSummary(document);

    assert.deepStrictEqual(parseAch(document), []);
    assert.strictEqual(document.batches[0].entryDescription, 'REVERSAL');
    assert.strictEqual(document.batches[0].isReversal, true);
    assert.strictEqual(summary.reversalBatches, 1);
    assert.strictEqual(summary.reversalEntries, 1);
  });

  test('Safely corrects reversal description casing when intent is unambiguous', () => {
    const text = reversalFile({ description: 'reversal' });
    const document = parseAchDocument(text);
    const diagnostic = parseAch(document).find(item => item.code === 'ACH-REVERSAL-DESCRIPTION');

    assert.ok(diagnostic);
    const edit = fixForAchDiagnostic(document, diagnostic);
    assert.ok(edit);
    const fixed = applyAchTextEdits(text, [edit]);
    assert.strictEqual(fixed.split('\n')[1].substring(53, 63), 'REVERSAL  ');
    assert.strictEqual(parseAch(parseAchDocument(fixed)).some(item => item.code === 'ACH-REVERSAL-DESCRIPTION'), false);
  });

  test('Rejects non-payment transaction kinds inside a reversal batch', () => {
    const diagnostics = parseAch(reversalFile({ transactionCode: '23', amount: 0n }));
    const diagnostic = diagnostics.find(item => item.code === 'ACH-REVERSAL-TRANSACTION-KIND');

    assert.ok(diagnostic);
    assert.strictEqual(diagnostic.actual, '23 (prenote)');
    assert.strictEqual(diagnostic.related?.[0].start, 53);
  });

  test('Labels reversal batches in the decoded explorer', () => {
    const document = parseAchDocument(reversalFile());
    const summary = parseAchSummary(document);
    const provider = new AchExplorerProvider();
    provider.update(vscode.Uri.file('/tmp/reversal.ach'), document, [], summary, true);

    const batch = provider.getChildren()[0].children.find(node => node.kind === 'batch');
    assert.ok(String(batch?.label).includes('REVERSAL'));
    assert.strictEqual(batch?.iconPath instanceof vscode.ThemeIcon && batch.iconPath.id, 'discard');

    const report = createAchJsonReport({
      fileName: 'reversal.ach',
      document,
      diagnostics: [],
      summary,
      profile: nachaValidationProfile,
      generatedAt: '2026-07-13T00:00:00.000Z',
    });
    assert.strictEqual(report.file.reversalBatches, 1);
    assert.strictEqual(report.file.reversalEntries, 1);
  });
});
