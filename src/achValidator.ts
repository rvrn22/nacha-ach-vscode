import type { AchBatch, AchDocument, AchEntry, AchRecord } from './achDocument';
import { parseAchDocument } from './achDocument';
import {
  allowedAddendaTypesForSec,
  knownSecCodes,
  maximumAddendaForSec,
  transactionCodeCompatibility,
  transactionCodes,
  type TransactionCodeRule,
} from './achRules';
import {
  nachaValidationProfile,
  type AchDiagnostic,
  type AchDiagnosticSeverity,
  type AchRelatedLocation,
  type AchRuleCategory,
  type AchRuleSeverityName,
  type AchValidationProfile,
} from './achTypes';

type DiagnosticOptions = {
  severity?: AchDiagnosticSeverity;
  expected?: string;
  actual?: string;
  related?: AchRelatedLocation[];
};

type BatchTotals = {
  count: number;
  hash: bigint;
  debit: bigint;
  credit: bigint;
  hashValid: boolean;
  amountsValid: boolean;
};

class ValidationContext {
  readonly diagnostics: AchDiagnostic[] = [];

  constructor(readonly profile: AchValidationProfile) { }

  add(
    record: AchRecord | undefined,
    start: number,
    end: number,
    code: string,
    category: AchRuleCategory,
    message: string,
    options: DiagnosticOptions = {},
  ): void {
    const override = this.overrideFor(code, category);
    if (override?.severity === 'off') { return; }
    const line = record?.line ?? 0;
    const length = record?.raw.length ?? 0;
    const safeStart = Math.min(start, length);
    const safeEnd = Math.max(safeStart, Math.min(end, length));
    this.diagnostics.push({
      line,
      start: safeStart,
      end: safeEnd,
      message,
      severity: override ? this.severityValue(override.severity) : options.severity ?? 0,
      code,
      category,
      profile: this.profile.id,
      rulesVersion: this.profile.rulesVersion,
      overrideReason: override?.reason,
      expected: options.expected,
      actual: options.actual,
      related: options.related,
    });
  }

  addLine(
    line: number,
    length: number,
    code: string,
    category: AchRuleCategory,
    message: string,
    options: DiagnosticOptions = {},
  ): void {
    const override = this.overrideFor(code, category);
    if (override?.severity === 'off') { return; }
    this.diagnostics.push({
      line,
      start: 0,
      end: Math.min(Math.max(length, 0), 94),
      message,
      severity: override ? this.severityValue(override.severity) : options.severity ?? 0,
      code,
      category,
      profile: this.profile.id,
      rulesVersion: this.profile.rulesVersion,
      overrideReason: override?.reason,
      expected: options.expected,
      actual: options.actual,
      related: options.related,
    });
  }

  private overrideFor(code: string, category: AchRuleCategory) {
    return this.profile.ruleOverrides[code]
      ?? this.profile.ruleOverrides[`category:${category}`]
      ?? this.profile.ruleOverrides['*'];
  }

  private severityValue(severity: Exclude<AchRuleSeverityName, 'off'>): AchDiagnosticSeverity {
    return severity === 'error' ? 0 : severity === 'warning' ? 1 : severity === 'information' ? 2 : 3;
  }
}

function related(record: AchRecord, start: number, end: number, message: string): AchRelatedLocation {
  return { line: record.line, start, end, message };
}

function isDigits(value: string): boolean {
  return /^\d+$/.test(value);
}

function parseBigInt(value: string): bigint | undefined {
  return isDigits(value) ? BigInt(value) : undefined;
}

