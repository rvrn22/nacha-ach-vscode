import * as assert from 'assert';
import { detectAchContent } from '../achDetection';
import { parseAchDocument } from '../achDocument';
import { resolveAchValidationProfile } from '../achProfiles';
import { createAchJsonReport, createAchSarifReport } from '../achReporting';
import { runCli } from '../cli';
import { ACH_RULESET_VERSION, nachaValidationProfile, type AchDiagnostic } from '../achTypes';
import { parseAch, parseAchSummary } from '../nachaParser';

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

function validFile(checkDigit = '4'): string {
  const header = makeRecord('1', [
    [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260713'], [29, '1200'],
    [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
  ]);
  const batch = makeRecord('5', [
    [1, '200'], [4, 'COMPANY'], [40, '1234567890'], [50, 'PPD'], [53, 'PAYMENT'], [69, '260713'],
    [78, '1'], [79, '06100010'], [87, '0000001'],
  ]);
  const entry = makeRecord('6', [
    [1, '22'], [3, '06100010'], [11, checkDigit], [12, '123456789'], [29, '0000001234'],
    [54, 'RECEIVER'], [78, '0'], [79, '061000100000001'],
  ]);
  const batchControl = makeRecord('8', [
    [1, '200'], [4, '000001'], [10, '0006100010'], [20, '000000000000'],
    [32, '000000001234'], [44, '1234567890'], [79, '06100010'], [87, '0000001'],
  ]);
  const fileControl = makeRecord('9', [
    [1, '000001'], [7, '000001'], [13, '00000001'], [21, '0006100010'],
    [31, '000000000000'], [43, '000000001234'],
  ]);
  return [header, batch, entry, batchControl, fileControl, ...Array(5).fill('9'.repeat(94))].join('\n');
}

suite('ACH Profiles, Reporting, CLI, and Detection Test Suite', () => {
  test('Resolves named profiles and applies explained rule overrides', () => {
    const profile = resolveAchValidationProfile(
      'partner-bank',
      {
        'partner-bank': {
          extends: 'unblocked',
          displayName: 'Partner Bank',
          ruleOverrides: {
            'ACH-PHYSICAL-RECORD-LENGTH': { severity: 'warning', reason: 'Partner accepts test fragments' },
            'ACH-STRUCTURE-MISSING-FILE-CONTROL': { severity: 'off', reason: 'Fragment validation' },
          },
        },
      },
    );
    const diagnostics = parseAch('101 short', profile);
    const length = diagnostics.find(diagnostic => diagnostic.code === 'ACH-PHYSICAL-RECORD-LENGTH');

    assert.strictEqual(profile.displayName, 'Partner Bank');
    assert.strictEqual(profile.requireBlocking, false);
    assert.strictEqual(profile.rulesVersion, ACH_RULESET_VERSION);
    assert.strictEqual(length?.severity, 1);
    assert.strictEqual(length?.overrideReason, 'Partner accepts test fragments');
    assert.strictEqual(diagnostics.some(diagnostic => diagnostic.code === 'ACH-STRUCTURE-MISSING-FILE-CONTROL'), false);
  });

  test('Creates redacted JSON and SARIF reports with versioned rules', () => {
    const document = parseAchDocument(validFile());
    const sensitiveDiagnostic: AchDiagnostic = {
      line: 2,
      start: 12,
      end: 29,
      message: 'Synthetic account diagnostic',
      severity: 0,
      code: 'ACH-TEST-SENSITIVE',
      category: 'field',
      profile: nachaValidationProfile.id,
      rulesVersion: ACH_RULESET_VERSION,
      expected: 'EXPECTED-ACCOUNT',
      actual: '123456789',
    };
    const input = {
      fileName: 'sample.ach',
      document,
      diagnostics: [sensitiveDiagnostic],
      summary: parseAchSummary(document),
      profile: nachaValidationProfile,
      generatedAt: '2026-07-13T00:00:00.000Z',
    };
    const json = createAchJsonReport(input);
    const sarif = createAchSarifReport(input);

    assert.strictEqual(json.redacted, true);
    assert.strictEqual(json.rulesVersion, ACH_RULESET_VERSION);
    assert.strictEqual(json.diagnostics[0].expected, '[REDACTED]');
    assert.strictEqual(json.diagnostics[0].actual, '[REDACTED]');
    assert.strictEqual(sarif.version, '2.1.0');
    assert.strictEqual(sarif.runs[0].results[0].ruleId, 'ACH-TEST-SENSITIVE');
    assert.strictEqual(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 3);
  });

  test('Detects high-confidence ACH text without flagging ordinary fixed-width text', () => {
    const ach = detectAchContent(validFile());
    const ordinary = detectAchContent(Array(5).fill('X'.repeat(94)).join('\n'));

    assert.strictEqual(ach.isLikelyAch, true);
    assert.ok(ach.confidence >= 0.8);
    assert.strictEqual(ordinary.isLikelyAch, false);
  });

  test('Runs the same validator headlessly with JSON and rule suppression', async () => {
    const outputs: string[] = [];
    const errors: string[] = [];
    const io = {
      readFile: (_fileName: string) => validFile('5'),
      write: (text: string) => outputs.push(text),
      writeError: (text: string) => errors.push(text),
    };
    const failing = await runCli(['--format', 'json', 'sample.ach'], io);
    const report = JSON.parse(outputs.join(''));

    assert.strictEqual(failing, 1);
    assert.strictEqual(report.file.name, 'sample.ach');
    assert.ok(report.diagnostics.some((diagnostic: { code: string }) => diagnostic.code === 'ACH-FIELD-ROUTING-CHECK-DIGIT'));
    outputs.length = 0;

    const suppressed = await runCli([
      '--format', 'json',
      '--rule', 'ACH-FIELD-ROUTING-CHECK-DIGIT=off:Known synthetic fixture',
      'sample.ach',
    ], io);
    const suppressedReport = JSON.parse(outputs.join(''));
    assert.strictEqual(suppressed, 0);
    assert.strictEqual(suppressedReport.diagnostics.length, 0);
    assert.deepStrictEqual(errors, []);
  });
});
