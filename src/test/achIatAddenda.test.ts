import * as assert from 'assert';
import { parseAchDocument } from '../achDocument';
import { parseAch } from '../nachaParser';

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

function addenda(type: string, typeSequence: number, entrySequence = '0000001'): string {
  const fieldsByType: Record<string, FieldValue[]> = {
    '10': [[1, '10'], [3, 'BUS'], [6, '000000000000005000'], [24, 'FOREIGN-TRACE'], [46, 'FOREIGN RECEIVER'], [87, entrySequence]],
    '11': [[1, '11'], [3, 'ORIGINATOR NAME'], [38, '123 MAIN STREET'], [87, entrySequence]],
    '12': [[1, '12'], [3, 'ATLANTA*GA\\'], [38, 'US*30303\\'], [87, entrySequence]],
    '13': [[1, '13'], [3, 'ORIGINATING BANK'], [38, '01'], [40, '061000104'], [74, 'US '], [87, entrySequence]],
    '14': [[1, '14'], [3, 'RECEIVING BANK'], [38, '02'], [40, 'ABCDEFGH123'], [74, 'US '], [87, entrySequence]],
    '15': [[1, '15'], [3, 'RECEIVER-ID'], [18, '456 OAK AVENUE'], [87, entrySequence]],
    '16': [[1, '16'], [3, 'MEXICO CITY*CMX\\'], [38, 'MX*01000\\'], [87, entrySequence]],
    '17': [[1, '17'], [3, 'REMITTANCE INFORMATION'], [83, number(typeSequence, 4)], [87, entrySequence]],
    '18': [[1, '18'], [3, 'CORRESPONDENT BANK'], [38, '02'], [40, 'CORRESPONDENT-BIC'], [74, 'GB '], [83, number(typeSequence, 4)], [87, entrySequence]],
  };
  return makeRecord('7', fieldsByType[type]);
}

function iatFile(optionalTypes: string[] = ['17', '18']): string {
  const mandatory = ['10', '11', '12', '13', '14', '15', '16'];
  const typeCounts = new Map<string, number>();
  const addendaRecords = [...mandatory, ...optionalTypes].map(type => {
    const sequence = (typeCounts.get(type) ?? 0) + 1;
    typeCounts.set(type, sequence);
    return addenda(type, sequence);
  });
  const count = 1 + addendaRecords.length;
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, '220'], [20, 'FF'], [22, '3'], [38, 'US'], [40, '1234567890'],
      [50, 'IAT'], [53, 'PAYMENT'], [63, 'USD'], [66, 'USD'], [69, '260713'],
      [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', [
      [1, '22'], [3, '06100010'], [11, '4'], [12, number(addendaRecords.length, 4)],
      [29, '0000005000'], [39, 'FOREIGN-ACCOUNT'], [78, '1'], [79, '061000100000001'],
    ]),
    ...addendaRecords,
    makeRecord('8', [
      [1, '220'], [4, number(count, 6)], [10, '0006100010'], [20, '000000000000'],
      [32, '000000005000'], [44, '1234567890'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, number(Math.ceil((5 + addendaRecords.length) / 10), 6)],
      [13, number(count, 8)], [21, '0006100010'], [31, '000000000000'], [43, '000000005000'],
    ]),
  ];
  return [...records, ...Array((10 - (records.length % 10)) % 10).fill('9'.repeat(94))].join('\n');
}

function replaceField(record: string, start: number, value: string): string {
  return record.substring(0, start) + value + record.substring(start + value.length);
}

suite('ACH Complete IAT Addenda Test Suite', () => {
  test('Accepts mandatory and optional IAT addenda with authoritative layouts', () => {
    const document = parseAchDocument(iatFile());
    const records = document.batches[0].entries[0].addenda;
    const type10 = records.find(record => record.raw.substring(1, 3) === '10')!;
    const type17 = records.find(record => record.raw.substring(1, 3) === '17')!;
    const type18 = records.find(record => record.raw.substring(1, 3) === '18')!;

    assert.deepStrictEqual(parseAch(document), []);
    assert.strictEqual(type10.fields.find(field => field.name === 'Foreign Trace Number')?.range.end, 46);
    assert.strictEqual(type10.fields.find(field => field.name === 'Entry Detail Sequence Number')?.range.start, 87);
    assert.strictEqual(type17.fields.find(field => field.name === 'Payment Related Information')?.range.end, 83);
    assert.strictEqual(type18.fields.find(field => field.name === 'Foreign Correspondent Bank Identification')?.range.end, 74);
    assert.strictEqual(type18.fields.find(field => field.name === 'Addenda Sequence Number')?.range.start, 83);
  });

  test('Validates optional addenda maxima, ordering, and per-type sequences', () => {
    const threeRemittance = parseAch(iatFile(['17', '17', '17']));
    const sixCorrespondents = parseAch(iatFile(['18', '18', '18', '18', '18', '18']));
    const sixOptional = parseAch(iatFile(['17', '17', '18', '18', '18', '18']));
    const wrongOrder = parseAch(iatFile(['18', '17']));
    const lines = iatFile(['17', '17']).split('\n');
    lines[11] = replaceField(lines[11], 83, '0009');
    const wrongSequence = parseAch(lines.join('\n'));

    assert.ok(threeRemittance.some(item => item.code === 'ACH-IAT-REMITTANCE-MAXIMUM'));
    assert.ok(sixCorrespondents.some(item => item.code === 'ACH-IAT-CORRESPONDENT-MAXIMUM'));
    assert.ok(sixOptional.some(item => item.code === 'ACH-IAT-OPTIONAL-ADDENDA-MAXIMUM'));
    assert.ok(wrongOrder.some(item => item.code === 'ACH-IAT-OPTIONAL-ADDENDA-ORDER'));
    assert.ok(wrongSequence.some(item => item.code === 'ACH-IAT-ADDENDA-SEQUENCE'));
  });

  test('Validates mandatory bank fields, qualifiers, country codes, and reserved columns', () => {
    const lines = iatFile().split('\n');
    const type18Line = 11;
    lines[type18Line] = replaceField(lines[type18Line], 3, ' '.repeat(35));
    lines[type18Line] = replaceField(lines[type18Line], 38, '99');
    lines[type18Line] = replaceField(lines[type18Line], 74, 'gbx');
    lines[type18Line] = replaceField(lines[type18Line], 77, 'X');
    const codes = new Set(parseAch(lines.join('\n')).map(item => item.code));

    assert.ok(codes.has('ACH-IAT-MANDATORY-FIELD'));
    assert.ok(codes.has('ACH-IAT-DFI-QUALIFIER'));
    assert.ok(codes.has('ACH-IAT-BRANCH-COUNTRY'));
    assert.ok(codes.has('ACH-IAT-RESERVED'));
  });

  test('Validates first-addenda fields and every IAT entry-detail sequence link', () => {
    const lines = iatFile().split('\n');
    lines[3] = replaceField(lines[3], 3, 'b*s');
    lines[3] = replaceField(lines[3], 6, 'NOT-NUMERIC-AMOUNT');
    lines[3] = replaceField(lines[3], 81, 'X');
    lines[10] = replaceField(lines[10], 87, '0000009');
    const codes = new Set(parseAch(lines.join('\n')).map(item => item.code));

    assert.ok(codes.has('ACH-IAT-TRANSACTION-TYPE'));
    assert.ok(codes.has('ACH-IAT-FOREIGN-AMOUNT'));
    assert.ok(codes.has('ACH-IAT-RESERVED'));
    assert.ok(codes.has('ACH-RELATION-ADDENDA-ENTRY-SEQUENCE'));
  });
});
