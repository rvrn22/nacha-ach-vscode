import * as assert from 'assert';
import { getAchFieldAtPosition, parseAchDocument } from '../achDocument';

function record(type: string, fields: Array<[number, string]> = []): string {
  const characters = Array(94).fill(' ');
  characters[0] = type;
  for (const [start, value] of fields) {
    for (let offset = 0; offset < value.length; offset++) {
      characters[start + offset] = value[offset];
    }
  }
  return characters.join('');
}

suite('ACH Document Model Test Suite', () => {
  test('Builds file, batch, entry, and addenda hierarchy', () => {
    const fileHeader = record('1');
    const batchHeader = record('5', [[50, 'PPD']]);
    const firstEntry = record('6', [[1, '22'], [29, '0000001234']]);
    const addenda = record('7', [[1, '05']]);
    const secondEntry = record('6', [[1, '27'], [29, '0000000500']]);
    const batchControl = record('8');
    const fileControl = record('9');
    const padding = '9'.repeat(94);

    const document = parseAchDocument([
      fileHeader,
      batchHeader,
      firstEntry,
      addenda,
      secondEntry,
      batchControl,
      fileControl,
      padding,
    ].join('\n'));

    assert.strictEqual(document.fileHeaders.length, 1);
    assert.strictEqual(document.batches.length, 1);
    assert.strictEqual(document.batches[0].secCode, 'PPD');
    assert.strictEqual(document.batches[0].entries.length, 2);
    assert.strictEqual(document.batches[0].entries[0].addenda.length, 1);
    assert.strictEqual(document.batches[0].entries[1].addenda.length, 0);
    assert.strictEqual(document.batches[0].control?.line, 5);
    assert.strictEqual(document.fileControls.length, 1);
    assert.strictEqual(document.paddingRecords.length, 1);

    const amountField = getAchFieldAtPosition(document.batches[0].entries[0].detail, 30);
    assert.strictEqual(amountField?.name, 'Amount');
    assert.strictEqual(amountField?.rawValue, '0000001234');
    assert.strictEqual(amountField?.range.line, 2);
  });

  test('Preserves malformed and orphaned records', () => {
    const orphanEntry = record('6');
    const unknown = record('X');
    const document = parseAchDocument([orphanEntry, '', unknown].join('\n'));

    assert.strictEqual(document.lines.length, 3);
    assert.strictEqual(document.records.length, 2);
    assert.strictEqual(document.orphanRecords.length, 2);
    assert.strictEqual(document.orphanRecords[0].kind, 'entryDetail');
    assert.strictEqual(document.orphanRecords[1].kind, 'unknown');
    assert.strictEqual(document.recordByLine.get(1), undefined);
  });

  test('Applies IAT field definitions using batch context', () => {
    const batchHeader = record('5', [[4, 'IAT'], [50, 'IAT']]);
    const entry = record('6', [[15, '07']]);
    const addenda = record('7', [[1, '10']]);
    const document = parseAchDocument([batchHeader, entry, addenda].join('\n'));

    const batch = document.batches[0];
    assert.strictEqual(batch.entries[0].detail.secCode, 'IAT');
    assert.ok(batch.entries[0].detail.fields.some(field => field.name === 'Number of Addenda Records'));
    assert.ok(batch.entries[0].addenda[0].fields.some(field => field.name === 'Foreign Payment Amount'));
  });

  test('Keeps multiple batches and their SEC contexts separate', () => {
    const firstBatchHeader = record('5', [[50, 'PPD']]);
    const firstEntry = record('6');
    const firstControl = record('8');
    const secondBatchHeader = record('5', [[50, 'CCD']]);
    const secondEntry = record('6');
    const secondControl = record('8');
    const document = parseAchDocument([
      firstBatchHeader,
      firstEntry,
      firstControl,
      secondBatchHeader,
      secondEntry,
      secondControl,
    ].join('\n'));

    assert.strictEqual(document.batches.length, 2);
    assert.strictEqual(document.batches[0].secCode, 'PPD');
    assert.strictEqual(document.batches[0].entries[0].detail.secCode, 'PPD');
    assert.strictEqual(document.batches[1].secCode, 'CCD');
    assert.strictEqual(document.batches[1].entries[0].detail.secCode, 'CCD');
    assert.strictEqual(document.batches[0].records.length, 3);
    assert.strictEqual(document.batches[1].records.length, 3);
  });
});
