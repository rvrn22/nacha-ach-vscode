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

// Basic NACHA/ACH parser: validates line length and record ordering.
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) {
      continue; // ignore blank trailing line
    }

    // Skip padding rows (blocking records)
    if (isPaddingRow(line)) {
      continue;
    }

    const firstChar = line.charAt(0);
    if (!recordTypes.has(firstChar)) {
      diags.push({
        line: i,
        start: 0,
        end: Math.max(1, Math.min(line.length, 1)),
        message: `Unknown record type '${firstChar}'. Expected one of 1,5,6,7,8,9`,
        severity: 1,
      });
    }

    // Length validation (allow >94 but warn; must be >=94)
    if (line.length < 94) {
      diags.push({
        line: i,
        start: 0,
        end: Math.max(1, line.length),
        message: `Record length ${line.length} is less than required 94 characters`,
        severity: 1,
      });
    } else if (line.length > 94) {
      // Soft warning: many files include extra padding; flag as hint
      diags.push({
        line: i,
        start: 94,
        end: line.length,
        message: `Record length ${line.length} exceeds 94 characters (extra trailing data)`,
        severity: 3,
      });
    }

    switch (firstChar) {
      case '1': // File Header must be first non-empty line
        if (seenFileHeader) {
          diags.push({
            line: i,
            start: 0,
            end: 1,
            message: 'Multiple File Header records (type 1) found',
            severity: 1,
          });
        }
        if (i !== 0) {
          diags.push({
            line: i,
            start: 0,
            end: 1,
            message: 'File Header (type 1) should be the first record',
            severity: 1,
          });
        }
        seenFileHeader = true;
        break;
      case '5': // Batch Header opens a batch
        if (!seenFileHeader) {
          diags.push({
            line: i,
            start: 0,
            end: 1,
            message: 'Batch Header (type 5) appears before File Header (type 1)',
            severity: 1,
          });
        }
        if (openBatch) {
          diags.push({
            line: i,
            start: 0,
            end: 1,
            message: 'Nested Batch Header (type 5) without closing previous batch (type 8)',
            severity: 1,
          });
        }
        openBatch = true;
        break;
      case '6': // Entry Detail must be inside a batch
      case '7': // Addenda must be inside a batch
        if (!openBatch) {
          diags.push({
            line: i,
            start: 0,
            end: 1,
            message: `Record type ${firstChar} appears outside of an open batch (type 5..8)`,
            severity: 1,
          });
        }
        break;
      case '8': // Batch Control closes a batch
        if (!openBatch) {
          diags.push({
            line: i,
            start: 0,
            end: 1,
            message: 'Batch Control (type 8) appears without a matching Batch Header (type 5)',
            severity: 1,
          });
        }
        openBatch = false;
        break;
      case '9': // File Control must be last record
        if (!seenFileHeader) {
          diags.push({
            line: i,
            start: 0,
            end: 1,
            message: 'File Control (type 9) appears before File Header (type 1)',
            severity: 1,
          });
        }
        // Check if there are non-padding records after type 9
        let hasNonPaddingAfter = false;
        for (let j = i + 1; j < lines.length; j++) {
          const afterLine = lines[j];
          if (afterLine.length > 0 && !/^9+$/.test(afterLine)) {
            hasNonPaddingAfter = true;
            break;
          }
        }
        
        if (hasNonPaddingAfter) {
          diags.push({
            line: i,
            start: 0,
            end: 1,
            message: 'File Control (type 9) should be the final record in the file (padding rows allowed)',
            severity: 1,
          });
        }
        if (openBatch) {
          diags.push({
            line: i,
            start: 0,
            end: 1,
            message: 'File closed (type 9) while a batch is still open (missing type 8)',
            severity: 1,
          });
        }
        break;
    }
  }

  // If file had content but no header/control, flag
  if (lines.some(l => l.length > 0)) {
    if (!seenFileHeader) {
      diags.push({
        line: 0,
        start: 0,
        end: 1,
        message: 'Missing File Header (type 1) record',
        severity: 1,
      });
    }
    const lastIdx = lastNonEmptyIndex(lines);
    if (lastIdx >= 0 && lines[lastIdx].charAt(0) !== '9') {
      diags.push({
        line: lastIdx,
        start: 0,
        end: 1,
        message: 'Missing File Control (type 9) at end of file',
        severity: 1,
      });
    }
  }

  return diags;
}

function lastNonEmptyIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].length > 0) {return i;}
  }
  return -1;
}

function hasNonEmptyAfter(lines: string[], index: number): boolean {
  for (let i = index + 1; i < lines.length; i++) {
    if (lines[i].length > 0) {return true;}
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
