export type AchDiagnostic = {
  line: number;
  start: number;
  end: number;
  message: string;
  severity: 0 | 1 | 2 | 3; // vscode.DiagnosticSeverity values
};

export type AchSummary = {
  batches: number;
  entries: number;
  totalDebit: number;
  totalCredit: number;
  netAmount: number;
};

// Basic NACHA/ACH parser: validates line length, record ordering, and field contents.
// NACHA records are fixed width (94 chars) and begin with type codes:
// 1: File Header, 5: Batch Header, 6: Entry Detail, 7: Addenda, 8: Batch Control, 9: File Control
export function parseAch(text: string): AchDiagnostic[] {
  const diags: AchDiagnostic[] = [];
  const lines = text.split(/\r?\n/);

  const recordTypes = new Set(['1', '5', '6', '7', '8', '9']);
  const isPaddingRow = (line: string) => line.length === 94 && /^9{94}$/.test(line);

  // Track simple structure expectations
  let seenFileHeader = false;
  let openBatch = false;
  let batchCount = 0;
  let totalEntryCount = 0;
  let totalDebitAmount = 0;
  let totalCreditAmount = 0;
  let totalEntryHash = 0n; // Use BigInt for hash to avoid overflow

  // Current batch tracking
  let currentBatchHeaderLine = -1;
  let currentBatchEntryCount = 0;
  let currentBatchDebitAmount = 0;
  let currentBatchCreditAmount = 0;
  let currentBatchEntryHash = 0n;
  let currentBatchServiceClass = '';
  let currentBatchId = '';
  let currentBatchOdfi = '';
  let currentBatchNumber = '';
  let currentBatchSec = '';

  const addDiag = (lineIdx: number, start: number, end: number, message: string, severity: 0 | 1 | 2 | 3 = 1) => {
    diags.push({ line: lineIdx, start, end, message, severity });
  };

  const isNumeric = (str: string) => /^\d+$/.test(str);

  const validateRouting = (routing: string): boolean => {
    if (routing.length !== 8 || !isNumeric(routing)) { return false; }
    return true;
  };

  const calculateCheckDigit = (routing8: string): number => {
    const weights = [3, 7, 1, 3, 7, 1, 3, 7];
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      sum += parseInt(routing8[i], 10) * weights[i];
    }
    return (10 - (sum % 10)) % 10;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) {
      if (i < lines.length - 1) {
        // Blank line in middle of file is usually an error in fixed-width formats
        addDiag(i, 0, 1, 'Unexpected blank line in ACH file', 2);
      }
      continue;
    }

    // Skip padding rows (blocking records)
    if (isPaddingRow(line)) {
      continue;
    }

    const firstChar = line.charAt(0);
    if (!recordTypes.has(firstChar)) {
      addDiag(i, 0, Math.max(1, Math.min(line.length, 1)), `Unknown record type '${firstChar}'. Expected 1, 5, 6, 7, 8, or 9`, 1);
    }

    // Length validation
    if (line.length < 94) {
      addDiag(i, 0, Math.max(1, line.length), `Record length ${line.length} is less than required 94 characters`, 1);
    } else if (line.length > 94) {
      addDiag(i, 94, line.length, `Record length ${line.length} exceeds 94 characters (extra trailing data)`, 3);
    }

    const getField = (start: number, end: number) => line.substring(start, end);

    switch (firstChar) {
      case '1': // File Header
        if (seenFileHeader) {
          addDiag(i, 0, 1, 'Multiple File Header records (type 1) found');
        }
        if (i !== 0) {
          addDiag(i, 0, 1, 'File Header (type 1) should be the first record');
        }
        seenFileHeader = true;

        // Field Validations for Type 1
        const priorityCode = getField(1, 3);
        if (priorityCode !== '01') {
          addDiag(i, 1, 3, `Priority Code should be '01', found '${priorityCode}'`, 2);
        }

        const immDest = getField(3, 13);
        if (immDest.trim().length === 0) {
          addDiag(i, 3, 13, 'Immediate Destination is required', 1);
        }

        const immOrig = getField(13, 23);
        if (immOrig.trim().length === 0) {
          addDiag(i, 13, 23, 'Immediate Origin is required', 1);
        }

        const fileDate = getField(23, 29);
        if (!/^\d{6}$/.test(fileDate)) {
          addDiag(i, 23, 29, 'File Creation Date must be YYMMDD format', 1);
        }

        const fileTime = getField(29, 33);
        if (fileTime.trim().length > 0 && !/^\d{4}$/.test(fileTime)) {
          addDiag(i, 29, 33, 'File Creation Time should be HHMM format', 2);
        }

        const recordSize = getField(34, 37);
        if (recordSize !== '094') {
          addDiag(i, 34, 37, 'Record Size must be 094', 1);
        }

        const blockingFactor = getField(37, 39);
        if (blockingFactor !== '10') {
          addDiag(i, 37, 39, 'Blocking Factor must be 10', 1);
        }

        const formatCode = getField(39, 40);
        if (formatCode !== '1') {
          addDiag(i, 39, 40, 'Format Code must be 1', 1);
        }
        break;

      case '5': // Batch Header
        batchCount++;
        if (!seenFileHeader) {
          addDiag(i, 0, 1, 'Batch Header (type 5) appears before File Header (type 1)');
        }
        if (openBatch) {
          addDiag(i, 0, 1, 'Nested Batch Header (type 5) without closing previous batch (type 8)');
        }
        openBatch = true;
        currentBatchHeaderLine = i;
        currentBatchEntryCount = 0;
        currentBatchDebitAmount = 0;
        currentBatchCreditAmount = 0;
        currentBatchEntryHash = 0n;

        currentBatchServiceClass = getField(1, 4);
        currentBatchId = getField(40, 50);
        currentBatchOdfi = getField(79, 87);
        currentBatchNumber = getField(87, 94);
        currentBatchSec = getField(50, 53).trim();

        const validServiceClasses = currentBatchSec === 'IAT' ? ['200', '220', '225'] : ['200', '220', '225', '280'];
        if (!validServiceClasses.includes(currentBatchServiceClass)) {
          addDiag(i, 1, 4, `Invalid Service Class Code for ${currentBatchSec}. Expected ${validServiceClasses.join(', ')}`, 1);
        }

        if (currentBatchSec === 'IAT') {
          const iatIndicator = getField(4, 7);
          if (iatIndicator !== 'IAT') {
            addDiag(i, 4, 7, 'IAT batches must have "IAT" in positions 5-7', 1);
          }
        }

        const effectiveDate = getField(69, 75);
        if (!/^\d{6}$/.test(effectiveDate)) {
          addDiag(i, 69, 75, 'Effective Entry Date must be YYMMDD format', 1);
        }

        if (getField(78, 79) !== '1') {
          addDiag(i, 78, 79, 'Originator Status Code must be 1', 1);
        }
        break;

      case '6': // Entry Detail
        if (!openBatch) {
          addDiag(i, 0, 1, 'Entry Detail (type 6) appears outside of an open batch');
        }
        currentBatchEntryCount++;
        totalEntryCount++;

        const txCode = getField(1, 3);
        const lastDigit = parseInt(txCode.charAt(1), 10);
        const amount = parseInt(getField(29, 39), 10);

        if (isNaN(amount)) {
          addDiag(i, 29, 39, 'Amount must be numeric', 1);
        } else {
          if (lastDigit >= 0 && lastDigit <= 4) {
            currentBatchCreditAmount += amount;
            totalCreditAmount += amount;
          } else if (lastDigit >= 5 && lastDigit <= 9) {
            currentBatchDebitAmount += amount;
            totalDebitAmount += amount;
          }
        }

        const rdfi = getField(3, 11);
        if (!validateRouting(rdfi)) {
          addDiag(i, 3, 11, 'Receiving DFI Identification must be 8 digits', 1);
        } else {
          currentBatchEntryHash += BigInt(rdfi);
          totalEntryHash += BigInt(rdfi);

          const checkDigit = parseInt(getField(11, 12), 10);
          const expectedCheckDigit = calculateCheckDigit(rdfi);
          if (checkDigit !== expectedCheckDigit) {
            addDiag(i, 11, 12, `Invalid Check Digit. Expected ${expectedCheckDigit} for routing ${rdfi}`, 1);
          }
        }

        if (currentBatchSec === 'IAT') {
          const addendaIndicator = getField(78, 79);
          if (addendaIndicator !== '1') {
            addDiag(i, 78, 79, 'Addenda Record Indicator must be 1 for IAT entries', 1);
          }
          const numAddendaStr = getField(15, 17);
          const numAddenda = parseInt(numAddendaStr, 10);
          if (isNaN(numAddenda) || numAddenda < 7) {
            addDiag(i, 15, 17, `IAT entries must have at least 07 addenda records (found ${numAddendaStr})`, 1);
          }
        } else {
          const addendaIndicator = getField(78, 79);
          if (addendaIndicator !== '0' && addendaIndicator !== '1') {
            addDiag(i, 78, 79, 'Addenda Record Indicator must be 0 or 1', 1);
          }
        }
        break;

      case '7': // Addenda
        if (!openBatch) {
          addDiag(i, 0, 1, 'Addenda (type 7) appears outside of an open batch');
        }
        currentBatchEntryCount++;
        totalEntryCount++;
        break;

      case '8': // Batch Control
        if (!openBatch) {
          addDiag(i, 0, 1, 'Batch Control (type 8) appears without a matching Batch Header (type 5)');
        }
        openBatch = false;

        // Cross-validation with Batch Header
        if (getField(1, 4) !== currentBatchServiceClass) {
          addDiag(i, 1, 4, `Service Class Code matches Batch Header (${currentBatchServiceClass})`, 1);
        }
        if (getField(44, 54) !== currentBatchId) {
          addDiag(i, 44, 54, `Company Identification matches Batch Header (${currentBatchId})`, 1);
        }
        if (getField(79, 87) !== currentBatchOdfi) {
          addDiag(i, 79, 87, `Originating DFI Identification matches Batch Header (${currentBatchOdfi})`, 1);
        }
        if (getField(87, 94) !== currentBatchNumber) {
          addDiag(i, 87, 94, `Batch Number matches Batch Header (${currentBatchNumber})`, 1);
        }

        // Totals validation
        const ctrlEntryCount = parseInt(getField(4, 10), 10);
        if (ctrlEntryCount !== currentBatchEntryCount) {
          addDiag(i, 4, 10, `Entry/Addenda Count (${ctrlEntryCount}) does not match actual count (${currentBatchEntryCount})`, 1);
        }

        const ctrlHashStr = getField(10, 20);
        const currentBatchHashTail = (currentBatchEntryHash % 10000000000n).toString().padStart(10, '0');
        if (ctrlHashStr !== currentBatchHashTail) {
          addDiag(i, 10, 20, `Entry Hash (${ctrlHashStr}) does not match calculated hash (${currentBatchHashTail})`, 1);
        }

        const ctrlDebitAmount = parseInt(getField(20, 32), 10);
        if (ctrlDebitAmount !== currentBatchDebitAmount) {
          addDiag(i, 20, 32, `Total Debit amount ($${(ctrlDebitAmount / 100).toFixed(2)}) does not match actual ($${(currentBatchDebitAmount / 100).toFixed(2)})`, 1);
        }

        const ctrlCreditAmount = parseInt(getField(32, 44), 10);
        if (ctrlCreditAmount !== currentBatchCreditAmount) {
          addDiag(i, 32, 44, `Total Credit amount ($${(ctrlCreditAmount / 100).toFixed(2)}) does not match actual ($${(currentBatchCreditAmount / 100).toFixed(2)})`, 1);
        }
        break;

      case '9': // File Control
        if (!seenFileHeader) {
          addDiag(i, 0, 1, 'File Control (type 9) appears before File Header');
        }
        if (openBatch) {
          addDiag(i, 0, 1, 'File Control (type 9) appears while a batch is still open');
        }

        // Check if there are non-padding records after type 9
        let hasNonPaddingAfter = false;
        for (let j = i + 1; j < lines.length; j++) {
          const afterLine = lines[j];
          if (afterLine.trim().length > 0 && !isPaddingRow(afterLine)) {
            hasNonPaddingAfter = true;
            break;
          }
        }
        if (hasNonPaddingAfter) {
          addDiag(i, 0, 1, 'File Control should be the final record (excluding padding)', 1);
        }

        // Totals validation
        const fileBatchCount = parseInt(getField(1, 7), 10);
        if (fileBatchCount !== batchCount) {
          addDiag(i, 1, 7, `Batch Count (${fileBatchCount}) does not match actual batch count (${batchCount})`, 1);
        }

        const fileEntryCount = parseInt(getField(13, 21), 10);
        if (fileEntryCount !== totalEntryCount) {
          addDiag(i, 13, 21, `Total Entry/Addenda Count (${fileEntryCount}) does not match actual count (${totalEntryCount})`, 1);
        }

        const fileHashStr = getField(21, 31);
        const fileHashTail = (totalEntryHash % 10000000000n).toString().padStart(10, '0');
        if (fileHashStr !== fileHashTail) {
          addDiag(i, 21, 31, `File Entry Hash (${fileHashStr}) does not match calculated hash (${fileHashTail})`, 1);
        }

        const fileDebitAmount = parseInt(getField(31, 43), 10);
        if (fileDebitAmount !== totalDebitAmount) {
          addDiag(i, 31, 43, `File Total Debit amount ($${(fileDebitAmount / 100).toFixed(2)}) does not match actual ($${(totalDebitAmount / 100).toFixed(2)})`, 1);
        }

        const fileCreditAmount = parseInt(getField(43, 55), 10);
        if (fileCreditAmount !== totalCreditAmount) {
          addDiag(i, 43, 55, `File Total Credit amount ($${(fileCreditAmount / 100).toFixed(2)}) does not match actual ($${(totalCreditAmount / 100).toFixed(2)})`, 1);
        }

        // Block count: total lines (including 1, 5, 6, 7, 8, 9 and padding) / 10
        // NACHA files are blocked in multiples of 10 records.
        // We need to count all non-empty lines.
        const totalRecords = lines.filter(l => l.trim().length > 0).length;
        const expectedBlockCount = Math.ceil(totalRecords / 10);
        const fileBlockCount = parseInt(getField(7, 13), 10);
        if (fileBlockCount !== expectedBlockCount) {
          addDiag(i, 7, 13, `Block Count (${fileBlockCount}) does not match calculated count (${expectedBlockCount}) based on ${totalRecords} records`, 2);
        }
        break;
    }
  }

  // Final checks
  if (lines.some(l => l.length > 0)) {
    if (!seenFileHeader) {
      addDiag(0, 0, 1, 'Missing File Header (type 1) record');
    }
    const lastIdx = lastNonEmptyIndex(lines);
    if (lastIdx >= 0 && lines[lastIdx].charAt(0) !== '9') {
      addDiag(lastIdx, 0, 1, 'Missing File Control (type 9) record');
    }
  }

  return diags;
}

function lastNonEmptyIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) { return i; }
  }
  return -1;
}

function hasNonEmptyAfter(lines: string[], index: number): boolean {
  for (let i = index + 1; i < lines.length; i++) {
    if (lines[i].trim().length > 0) { return true; }
  }
  return false;
}

export function parseAchSummary(text: string): AchSummary {
  const lines = text.split(/\r?\n/);
  let batches = 0;
  let entries = 0;
  let totalDebit = 0;
  let totalCredit = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line.length === 0) {
      continue;
    }
    const type = line.charAt(0);

    if (type === '5') {
      batches++;
    } else if (type === '6') {
      entries++;

      if (line.length >= 39) {
        const transactionCode = line.substring(1, 3);
        const amountStr = line.substring(29, 39);
        const amount = parseInt(amountStr, 10) / 100; // Convert cents to dollars

        if (!isNaN(amount) && amount > 0) {
          // ACH Transaction codes:
          // X0-X4 = Credits (20-24, 30-34, 40-44, 50-54)
          // X5-X9 = Debits (25-29, 35-39, 45-49, 55-59)
          const lastDigit = parseInt(transactionCode.charAt(1), 10);

          if (lastDigit >= 0 && lastDigit <= 4) {
            totalCredit += amount;
          } else if (lastDigit >= 5 && lastDigit <= 9) {
            totalDebit += amount;
          }
        }
      }
    }
  }

  return {
    batches,
    entries,
    totalDebit,
    totalCredit,
    netAmount: totalCredit - totalDebit
  };
}
