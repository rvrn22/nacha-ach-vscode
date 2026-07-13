import * as assert from 'assert';
import { parseAch } from '../nachaParser';
import { replaceAchField, standardAchRecords } from './fixtures/achFixtures';

type Mutation = {
  name: string;
  line: number;
  start: number;
  value: string;
  expectedCode: string;
};

function diagnosticsFor(mutation: Mutation) {
  const records = standardAchRecords();
  records[mutation.line] = replaceAchField(records[mutation.line], mutation.start, mutation.value);
  return parseAch(records.join('\n'));
}

suite('ACH Property-Style Mutation Test Suite', () => {
  test('Detects deterministic mutations of every derived count, hash, and total', () => {
    const mutations: Mutation[] = [
      { name: 'batch count', line: 3, start: 4, value: '000002', expectedCode: 'ACH-RELATION-BATCH-ENTRY-COUNT' },
      { name: 'batch hash', line: 3, start: 10, value: '0006100011', expectedCode: 'ACH-RELATION-BATCH-HASH' },
      { name: 'batch debit', line: 3, start: 20, value: '000000000001', expectedCode: 'ACH-RELATION-BATCH-DEBIT' },
      { name: 'batch credit', line: 3, start: 32, value: '000000001235', expectedCode: 'ACH-RELATION-BATCH-CREDIT' },
      { name: 'file batch count', line: 4, start: 1, value: '000002', expectedCode: 'ACH-RELATION-FILE-BATCH-COUNT' },
      { name: 'file block count', line: 4, start: 7, value: '000002', expectedCode: 'ACH-RELATION-FILE-BLOCK-COUNT' },
      { name: 'file entry count', line: 4, start: 13, value: '00000002', expectedCode: 'ACH-RELATION-FILE-ENTRY-COUNT' },
      { name: 'file hash', line: 4, start: 21, value: '0006100011', expectedCode: 'ACH-RELATION-FILE-HASH' },
      { name: 'file debit', line: 4, start: 31, value: '000000000001', expectedCode: 'ACH-RELATION-FILE-DEBIT' },
      { name: 'file credit', line: 4, start: 43, value: '000000001235', expectedCode: 'ACH-RELATION-FILE-CREDIT' },
    ];

    for (const mutation of mutations) {
      assert.ok(
        diagnosticsFor(mutation).some(diagnostic => diagnostic.code === mutation.expectedCode),
        `${mutation.name} mutation should produce ${mutation.expectedCode}`,
      );
    }
  });

  test('Detects each incorrect routing check digit mutation', () => {
    for (const checkDigit of '012356789') {
      const mutation: Mutation = {
        name: `routing check digit ${checkDigit}`,
        line: 2,
        start: 11,
        value: checkDigit,
        expectedCode: 'ACH-FIELD-ROUTING-CHECK-DIGIT',
      };
      assert.ok(diagnosticsFor(mutation).some(diagnostic => diagnostic.code === mutation.expectedCode));
    }
  });

  test('Detects invalid record-order permutations without discarding source records', () => {
    const permutations = [
      [0, 2, 1, 3, 4],
      [0, 1, 3, 2, 4],
      [0, 1, 2, 4, 3],
    ];

    for (const order of permutations) {
      const records = standardAchRecords();
      const reordered = [...order.map(index => records[index]), ...records.slice(5)];
      const diagnostics = parseAch(reordered.join('\n'));
      assert.ok(diagnostics.some(diagnostic => diagnostic.category === 'structural'));
    }
  });
});