function isValidAchDate(value: string): boolean {
  if (!/^\d{6}$/.test(value)) { return false; }
  const year = 2000 + Number(value.substring(0, 2));
  const month = Number(value.substring(2, 4));
  const day = Number(value.substring(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isValidAchTime(value: string): boolean {
  if (!/^\d{4}$/.test(value)) { return false; }
  const hour = Number(value.substring(0, 2));
  const minute = Number(value.substring(2, 4));
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function calculateCheckDigit(routing8: string): number {
  const weights = [3, 7, 1, 3, 7, 1, 3, 7];
  let sum = 0;
  for (let index = 0; index < routing8.length; index++) {
    sum += Number(routing8[index]) * weights[index];
  }
  return (10 - (sum % 10)) % 10;
}

function validatePhysical(document: AchDocument, context: ValidationContext): void {
  for (let line = 0; line < document.lines.length; line++) {
    const raw = document.lines[line];
    if (raw.length === 0) {
      if (line < document.lines.length - 1) {
        context.addLine(line, 0, 'ACH-PHYSICAL-BLANK-LINE', 'physical', 'Blank records are not allowed inside an ACH file', { severity: 1 });
      }
      continue;
    }

    const record = document.recordByLine.get(line);
    if (raw.length !== 94) {
      context.add(
        record,
        raw.length > 94 ? 94 : 0,
        raw.length,
        'ACH-PHYSICAL-RECORD-LENGTH',
        'physical',
        `Record length is ${raw.length}; ACH records must contain exactly 94 characters`,
        { expected: '94', actual: String(raw.length) },
      );
    }

    if (context.profile.validateAsciiCharacters) {
      const invalidOffset = [...raw].findIndex(character => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 0x20 || codePoint > 0x7e;
      });
      if (invalidOffset >= 0) {
        context.add(record, invalidOffset, invalidOffset + 1, 'ACH-PHYSICAL-CHARACTER-SET', 'physical', 'ACH records must use printable ASCII characters');
      }
    }
  }

  const physicalRecords = document.lines.filter(line => line.length > 0).length;
  const nonPaddingRecords = document.records.filter(record => record.kind !== 'padding').length;
  const requiredPadding = (10 - (nonPaddingRecords % 10)) % 10;
  if (context.profile.requireBlocking) {
    if (physicalRecords % 10 !== 0) {
      const last = document.records.at(-1);
      context.add(last, 0, last?.raw.length ?? 0, 'ACH-PHYSICAL-BLOCK-MULTIPLE', 'physical', 'Physical record count must be a multiple of the blocking factor 10', {
        expected: 'multiple of 10',
        actual: String(physicalRecords),
      });
    }
    if (document.paddingRecords.length !== requiredPadding) {
      const target = document.fileControls[0] ?? document.records.at(-1);
      context.add(target, 0, target?.raw.length ?? 0, 'ACH-PHYSICAL-PADDING-COUNT', 'physical', 'Padding record count does not match the number required to complete a block', {
        expected: String(requiredPadding),
        actual: String(document.paddingRecords.length),
      });
    }
  }
}

type StructureState = 'expectFileHeader' | 'betweenBatches' | 'inBatch' | 'afterFileControl';

function validateStructure(document: AchDocument, context: ValidationContext): void {
  let state: StructureState = 'expectFileHeader';
  let currentBatchHeader: AchRecord | undefined;
  let currentEntry: AchRecord | undefined;
  let paddingStarted = false;

  for (const record of document.records) {
    if (record.kind === 'padding') {
      paddingStarted = true;
      if (state !== 'afterFileControl') {
        context.add(record, 0, 94, 'ACH-STRUCTURE-PADDING-PLACEMENT', 'structural', 'Padding records are allowed only after the File Control record');
      }
      continue;
    }

    if (paddingStarted) {
      context.add(record, 0, 1, 'ACH-STRUCTURE-RECORD-AFTER-PADDING', 'structural', 'Only padding records may follow the first padding record');
    }
    if (state === 'afterFileControl') {
      context.add(record, 0, 1, 'ACH-STRUCTURE-RECORD-AFTER-FILE-CONTROL', 'structural', 'No non-padding record may follow the File Control record');
    }

    switch (record.kind) {
      case 'fileHeader':
        if (state !== 'expectFileHeader') {
          context.add(record, 0, 1, 'ACH-STRUCTURE-FILE-HEADER-POSITION', 'structural', 'The File Header must be the first and only type 1 record');
        }
        state = 'betweenBatches';
        currentBatchHeader = undefined;
        currentEntry = undefined;
        break;

      case 'batchHeader':
        if (state === 'expectFileHeader') {
          context.add(record, 0, 1, 'ACH-STRUCTURE-MISSING-FILE-HEADER-BEFORE-BATCH', 'structural', 'Batch Header appears before the File Header');
        } else if (state === 'inBatch') {
          context.add(record, 0, 1, 'ACH-STRUCTURE-UNCLOSED-BATCH', 'structural', 'A new Batch Header appears before the previous batch was closed', {
            related: currentBatchHeader ? [related(currentBatchHeader, 0, 1, 'Unclosed batch begins here')] : undefined,
          });
        }
        state = 'inBatch';
        currentBatchHeader = record;
        currentEntry = undefined;
        break;

      case 'entryDetail':
        if (state !== 'inBatch') {
          context.add(record, 0, 1, 'ACH-STRUCTURE-ENTRY-OUTSIDE-BATCH', 'structural', 'Entry Detail record is outside a batch');
        }
        currentEntry = record;
        break;

      case 'addenda':
        if (state !== 'inBatch') {
          context.add(record, 0, 1, 'ACH-STRUCTURE-ADDENDA-OUTSIDE-BATCH', 'structural', 'Addenda record is outside a batch');
        } else if (!currentEntry) {
          context.add(record, 0, 3, 'ACH-STRUCTURE-ADDENDA-WITHOUT-ENTRY', 'structural', 'Addenda record does not immediately follow an Entry Detail record');
        }
        break;

      case 'batchControl':
        if (state !== 'inBatch') {
          context.add(record, 0, 1, 'ACH-STRUCTURE-BATCH-CONTROL-WITHOUT-HEADER', 'structural', 'Batch Control record has no open Batch Header');
        }
        state = 'betweenBatches';
        currentBatchHeader = undefined;
        currentEntry = undefined;
        break;

      case 'fileControl':
        if (state === 'expectFileHeader') {
          context.add(record, 0, 1, 'ACH-STRUCTURE-FILE-CONTROL-BEFORE-HEADER', 'structural', 'File Control appears before the File Header');
        } else if (state === 'inBatch') {
          context.add(record, 0, 1, 'ACH-STRUCTURE-FILE-CONTROL-IN-BATCH', 'structural', 'File Control appears before the current batch was closed', {
            related: currentBatchHeader ? [related(currentBatchHeader, 0, 1, 'Unclosed batch begins here')] : undefined,
          });
        }
        state = 'afterFileControl';
        currentBatchHeader = undefined;
        currentEntry = undefined;
        break;

      case 'unknown':
        context.add(record, 0, 1, 'ACH-STRUCTURE-UNKNOWN-RECORD', 'structural', `Unknown record type '${record.recordType}'`);
        currentEntry = undefined;
        break;

    }
  }

  if (document.fileHeaders.length === 0 && document.records.length > 0) {
    context.add(document.records[0], 0, 1, 'ACH-STRUCTURE-MISSING-FILE-HEADER', 'structural', 'ACH file is missing its File Header record');
  }
  if (document.fileHeaders.length > 1) {
    for (const duplicate of document.fileHeaders.slice(1)) {
      context.add(duplicate, 0, 1, 'ACH-STRUCTURE-DUPLICATE-FILE-HEADER', 'structural', 'ACH file contains more than one File Header record');
    }
  }
  if (document.fileControls.length === 0 && document.records.length > 0) {
    const target = document.paddingRecords[0] ?? document.records.at(-1);
    context.add(target, 0, Math.min(target?.raw.length ?? 0, 1), 'ACH-STRUCTURE-MISSING-FILE-CONTROL', 'structural', 'ACH file is missing its File Control record');
  }
  if (document.fileControls.length > 1) {
    for (const duplicate of document.fileControls.slice(1)) {
      context.add(duplicate, 0, 1, 'ACH-STRUCTURE-DUPLICATE-FILE-CONTROL', 'structural', 'ACH file contains more than one File Control record');
    }
  }
  for (const batch of document.batches) {
    if (!batch.control) {
      context.add(batch.header, 0, 1, 'ACH-STRUCTURE-MISSING-BATCH-CONTROL', 'structural', 'Batch is missing its Batch Control record');
    }
  }
}

function expectValue(
  record: AchRecord,
  start: number,
  end: number,
  expected: string,
  code: string,
  message: string,
  context: ValidationContext,
): void {
  const actual = record.raw.substring(start, end);
  if (actual !== expected) {
    context.add(record, start, end, code, 'field', message, { expected, actual });
  }
}

function validateFileHeader(record: AchRecord, context: ValidationContext): void {
  expectValue(record, 1, 3, '01', 'ACH-FIELD-PRIORITY-CODE', 'Priority Code must be 01', context);
  if (record.raw.substring(3, 13).trim().length === 0) {
    context.add(record, 3, 13, 'ACH-FIELD-IMMEDIATE-DESTINATION-REQUIRED', 'field', 'Immediate Destination is required');
  }
  if (record.raw.substring(13, 23).trim().length === 0) {
    context.add(record, 13, 23, 'ACH-FIELD-IMMEDIATE-ORIGIN-REQUIRED', 'field', 'Immediate Origin is required');
  }
  const date = record.raw.substring(23, 29);
  if (!isValidAchDate(date)) {
    context.add(record, 23, 29, 'ACH-FIELD-FILE-CREATION-DATE', 'field', 'File Creation Date is not a real YYMMDD calendar date', { expected: 'valid YYMMDD', actual: date });
  }
  const time = record.raw.substring(29, 33);
  if (time.trim().length > 0 && !isValidAchTime(time)) {
    context.add(record, 29, 33, 'ACH-FIELD-FILE-CREATION-TIME', 'field', 'File Creation Time is not a valid 24-hour HHMM time', { expected: '0000-2359', actual: time });
  }
  const modifier = record.raw.substring(33, 34);
  if (!/^[A-Z0-9]$/.test(modifier)) {
    context.add(record, 33, 34, 'ACH-FIELD-FILE-ID-MODIFIER', 'field', 'File ID Modifier must be an uppercase letter or digit', { expected: 'A-Z or 0-9', actual: modifier });
  }
  expectValue(record, 34, 37, '094', 'ACH-FIELD-RECORD-SIZE', 'Record Size must be 094', context);
  expectValue(record, 37, 39, '10', 'ACH-FIELD-BLOCKING-FACTOR', 'Blocking Factor must be 10', context);
  expectValue(record, 39, 40, '1', 'ACH-FIELD-FORMAT-CODE', 'Format Code must be 1', context);
}

function validateBatchHeader(batch: AchBatch, context: ValidationContext): void {
  const record = batch.header;
  const serviceClass = record.raw.substring(1, 4);
  if (!['200', '220', '225'].includes(serviceClass)) {
    context.add(record, 1, 4, 'ACH-FIELD-SERVICE-CLASS', 'field', 'Service Class Code must be 200, 220, or 225', { expected: '200, 220, or 225', actual: serviceClass });
  }
  if (record.raw.substring(40, 50).trim().length === 0) {
    context.add(record, 40, 50, 'ACH-FIELD-COMPANY-ID-REQUIRED', 'field', 'Company Identification is required');
  }
  if (!knownSecCodes.has(batch.secCode)) {
    context.add(record, 50, 53, 'ACH-SEC-UNKNOWN-CODE', 'sec', `Unknown or unsupported SEC code '${batch.secCode}'`, { severity: 1, actual: batch.secCode });
  }
  if (batch.secCode === 'IAT') {
    const iatIndicator = record.raw.substring(4, 20);
    if (!['', 'IAT', 'IATCOR'].includes(iatIndicator.trim())) {
      context.add(record, 4, 20, 'ACH-IAT-INDICATOR', 'sec', 'IAT Indicator must be blank for a forward IAT entry or contain IATCOR for an IAT Notification of Change', { expected: 'blank or IATCOR', actual: iatIndicator });
    }
  }
  const effectiveDate = record.raw.substring(69, 75);
  if (!isValidAchDate(effectiveDate)) {
    context.add(record, 69, 75, 'ACH-FIELD-EFFECTIVE-DATE', 'field', 'Effective Entry Date is not a real YYMMDD calendar date', { expected: 'valid YYMMDD', actual: effectiveDate });
  }
  expectValue(record, 78, 79, '1', 'ACH-FIELD-ORIGINATOR-STATUS', 'Originator Status Code must be 1', context);
  const odfi = record.raw.substring(79, 87);
  if (!isDigits(odfi)) {
    context.add(record, 79, 87, 'ACH-FIELD-ODFI-ID', 'field', 'Originating DFI Identification must contain 8 digits');
  }
  const batchNumber = record.raw.substring(87, 94);
  if (!isDigits(batchNumber)) {
    context.add(record, 87, 94, 'ACH-FIELD-BATCH-NUMBER', 'field', 'Batch Number must contain 7 digits');
  }
}

function validateReversalBatch(batch: AchBatch, context: ValidationContext): void {
  const rawDescription = batch.header.raw.substring(53, 63);
  const description = rawDescription.trim();
  if (description.toUpperCase() === 'REVERSAL' && description !== 'REVERSAL') {
    context.add(batch.header, 53, 63, 'ACH-REVERSAL-DESCRIPTION', 'field', 'A reversal batch must use uppercase REVERSAL in the Company Entry Description field', {
      expected: 'REVERSAL  ',
      actual: rawDescription,
    });
    return;
  }
  if (!batch.isReversal) { return; }

  for (const entry of batch.entries) {
    if (entry.detail.raw.length !== 94) { continue; }
    const transactionCode = entry.detail.raw.substring(1, 3);
    const rule = transactionCodes.get(transactionCode);
    if (rule && rule.kind !== 'payment') {
      context.add(entry.detail, 1, 3, 'ACH-REVERSAL-TRANSACTION-KIND', 'sec', 'A reversal batch must contain payment transaction codes, not Return, prenote, zero-dollar, or settlement entries', {
        expected: 'payment transaction code',
        actual: `${transactionCode} (${rule.kind})`,
        related: [related(batch.header, 53, 63, 'REVERSAL Company Entry Description')],
      });
    }
  }
}

function validateEntry(entry: AchEntry, batch: AchBatch, context: ValidationContext): TransactionCodeRule | undefined {
  const record = entry.detail;
  const transactionCode = record.raw.substring(1, 3);
  const rule = transactionCodes.get(transactionCode);
  if (!rule) {
    context.add(record, 1, 3, 'ACH-FIELD-TRANSACTION-CODE', 'field', `Unknown or reserved transaction code '${transactionCode}'`, { actual: transactionCode });
  } else if (context.profile.validateSecCompatibility) {
    const incompatibility = transactionCodeCompatibility(rule, batch.secCode);
    if (incompatibility) {
      context.add(record, 1, 3, 'ACH-SEC-TRANSACTION-CODE', 'sec', incompatibility, { severity: 1, actual: transactionCode });
    }
  }

  const amountRaw = record.raw.substring(29, 39);
  const amount = parseBigInt(amountRaw);
  if (amount === undefined) {
    context.add(record, 29, 39, 'ACH-FIELD-AMOUNT-NUMERIC', 'field', 'Amount must contain 10 digits', { actual: amountRaw });
  } else if (rule && ['prenote', 'zeroDollar'].includes(rule.kind) && amount !== 0n) {
    context.add(record, 29, 39, 'ACH-FIELD-NONMONETARY-AMOUNT', 'field', `${rule.description} must have a zero amount`, { expected: '0000000000', actual: amountRaw });
  }

  const rdfi = record.raw.substring(3, 11);
  if (!/^\d{8}$/.test(rdfi)) {
    context.add(record, 3, 11, 'ACH-FIELD-RDFI-ID', 'field', 'Receiving DFI Identification must contain 8 digits');
  } else {
    const actualCheckDigit = record.raw.substring(11, 12);
    const expectedCheckDigit = String(calculateCheckDigit(rdfi));
    if (actualCheckDigit !== expectedCheckDigit) {
      context.add(record, 11, 12, 'ACH-FIELD-ROUTING-CHECK-DIGIT', 'field', `Routing check digit should be ${expectedCheckDigit}`, { expected: expectedCheckDigit, actual: actualCheckDigit });
    }
  }

  const trace = record.raw.substring(79, 94);
  if (!/^\d{15}$/.test(trace)) {
    context.add(record, 79, 94, 'ACH-FIELD-TRACE-NUMBER', 'field', 'Trace Number must contain 15 digits');
  } else {
    const odfi = batch.header.raw.substring(79, 87);
    if (trace.substring(0, 8) !== odfi) {
      context.add(record, 79, 87, 'ACH-RELATION-TRACE-ODFI', 'relational', 'The first 8 trace digits must match the batch Originating DFI Identification', {
        expected: odfi,
        actual: trace.substring(0, 8),
        related: [related(batch.header, 79, 87, 'Originating DFI Identification')],
      });
    }
  }

  validateEntryAddenda(entry, batch, rule, context);
  return rule;
}

function validateSpecialAddenda(addenda: AchRecord, detail: AchRecord, context: ValidationContext): void {
  const addendaType = addenda.raw.substring(1, 3);
  const code = addenda.raw.substring(3, 6);
  const originalTrace = addenda.raw.substring(6, 21);
  const originalRdfi = addenda.raw.substring(27, 35);
  const trace = addenda.raw.substring(79, 94);

  if (addendaType === '98') {
    if (!/^C\d{2}$/.test(code)) {
      context.add(addenda, 3, 6, 'ACH-NOC-CHANGE-CODE', 'field', 'Notification of Change code must use C followed by 2 digits', { expected: 'C00-C99', actual: code });
    }
    const correctedDataEnd = addenda.secCode === 'IAT' ? 70 : 64;
    const firstReserved = addenda.raw.substring(21, 27);
    const secondReserved = addenda.raw.substring(correctedDataEnd, 79);
    if (firstReserved.trim().length > 0) {
      context.add(addenda, 21, 27, 'ACH-NOC-RESERVED', 'field', 'Notification of Change reserved field must be blank', { expected: 'blank', actual: firstReserved });
    }
    if (secondReserved.trim().length > 0) {
      context.add(addenda, correctedDataEnd, 79, 'ACH-NOC-RESERVED', 'field', 'Notification of Change reserved field must be blank', { expected: 'blank', actual: secondReserved });
    }
    if (addenda.raw.substring(35, correctedDataEnd).trim().length === 0) {
      context.add(addenda, 35, correctedDataEnd, 'ACH-NOC-CORRECTED-DATA-REQUIRED', 'field', 'Notification of Change Corrected Data must not be blank');
    }
  } else {
    if (!/^R\d{2}$/.test(code)) {
      context.add(addenda, 3, 6, 'ACH-RETURN-REASON-CODE', 'field', 'Return Reason Code must use R followed by 2 digits', { expected: 'R00-R99', actual: code });
    }
    const dateOfDeath = addenda.raw.substring(21, 27);
    if (['R14', 'R15'].includes(code)) {
      if (!isValidAchDate(dateOfDeath)) {
        context.add(addenda, 21, 27, 'ACH-RETURN-DATE-OF-DEATH', 'field', 'Date of Death is required as a real YYMMDD date for return reason R14 or R15', { expected: 'valid YYMMDD', actual: dateOfDeath });
      }
    } else if (dateOfDeath.trim().length > 0) {
      context.add(addenda, 21, 27, 'ACH-RETURN-DATE-OF-DEATH', 'field', 'Date of Death must be blank unless the Return Reason Code is R14 or R15', { expected: 'blank', actual: dateOfDeath });
    }
    if (addenda.secCode === 'IAT' && !/^\d{10}$/.test(addenda.raw.substring(35, 45))) {
      context.add(addenda, 35, 45, 'ACH-IAT-RETURN-ORIGINAL-AMOUNT', 'field', 'IAT Return Original Forward Entry Payment Amount must contain 10 digits');
    }
  }

  if (!/^\d{15}$/.test(originalTrace)) {
    context.add(addenda, 6, 21, 'ACH-RETURN-NOC-ORIGINAL-TRACE', 'field', 'Original Entry Trace Number must contain 15 digits');
  }
  if (!/^\d{8}$/.test(originalRdfi)) {
    context.add(addenda, 27, 35, 'ACH-RETURN-NOC-ORIGINAL-RDFI', 'field', 'Original Receiving DFI Identification must contain 8 digits');
  }
  if (!/^\d{15}$/.test(trace)) {
    context.add(addenda, 79, 94, 'ACH-RETURN-NOC-TRACE-NUMERIC', 'field', 'Return/NOC Trace Number must contain 15 digits');
  } else {
    const expectedTrace = detail.raw.substring(79, 94);
    if (trace !== expectedTrace) {
      context.add(addenda, 79, 94, 'ACH-RELATION-ADDENDA-TRACE', 'relational', 'Return/NOC Addenda Trace Number must match the related Entry Detail Trace Number', {
        expected: expectedTrace,
        actual: trace,
        related: [related(detail, 79, 94, 'Related Entry Detail trace number')],
      });
    }
  }
}

function validateEntryAddenda(entry: AchEntry, batch: AchBatch, rule: TransactionCodeRule | undefined, context: ValidationContext): void {
  const detail = entry.detail;
  const actualCount = entry.addenda.length;
  const indicator = detail.raw.substring(78, 79);
  const expectedIndicator = batch.secCode === 'IAT' ? '1' : (actualCount > 0 ? '1' : '0');
  if (indicator !== expectedIndicator) {
    context.add(detail, 78, 79, 'ACH-RELATION-ADDENDA-INDICATOR', 'relational', 'Addenda Record Indicator does not match the actual attached addenda records', {
      expected: expectedIndicator,
      actual: indicator,
      related: entry.addenda.map(addenda => related(addenda, 0, 3, 'Attached addenda record')),
    });
  }

  const maximum = maximumAddendaForSec(batch.secCode);
  const returnOrNoc = entry.addenda.some(addenda => ['98', '99'].includes(addenda.raw.substring(1, 3)));
  if (maximum !== undefined && actualCount > maximum && !returnOrNoc) {
    context.add(detail, 78, 79, 'ACH-SEC-ADDENDA-MAXIMUM', 'sec', `${batch.secCode} permits at most ${maximum} addenda record(s) per entry`, {
      expected: `0-${maximum}`,
      actual: String(actualCount),
    });
  }

  const returnAddenda = entry.addenda.filter(addenda => addenda.raw.substring(1, 3) === '99');
  const nocAddenda = entry.addenda.filter(addenda => addenda.raw.substring(1, 3) === '98');
  const isIatNoc = batch.secCode === 'IAT' && batch.header.raw.substring(4, 20).trim() === 'IATCOR';
  const isNoc = batch.secCode === 'COR' || isIatNoc;
  if (isNoc) {
    if (actualCount !== 1 || nocAddenda.length !== 1 || returnAddenda.length > 0) {
      context.add(detail, 78, 79, 'ACH-NOC-ADDENDA-REQUIRED', 'sec', 'A Notification of Change entry requires exactly one addenda record (type 98)', {
        expected: 'one type 98 addenda',
        actual: `${nocAddenda.length} type 98, ${returnAddenda.length} type 99`,
      });
    }
    if (detail.raw.substring(29, 39) !== '0000000000') {
      context.add(detail, 29, 39, 'ACH-NOC-AMOUNT-ZERO', 'sec', 'Notification of Change entries must have a zero amount', { expected: '0000000000', actual: detail.raw.substring(29, 39) });
    }
  } else if (rule?.kind === 'return' && (returnAddenda.length !== 1 || (batch.secCode !== 'IAT' && actualCount !== 1))) {
    context.add(detail, 78, 79, 'ACH-RETURN-ADDENDA-REQUIRED', 'sec', 'A return entry requires exactly one Return addenda record (type 99)', {
      expected: 'one type 99 addenda',
      actual: String(returnAddenda.length),
    });
  } else if (rule && rule.kind !== 'return' && returnOrNoc) {
    context.add(detail, 1, 3, 'ACH-RETURN-NOC-TRANSACTION-CODE', 'sec', 'Return/NOC addenda requires a return or Notification of Change transaction code', { actual: detail.raw.substring(1, 3) });
  }

  if (batch.secCode === 'IAT') {
    const declaredRaw = detail.raw.substring(12, 16);
    const declared = isDigits(declaredRaw) ? Number(declaredRaw) : undefined;
    if (declared === undefined) {
      context.add(detail, 12, 16, 'ACH-IAT-ADDENDA-COUNT-NUMERIC', 'sec', 'IAT Number of Addenda Records must contain 4 digits', { actual: declaredRaw });
    } else if (declared !== actualCount) {
      context.add(detail, 12, 16, 'ACH-IAT-ADDENDA-COUNT', 'sec', 'Declared IAT addenda count does not match actual attached addenda records', {
        expected: String(actualCount).padStart(4, '0'),
        actual: declaredRaw,
        related: entry.addenda.map(addenda => related(addenda, 0, 3, 'Attached IAT addenda record')),
      });
    }
    if (!returnOrNoc && (actualCount < 7 || actualCount > 12)) {
      context.add(detail, 12, 16, 'ACH-IAT-ADDENDA-RANGE', 'sec', 'IAT entries require between 7 and 12 addenda records', { expected: '7-12', actual: String(actualCount) });
    }
    if (!returnOrNoc) {
      const mandatoryTypes = ['10', '11', '12', '13', '14', '15', '16'];
      for (let index = 0; index < mandatoryTypes.length; index++) {
        const actualType = entry.addenda[index]?.raw.substring(1, 3);
        if (actualType !== mandatoryTypes[index]) {
          const target = entry.addenda[index] ?? detail;
          context.add(target, target === detail ? 12 : 1, target === detail ? 16 : 3, 'ACH-IAT-MANDATORY-ADDENDA', 'sec', `IAT mandatory addenda ${mandatoryTypes[index]} is missing or out of order`, {
            expected: mandatoryTypes[index],
            actual: actualType ?? 'missing',
          });
        }
      }
    }
  }

  const traceSequence = detail.raw.substring(87, 94);
  const allowedTypes = allowedAddendaTypesForSec(batch.secCode);
  for (let index = 0; index < entry.addenda.length; index++) {
    const addenda = entry.addenda[index];
    const addendaType = addenda.raw.substring(1, 3);
    if (!/^\d{2}$/.test(addendaType)) {
      context.add(addenda, 1, 3, 'ACH-FIELD-ADDENDA-TYPE', 'field', 'Addenda Type Code must contain 2 digits');
    } else if (allowedTypes && !allowedTypes.has(addendaType) && !['98', '99'].includes(addendaType)) {
      context.add(addenda, 1, 3, 'ACH-SEC-ADDENDA-TYPE', 'sec', `Addenda Type ${addendaType} is not valid for SEC ${batch.secCode}`, {
        expected: [...allowedTypes].join(', '),
        actual: addendaType,
      });
    }
    if (['98', '99'].includes(addendaType)) {
      validateSpecialAddenda(addenda, detail, context);
    } else {
      const entrySequence = addenda.raw.substring(87, 94);
      if (entrySequence !== traceSequence) {
        context.add(addenda, 87, 94, 'ACH-RELATION-ADDENDA-ENTRY-SEQUENCE', 'relational', 'Entry Detail Sequence Number must match the last 7 digits of the related trace number', {
          expected: traceSequence,
          actual: entrySequence,
          related: [related(detail, 87, 94, 'Related Entry Detail trace sequence')],
        });
      }
    }
    if (batch.secCode !== 'IAT' && addendaType === '05') {
      const sequenceRaw = addenda.raw.substring(83, 87);
      const expectedSequence = String(index + 1).padStart(4, '0');
      if (sequenceRaw !== expectedSequence) {
        context.add(addenda, 83, 87, 'ACH-RELATION-ADDENDA-SEQUENCE', 'relational', 'Addenda Sequence Number is not sequential for its entry', { expected: expectedSequence, actual: sequenceRaw });
      }
    }
  }
}

function calculateBatchTotals(batch: AchBatch, context: ValidationContext): BatchTotals {
  let hash = 0n;
  let debit = 0n;
  let credit = 0n;
  let hashValid = true;
  let amountsValid = true;

  for (const entry of batch.entries) {
    if (entry.detail.raw.length !== 94) {
      hashValid = false;
      amountsValid = false;
      continue;
    }
    const rule = validateEntry(entry, batch, context);
    const rdfi = parseBigInt(entry.detail.raw.substring(3, 11));
    if (rdfi === undefined) {
      hashValid = false;
    } else {
      hash += rdfi;
    }
    const amount = parseBigInt(entry.detail.raw.substring(29, 39));
    if (amount === undefined || !rule) {
      amountsValid = false;
    } else if (rule.direction === 'credit') {
      credit += amount;
    } else {
      debit += amount;
    }
  }

  return {
    count: batch.records.filter(record => record.kind === 'entryDetail' || record.kind === 'addenda').length,
    hash,
    debit,
    credit,
    hashValid,
    amountsValid,
  };
}

function compareHeaderControl(
  header: AchRecord,
  control: AchRecord,
  headerStart: number,
  headerEnd: number,
  controlStart: number,
  controlEnd: number,
  code: string,
  label: string,
  context: ValidationContext,
): void {
  const expected = header.raw.substring(headerStart, headerEnd);
  const actual = control.raw.substring(controlStart, controlEnd);
  if (actual !== expected) {
    context.add(control, controlStart, controlEnd, code, 'relational', `${label} does not match the Batch Header`, {
      expected,
      actual,
      related: [related(header, headerStart, headerEnd, `Batch Header ${label}`)],
    });
  }
}

function validateBatchControl(batch: AchBatch, totals: BatchTotals, context: ValidationContext): void {
  const control = batch.control;
  if (!control || control.raw.length !== 94) { return; }
  const expectedCount = String(totals.count).padStart(6, '0');
  const expectedHash = totals.hashValid ? (totals.hash % 10000000000n).toString().padStart(10, '0') : undefined;
  const expectedDebit = totals.amountsValid ? totals.debit.toString().padStart(12, '0') : undefined;
  const expectedCredit = totals.amountsValid ? totals.credit.toString().padStart(12, '0') : undefined;
  for (const [start, end, code, label, expected] of [
    [4, 10, 'ACH-FIELD-BATCH-ENTRY-COUNT', 'Entry/Addenda Count', expectedCount],
    [10, 20, 'ACH-FIELD-BATCH-HASH', 'Entry Hash', expectedHash],
    [20, 32, 'ACH-FIELD-BATCH-DEBIT', 'Total Debit', expectedDebit],
    [32, 44, 'ACH-FIELD-BATCH-CREDIT', 'Total Credit', expectedCredit],
  ] as const) {
    const value = control.raw.substring(start, end);
    if (!isDigits(value)) {
      context.add(control, start, end, code, 'field', `${label} must be numeric`, { actual: value, expected });
    }
  }
  if (control.raw.substring(73, 79).trim().length > 0) {
    context.add(control, 73, 79, 'ACH-FIELD-BATCH-CONTROL-RESERVED', 'field', 'Batch Control reserved field must be blank');
  }
  compareHeaderControl(batch.header, control, 1, 4, 1, 4, 'ACH-RELATION-SERVICE-CLASS', 'Service Class Code', context);
  compareHeaderControl(batch.header, control, 40, 50, 44, 54, 'ACH-RELATION-COMPANY-ID', 'Company Identification', context);
  compareHeaderControl(batch.header, control, 79, 87, 79, 87, 'ACH-RELATION-ODFI-ID', 'Originating DFI Identification', context);
  compareHeaderControl(batch.header, control, 87, 94, 87, 94, 'ACH-RELATION-BATCH-NUMBER', 'Batch Number', context);

  const actualCount = control.raw.substring(4, 10);
  if (isDigits(actualCount) && actualCount !== expectedCount) {
    context.add(control, 4, 10, 'ACH-RELATION-BATCH-ENTRY-COUNT', 'relational', 'Batch Entry/Addenda Count does not match actual records', { expected: expectedCount, actual: actualCount });
  }
  if (totals.hashValid) {
    const actualHash = control.raw.substring(10, 20);
    if (expectedHash && isDigits(actualHash) && actualHash !== expectedHash) {
      context.add(control, 10, 20, 'ACH-RELATION-BATCH-HASH', 'relational', 'Batch Entry Hash does not match the calculated hash', { expected: expectedHash, actual: actualHash });
    }
  }
  if (totals.amountsValid) {
    const actualDebit = control.raw.substring(20, 32);
    const actualCredit = control.raw.substring(32, 44);
    if (expectedDebit && isDigits(actualDebit) && actualDebit !== expectedDebit) {
      context.add(control, 20, 32, 'ACH-RELATION-BATCH-DEBIT', 'relational', 'Batch debit total does not match the calculated total', { expected: expectedDebit, actual: actualDebit });
    }
    if (expectedCredit && isDigits(actualCredit) && actualCredit !== expectedCredit) {
      context.add(control, 32, 44, 'ACH-RELATION-BATCH-CREDIT', 'relational', 'Batch credit total does not match the calculated total', { expected: expectedCredit, actual: actualCredit });
    }

    const serviceClass = batch.header.raw.substring(1, 4);
    if (serviceClass === '220' && totals.debit !== 0n) {
      context.add(batch.header, 1, 4, 'ACH-SEC-SERVICE-CLASS-DIRECTION', 'sec', 'Credits-only Service Class 220 contains debit entries', { expected: 'credit entries only', actual: `${totals.debit} debit cents` });
    }
    if (serviceClass === '225' && totals.credit !== 0n) {
      context.add(batch.header, 1, 4, 'ACH-SEC-SERVICE-CLASS-DIRECTION', 'sec', 'Debits-only Service Class 225 contains credit entries', { expected: 'debit entries only', actual: `${totals.credit} credit cents` });
    }
  }
}

function validateFileControl(document: AchDocument, batchTotals: BatchTotals[], context: ValidationContext): void {
  const control = document.fileControls[0];
  if (!control || control.raw.length !== 94) { return; }
  const expectedBatchCount = String(document.batches.length).padStart(6, '0');
  const physicalRecords = document.lines.filter(line => line.length > 0).length;
  const expectedBlockCount = String(Math.ceil(physicalRecords / 10)).padStart(6, '0');
  const totalCount = batchTotals.reduce((sum, totals) => sum + totals.count, 0);
  const expectedEntryCount = String(totalCount).padStart(8, '0');
  const expectedHash = batchTotals.every(totals => totals.hashValid)
    ? (batchTotals.reduce((sum, totals) => sum + totals.hash, 0n) % 10000000000n).toString().padStart(10, '0')
    : undefined;
  const expectedDebit = batchTotals.every(totals => totals.amountsValid)
    ? batchTotals.reduce((sum, totals) => sum + totals.debit, 0n).toString().padStart(12, '0')
    : undefined;
  const expectedCredit = batchTotals.every(totals => totals.amountsValid)
    ? batchTotals.reduce((sum, totals) => sum + totals.credit, 0n).toString().padStart(12, '0')
    : undefined;

  for (const [start, end, code, label, expected] of [
    [1, 7, 'ACH-FIELD-FILE-BATCH-COUNT', 'Batch Count', expectedBatchCount],
    [7, 13, 'ACH-FIELD-FILE-BLOCK-COUNT', 'Block Count', expectedBlockCount],
    [13, 21, 'ACH-FIELD-FILE-ENTRY-COUNT', 'Entry/Addenda Count', expectedEntryCount],
    [21, 31, 'ACH-FIELD-FILE-HASH', 'Entry Hash', expectedHash],
    [31, 43, 'ACH-FIELD-FILE-DEBIT', 'Total Debit', expectedDebit],
    [43, 55, 'ACH-FIELD-FILE-CREDIT', 'Total Credit', expectedCredit],
  ] as const) {
    const value = control.raw.substring(start, end);
    if (!isDigits(value)) {
      context.add(control, start, end, code, 'field', `${label} must be numeric`, { actual: value, expected });
    }
  }

  const actualBatchCount = control.raw.substring(1, 7);
  if (isDigits(actualBatchCount) && actualBatchCount !== expectedBatchCount) {
    context.add(control, 1, 7, 'ACH-RELATION-FILE-BATCH-COUNT', 'relational', 'File Batch Count does not match actual batches', { expected: expectedBatchCount, actual: actualBatchCount });
  }
  const actualBlockCount = control.raw.substring(7, 13);
  if (isDigits(actualBlockCount) && actualBlockCount !== expectedBlockCount) {
    context.add(control, 7, 13, 'ACH-RELATION-FILE-BLOCK-COUNT', 'relational', 'File Block Count does not match physical records', { expected: expectedBlockCount, actual: actualBlockCount });
  }
  const actualEntryCount = control.raw.substring(13, 21);
  if (isDigits(actualEntryCount) && actualEntryCount !== expectedEntryCount) {
    context.add(control, 13, 21, 'ACH-RELATION-FILE-ENTRY-COUNT', 'relational', 'File Entry/Addenda Count does not match actual records', { expected: expectedEntryCount, actual: actualEntryCount });
  }

  if (expectedHash) {
    const actualHash = control.raw.substring(21, 31);
    if (isDigits(actualHash) && actualHash !== expectedHash) {
      context.add(control, 21, 31, 'ACH-RELATION-FILE-HASH', 'relational', 'File Entry Hash does not match the calculated hash', { expected: expectedHash, actual: actualHash });
    }
  }

  if (expectedDebit && expectedCredit) {
    const actualDebit = control.raw.substring(31, 43);
    const actualCredit = control.raw.substring(43, 55);
    if (isDigits(actualDebit) && actualDebit !== expectedDebit) {
      context.add(control, 31, 43, 'ACH-RELATION-FILE-DEBIT', 'relational', 'File debit total does not match the calculated total', { expected: expectedDebit, actual: actualDebit });
    }
    if (isDigits(actualCredit) && actualCredit !== expectedCredit) {
      context.add(control, 43, 55, 'ACH-RELATION-FILE-CREDIT', 'relational', 'File credit total does not match the calculated total', { expected: expectedCredit, actual: actualCredit });
    }
  }

  if (control.raw.substring(55, 94).trim().length > 0) {
    context.add(control, 55, 94, 'ACH-FIELD-FILE-CONTROL-RESERVED', 'field', 'File Control reserved field must be blank');
  }
}

function validateFieldsAndRelationships(document: AchDocument, context: ValidationContext): void {
  for (const header of document.fileHeaders) {
    if (header.raw.length === 94) { validateFileHeader(header, context); }
  }

  const batchTotals: BatchTotals[] = [];
  for (const batch of document.batches) {
    if (batch.header.raw.length === 94) {
      validateBatchHeader(batch, context);
      validateReversalBatch(batch, context);
    }
    const totals = calculateBatchTotals(batch, context);
    batchTotals.push(totals);
    validateBatchControl(batch, totals, context);
  }

  validateFileControl(document, batchTotals, context);
}

export function validateAch(
  input: string | AchDocument,
  profile: AchValidationProfile = nachaValidationProfile,
): AchDiagnostic[] {
  const document = typeof input === 'string' ? parseAchDocument(input) : input;
  const context = new ValidationContext(profile);
  validatePhysical(document, context);
  validateStructure(document, context);
  validateFieldsAndRelationships(document, context);
  return context.diagnostics;
}
