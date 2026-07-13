import * as assert from 'assert';
import { knownSecCodes } from '../achRules';

const secFixtureCoverage = {
  ACK: 'achAcknowledgments.test.ts',
  ADV: 'achAdv.test.ts',
  ARC: 'achSecEntryFields.test.ts',
  ATX: 'achAcknowledgments.test.ts',
  BOC: 'achSecEntryFields.test.ts',
  CCD: 'achSecEntryFields.test.ts',
  CIE: 'achSpecializedEntries.test.ts',
  COR: 'achReturns.test.ts',
  CTX: 'achSecEntryFields.test.ts',
  DNE: 'achSpecializedEntries.test.ts',
  ENR: 'achSpecializedEntries.test.ts',
  IAT: 'achIatAddenda.test.ts',
  MTE: 'achTerminalEntries.test.ts',
  POP: 'achSecEntryFields.test.ts',
  POS: 'achTerminalEntries.test.ts',
  PPD: 'achSecEntryFields.test.ts',
  RCK: 'achSecEntryFields.test.ts',
  SHR: 'achTerminalEntries.test.ts',
  TEL: 'achSecEntryFields.test.ts',
  TRX: 'achTrx.test.ts',
  WEB: 'achSecEntryFields.test.ts',
} as const;

suite('ACH Supported SEC Fixture Matrix', () => {
  test('Keeps valid and targeted-invalid fixture suites mapped for every supported SEC code', () => {
    assert.deepStrictEqual(
      Object.keys(secFixtureCoverage).sort(),
      [...knownSecCodes].sort(),
      'Add valid and targeted-invalid fixtures whenever the supported SEC table changes',
    );
    assert.ok(Object.values(secFixtureCoverage).every(suiteName => suiteName.endsWith('.test.ts')));
  });
});
