import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseAchDocument } from '../achDocument';
import {
  AchDocumentSymbolProvider,
  AchFoldingRangeProvider,
  AchInlayHintsProvider,
  findMatchingAchRange,
  findRelatedAchRanges,
} from '../achNavigation';

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

function navigationDocument() {
  const header = makeRecord('1');
  const batch = makeRecord('5', [[1, '200'], [4, 'COMPANY'], [40, '1234567890'], [50, 'CTX'], [79, '06100010'], [87, '0000001']]);
  const entry = makeRecord('6', [[1, '22'], [78, '1'], [79, '061000100000001']]);
  const addenda1 = makeRecord('7', [[1, '05'], [83, '0001'], [87, '0000001']]);
  const addenda2 = makeRecord('7', [[1, '05'], [83, '0002'], [87, '0000001']]);
  const batchControl = makeRecord('8', [[1, '200'], [44, '1234567890'], [79, '06100010'], [87, '0000001']]);
  const fileControl = makeRecord('9');
  const padding1 = '9'.repeat(94);
  const padding2 = '9'.repeat(94);
  return parseAchDocument([header, batch, entry, addenda1, addenda2, batchControl, fileControl, padding1, padding2].join('\n'));
}

suite('ACH Navigation and Reading Aids Test Suite', () => {
  test('Builds symbols for file, batch, entry, and addenda breadcrumbs', () => {
    const model = navigationDocument();
    const provider = new AchDocumentSymbolProvider(() => model);
    const symbols = provider.provideDocumentSymbols({} as vscode.TextDocument);
    const file = symbols[0];
    const batch = file.children.find(symbol => symbol.name === 'Batch 0000001');
    const entry = batch?.children.find(symbol => symbol.name === 'Entry 0000001');

    assert.strictEqual(file.name, 'ACH File');
    assert.ok(batch);
    assert.ok(entry);
    assert.strictEqual(entry.children.filter(symbol => symbol.name.startsWith('Addenda')).length, 2);
  });

  test('Provides folding ranges for batches, entries, and padding', () => {
    const model = navigationDocument();
    const provider = new AchFoldingRangeProvider(() => model);
    const ranges = provider.provideFoldingRanges({} as vscode.TextDocument);

    assert.ok(ranges.some(range => range.start === 1 && range.end === 5));
    assert.ok(ranges.some(range => range.start === 2 && range.end === 4));
    assert.ok(ranges.some(range => range.start === 7 && range.end === 8));
  });

  test('Navigates between matching headers, controls, entries, and addenda', () => {
    const model = navigationDocument();

    assert.strictEqual(findMatchingAchRange(model, 0)?.line, 6);
    assert.strictEqual(findMatchingAchRange(model, 1)?.line, 5);
    assert.strictEqual(findMatchingAchRange(model, 5)?.line, 1);
    assert.strictEqual(findMatchingAchRange(model, 2)?.line, 3);
    assert.strictEqual(findMatchingAchRange(model, 4)?.line, 2);
    assert.strictEqual(findMatchingAchRange(model, 6)?.line, 0);
  });

  test('Finds related header/control, aggregate, and trace fields', () => {
    const model = navigationDocument();
    const companyRanges = findRelatedAchRanges(model, 1, 45);
    const batchHashRanges = findRelatedAchRanges(model, 5, 12);
    const fileHashRanges = findRelatedAchRanges(model, 6, 22);
    const traceRanges = findRelatedAchRanges(model, 2, 80);
    const indicatorRanges = findRelatedAchRanges(model, 2, 78);

    assert.ok(companyRanges.some(range => range.line === 5 && range.start === 44 && range.end === 54));
    assert.ok(batchHashRanges.some(range => range.line === 6 && range.start === 21 && range.end === 31));
    assert.ok(fileHashRanges.some(range => range.line === 5 && range.start === 10 && range.end === 20));
    assert.ok(traceRanges.some(range => range.line === 3 && range.start === 87 && range.end === 94));
    assert.ok(traceRanges.some(range => range.line === 4 && range.start === 87 && range.end === 94));
    assert.ok(indicatorRanges.some(range => range.line === 3 && range.start === 0 && range.end === 3));
  });

  test('Provides optional field-name inlay hints', () => {
    const model = navigationDocument();
    const provider = new AchInlayHintsProvider(() => model, () => true);
    const hints = provider.provideInlayHints(
      {} as vscode.TextDocument,
      new vscode.Range(1, 0, 2, 94),
    );

    assert.ok(hints.some(hint => hint.label === 'Service Class Code:'));
    assert.ok(hints.some(hint => hint.label === 'Transaction Code:'));
  });
});
