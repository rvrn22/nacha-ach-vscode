import * as assert from 'assert';
import { performance } from 'perf_hooks';
import { parseAchDocument } from '../achDocument';
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

function number(value: bigint | number, width: number): string {
  return value.toString().padStart(width, '0');
}

function largeValidFile(entryCount: number): string {
  const header = makeRecord('1', [
    [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260713'], [29, '1200'],
    [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
  ]);
  const batch = makeRecord('5', [
    [1, '220'], [4, 'PERFORMANCE'], [40, '1234567890'], [50, 'PPD'], [53, 'PAYMENT'], [69, '260713'],
    [78, '1'], [79, '06100010'], [87, '0000001'],
  ]);
  const entries = Array.from({ length: entryCount }, (_, index) => makeRecord('6', [
    [1, '22'], [3, '06100010'], [11, '4'], [12, `ACCOUNT${index}`], [29, '0000000001'],
    [54, 'RECEIVER'], [78, '0'], [79, `06100010${number(index + 1, 7)}`],
  ]));
  const hash = (6100010n * BigInt(entryCount)) % 10000000000n;
  const batchControl = makeRecord('8', [
    [1, '220'], [4, number(entryCount, 6)], [10, number(hash, 10)], [20, '000000000000'],
    [32, number(entryCount, 12)], [44, '1234567890'], [79, '06100010'], [87, '0000001'],
  ]);
  const nonPaddingCount = entryCount + 4;
  const blockCount = Math.ceil(nonPaddingCount / 10);
  const fileControl = makeRecord('9', [
    [1, '000001'], [7, number(blockCount, 6)], [13, number(entryCount, 8)], [21, number(hash, 10)],
    [31, '000000000000'], [43, number(entryCount, 12)],
  ]);
  const paddingCount = (10 - (nonPaddingCount % 10)) % 10;
  return [header, batch, ...entries, batchControl, fileControl, ...Array(paddingCount).fill('9'.repeat(94))].join('\n');
}

suite('ACH Large File Performance Test Suite', () => {
  test('Parses, validates, and summarizes 10,000 entries within the regression budget', () => {
    const text = largeValidFile(10000);
    const started = performance.now();
    const document = parseAchDocument(text);
    const diagnostics = parseAch(document);
    const summary = parseAchSummary(document);
    const elapsed = performance.now() - started;

    assert.strictEqual(summary.entries, 10000);
    assert.strictEqual(summary.totalCreditCents, 10000n);
    assert.deepStrictEqual(diagnostics, []);
    assert.ok(elapsed < 10000, `Large-file analysis took ${elapsed.toFixed(0)}ms`);
  });
});
