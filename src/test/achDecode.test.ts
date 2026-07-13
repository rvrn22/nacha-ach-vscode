import * as assert from 'assert';
import * as vscode from 'vscode';
import { decodeAchField, maskAchValue } from '../achDecode';
import { parseAchDocument, type AchField, type AchRecord } from '../achDocument';
import { AchExplorerProvider } from '../achExplorer';
import { parseAchSummary } from '../nachaParser';

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

function field(record: AchRecord, name: string): AchField {
  const result = record.fields.find(candidate => candidate.name === name);
  assert.ok(result, `Expected field '${name}'`);
  return result;
}

function sampleDocument() {
  const header = makeRecord('1', [[23, '260713'], [29, '0935']]);
  const batch = makeRecord('5', [[1, '220'], [40, '1234567890'], [50, 'PPD'], [79, '06100010'], [87, '0000001']]);
  const entry = makeRecord('6', [
    [1, '22'], [3, '06100010'], [11, '4'], [12, '123456789'], [29, '0000001234'],
    [54, 'RECEIVER'], [78, '0'], [79, '061000100000001'],
  ]);
  const control = makeRecord('8');
  const fileControl = makeRecord('9');
  return parseAchDocument([header, batch, entry, control, fileControl].join('\n'));
}

suite('ACH Decoding and Explorer Test Suite', () => {
  test('Decodes transaction codes, amounts, dates, times, and SEC values', () => {
    const document = sampleDocument();
    const header = document.fileHeaders[0];
    const batch = document.batches[0].header;
    const entry = document.batches[0].entries[0].detail;

    assert.strictEqual(decodeAchField(entry, field(entry, 'Transaction Code')).display, '22 — Checking credit');
    assert.strictEqual(decodeAchField(entry, field(entry, 'Receiving DFI Identification')).display, '061000104 — routing number');
    assert.strictEqual(decodeAchField(entry, field(entry, 'Amount')).display, '$12.34');
    assert.strictEqual(decodeAchField(header, field(header, 'File Creation Date')).display, '2026-07-13');
    assert.strictEqual(decodeAchField(header, field(header, 'File Creation Time')).display, '09:35');
    assert.strictEqual(decodeAchField(batch, field(batch, 'Service Class Code')).display, '220 — Credits only');
    assert.strictEqual(decodeAchField(batch, field(batch, 'Standard Entry Class')).display, 'PPD — Prearranged Payment and Deposit');
  });

  test('Masks sensitive values by default without leaking short values', () => {
    const entry = sampleDocument().batches[0].entries[0].detail;
    const account = field(entry, 'DFI Account Number');
    const masked = decodeAchField(entry, account);
    const visible = decodeAchField(entry, account, false);

    assert.strictEqual(masked.masked, true);
    assert.ok(masked.display.endsWith('6789'));
    assert.strictEqual(masked.display.includes('12345'), false);
    assert.strictEqual(visible.display, '123456789');
    assert.strictEqual(maskAchValue('1234').includes('1234'), false);
  });

  test('Builds navigable file, batch, entry, record, and field nodes', () => {
    const document = sampleDocument();
    const provider = new AchExplorerProvider();
    provider.update(
      vscode.Uri.file('/tmp/sample.ach'),
      document,
      [],
      parseAchSummary(document),
      true,
    );

    const root = provider.getChildren()[0];
    const batch = root.children.find(node => node.kind === 'batch');
    const entry = batch?.children.find(node => node.kind === 'entry');
    const fieldNode = provider.nodeAt(2, 30);

    assert.ok(root);
    assert.ok(batch);
    assert.ok(entry);
    assert.strictEqual(fieldNode?.kind, 'field');
    assert.strictEqual(fieldNode?.label, 'Amount');
    assert.strictEqual(fieldNode?.description, '0000001234 → $12.34');
    assert.strictEqual(fieldNode?.start, 29);
    assert.strictEqual(fieldNode?.end, 39);
  });
});
