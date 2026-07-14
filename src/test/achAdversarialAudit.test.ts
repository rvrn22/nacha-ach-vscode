import * as assert from 'assert';
import { parseAchDocument } from '../achDocument';
import { applyAchTextEdits, collectAchFixEdits } from '../achFixes';
import { createAchJsonReport, createAchSarifReport } from '../achReporting';
import { maximumAddendaForSec, transactionCodeCompatibility, transactionCodes } from '../achRules';
import { runCli } from '../cli';
import { parseAch, parseAchSummary } from '../nachaParser';
import { nachaValidationProfile, type AchDiagnostic } from '../achTypes';
import { makeAchRecord, replaceAchField, standardAchFile, standardAchRecords } from './fixtures/achFixtures';

function codes(text: string): Set<string> {
  return new Set(parseAch(text).map(diagnostic => diagnostic.code));
}

function returnAddenda(reason: string, trace = '061000100000001'): string {
  return makeAchRecord('7', [
    [1, '99'], [3, reason], [6, '031300010000123'], [27, '03130001'], [79, trace],
  ]);
}

function nocAddenda(code: string, correctedData: string, trace = '061000100000001'): string {
  return makeAchRecord('7', [
    [1, '98'], [3, code], [6, '031300010000123'], [27, '03130001'], [35, correctedData], [79, trace],
  ]);
}

function nocFile(code: string, correctedData: string, sec = 'COR'): string {
  const records = standardAchRecords();
  records[1] = replaceAchField(records[1], 50, sec);
  records[2] = replaceAchField(records[2], 1, '21');
  records[2] = replaceAchField(records[2], 78, '1');
  records.splice(3, 0, nocAddenda(code, correctedData));
  return records.join('\n');
}

