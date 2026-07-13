import * as assert from 'assert';
import { parseAch } from '../nachaParser';
import { replaceAchField, standardAchFile, standardAchRecords } from './fixtures/achFixtures';

function codes(text: string): Set<string> {
  return new Set(parseAch(text).map(diagnostic => diagnostic.code));
}

suite('ACH Physical Edge Case Test Suite', () => {
  test('Accepts equivalent LF and CRLF blocked files', () => {
    assert.deepStrictEqual(parseAch(standardAchFile('\n')), []);
    assert.deepStrictEqual(parseAch(standardAchFile('\r\n')), []);
  });

  test('Rejects tabs, non-ASCII characters, and internal blank records', () => {
    for (const invalid of ['\t', 'é']) {
      const records = standardAchRecords();
      records[0] = replaceAchField(records[0], 40, invalid);
      assert.ok(codes(records.join('\n')).has('ACH-PHYSICAL-CHARACTER-SET'));
    }

    const records = standardAchRecords();
    records.splice(2, 0, '');
    assert.ok(codes(records.join('\n')).has('ACH-PHYSICAL-BLANK-LINE'));
  });

  test('Reports short and long physical records at the record boundary', () => {
    const shortRecords = standardAchRecords();
    shortRecords[2] = shortRecords[2].substring(0, 90);
    const longRecords = standardAchRecords();
    longRecords[2] += 'EXTRA';

    for (const text of [shortRecords.join('\n'), longRecords.join('\n')]) {
      const length = parseAch(text).find(diagnostic => diagnostic.code === 'ACH-PHYSICAL-RECORD-LENGTH');
      assert.ok(length);
      assert.strictEqual(length.expected, '94');
    }
  });

  test('Validates padding count, placement, and records after padding', () => {
    const tooFew = standardAchRecords().slice(0, -1);
    const tooMany = [...standardAchRecords(), '9'.repeat(94)];
    assert.ok(codes(tooFew.join('\n')).has('ACH-PHYSICAL-PADDING-COUNT'));
    assert.ok(codes(tooFew.join('\n')).has('ACH-PHYSICAL-BLOCK-MULTIPLE'));
    assert.ok(codes(tooMany.join('\n')).has('ACH-PHYSICAL-PADDING-COUNT'));

    const misplaced = standardAchRecords();
    misplaced.splice(3, 0, misplaced.pop()!);
    const misplacedCodes = codes(misplaced.join('\n'));
    assert.ok(misplacedCodes.has('ACH-STRUCTURE-PADDING-PLACEMENT'));
    assert.ok(misplacedCodes.has('ACH-STRUCTURE-RECORD-AFTER-PADDING'));
  });
});
