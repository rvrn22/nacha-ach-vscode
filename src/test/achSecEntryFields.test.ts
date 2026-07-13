import * as assert from 'assert';
import { decodeAchField } from '../achDecode';
import { parseAchDocument } from '../achDocument';
import { transactionCodes } from '../achRules';
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

function secFile(options: {
  secCode: string;
  transactionCode: string;
  account?: string;
  identification?: string;
  receiverName?: string;
  paymentType?: string;
}): string {
  const amount = 1234n;
  const transaction = transactionCodes.get(options.transactionCode)!;
  const debit = transaction.direction === 'debit' ? amount : 0n;
  const credit = transaction.direction === 'credit' ? amount : 0n;
  const serviceClass = transaction.direction === 'debit' ? '225' : '220';
  const checkBased = ['ARC', 'BOC', 'RCK'].includes(options.secCode);
  const identification = options.identification ?? (checkBased ? 'CHECK-12345' : 'ENTRY-REFERENCE');
  const receiverName = options.receiverName
    ?? (['CCD', 'CTX'].includes(options.secCode) ? 'RECEIVING COMPANY' : 'RECEIVER NAME');
  const contextualFields: FieldValue[] = options.secCode === 'CTX'
    ? [[54, '0000'], [58, receiverName.substring(0, 16)]]
    : [[54, receiverName], [76, options.paymentType ?? '  ']];
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, serviceClass], [4, 'COMPANY'], [40, '1234567890'], [50, options.secCode],
      [53, 'PAYMENT'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', [
      [1, options.transactionCode], [3, '06100010'], [11, '4'],
      [12, options.account ?? 'RECEIVER-ACCOUNT'], [29, number(amount, 10)],
      [39, identification], ...contextualFields,
      [78, '0'], [79, '061000100000001'],
    ]),
    makeRecord('8', [
      [1, serviceClass], [4, '000001'], [10, '0006100010'],
      [20, number(debit, 12)], [32, number(credit, 12)], [44, '1234567890'],
      [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, '00000001'], [21, '0006100010'],
      [31, number(debit, 12)], [43, number(credit, 12)],
    ]),
  ];
  return [...records, ...Array(5).fill('9'.repeat(94))].join('\n');
}

function replaceField(record: string, start: number, value: string): string {
  return record.substring(0, start) + value + record.substring(start + value.length);
}

suite('ACH SEC-Aware Entry Detail Test Suite', () => {
  test('Uses SEC-specific field names for converted checks, corporate entries, and WEB/TEL', () => {
    const arc = parseAchDocument(secFile({ secCode: 'ARC', transactionCode: '27' }));
    const ccd = parseAchDocument(secFile({ secCode: 'CCD', transactionCode: '22' }));
    const web = parseAchDocument(secFile({ secCode: 'WEB', transactionCode: '27', paymentType: 'ST' }));
    const arcFields = arc.batches[0].entries[0].detail.fields;
    const ccdFields = ccd.batches[0].entries[0].detail.fields;
    const webDetail = web.batches[0].entries[0].detail;
    const checkSerial = arcFields.find(field => field.range.start === 39)!;
    const paymentType = webDetail.fields.find(field => field.name === 'Payment Type Code')!;

    assert.strictEqual(checkSerial.name, 'Check Serial Number');
    assert.strictEqual(decodeAchField(arc.batches[0].entries[0].detail, checkSerial).masked, true);
    assert.strictEqual(ccdFields.find(field => field.range.start === 54)?.name, 'Receiving Company Name');
    const ctxFields = parseAchDocument(secFile({ secCode: 'CTX', transactionCode: '22' }))
      .batches[0].entries[0].detail.fields;
    assert.strictEqual(ctxFields.find(field => field.range.start === 54)?.name, 'Number of Addenda Records');
    assert.strictEqual(ctxFields.find(field => field.range.start === 58)?.name, 'Receiving Company Name / ID Number');
    assert.strictEqual(paymentType.range.start, 76);
    assert.strictEqual(decodeAchField(webDetail, paymentType).display, 'ST — Standing Authorization');
  });

  test('Accepts representative valid files across the common domestic SEC layouts', () => {
    const fixtures = [
      { secCode: 'ARC', transactionCode: '27' },
      { secCode: 'BOC', transactionCode: '27' },
      { secCode: 'RCK', transactionCode: '27' },
      { secCode: 'CCD', transactionCode: '22' },
      { secCode: 'CTX', transactionCode: '22' },
      { secCode: 'PPD', transactionCode: '22' },
      { secCode: 'TEL', transactionCode: '27', paymentType: 'S ' },
      { secCode: 'WEB', transactionCode: '27', paymentType: 'R ' },
      { secCode: 'WEB', transactionCode: '22', identification: 'CONSUMER NAME', paymentType: 'ST' },
    ];

    for (const fixture of fixtures) {
      assert.deepStrictEqual(parseAch(secFile(fixture)), [], `${fixture.secCode} should be valid`);
    }
  });

  test('Requires accounts, Receiver names, and converted-check serial numbers by SEC', () => {
    const missingAccount = parseAch(secFile({ secCode: 'PPD', transactionCode: '22', account: '' }));
    const missingCompany = parseAch(secFile({ secCode: 'CCD', transactionCode: '22', receiverName: '' }));
    const missingSerial = parseAch(secFile({ secCode: 'ARC', transactionCode: '27', identification: '' }));

    assert.ok(missingAccount.some(item => item.code === 'ACH-SEC-ACCOUNT-REQUIRED'));
    assert.ok(missingCompany.some(item => item.code === 'ACH-SEC-RECEIVER-NAME-REQUIRED'));
    assert.ok(missingSerial.some(item => item.code === 'ACH-SEC-CHECK-SERIAL-REQUIRED'));
  });

  test('Requires the consumer Originator name for WEB credits', () => {
    const diagnostics = parseAch(secFile({
      secCode: 'WEB',
      transactionCode: '22',
      identification: '',
      paymentType: 'S ',
    }));

    assert.ok(diagnostics.some(item => item.code === 'ACH-WEB-CREDIT-ORIGINATOR-NAME'));
  });

  test('Validates the CTX declared addenda count and reserved columns', () => {
    const lines = secFile({ secCode: 'CTX', transactionCode: '22' }).split('\n');
    lines[2] = replaceField(lines[2], 54, '0001');
    lines[2] = replaceField(lines[2], 74, 'X ');
    const codes = new Set(parseAch(lines.join('\n')).map(item => item.code));

    assert.ok(codes.has('ACH-CTX-ADDENDA-COUNT'));
    assert.ok(codes.has('ACH-CTX-RESERVED'));
  });
});
