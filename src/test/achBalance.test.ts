import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseAchDocument } from '../achDocument';
import { AchExplorerProvider } from '../achExplorer';
import { resolveAchValidationProfile } from '../achProfiles';
import { createAchJsonReport } from '../achReporting';
import { balancedValidationProfile, nachaValidationProfile, parseAch, parseAchSummary } from '../nachaParser';

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

function netPositionFile(netZero: boolean): string {
  const entryCount = netZero ? 2 : 1;
  const hash = netZero ? '0012200020' : '0006100010';
  const debit = netZero ? '000000001234' : '000000000000';
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, '200'], [4, 'COMPANY'], [40, '1234567890'], [50, 'PPD'],
      [53, 'PAYROLL'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', [
      [1, '22'], [3, '06100010'], [11, '4'], [12, 'EMPLOYEE'],
      [29, '0000001234'], [54, 'RECEIVER'], [78, '0'], [79, '061000100000001'],
    ]),
  ];
  if (netZero) {
    records.push(makeRecord('6', [
      [1, '27'], [3, '06100010'], [11, '4'], [12, 'FUNDING'],
      [29, '0000001234'], [54, 'OFFSET CANDIDATE'], [78, '0'], [79, '061000100000002'],
    ]));
  }
  records.push(
    makeRecord('8', [
      [1, '200'], [4, String(entryCount).padStart(6, '0')], [10, hash],
      [20, debit], [32, '000000001234'], [44, '1234567890'],
      [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, String(entryCount).padStart(8, '0')], [21, hash],
      [31, debit], [43, '000000001234'],
    ]),
  );
  return [...records, ...Array((10 - (records.length % 10)) % 10).fill('9'.repeat(94))].join('\n');
}

suite('ACH Net Position and Balanced Profile Test Suite', () => {
  test('Classifies exact net-zero, net-credit, and net-debit positions', () => {
    const zero = parseAchSummary(netPositionFile(true));
    const credit = parseAchSummary(netPositionFile(false));
    const debitLines = netPositionFile(false).split('\n');
    debitLines[2] = debitLines[2].substring(0, 1) + '27' + debitLines[2].substring(3);
    debitLines[3] = debitLines[3].substring(0, 20) + '000000001234' + '000000000000' + debitLines[3].substring(44);
    debitLines[4] = debitLines[4].substring(0, 31) + '000000001234' + '000000000000' + debitLines[4].substring(55);
    const debit = parseAchSummary(debitLines.join('\n'));

    assert.strictEqual(zero.netPosition, 'zero');
    assert.strictEqual(zero.netPositionAmountCents, 0n);
    assert.strictEqual(credit.netPosition, 'credit');
    assert.strictEqual(credit.netPositionAmountCents, 1234n);
    assert.strictEqual(debit.netPosition, 'debit');
    assert.strictEqual(debit.netPositionAmountCents, 1234n);
  });

  test('Accepts either net position by default and enforces net zero only when opted in', () => {
    const netZero = netPositionFile(true);
    const unbalanced = netPositionFile(false);

    assert.deepStrictEqual(parseAch(netZero), []);
    assert.deepStrictEqual(parseAch(unbalanced), []);
    assert.strictEqual(parseAch(netZero, balancedValidationProfile).some(item => item.code === 'ACH-PROFILE-NET-ZERO'), false);
    const diagnostic = parseAch(unbalanced, balancedValidationProfile).find(item => item.code === 'ACH-PROFILE-NET-ZERO');
    assert.ok(diagnostic);
    assert.strictEqual(diagnostic.actual, '1234 cents');
    assert.strictEqual(diagnostic.related?.[0].start, 20);
  });

  test('Supports the balanced built-in and custom net-zero profiles', () => {
    const builtIn = resolveAchValidationProfile('balanced');
    const custom = resolveAchValidationProfile('partner-balanced', {
      'partner-balanced': { extends: 'unblocked', requireNetZero: true },
    });

    assert.strictEqual(builtIn.requireNetZero, true);
    assert.strictEqual(builtIn.id, 'nacha-balanced');
    assert.strictEqual(custom.requireBlocking, false);
    assert.strictEqual(custom.requireNetZero, true);
  });

  test('Surfaces factual net position in the explorer and JSON report', () => {
    const document = parseAchDocument(netPositionFile(false));
    const summary = parseAchSummary(document);
    const provider = new AchExplorerProvider();
    provider.update(vscode.Uri.file('/tmp/net-credit.ach'), document, [], summary, true);

    const root = provider.getChildren()[0];
    assert.ok(String(root.description).includes('$12.34 net credit'));

    const report = createAchJsonReport({
      fileName: 'net-credit.ach',
      document,
      diagnostics: [],
      summary,
      profile: nachaValidationProfile,
      generatedAt: '2026-07-13T00:00:00.000Z',
    });
    assert.strictEqual(report.file.netPosition, 'credit');
    assert.strictEqual(report.file.netAmountCents, '1234');
    assert.strictEqual(report.profile.requireNetZero, false);
  });
});
