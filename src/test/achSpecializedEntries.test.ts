import * as assert from 'assert';
import { parseAchDocument } from '../achDocument';
import { fixForAchDiagnostic } from '../achFixes';
import { parseAch } from '../nachaParser';

type FieldValue = [start: number, value: string];
type SpecializedSec = 'CIE' | 'DNE' | 'ENR';

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

function specializedFile(options: {
  secCode: SpecializedSec;
  transactionCode?: string;
  amount?: number;
  account?: string;
  individualName?: string;
  individualId?: string;
  receiver?: string;
  addenda?: number;
  addendaContent?: string;
  declaredAddenda?: string;
  reserved?: string;
}): string {
  const { secCode } = options;
  const transactionCode = options.transactionCode ?? (secCode === 'CIE' ? '22' : '23');
  const amount = options.amount ?? (secCode === 'CIE' ? 123 : 0);
  const account = options.account ?? '123456789';
  const individualName = options.individualName ?? 'INDIVIDUAL NAME';
  const individualId = options.individualId ?? 'CUSTOMER-000001';
  const receiver = options.receiver ?? 'FEDERAL AGENCY';
  const addendaCount = options.addenda ?? (secCode === 'CIE' ? 0 : secCode === 'DNE' ? 1 : 2);
  const trace = '061000100000001';
  const entryFields: FieldValue[] = [
    [1, transactionCode], [3, '06100010'], [11, '4'], [12, account],
    [29, number(amount, 10)], [78, addendaCount > 0 ? '1' : '0'], [79, trace],
  ];
  if (secCode === 'CIE') {
    entryFields.push([39, individualName], [54, individualId]);
  } else if (secCode === 'DNE') {
    entryFields.push([39, individualId], [54, individualName]);
  } else {
    entryFields.push(
      [39, individualId],
      [54, options.declaredAddenda ?? number(addendaCount, 4)],
      [58, receiver],
      [74, options.reserved ?? '  '],
    );
  }

  const entryAndAddendaCount = 1 + addendaCount;
  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, '220'], [4, 'ORIGINATOR'], [40, '1234567890'], [50, secCode],
      [53, 'SPECIAL'], [69, '260713'], [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', entryFields),
  ];
  for (let index = 0; index < addendaCount; index++) {
    records.push(makeRecord('7', [
      [1, '05'],
      [3, options.addendaContent ?? `${secCode} CONVENTION DATA ${index + 1}`],
      [83, number(index + 1, 4)],
      [87, trace.substring(8)],
    ]));
  }
  records.push(
    makeRecord('8', [
      [1, '220'], [4, number(entryAndAddendaCount, 6)], [10, '0006100010'],
      [20, '000000000000'], [32, number(amount, 12)], [44, '1234567890'],
      [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('9', [
      [1, '000001'], [7, '000001'], [13, number(entryAndAddendaCount, 8)], [21, '0006100010'],
      [31, '000000000000'], [43, number(amount, 12)],
    ]),
  );
  return [...records, ...Array((10 - (records.length % 10)) % 10).fill('9'.repeat(94))].join('\n');
}

suite('ACH CIE/DNE/ENR Specialized Entry Test Suite', () => {
  test('Accepts CIE, DNE, and ENR entries with their contextual layouts', () => {
    for (const secCode of ['CIE', 'DNE', 'ENR'] as const) {
      const document = parseAchDocument(specializedFile({ secCode }));
      const detail = document.batches[0].entries[0].detail;

      assert.deepStrictEqual(parseAch(document), []);
      if (secCode === 'CIE') {
        assert.strictEqual(detail.fields.find(field => field.range.start === 39)?.name, 'Individual Name');
        assert.strictEqual(detail.fields.find(field => field.range.start === 54)?.name, 'Individual Identification Number');
      } else if (secCode === 'DNE') {
        assert.strictEqual(detail.fields.find(field => field.range.start === 39)?.name, 'Individual Identification Number');
        assert.strictEqual(detail.fields.find(field => field.range.start === 54)?.name, 'Individual Name');
      } else {
        assert.strictEqual(detail.fields.find(field => field.range.start === 54)?.name, 'Number of Addenda Records');
        assert.strictEqual(detail.fields.find(field => field.range.start === 58)?.name, 'Receiving Company Name / ID Number');
      }
    }
  });

  test('Validates CIE account, individual name, and customer reference', () => {
    const diagnostics = parseAch(specializedFile({
      secCode: 'CIE',
      account: '',
      individualName: '',
      individualId: '',
    }));
    const codes = new Set(diagnostics.map(item => item.code));

    assert.ok(codes.has('ACH-SEC-ACCOUNT-REQUIRED'));
    assert.ok(codes.has('ACH-CIE-INDIVIDUAL-NAME-REQUIRED'));
    assert.ok(codes.has('ACH-CIE-INDIVIDUAL-ID-REQUIRED'));
  });

  test('Requires DNE and ENR non-monetary codes, zero amounts, and addenda', () => {
    for (const secCode of ['DNE', 'ENR'] as const) {
      const diagnostics = parseAch(specializedFile({
        secCode,
        transactionCode: '22',
        amount: 25,
        addenda: 0,
        declaredAddenda: secCode === 'ENR' ? '0000' : undefined,
      }));
      const codes = new Set(diagnostics.map(item => item.code));

      assert.ok(codes.has('ACH-SEC-TRANSACTION-CODE'));
      assert.ok(codes.has('ACH-SEC-NONMONETARY-AMOUNT'));
      assert.ok(codes.has('ACH-SEC-ADDENDA-REQUIRED'));
    }
  });

  test('Validates DNE/ENR addenda content and DNE single-addenda maximum', () => {
    const blankContent = parseAch(specializedFile({ secCode: 'DNE', addendaContent: '' }));
    const tooMany = parseAch(specializedFile({ secCode: 'DNE', addenda: 2 }));

    assert.ok(blankContent.some(item => item.code === 'ACH-SEC-ADDENDA-CONTENT-REQUIRED'));
    assert.ok(tooMany.some(item => item.code === 'ACH-SEC-ADDENDA-MAXIMUM'));
  });

  test('Validates and safely repairs ENR count while checking Receiver and reserved fields', () => {
    const document = parseAchDocument(specializedFile({
      secCode: 'ENR',
      addenda: 2,
      declaredAddenda: '0001',
      receiver: '',
      reserved: 'XX',
    }));
    const diagnostics = parseAch(document);
    const count = diagnostics.find(item => item.code === 'ACH-ENR-ADDENDA-COUNT');

    assert.ok(count);
    assert.strictEqual(count.expected, '0002');
    assert.strictEqual(fixForAchDiagnostic(document, count)?.newText, '0002');
    assert.ok(diagnostics.some(item => item.code === 'ACH-ENR-RECEIVER-REQUIRED'));
    assert.ok(diagnostics.some(item => item.code === 'ACH-ENR-RESERVED'));
  });
});
