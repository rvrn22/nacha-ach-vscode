export type AchFieldValue = readonly [start: number, value: string];

export function makeAchRecord(type: string, fields: readonly AchFieldValue[] = []): string {
  const characters = Array(94).fill(' ');
  characters[0] = type;
  for (const [start, value] of fields) {
    for (let offset = 0; offset < value.length; offset++) {
      characters[start + offset] = value[offset];
    }
  }
  return characters.join('');
}

export function replaceAchField(record: string, start: number, value: string): string {
  return record.substring(0, start) + value + record.substring(start + value.length);
}

export function standardAchRecords(): string[] {
  const amount = '0000001234';
  const records = [
    makeAchRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeAchRecord('5', [
      [1, '220'], [4, 'FIXTURE COMPANY'], [40, '1234567890'], [50, 'PPD'],
      [53, 'PAYMENT'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeAchRecord('6', [
      [1, '22'], [3, '06100010'], [11, '4'], [12, 'RECEIVER-ACCOUNT'],
      [29, amount], [39, 'ENTRY-REFERENCE'], [54, 'RECEIVER NAME'],
      [78, '0'], [79, '061000100000001'],
    ]),
    makeAchRecord('8', [
      [1, '220'], [4, '000001'], [10, '0006100010'], [20, '000000000000'],
      [32, '000000001234'], [44, '1234567890'], [79, '06100010'], [87, '0000001'],
    ]),
    makeAchRecord('9', [
      [1, '000001'], [7, '000001'], [13, '00000001'], [21, '0006100010'],
      [31, '000000000000'], [43, '000000001234'],
    ]),
  ];
  return [...records, ...Array(5).fill('9'.repeat(94))];
}

export function standardAchFile(lineEnding = '\n'): string {
  return standardAchRecords().join(lineEnding);
}
