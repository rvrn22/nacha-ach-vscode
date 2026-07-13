import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseAchDocument } from '../achDocument';
import { AchExplorerProvider } from '../achExplorer';
import { applyAchTextEdits, fixForAchDiagnostic } from '../achFixes';
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

function header(): string {
  return makeRecord('1', [
    [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
    [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
  ]);
}

function microEntryFile(options: {
  description?: string;
  firstCredit?: bigint;
  secondCredit?: bigint;
  debit?: bigint;
  firstCode?: string;
} = {}): string {
  const description = options.description ?? 'ACCTVERIFY';
  const credits = [options.firstCredit ?? 32n, options.secondCredit ?? 47n];
  const debit = options.debit ?? 79n;
  const entries = [
    { code: options.firstCode ?? '22', amount: credits[0] },
    { code: '22', amount: credits[1] },
    { code: '27', amount: debit },
  ];
  const hash = '0018300030';
  const records = [
    header(),
    makeRecord('5', [
      [1, '200'], [4, 'RECOGNIZABLE CO'], [40, '1234567890'], [50, 'PPD'],
      [53, description], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    ...entries.map((entry, index) => makeRecord('6', [
      [1, entry.code], [3, '06100010'], [11, '4'], [12, 'ACCOUNT-123'],
      [29, number(entry.amount, 10)], [39, `VERIFY-${index + 1}`], [54, 'RECEIVER'],
      [78, '0'], [79, `06100010${String(index + 1).padStart(7, '0')}`],
    ])),
    makeRecord('8', [
      [1, '200'], [4, '000003'], [10, hash], [20, number(debit, 12)],
      [32, number(credits[0] + credits[1], 12)], [44, '1234567890'],
      [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, '00000003'], [21, hash],
      [31, number(debit, 12)], [43, number(credits[0] + credits[1], 12)],
    ]),
  ];
  return [...records, ...Array((10 - (records.length % 10)) % 10).fill('9'.repeat(94))].join('\n');
}

function splitMicroEntryFile(debitDate: string): string {
  const records = [
    header(),
    makeRecord('5', [
      [1, '220'], [4, 'RECOGNIZABLE CO'], [40, '1234567890'], [50, 'PPD'],
      [53, 'ACCTVERIFY'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', [
      [1, '22'], [3, '06100010'], [11, '4'], [12, 'ACCOUNT-123'], [29, '0000000050'],
      [54, 'RECEIVER'], [78, '0'], [79, '061000100000001'],
    ]),
    makeRecord('8', [
      [1, '220'], [4, '000001'], [10, '0006100010'], [20, '000000000000'],
      [32, '000000000050'], [44, '1234567890'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('5', [
      [1, '225'], [4, 'RECOGNIZABLE CO'], [40, '1234567890'], [50, 'PPD'],
      [53, 'ACCTVERIFY'], [69, debitDate], [78, '1'], [79, '06100010'], [87, '0000002'],
    ]),
    makeRecord('6', [
      [1, '27'], [3, '06100010'], [11, '4'], [12, 'ACCOUNT-123'], [29, '0000000050'],
      [54, 'RECEIVER'], [78, '0'], [79, '061000100000002'],
    ]),
    makeRecord('8', [
      [1, '225'], [4, '000001'], [10, '0006100010'], [20, '000000000050'],
      [32, '000000000000'], [44, '1234567890'], [79, '06100010'], [87, '0000002'],
    ]),
    makeRecord('9', [
      [1, '000002'], [7, '000001'], [13, '00000002'], [21, '0012200020'],
      [31, '000000000050'], [43, '000000000050'],
    ]),
  ];
  return [...records, ...Array(2).fill('9'.repeat(94))].join('\n');
}

suite('ACH Micro-Entry Support Test Suite', () => {
  test('Accepts and classifies valid credit and offsetting debit Micro-Entries', () => {
    const document = parseAchDocument(microEntryFile());
    const summary = parseAchSummary(document);

    assert.deepStrictEqual(parseAch(document), []);
    assert.strictEqual(document.batches[0].isMicroEntry, true);
    assert.ok(document.batches[0].entries.every(entry => entry.isMicroEntry));
    assert.strictEqual(summary.microEntryBatches, 1);
    assert.strictEqual(summary.microEntries, 3);
  });

  test('Validates credit amounts and prevents a net debit to the receiver', () => {
    const amountCodes = new Set(parseAch(microEntryFile({ firstCredit: 100n })).map(item => item.code));
    const netCodes = new Set(parseAch(microEntryFile({ debit: 80n })).map(item => item.code));

    assert.ok(amountCodes.has('ACH-MICRO-CREDIT-AMOUNT'));
    assert.ok(netCodes.has('ACH-MICRO-NET-DEBIT'));
  });

  test('Requires live transaction codes and matching effective dates for offsets', () => {
    assert.ok(parseAch(microEntryFile({ firstCode: '23', firstCredit: 0n }))
      .some(item => item.code === 'ACH-MICRO-TRANSACTION-KIND'));
    assert.deepStrictEqual(parseAch(splitMicroEntryFile('260713')), []);
    assert.ok(parseAch(splitMicroEntryFile('260714'))
      .some(item => item.code === 'ACH-MICRO-EFFECTIVE-DATE'));
  });

  test('Safely corrects ACCTVERIFY casing when intent is unambiguous', () => {
    const text = microEntryFile({ description: 'acctverify' });
    const document = parseAchDocument(text);
    const diagnostic = parseAch(document).find(item => item.code === 'ACH-MICRO-DESCRIPTION');

    assert.ok(diagnostic);
    const edit = fixForAchDiagnostic(document, diagnostic);
    assert.ok(edit);
    const fixed = applyAchTextEdits(text, [edit]);
    assert.strictEqual(fixed.split('\n')[1].substring(53, 63), 'ACCTVERIFY');
    assert.strictEqual(parseAch(fixed).some(item => item.code === 'ACH-MICRO-DESCRIPTION'), false);
  });

  test('Surfaces Micro-Entries in the explorer and redacted JSON report', () => {
    const document = parseAchDocument(microEntryFile());
    const summary = parseAchSummary(document);
    const provider = new AchExplorerProvider();
    provider.update(vscode.Uri.file('/tmp/micro.ach'), document, [], summary, true);

    const batch = provider.getChildren()[0].children.find(node => node.kind === 'batch');
    const entry = batch?.children.find(node => node.kind === 'entry');
    assert.ok(String(batch?.label).includes('ACCTVERIFY'));
    assert.strictEqual(entry?.iconPath instanceof vscode.ThemeIcon && entry.iconPath.id, 'verified');

    const report = createAchJsonReport({
      fileName: 'micro.ach',
      document,
      diagnostics: [],
      summary,
      profile: nachaValidationProfile,
      generatedAt: '2026-07-13T00:00:00.000Z',
    });
    assert.strictEqual(report.file.microEntryBatches, 1);
    assert.strictEqual(report.file.microEntries, 3);
  });
});
