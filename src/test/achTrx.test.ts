import * as assert from 'assert';
import { parseAchDocument } from '../achDocument';
import { fixForAchDiagnostic } from '../achFixes';
import { maximumAddendaForSec, transactionCodes } from '../achRules';
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

function number(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function trxFile(options: {
  transactionCode?: string;
  amount?: number;
  account?: string;
  addenda?: number;
  declaredAddenda?: string;
  receiver?: string;
  reserved?: string;
  itemType?: string;
  paymentInformation?: string;
  secondSequence?: string;
  secondEntrySequence?: string;
} = {}): string {
  const transactionCode = options.transactionCode ?? '27';
  const transaction = transactionCodes.get(transactionCode)!;
  const amount = options.amount ?? (transaction.kind === 'prenote' ? 0 : 123);
  const addendaCount = options.addenda ?? (transaction.kind === 'prenote' ? 0 : 2);
  const trace = '061000100000001';
  const entryAndAddendaCount = 1 + addendaCount;
  const debit = transaction.direction === 'debit' ? amount : 0;
  const credit = transaction.direction === 'credit' ? amount : 0;
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, transaction.direction === 'credit' ? '220' : '225'], [4, 'SAFEKEEPING CO'],
      [40, '1234567890'], [50, 'TRX'], [53, 'TRUNCATED'], [69, '260713'],
      [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', [
      [1, transactionCode], [3, '06100010'], [11, '4'], [12, options.account ?? '123456789'],
      [29, number(amount, 10)], [39, 'ITEM-REFERENCE'],
      [54, options.declaredAddenda ?? number(addendaCount, 4)],
      [58, options.receiver ?? 'RECEIVING CO'], [74, options.reserved ?? '  '],
      [76, options.itemType ?? 'CK'], [78, addendaCount > 0 ? '1' : '0'], [79, trace],
    ]),
  ];
  for (let index = 0; index < addendaCount; index++) {
    records.push(makeRecord('7', [
      [1, '05'],
      [3, options.paymentInformation ?? ''],
      [83, index === 1 && options.secondSequence ? options.secondSequence : number(index + 1, 4)],
      [87, index === 1 && options.secondEntrySequence ? options.secondEntrySequence : trace.substring(8)],
    ]));
  }
  records.push(
    makeRecord('8', [
      [1, transaction.direction === 'credit' ? '220' : '225'], [4, number(entryAndAddendaCount, 6)],
      [10, '0006100010'], [20, number(debit, 12)], [32, number(credit, 12)],
      [44, '1234567890'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, number(entryAndAddendaCount, 8)], [21, '0006100010'],
      [31, number(debit, 12)], [43, number(credit, 12)],
    ]),
  );
  return [...records, ...Array((10 - (records.length % 10)) % 10).fill('9'.repeat(94))].join('\n');
}

suite('ACH TRX Truncated Entries Exchange Test Suite', () => {
  test('Accepts and decodes the TRX corporate layout with optional addenda content', () => {
    const document = parseAchDocument(trxFile());
    const detail = document.batches[0].entries[0].detail;

    assert.deepStrictEqual(parseAch(document), []);
    assert.strictEqual(detail.fields.find(field => field.range.start === 54)?.name, 'Number of Addenda Records');
    assert.strictEqual(detail.fields.find(field => field.range.start === 58)?.name, 'Receiving Company Name / ID Number');
    assert.strictEqual(detail.fields.find(field => field.range.start === 76)?.name, 'Item Type Indicator');
    assert.strictEqual(maximumAddendaForSec('TRX'), 9999);
  });

  test('Requires addenda for live TRX entries but permits a prenote without addenda', () => {
    const live = parseAch(trxFile({ addenda: 0 }));
    const prenote = parseAch(trxFile({ transactionCode: '28', amount: 0, addenda: 0 }));

    assert.ok(live.some(item => item.code === 'ACH-TRX-ADDENDA-REQUIRED'));
    assert.deepStrictEqual(prenote, []);
  });

  test('Validates debit direction, account, Receiver, and reserved columns', () => {
    const diagnostics = parseAch(trxFile({
      transactionCode: '22',
      account: '',
      receiver: '',
      reserved: 'XX',
    }));
    const codes = new Set(diagnostics.map(item => item.code));

    assert.ok(codes.has('ACH-SEC-TRANSACTION-CODE'));
    assert.ok(codes.has('ACH-SEC-ACCOUNT-REQUIRED'));
    assert.ok(codes.has('ACH-TRX-RECEIVER-REQUIRED'));
    assert.ok(codes.has('ACH-TRX-RESERVED'));
  });

  test('Validates and safely repairs the declared TRX addenda count', () => {
    const document = parseAchDocument(trxFile({ addenda: 2, declaredAddenda: '0001' }));
    const diagnostic = parseAch(document).find(item => item.code === 'ACH-TRX-ADDENDA-COUNT');

    assert.ok(diagnostic);
    assert.strictEqual(diagnostic.expected, '0002');
    assert.strictEqual(fixForAchDiagnostic(document, diagnostic)?.newText, '0002');
  });

  test('Retains type 05 addenda sequence and Entry Detail linkage validation', () => {
    const diagnostics = parseAch(trxFile({
      secondSequence: '0009',
      secondEntrySequence: '9999999',
    }));
    const codes = new Set(diagnostics.map(item => item.code));

    assert.ok(codes.has('ACH-RELATION-ADDENDA-SEQUENCE'));
    assert.ok(codes.has('ACH-RELATION-ADDENDA-ENTRY-SEQUENCE'));
  });
});
