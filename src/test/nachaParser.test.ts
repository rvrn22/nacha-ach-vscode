import * as assert from 'assert';
import { parseAch } from '../nachaParser';

suite('Nacha Parser Validation Test Suite', () => {
    test('Should detect correct record length', () => {
        const text = '101 123456789 123456789 2310260900A094101Immediate Dest      Immediate Origin        Reference';
        // Ensure it's 94 chars
        const line = text.padEnd(94, ' ');
        const diags = parseAch(line);
        const lengthErrors = diags.filter(d => d.message.includes('length'));
        assert.strictEqual(lengthErrors.length, 0, `Expected no length errors, found: ${JSON.stringify(lengthErrors)}`);
    });

    test('Should detect short record length', () => {
        const text = '101 123456789 123456789';
        const diags = parseAch(text);
        const lengthErrors = diags.filter(d => d.message.includes('less than required 94 characters'));
        assert.strictEqual(lengthErrors.length > 0, true, 'Should have detected short record');
    });

    test('Should validate routing number checksum', () => {
        // Valid routing: 06100010 (Check digit is 4)
        // Calculating check digit for 06100010:
        // 0*3 + 6*7 + 1*1 + 0*3 + 0*7 + 0*1 + 1*3 + 0*7 = 0+42+1+0+0+0+3+0 = 46
        // 10 - (46 % 10) = 10 - 6 = 4. Correct.

        const validEntry = '622061000104123456789012345670000001234ID1234567890123456789012Individual Name          001234567812345';
        const invalidEntry = '622061000105123456789012345670000001234ID1234567890123456789012Individual Name          001234567812345';

        const diagsValid = parseAch('101 123456789 123456789 2310260900A094101Dest                    Origin                  \n5200Company Name        Discretionary       1234567890PPDDescription   YYMMDD231026   1061000100000001\n' + validEntry);
        const diagsInvalid = parseAch('101 123456789 123456789 2310260900A094101Dest                    Origin                  \n5200Company Name        Discretionary       1234567890PPDDescription   YYMMDD231026   1061000100000001\n' + invalidEntry);

        const checksumErrorsValid = diagsValid.filter(d => d.message.includes('Invalid Check Digit'));
        const checksumErrorsInvalid = diagsInvalid.filter(d => d.message.includes('Invalid Check Digit'));

        assert.strictEqual(checksumErrorsValid.length, 0, 'Should not have checksum errors for valid routing');
        assert.strictEqual(checksumErrorsInvalid.length > 0, true, 'Should have checksum error for invalid routing');
    });

    test('Should validate batch totals', () => {
        const pad = (s: string, n: number) => s.padEnd(n, ' ');
        const padNum = (s: string, n: number) => s.padStart(n, '0');

        // File Header (Type 1)
        const fileHeader = '101' + pad('Dest', 10) + pad('Origin', 10) + '231026' + '0900' + 'A' + '094' + '10' + '1' + pad('Dest Name', 23) + pad('Orig Name', 23) + pad('', 8);

        // Batch Header (Type 5)
        // Service Class: 200 (1-4), Co Name: (4-20), Discretionary: (20-40), ID: (40-50), SEC: PPD (50-53), Desc: (53-63), Date: (63-69), Eff Date: (69-75), Settle: (75-78), Status: 1 (78-79), ODFI: (79-87), Batch: (87-94)
        const batchHeader = '5200' + pad('Company Name', 16) + pad('Discretionary', 20) + '1234567890' + 'PPD' + pad('PAYROLL', 10) + '      ' + '231026' + '   ' + '1' + '06100010' + '0000001';

        // Entry Detail (Type 6)
        // Tx Code: 22 (1-3), RDFI: 06100010 (3-11), Check Digit: 4 (11-12), Account: (12-29), Amount: 1234 (29-39), ID: (39-54), Name: (54-76), Disc: (76-78), Addenda: 0 (78-79), Trace: (79-94)
        const entry = '622' + '06100010' + '4' + pad('123456789', 17) + padNum('1234', 10) + pad('ID12345', 15) + pad('Individual Name', 22) + '  ' + '0' + '061000100000001';

        // Batch Control (Type 8)
        // Service Class: 200 (1-4), Count: 1 (4-10), Hash: 06100010 (10-20), Debit: 0 (20-32), Credit: 1234 (32-44), ID: 1234567890 (44-54), MAC: (54-73), Reserved: (73-79), ODFI: 06100010 (79-87), Batch: (87-94)
        const batchControl = '8200' + padNum('1', 6) + padNum('6100010', 10) + padNum('0', 12) + padNum('1234', 12) + '1234567890' + pad('', 19) + pad('', 6) + '06100010' + '0000001';

        // File Control (Type 9)
        // Batch Count: 1 (1-7), Block Count: 1 (7-13), Entry Count: 1 (13-21), Hash: 06100010 (21-31), Debit: 0 (31-43), Credit: 1234 (43-55), Reserved: (55-94)
        const fileControl = '9' + padNum('1', 6) + padNum('1', 6) + padNum('1', 8) + padNum('6100010', 10) + padNum('0', 12) + padNum('1234', 12) + pad('', 39);

        const fullFile = [fileHeader, batchHeader, entry, batchControl, fileControl].join('\n');

        const diags = parseAch(fullFile);
        const totalErrors = diags.filter(d => d.message.includes('match') || d.message.includes('calculate'));
        assert.strictEqual(totalErrors.length, 0, `Expected no totals errors, found: ${JSON.stringify(totalErrors)}`);
    });

    test('Should validate IAT records', () => {
        const pad = (s: string, n: number) => s.padEnd(n, ' ');
        const padNum = (s: string, n: number) => s.padStart(n, '0');

        // File Header
        const fileHeader = '101' + pad('Dest', 10) + pad('Origin', 10) + '231026' + '0900' + 'A' + '094' + '10' + '1' + pad('Dest Name', 23) + pad('Orig Name', 23) + pad('', 8);

        // IAT Batch Header
        // 5 + Service(3) + IAT Indicator(16) + FX Ind(2) + FX Ref Ind(1) + FX Ref(15) + Country(2) + ID(10) + SEC(3) + Desc(10) + Orig Curr(3) + Dest Curr(3) + Date(6) + Settle(3) + Status(1) + ODFI(8) + Batch(7)
        const batchHeader = '5220' + 'IAT             ' + 'FF' + '3' + pad('', 15) + 'MX' + '1234567890' + 'IAT' + pad('PAYROLL', 10) + 'USD' + 'MXN' + '231026' + '   ' + '1' + '06100010' + '0000001';

        // IAT Entry Detail
        // 6 + Tx(2) + RDFI(8) + CD(1) + Res(3) + Addenda(2) + Res(12) + Amount(10) + Account(35) + Res(2) + Screen(2) + Addenda Ind(1) + Trace(15)
        const entry = '622' + '06100010' + '4' + '   ' + '07' + pad('', 12) + padNum('5000', 10) + pad('FOREIGN-ACCOUNT-123', 35) + '  ' + '  ' + '1' + '061000100000001';

        // 7 mandatory IAT addenda (Types 10-16)
        const addenda10 = '710' + 'BUS' + padNum('5000', 18) + 'FF' + pad('RECEIVER NAME', 35) + pad('', 18) + '061000100000001';
        const addenda11 = '711' + pad('ORIGINATOR NAME', 35) + pad('123 MAIN ST', 35) + pad('', 6) + '061000100000001';
        const addenda12 = '712' + pad('ORIGINATOR CITY', 35) + pad('CAUS90210', 35) + pad('', 6) + '061000100000001';
        const addenda13 = '713' + pad('ODFI NAME', 35) + pad('12345678US', 35) + pad('', 6) + '061000100000001';
        const addenda14 = '714' + pad('RDFI NAME', 35) + pad('87654321MX', 35) + pad('', 6) + '061000100000001';
        const addenda15 = '715' + pad('RECEIVER ID', 35) + pad('456 OAK AVE', 35) + pad('', 6) + '061000100000001';
        const addenda16 = '716' + pad('RECEIVER CITY', 35) + pad('MEXICO CITY MX 12345', 35) + pad('', 6) + '061000100000001';

        // Batch Control (Count: 1 entry + 7 addenda = 8)
        const batchControl = '8220' + padNum('8', 6) + padNum('6100010', 10) + padNum('0', 12) + padNum('5000', 12) + '1234567890' + pad('', 19) + pad('', 6) + '06100010' + '0000001';

        // File Control
        const fileControl = '9' + padNum('1', 6) + padNum('2', 6) + padNum('8', 8) + padNum('6100010', 10) + padNum('0', 12) + padNum('5000', 12) + pad('', 39);

        const fullFile = [fileHeader, batchHeader, entry, addenda10, addenda11, addenda12, addenda13, addenda14, addenda15, addenda16, batchControl, fileControl].join('\n');

        const diags = parseAch(fullFile);
        const totalErrors = diags.filter(d => d.message.includes('match') || d.message.includes('calculate') || d.message.includes('IAT'));
        assert.strictEqual(totalErrors.length, 0, `Expected no IAT related errors, found: ${JSON.stringify(totalErrors)}`);
    });
});
