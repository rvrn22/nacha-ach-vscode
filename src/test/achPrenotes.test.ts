import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseAchDocument } from '../achDocument';
import { AchExplorerProvider } from '../achExplorer';
import { fixForAchDiagnostic } from '../achFixes';
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

function prenoteFile(prenoteAmount = 0n, withAddenda = false): string {
  const prenoteTrace = '061000100000001';
  const liveTrace = '061000100000002';
  const count = 2 + (withAddenda ? 1 : 0);
  const credit = prenoteAmount + 1234n;
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, '220'], [4, 'COMPANY'], [40, '1234567890'], [50, 'PPD'],
      [53, 'ACCOUNT TEST'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', [
      [1, '23'], [3, '06100010'], [11, '4'], [12, '123456789'],
      [29, number(prenoteAmount, 10)], [39, 'PRENOTE'], [54, 'RECEIVER'],
      [78, withAddenda ? '1' : '0'], [79, prenoteTrace],
    ]),
  ];
  if (withAddenda) {
    records.push(makeRecord('7', [
      [1, '05'], [3, 'PRENOTE INFORMATION'], [83, '0001'], [87, prenoteTrace.substring(8)],
    ]));
  }
  records.push(
    makeRecord('6', [
      [1, '22'], [3, '06100010'], [11, '4'], [12, '987654321'],
      [29, '0000001234'], [39, 'LIVE ENTRY'], [54, 'RECEIVER'],
      [78, '0'], [79, liveTrace],
    ]),
    makeRecord('8', [
      [1, '220'], [4, number(count, 6)], [10, '0012200020'],
      [20, '000000000000'], [32, number(credit, 12)], [44, '1234567890'],
      [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, number(count, 8)], [21, '0012200020'],
      [31, '000000000000'], [43, number(credit, 12)],
    ]),
  );
  return [...records, ...Array((10 - (records.length % 10)) % 10).fill('9'.repeat(94))].join('\n');
}

suite('ACH Prenotification Support Test Suite', () => {
  test('Accepts and classifies a prenote mixed with a live entry', () => {
    const document = parseAchDocument(prenoteFile());
    const summary = parseAchSummary(document);

    assert.deepStrictEqual(parseAch(document), []);
    assert.strictEqual(document.batches[0].entries[0].transactionKind, 'prenote');
    assert.strictEqual(document.batches[0].entries[0].isPrenote, true);
    assert.strictEqual(document.batches[0].entries[1].isPrenote, false);
    assert.strictEqual(summary.batchesWithPrenotes, 1);
    assert.strictEqual(summary.prenoteEntries, 1);
  });

  test('Allows a prenote to carry an SEC-compatible addenda record', () => {
    assert.deepStrictEqual(parseAch(prenoteFile(0n, true)), []);
  });

  test('Requires a zero amount without offering a control-breaking field-only fix', () => {
    const document = parseAchDocument(prenoteFile(99n));
    const diagnostic = parseAch(document).find(item => item.code === 'ACH-PRENOTE-AMOUNT-ZERO');

    assert.ok(diagnostic);
    assert.strictEqual(diagnostic.expected, '0000000000');
    assert.strictEqual(fixForAchDiagnostic(document, diagnostic), undefined);
  });

  test('Does not misclassify DNE entries that share a non-dollar transaction code', () => {
    const batch = makeRecord('5', [[50, 'DNE']]);
    const entry = makeRecord('6', [[1, '23']]);
    const document = parseAchDocument([batch, entry].join('\n'));

    assert.strictEqual(document.batches[0].entries[0].transactionKind, 'deathNotice');
    assert.strictEqual(document.batches[0].entries[0].isPrenote, false);
    assert.strictEqual(parseAchSummary(document).prenoteEntries, 0);
  });

  test('Retains mandatory IAT addenda validation for IAT prenotes', () => {
    const batch = makeRecord('5', [
      [1, '200'], [20, 'FF'], [22, '3'], [38, 'US'], [40, '1234567890'],
      [50, 'IAT'], [53, 'PRENOTE'], [63, 'USD'], [66, 'USD'], [69, '260713'],
      [78, '1'], [79, '06100010'], [87, '0000001'],
    ]);
    const entry = makeRecord('6', [
      [1, '23'], [3, '06100010'], [11, '4'], [12, '0000'], [29, '0000000000'],
      [39, 'FOREIGN-ACCOUNT'], [78, '1'], [79, '061000100000001'],
    ]);
    const document = parseAchDocument([batch, entry].join('\n'));
    const codes = new Set(parseAch(document).map(item => item.code));

    assert.strictEqual(document.batches[0].entries[0].isPrenote, true);
    assert.ok(codes.has('ACH-IAT-ADDENDA-RANGE'));
    assert.ok(codes.has('ACH-IAT-MANDATORY-ADDENDA'));
  });

  test('Surfaces prenote counts in the explorer and redacted JSON report', () => {
    const document = parseAchDocument(prenoteFile());
    const summary = parseAchSummary(document);
    const provider = new AchExplorerProvider();
    provider.update(vscode.Uri.file('/tmp/prenote.ach'), document, [], summary, true);

    const batch = provider.getChildren()[0].children.find(node => node.kind === 'batch');
    const entry = batch?.children.find(node => node.kind === 'entry');
    assert.strictEqual(entry?.iconPath instanceof vscode.ThemeIcon && entry.iconPath.id, 'preview');

    const report = createAchJsonReport({
      fileName: 'prenote.ach',
      document,
      diagnostics: [],
      summary,
      profile: nachaValidationProfile,
      generatedAt: '2026-07-13T00:00:00.000Z',
    });
    assert.strictEqual(report.file.batchesWithPrenotes, 1);
    assert.strictEqual(report.file.prenoteEntries, 1);
  });
});
