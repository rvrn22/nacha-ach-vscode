import * as assert from 'assert';
import { decodeAchField } from '../achDecode';
import { parseAchDocument } from '../achDocument';
import { fixForAchDiagnostic } from '../achFixes';
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

function acknowledgmentFile(options: {
  secCode?: 'ACK' | 'ATX';
  amount?: string;
  originalTrace?: string;
  account?: string;
  receiver?: string;
  addenda?: number;
  declaredAddenda?: string;
  reserved?: string;
} = {}): string {
  const secCode = options.secCode ?? 'ACK';
  const amount = options.amount ?? '0000000000';
  const originalTrace = options.originalTrace ?? '071000010000123';
  const account = options.account ?? '123456789';
  const receiver = options.receiver ?? 'RECEIVING COMPANY';
  const addendaCount = options.addenda ?? 0;
  const trace = '061000100000001';
  const entryCount = 1 + addendaCount;
  const entryFields: FieldValue[] = [
    [1, '24'], [3, '06100010'], [11, '4'], [12, account], [29, amount],
    [39, originalTrace], [78, addendaCount > 0 ? '1' : '0'], [79, trace],
  ];
  if (secCode === 'ACK') {
    entryFields.push([54, receiver]);
  } else {
    entryFields.push(
      [54, options.declaredAddenda ?? number(addendaCount, 4)],
      [58, receiver],
      [74, options.reserved ?? '  '],
    );
  }

  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, '220'], [4, 'ACK COMPANY'], [40, '1234567890'], [50, secCode],
      [53, 'ACKNOWLEDGE'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', entryFields),
  ];
  for (let index = 0; index < addendaCount; index++) {
    records.push(makeRecord('7', [
      [1, '05'], [3, `ACKNOWLEDGMENT ${index + 1}`], [83, number(index + 1, 4)], [87, trace.substring(8)],
    ]));
  }
  records.push(
    makeRecord('8', [
      [1, '220'], [4, number(entryCount, 6)], [10, '0006100010'],
      [20, '000000000000'], [32, '000000000000'], [44, '1234567890'],
      [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, number(entryCount, 8)], [21, '0006100010'],
      [31, '000000000000'], [43, '000000000000'],
    ]),
  );
  return [...records, ...Array((10 - (records.length % 10)) % 10).fill('9'.repeat(94))].join('\n');
}

suite('ACH ACK/ATX Acknowledgment Test Suite', () => {
  test('Accepts ACK and ATX acknowledgments with their distinct layouts', () => {
    for (const secCode of ['ACK', 'ATX'] as const) {
      const document = parseAchDocument(acknowledgmentFile({ secCode, addenda: 1 }));
      const detail = document.batches[0].entries[0].detail;

      assert.deepStrictEqual(parseAch(document), []);
      assert.strictEqual(detail.fields.find(field => field.range.start === 39)?.name, 'Original Entry Trace Number');
      assert.strictEqual(detail.fields.find(field => field.name === 'Original Entry Trace Number')?.value, '071000010000123');
      assert.strictEqual(detail.fields.find(field => field.range.start === (secCode === 'ATX' ? 58 : 54))?.name,
        secCode === 'ATX' ? 'Receiving Company Name / ID Number' : 'Receiving Company Name');
      if (secCode === 'ATX') {
        const count = detail.fields.find(field => field.name === 'Number of Addenda Records');
        assert.ok(count);
        assert.strictEqual(decodeAchField(detail, count).display, '1');
      }
    }
  });

  test('Validates acknowledgment amount, original trace, account, and company name', () => {
    const diagnostics = parseAch(acknowledgmentFile({
      amount: '0000000123',
      originalTrace: 'INVALID',
      account: '',
      receiver: '',
    }));
    const codes = new Set(diagnostics.map(item => item.code));

    assert.ok(codes.has('ACH-ACK-AMOUNT-ZERO'));
    assert.ok(codes.has('ACH-ACK-ORIGINAL-TRACE'));
    assert.ok(codes.has('ACH-SEC-ACCOUNT-REQUIRED'));
    assert.ok(codes.has('ACH-ACK-RECEIVER-REQUIRED'));
  });

  test('Validates and safely repairs the ATX declared addenda count', () => {
    const document = parseAchDocument(acknowledgmentFile({ secCode: 'ATX', addenda: 1, declaredAddenda: '0000' }));
    const diagnostic = parseAch(document).find(item => item.code === 'ACH-ATX-ADDENDA-COUNT');

    assert.ok(diagnostic);
    assert.strictEqual(diagnostic.expected, '0001');
    assert.strictEqual(fixForAchDiagnostic(document, diagnostic)?.newText, '0001');
  });

  test('Rejects ATX reserved data and more than one acknowledgment addenda', () => {
    const diagnostics = parseAch(acknowledgmentFile({ secCode: 'ATX', addenda: 2, reserved: 'XX' }));
    const codes = new Set(diagnostics.map(item => item.code));

    assert.ok(codes.has('ACH-ATX-RESERVED'));
    assert.ok(codes.has('ACH-SEC-ADDENDA-MAXIMUM'));
  });
});