suite('ACH Adversarial Audit Regression Test Suite', () => {
  test('Fails closed for empty files, files without batches, and empty batches', () => {
    const emptyCodes = codes('');
    assert.ok(emptyCodes.has('ACH-STRUCTURE-MISSING-FILE-HEADER'));
    assert.ok(emptyCodes.has('ACH-STRUCTURE-MISSING-FILE-CONTROL'));
    assert.ok(emptyCodes.has('ACH-STRUCTURE-NO-BATCHES'));

    const records = standardAchRecords();
    const noBatchControl = replaceAchField(
      replaceAchField(replaceAchField(records[4], 1, '000000'), 13, '00000000'),
      21,
      '0000000000',
    );
    const noBatches = [records[0], noBatchControl, ...Array(8).fill('9'.repeat(94))].join('\n');
    assert.ok(codes(noBatches).has('ACH-STRUCTURE-NO-BATCHES'));

    const emptyBatch = [records[0], records[1], records[3], records[4], ...Array(6).fill('9'.repeat(94))].join('\n');
    assert.ok(codes(emptyBatch).has('ACH-STRUCTURE-EMPTY-BATCH'));
  });

  test('Treats unknown SECs, SEC incompatibilities, and internal blank records as errors', () => {
    const records = standardAchRecords();
    records[1] = replaceAchField(records[1], 50, 'ZZZ');
    const unknown = parseAch(records.join('\n')).find(item => item.code === 'ACH-SEC-UNKNOWN-CODE');
    assert.strictEqual(unknown?.severity, 0);

    const incompatibleRecords = standardAchRecords();
    incompatibleRecords[2] = replaceAchField(incompatibleRecords[2], 1, '42');
    const incompatible = parseAch(incompatibleRecords.join('\n')).find(item => item.code === 'ACH-SEC-TRANSACTION-CODE');
    assert.strictEqual(incompatible?.severity, 0);

    const lines = standardAchFile().split('\n');
    lines.splice(3, 0, '');
    const blank = parseAch(lines.join('\n')).find(item => item.code === 'ACH-PHYSICAL-BLANK-LINE');
    assert.strictEqual(blank?.severity, 0);
  });

  test('Requires foundational header fields and validates destination routing and settlement date', () => {
    const records = standardAchRecords();
    records[0] = replaceAchField(records[0], 3, ' INVALID!!');
    records[1] = replaceAchField(records[1], 4, ' '.repeat(16));
    records[1] = replaceAchField(records[1], 53, ' '.repeat(10));
    records[1] = replaceAchField(records[1], 75, 'XYZ');
    const result = codes(records.join('\n'));
    assert.ok(result.has('ACH-FIELD-IMMEDIATE-DESTINATION'));
    assert.ok(result.has('ACH-FIELD-COMPANY-NAME-REQUIRED'));
    assert.ok(result.has('ACH-FIELD-COMPANY-ENTRY-DESCRIPTION-REQUIRED'));
    assert.ok(result.has('ACH-FIELD-SETTLEMENT-DATE'));
  });

  test('Rejects duplicate and descending traces and mixed forward/return batches', () => {
    const duplicate = standardAchRecords();
    duplicate.splice(3, 0, duplicate[2]);
    const duplicateCodes = codes(duplicate.join('\n'));
    assert.ok(duplicateCodes.has('ACH-RELATION-TRACE-DUPLICATE'));
    assert.ok(duplicateCodes.has('ACH-RELATION-TRACE-ORDER'));

    const mixed = standardAchRecords();
    mixed[2] = replaceAchField(mixed[2], 78, '0');
    const returnedEntry = replaceAchField(replaceAchField(mixed[2], 1, '21'), 78, '1');
    mixed.splice(3, 0, returnedEntry, returnAddenda('R01'));
    assert.ok(codes(mixed.join('\n')).has('ACH-STRUCTURE-MIXED-FORWARD-RETURN-BATCH'));
  });

  test('Uses transaction direction even for zero-dollar prenotes and restricts loan debits to reversals', () => {
    const prenote = standardAchRecords();
    prenote[2] = replaceAchField(prenote[2], 1, '28');
    prenote[2] = replaceAchField(prenote[2], 29, '0000000000');
    assert.ok(codes(prenote.join('\n')).has('ACH-SEC-SERVICE-CLASS-DIRECTION'));

    const loan = standardAchRecords();
    loan[1] = replaceAchField(loan[1], 50, 'CCD');
    loan[2] = replaceAchField(loan[2], 1, '55');
    assert.ok(codes(loan.join('\n')).has('ACH-SEC-LOAN-DEBIT-REVERSAL-ONLY'));
  });

  test('Pins current Return/NOC code tables and rejects future R90', () => {
    const records = standardAchRecords();
    records[2] = replaceAchField(records[2], 1, '21');
    records[2] = replaceAchField(records[2], 78, '1');
    records.splice(3, 0, returnAddenda('R90'));
    const diagnostic = parseAch(records.join('\n')).find(item => item.code === 'ACH-RETURN-REASON-CODE');
    assert.ok(diagnostic?.message.includes('2028-03-17'));
  });

  test('Enforces deterministic SEC restrictions for specialized Return Reason Codes', () => {
    for (const [reason, allowedSec, rejectedSec] of [
      ['R05', 'CCD', 'PPD'],
      ['R21', 'CIE', 'PPD'],
      ['R29', 'CTX', 'PPD'],
      ['R33', 'XCK', 'PPD'],
      ['R37', 'ARC', 'PPD'],
      ['R40', 'ENR', 'PPD'],
      ['R50', 'RCK', 'PPD'],
      ['R61', 'PPD', 'IAT'],
      ['R80', 'IAT', 'PPD'],
    ]) {
      const build = (sec: string): string => {
        const records = standardAchRecords();
        records[1] = replaceAchField(records[1], 50, sec);
        records[2] = replaceAchField(records[2], 1, '21');
        records[2] = replaceAchField(records[2], 78, '1');
        records.splice(3, 0, returnAddenda(reason));
        return records.join('\n');
      };
      assert.strictEqual(codes(build(allowedSec)).has('ACH-RETURN-REASON-CODE-SEC'), false, `${reason} should allow ${allowedSec}`);
      assert.ok(codes(build(rejectedSec)).has('ACH-RETURN-REASON-CODE-SEC'), `${reason} should reject ${rejectedSec}`);
    }
  });

  test('Validates the fixed positions for every current NOC corrected-data code', () => {
    const validCases: Array<[string, string, string?]> = [
      ['C01', 'ACCOUNT-123'],
      ['C02', '031300012'],
      ['C03', `031300012   ${'ACCOUNT-123'.padEnd(17)}`],
      ['C04', 'RECEIVER NAME'],
      ['C05', '22'],
      ['C06', `${'ACCOUNT-123'.padEnd(17)}   22`],
      ['C07', `031300012${'ACCOUNT-123'.padEnd(17)}22`],
      ['C08', 'BARCGB22XXX', 'IAT'],
      ['C09', 'RECEIVER-ID'],
      ['C13', ''],
      ['C14', 'IAT', 'IAT'],
    ];
    for (const [code, correctedData, sec] of validCases) {
      const result = codes(nocFile(code, correctedData, sec));
      assert.strictEqual(result.has('ACH-NOC-CORRECTED-DATA-FORMAT'), false, `${code} should use its published layout`);
      assert.strictEqual(result.has('ACH-NOC-CORRECTED-DATA-REQUIRED'), false, `${code} should meet its presence rule`);
    }

    for (const [code, correctedData, sec] of [
      ['C03', `031300012${'ACCOUNT-123'.padEnd(20)}`],
      ['C06', `${'ACCOUNT-123'.padEnd(17)}22`],
      ['C07', `031300012${'ACCOUNT-123'.padEnd(17)}22X`],
      ['C08', 'X'.repeat(35), 'IAT'],
      ['C09', 'X'.repeat(23)],
      ['C13', 'NOT BLANK'],
      ['C14', 'CCD', 'IAT'],
    ] as Array<[string, string, string?]>) {
      assert.ok(codes(nocFile(code, correctedData, sec)).has('ACH-NOC-CORRECTED-DATA-FORMAT'), `${code} invalid placement should fail`);
    }
  });

  test('Applies corrected COR, DNE, IAT, ADV, TRC, and XCK compatibility tables', () => {
    for (const code of ['31', '36']) {
      assert.strictEqual(transactionCodeCompatibility(transactionCodes.get(code)!, 'COR'), undefined);
    }
    assert.ok(transactionCodeCompatibility(transactionCodes.get('41')!, 'DNE'));
    assert.ok(transactionCodeCompatibility(transactionCodes.get('44')!, 'IAT'));
    assert.strictEqual(maximumAddendaForSec('ADV'), 0);
    assert.strictEqual(transactionCodeCompatibility(transactionCodes.get('27')!, 'TRC'), undefined);
    assert.strictEqual(transactionCodeCompatibility(transactionCodes.get('27')!, 'XCK'), undefined);
  });

  test('Requires a recognized WEB payment type instead of accepting a blank or private value', () => {
    for (const paymentType of ['  ', 'ZZ']) {
      const records = standardAchRecords();
      records[1] = replaceAchField(records[1], 50, 'WEB');
      records[2] = replaceAchField(records[2], 76, paymentType);
      assert.ok(codes(records.join('\n')).has('ACH-WEB-PAYMENT-TYPE'));
    }
  });

  test('Validates IAT indicators, exchange/country/currency data, account, OFAC, and reserved fields', () => {
    const records = standardAchRecords();
    records[1] = makeAchRecord('5', [
      [1, '220'], [4, 'IAT'], [20, 'XX'], [22, '9'], [23, 'REFERENCE'], [38, 'ZZ'],
      [40, '1234567890'], [50, 'IAT'], [53, 'PAYMENT'], [63, 'ZZZ'], [66, 'QQQ'],
      [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]);
    records[2] = makeAchRecord('6', [
      [1, '22'], [3, '06100010'], [11, '4'], [12, '0000'], [16, 'NOT RESERVED'],
      [29, '0000001234'], [74, 'X'], [76, 'XX'], [78, '1'], [79, '061000100000001'],
    ]);
    const result = codes(records.join('\n'));
    for (const expected of [
      'ACH-IAT-INDICATOR', 'ACH-IAT-FOREIGN-EXCHANGE-INDICATOR',
      'ACH-IAT-FOREIGN-EXCHANGE-REFERENCE-INDICATOR', 'ACH-IAT-DESTINATION-COUNTRY',
      'ACH-IAT-ORIGINATING-CURRENCY', 'ACH-IAT-DESTINATION-CURRENCY',
      'ACH-IAT-ACCOUNT-REQUIRED', 'ACH-IAT-OFAC-INDICATOR', 'ACH-IAT-ENTRY-RESERVED',
    ]) { assert.ok(result.has(expected), `Expected ${expected}`); }
  });

  test('Accepts status 2, reserves status 0 for ADV, and does not auto-fix status values', () => {
    const federal = standardAchRecords();
    federal[1] = replaceAchField(federal[1], 78, '2');
    assert.strictEqual(codes(federal.join('\n')).has('ACH-FIELD-ORIGINATOR-STATUS'), false);

    const operator = standardAchRecords();
    operator[1] = replaceAchField(operator[1], 78, '0');
    const text = operator.join('\n');
    assert.ok(codes(text).has('ACH-SEC-ORIGINATOR-STATUS'));
    const document = parseAchDocument(text);
    assert.strictEqual(collectAchFixEdits(document, parseAch(document)).some(edit => edit.startLine === 1 && edit.startCharacter === 78), false);
  });

  test('Never propagates invalid header relationship values into controls', () => {
    const records = standardAchRecords();
    records[1] = replaceAchField(records[1], 1, '999');
    records[1] = replaceAchField(records[1], 79, 'ABCDEFGH');
    const text = records.join('\n');
    const document = parseAchDocument(text);
    const edits = collectAchFixEdits(document, parseAch(document), 'derived');
    assert.strictEqual(edits.some(edit => edit.startLine === 3 && edit.startCharacter === 1), false);
    assert.strictEqual(edits.some(edit => edit.startLine === 3 && edit.startCharacter === 79), false);

    const advServiceInPaymentBatch = standardAchRecords();
    advServiceInPaymentBatch[1] = replaceAchField(advServiceInPaymentBatch[1], 1, '280');
    const serviceText = advServiceInPaymentBatch.join('\n');
    const serviceEdits = collectAchFixEdits(parseAchDocument(serviceText), parseAch(serviceText), 'derived');
    assert.strictEqual(serviceEdits.some(edit => edit.startLine === 3 && edit.startCharacter === 1), false);

    const invalidTraceSource = standardAchRecords();
    invalidTraceSource[2] = replaceAchField(invalidTraceSource[2], 1, '21');
    invalidTraceSource[2] = replaceAchField(invalidTraceSource[2], 78, '1');
    invalidTraceSource[2] = replaceAchField(invalidTraceSource[2], 79, '999999990000001');
    invalidTraceSource.splice(3, 0, returnAddenda('R01'));
    const traceText = invalidTraceSource.join('\n');
    const traceEdits = collectAchFixEdits(parseAchDocument(traceText), parseAch(traceText), 'derived');
    assert.strictEqual(traceEdits.some(edit => edit.diagnosticCode === 'ACH-RELATION-ADDENDA-TRACE'), false);
  });

  test('Composes short File Control padding and block padding fixes without dropping either edit', () => {
    const text = standardAchRecords().slice(0, 5).map((record, index) => index === 4 ? record.substring(0, 90) : record).join('\n');
    const document = parseAchDocument(text);
    const fixed = applyAchTextEdits(text, collectAchFixEdits(document, parseAch(document)));
    const lines = fixed.split('\n');
    assert.strictEqual(lines[4].length, 94);
    assert.strictEqual(lines.filter(line => /^9{94}$/.test(line)).length, 5);
    assert.strictEqual(parseAch(fixed).some(diagnostic => diagnostic.category === 'physical'), false);
  });

  test('Uses UTF-16 ranges and exclusive report end columns', () => {
    const records = standardAchRecords();
    records[0] = records[0].substring(0, 40) + '😀' + records[0].substring(41);
    const unicode = parseAch(records.join('\n')).find(item => item.code === 'ACH-PHYSICAL-CHARACTER-SET');
    assert.strictEqual(unicode?.start, 40);
    assert.strictEqual(unicode?.end, 42);

    const document = parseAchDocument(standardAchFile());
    const synthetic: AchDiagnostic = {
      line: 2, start: 12, end: 13, message: 'one character', severity: 0,
      code: 'ACH-TEST-COLUMN', category: 'field', profile: nachaValidationProfile.id,
      rulesVersion: nachaValidationProfile.rulesVersion,
    };
    const input = { fileName: 'sample.ach', document, diagnostics: [synthetic], summary: parseAchSummary(document), profile: nachaValidationProfile };
    const json = createAchJsonReport(input);
    const sarif = createAchSarifReport(input);
    assert.strictEqual(json.diagnostics[0].location.startColumn, 13);
    assert.strictEqual(json.diagnostics[0].location.endColumn, 14);
    assert.strictEqual(sarif.runs[0].results[0].locations[0].physicalLocation.region.endColumn, 14);
    assert.strictEqual(sarif.runs[0].properties.complianceCertified, false);
    assert.ok(sarif.runs[0].properties.externalRequirements.length > 0);
    assert.strictEqual(json.result.complianceCertified, false);
    assert.ok(json.scope.externalRequirements.length > 0);
  });

  test('Clamps related-information ranges to truncated source records', () => {
    const records = standardAchRecords();
    records[1] = records[1].substring(0, 42);
    records[3] = replaceAchField(records[3], 44, '9999999999');
    const diagnostic = parseAch(records.join('\n')).find(item => item.code === 'ACH-RELATION-COMPANY-ID');
    assert.ok(diagnostic?.related?.length);
    assert.ok(diagnostic.related[0].start <= records[1].length);
    assert.ok(diagnostic.related[0].end <= records[1].length);
  });

  test('Rejects unknown CLI profiles instead of silently falling back', async () => {
    const errors: string[] = [];
    const exit = await runCli(['--profile', 'ncha', 'sample.ach'], {
      readFile: () => standardAchFile(), write: () => undefined, writeError: value => errors.push(value),
    });
    assert.strictEqual(exit, 2);
    assert.ok(errors.join('').includes("Unknown --profile value 'ncha'"));
  });
});
