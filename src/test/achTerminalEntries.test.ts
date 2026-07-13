import * as assert from 'assert';
import { decodeAchField } from '../achDecode';
import { parseAchDocument } from '../achDocument';
import { buildSequenceRenumberEdits, fixForAchDiagnostic } from '../achFixes';
import { findRelatedAchRanges } from '../achNavigation';
import { transactionCodes } from '../achRules';
import { parseAch } from '../nachaParser';

type FieldValue = [start: number, value: string];
type TerminalSec = 'MTE' | 'POS' | 'SHR';

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

function terminalFile(options: {
  secCode: TerminalSec;
  transactionCode?: string;
  amount?: number;
  addenda?: boolean;
  individualName?: string;
  individualId?: string;
  cardType?: string;
  expiration?: string;
  documentReference?: string;
  cardAccount?: string;
  transactionDescription?: string;
  terminalId?: string;
  serial?: string;
  transactionDate?: string;
  transactionTime?: string;
  terminalLocation?: string;
  terminalCity?: string;
  terminalState?: string;
  addendaTrace?: string;
}): string {
  const { secCode } = options;
  const transactionCode = options.transactionCode ?? '27';
  const transaction = transactionCodes.get(transactionCode)!;
  const amount = options.amount ?? (transaction.kind === 'prenote' ? 0 : 123);
  const hasAddenda = options.addenda ?? transaction.kind !== 'prenote';
  const trace = '061000100000001';
  const entryFields: FieldValue[] = [
    [1, transactionCode], [3, '06100010'], [11, '4'], [12, '123456789'],
    [29, number(amount, 10)], [78, hasAddenda ? '1' : '0'], [79, trace],
  ];
  if (secCode === 'MTE') {
    entryFields.push(
      [39, options.individualName ?? 'CARDHOLDER NAME'],
      [54, options.individualId ?? 'CUSTOMER-000001'],
    );
  } else if (secCode === 'POS') {
    entryFields.push(
      [39, options.individualId ?? 'CUSTOMER-000001'],
      [54, options.individualName ?? 'CARDHOLDER NAME'],
      [76, options.cardType ?? '01'],
    );
  } else {
    entryFields.push(
      [39, options.expiration ?? '0728'],
      [43, options.documentReference ?? '00000012345'],
      [54, options.cardAccount ?? '1234567890123456789012'],
      [76, options.cardType ?? '01'],
    );
  }

  const records = [
    makeRecord('1', [
      [1, '01'], [3, ' 061000104'], [13, ' 061000104'], [23, '260712'],
      [29, '1200'], [33, 'A'], [34, '094'], [37, '10'], [39, '1'],
    ]),
    makeRecord('5', [
      [1, transaction.direction === 'credit' ? '220' : '225'], [4, 'TERMINAL OWNER'],
      [40, '1234567890'], [50, secCode], [53, 'TERMINAL'], [69, '260713'],
      [78, '1'], [79, '06100010'], [87, '0000001'],
    ]),
    makeRecord('6', entryFields),
  ];
  if (hasAddenda) {
    records.push(makeRecord('7', [
      [1, '02'],
      [3, secCode === 'MTE' ? options.transactionDescription ?? 'WITHDRW' : 'REF0001'],
      [10, secCode === 'MTE' ? 'NET' : 'R02'],
      [13, options.terminalId ?? 'TERM01'],
      [19, options.serial ?? '000001'],
      [25, options.transactionDate ?? '0712'],
      [29, secCode === 'MTE' ? options.transactionTime ?? '123456' : 'AUTH01'],
      [35, options.terminalLocation ?? 'MAIN STREET TERMINAL'],
      [62, options.terminalCity ?? 'CHICAGO'],
      [77, options.terminalState ?? 'IL'],
      [79, options.addendaTrace ?? trace],
    ]));
  }

  const entryAndAddendaCount = 1 + (hasAddenda ? 1 : 0);
  const debit = transaction.direction === 'debit' ? amount : 0;
  const credit = transaction.direction === 'credit' ? amount : 0;
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

suite('ACH MTE/POS/SHR Terminal Entry Test Suite', () => {
  test('Accepts and decodes each terminal Entry Detail and type 02 addenda layout', () => {
    for (const secCode of ['MTE', 'POS', 'SHR'] as const) {
      const document = parseAchDocument(terminalFile({ secCode }));
      const entry = document.batches[0].entries[0];
      const addenda = entry.addenda[0];

      assert.deepStrictEqual(parseAch(document), []);
      assert.strictEqual(addenda.fields.find(field => field.range.start === 79)?.name, 'Trace Number');
      assert.strictEqual(addenda.fields.some(field => field.name === 'Addenda Sequence Number'), false);
      assert.strictEqual(addenda.fields.find(field => field.range.start === 3)?.name,
        secCode === 'MTE' ? 'Transaction Description' : 'Reference Information #1');
      if (secCode === 'MTE') {
        const time = addenda.fields.find(field => field.name === 'Transaction Time');
        assert.ok(time);
        assert.strictEqual(decodeAchField(addenda, time).display, '12:34:56');
      } else {
        const cardType = entry.detail.fields.find(field => field.name === 'Card Transaction Type Code');
        assert.ok(cardType);
        assert.strictEqual(decodeAchField(entry.detail, cardType).display, '01 — Purchase of goods or services');
      }
    }
  });

  test('Requires type 02 addenda for live entries but not terminal prenotes', () => {
    for (const secCode of ['MTE', 'POS', 'SHR'] as const) {
      const live = parseAch(terminalFile({ secCode, addenda: false }));
      const prenote = parseAch(terminalFile({ secCode, transactionCode: '28', amount: 0, addenda: false }));

      assert.ok(live.some(item => item.code === 'ACH-TERMINAL-ADDENDA-REQUIRED'));
      assert.deepStrictEqual(prenote, []);
    }
  });

  test('Validates required terminal fields, transaction dates, and MTE times', () => {
    const diagnostics = parseAch(terminalFile({
      secCode: 'MTE',
      transactionDescription: '',
      terminalId: '',
      serial: '',
      transactionDate: '0230',
      transactionTime: '246060',
      terminalLocation: '',
      terminalCity: '',
      terminalState: '',
      addendaTrace: 'INVALID',
    }));
    const codes = new Set(diagnostics.map(item => item.code));

    assert.ok(codes.has('ACH-TERMINAL-ADDENDA-REQUIRED'));
    assert.ok(codes.has('ACH-TERMINAL-TRANSACTION-DATE'));
    assert.ok(codes.has('ACH-MTE-TRANSACTION-TIME'));
    assert.ok(codes.has('ACH-TERMINAL-ADDENDA-TRACE-NUMERIC'));
  });

  test('Validates POS and SHR entry-specific card data and debit direction', () => {
    const pos = parseAch(terminalFile({ secCode: 'POS', individualName: '', cardType: '77' }));
    const shr = parseAch(terminalFile({
      secCode: 'SHR',
      transactionCode: '22',
      expiration: '1328',
      documentReference: 'INVALID',
      cardAccount: 'INVALID',
      cardType: '77',
    }));
    const posCodes = new Set(pos.map(item => item.code));
    const shrCodes = new Set(shr.map(item => item.code));

    assert.ok(posCodes.has('ACH-POS-INDIVIDUAL-NAME-REQUIRED'));
    assert.ok(posCodes.has('ACH-CARD-TRANSACTION-TYPE'));
    assert.ok(shrCodes.has('ACH-SHR-CARD-EXPIRATION'));
    assert.ok(shrCodes.has('ACH-SHR-DOCUMENT-REFERENCE'));
    assert.ok(shrCodes.has('ACH-SHR-CARD-ACCOUNT'));
    assert.ok(shrCodes.has('ACH-CARD-TRANSACTION-TYPE'));
    assert.ok(shrCodes.has('ACH-SEC-TRANSACTION-CODE'));
  });

  test('Synchronizes and navigates the complete terminal addenda trace', () => {
    const document = parseAchDocument(terminalFile({ secCode: 'POS', addendaTrace: '071000010000999' }));
    const diagnostic = parseAch(document).find(item => item.code === 'ACH-RELATION-TERMINAL-ADDENDA-TRACE');
    const addenda = document.batches[0].entries[0].addenda[0];

    assert.ok(diagnostic);
    assert.strictEqual(fixForAchDiagnostic(document, diagnostic)?.newText, '061000100000001');
    assert.deepStrictEqual(findRelatedAchRanges(document, addenda.line, 80).map(range => [range.line, range.start, range.end]), [
      [addenda.line, 79, 94],
      [document.batches[0].entries[0].detail.line, 79, 94],
    ]);
    assert.ok(buildSequenceRenumberEdits(document).some(edit =>
      edit.startLine === addenda.line && edit.startCharacter === 79 && edit.endCharacter === 94));
  });
});
