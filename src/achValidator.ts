import type { AchBatch, AchDocument, AchEntry, AchRecord } from './achDocument';
import { parseAchDocument } from './achDocument';
import {
  allowedAddendaTypesForSec,
  entryAmountRangeForSec,
  knownSecCodes,
  maximumAddendaForSec,
  isPrenoteTransaction,
  isZeroDollarTransaction,
  transactionCodeCompatibility,
  transactionCodes,
  type TransactionCodeRule,
} from './achRules';
import {
  futureReturnReasonCodes,
  isoCountryCodes,
  isoCurrencyCodes,
  returnReasonSecCompatibility,
  validNotificationOfChangeCodes,
  validReturnReasonCodes,
} from './achRuleData';
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
  const safeStart = Math.min(Math.max(start, 0), record.raw.length);
  const safeEnd = Math.max(safeStart, Math.min(end, record.raw.length));
  return { line: record.line, start: safeStart, end: safeEnd, message };
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

function isValidMonthDay(value: string): boolean {
  if (!/^\d{4}$/.test(value)) { return false; }
  const month = Number(value.substring(0, 2));
  const day = Number(value.substring(2, 4));
  const date = new Date(Date.UTC(2000, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidAchTimeWithSeconds(value: string): boolean {
  if (!/^\d{6}$/.test(value)) { return false; }
  const hour = Number(value.substring(0, 2));
  const minute = Number(value.substring(2, 4));
  const second = Number(value.substring(4, 6));
  return hour <= 23 && minute <= 59 && second <= 59;
}

const cardTransactionTypeCodes = new Set(['01', '02', '03', '11', '12', '13', '21', '99']);
const iatTransactionTypeCodes = new Set([
  'ANN', 'BUS', 'DEP', 'LOA', 'MIS', 'MOR', 'PEN', 'RLS', 'SAL', 'TAX',
  'ARC', 'BOC', 'MTE', 'POP', 'POS', 'RCK', 'SHR', 'TEL', 'WEB',
]);

function calculateCheckDigit(routing8: string): number {
  const weights = [3, 7, 1, 3, 7, 1, 3, 7];
  let sum = 0;
  for (let index = 0; index < routing8.length; index++) {
    sum += Number(routing8[index]) * weights[index];
  }
  return (10 - (sum % 10)) % 10;
}

function physicalRecordCount(document: AchDocument): number {
  const trailingTerminator = document.lines.length > 1 && document.lines.at(-1) === '' ? 1 : 0;
  return document.lines.length - trailingTerminator;
}

function validatePhysical(document: AchDocument, context: ValidationContext): void {
  for (let line = 0; line < document.lines.length; line++) {
    const raw = document.lines[line];
    if (raw.length === 0) {
      if (line < document.lines.length - 1) {
        context.addLine(line, 0, 'ACH-PHYSICAL-BLANK-LINE', 'physical', 'Blank records are not allowed inside an ACH file');
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
      let invalidOffset = -1;
      let invalidWidth = 1;
      for (let offset = 0; offset < raw.length;) {
        const codePoint = raw.codePointAt(offset) ?? 0;
        const width = codePoint > 0xffff ? 2 : 1;
        if (codePoint < 0x20 || codePoint > 0x7e) {
          invalidOffset = offset;
          invalidWidth = width;
          break;
        }
        offset += width;
      }
      if (invalidOffset >= 0) {
        context.add(record, invalidOffset, invalidOffset + invalidWidth, 'ACH-PHYSICAL-CHARACTER-SET', 'physical', 'ACH records must use printable ASCII characters');
      }
    }
  }

  const physicalRecords = physicalRecordCount(document);
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

  if (document.fileHeaders.length === 0) {
    context.add(document.records[0], 0, 1, 'ACH-STRUCTURE-MISSING-FILE-HEADER', 'structural', 'ACH file is missing its File Header record');
  }
  if (document.fileHeaders.length > 1) {
    for (const duplicate of document.fileHeaders.slice(1)) {
      context.add(duplicate, 0, 1, 'ACH-STRUCTURE-DUPLICATE-FILE-HEADER', 'structural', 'ACH file contains more than one File Header record');
    }
  }
  if (document.fileControls.length === 0) {
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
    if (batch.entries.length === 0) {
      context.add(batch.header, 0, 1, 'ACH-STRUCTURE-EMPTY-BATCH', 'structural', 'An ACH batch must contain at least one Entry Detail record');
    }
  }
  if (document.batches.length === 0) {
    context.add(document.fileHeaders[0] ?? document.fileControls[0] ?? document.records[0], 0, 1, 'ACH-STRUCTURE-NO-BATCHES', 'structural', 'An ACH file must contain at least one batch');
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
  const destination = record.raw.substring(3, 13);
  if (!/^ \d{9}$/.test(destination)) {
    context.add(record, 3, 13, 'ACH-FIELD-IMMEDIATE-DESTINATION', 'field', 'Immediate Destination must contain a leading blank followed by a 9-digit routing number', { expected: 'blank + 9 digits', actual: destination });
  } else {
    const routing = destination.substring(1);
    const expected = String(calculateCheckDigit(routing.substring(0, 8)));
    if (routing.charAt(8) !== expected) {
      context.add(record, 12, 13, 'ACH-FIELD-IMMEDIATE-DESTINATION-CHECK-DIGIT', 'field', `Immediate Destination routing check digit should be ${expected}`, { expected, actual: routing.charAt(8) });
    }
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
  if (!['200', '220', '225', '280'].includes(serviceClass)) {
    context.add(record, 1, 4, 'ACH-FIELD-SERVICE-CLASS', 'field', 'Service Class Code must be 200, 220, 225, or 280', { expected: '200, 220, 225, or 280', actual: serviceClass });
  }
  if (batch.secCode === 'ADV' && serviceClass !== '280') {
    context.add(record, 1, 4, 'ACH-ADV-SERVICE-CLASS', 'sec', 'ADV batches require Service Class Code 280', { expected: '280', actual: serviceClass });
  } else if (batch.secCode !== 'ADV' && serviceClass === '280') {
    context.add(record, 1, 4, 'ACH-ADV-SERVICE-CLASS', 'sec', 'Service Class Code 280 is valid only for ADV batches', { expected: '200, 220, or 225', actual: serviceClass });
  }
  if (batch.secCode !== 'IAT' && record.raw.substring(4, 20).trim().length === 0) {
    context.add(record, 4, 20, 'ACH-FIELD-COMPANY-NAME-REQUIRED', 'field', 'Company Name is required');
  }
  if (record.raw.substring(40, 50).trim().length === 0) {
    context.add(record, 40, 50, 'ACH-FIELD-COMPANY-ID-REQUIRED', 'field', 'Company Identification is required');
  }
  if (record.raw.substring(53, 63).trim().length === 0) {
    context.add(record, 53, 63, 'ACH-FIELD-COMPANY-ENTRY-DESCRIPTION-REQUIRED', 'field', 'Company Entry Description is required');
  }
  if (!knownSecCodes.has(batch.secCode)) {
    context.add(record, 50, 53, 'ACH-SEC-UNKNOWN-CODE', 'sec', `Unknown or unsupported SEC code '${batch.secCode}'`, { actual: batch.secCode });
  }
  if (batch.secCode === 'IAT') {
    const iatIndicator = record.raw.substring(4, 20);
    if (!['', 'IATCOR'].includes(iatIndicator.trim())) {
      context.add(record, 4, 20, 'ACH-IAT-INDICATOR', 'sec', 'IAT Indicator must be blank for a forward IAT entry or contain IATCOR for an IAT Notification of Change', { expected: 'blank or IATCOR', actual: iatIndicator });
    }
    const exchangeIndicator = record.raw.substring(20, 22);
    if (!['FV', 'VF', 'FF'].includes(exchangeIndicator)) {
      context.add(record, 20, 22, 'ACH-IAT-FOREIGN-EXCHANGE-INDICATOR', 'field', 'IAT Foreign Exchange Indicator must be FV, VF, or FF', { expected: 'FV, VF, or FF', actual: exchangeIndicator });
    }
    const referenceIndicator = record.raw.substring(22, 23);
    const reference = record.raw.substring(23, 38);
    if (!['1', '2', '3'].includes(referenceIndicator)) {
      context.add(record, 22, 23, 'ACH-IAT-FOREIGN-EXCHANGE-REFERENCE-INDICATOR', 'field', 'IAT Foreign Exchange Reference Indicator must be 1, 2, or 3', { expected: '1, 2, or 3', actual: referenceIndicator });
    } else if (referenceIndicator === '1' && !/^\d{15}$/.test(reference)) {
      context.add(record, 23, 38, 'ACH-IAT-FOREIGN-EXCHANGE-REFERENCE', 'field', 'An exchange-rate reference must contain 15 digits', { expected: '15 digits', actual: reference });
    } else if (referenceIndicator === '2' && reference.trim().length === 0) {
      context.add(record, 23, 38, 'ACH-IAT-FOREIGN-EXCHANGE-REFERENCE', 'field', 'A foreign-exchange reference number is required when the indicator is 2');
    } else if (referenceIndicator === '3' && reference.trim().length > 0) {
      context.add(record, 23, 38, 'ACH-IAT-FOREIGN-EXCHANGE-REFERENCE', 'field', 'Foreign Exchange Reference must be blank when the indicator is 3', { expected: 'blank', actual: reference });
    }
    const destinationCountry = record.raw.substring(38, 40);
    if (!isoCountryCodes.has(destinationCountry)) {
      context.add(record, 38, 40, 'ACH-IAT-DESTINATION-COUNTRY', 'field', 'IAT ISO Destination Country Code is not a current ISO 3166-1 alpha-2 code', { expected: 'ISO alpha-2 country code', actual: destinationCountry });
    }
    for (const [start, end, label] of [[63, 66, 'Originating'], [66, 69, 'Destination']] as const) {
      const currency = record.raw.substring(start, end);
      if (!isoCurrencyCodes.has(currency)) {
        context.add(record, start, end, `ACH-IAT-${label.toUpperCase()}-CURRENCY`, 'field', `IAT ISO ${label} Currency Code is not a current ISO 4217 code`, { expected: 'ISO 4217 code', actual: currency });
      }
    }
  }
  const effectiveDate = record.raw.substring(69, 75);
  if (!isValidAchDate(effectiveDate)) {
    context.add(record, 69, 75, 'ACH-FIELD-EFFECTIVE-DATE', 'field', 'Effective Entry Date is not a real YYMMDD calendar date', { expected: 'valid YYMMDD', actual: effectiveDate });
  }
  const settlementDate = record.raw.substring(75, 78);
  if (settlementDate.trim().length > 0 && (!/^\d{3}$/.test(settlementDate) || Number(settlementDate) < 1 || Number(settlementDate) > 366)) {
    context.add(record, 75, 78, 'ACH-FIELD-SETTLEMENT-DATE', 'field', 'Settlement Date must be blank or a valid 001-366 Julian day inserted by an ACH Operator', { expected: 'blank or 001-366', actual: settlementDate });
  }
  const originatorStatus = record.raw.substring(78, 79);
  if (!['0', '1', '2'].includes(originatorStatus)) {
    context.add(record, 78, 79, 'ACH-FIELD-ORIGINATOR-STATUS', 'field', 'Originator Status Code must be 0 (ACH Operator ADV), 1 (DFI), or 2 (Federal Government)', { expected: '0, 1, or 2', actual: originatorStatus });
  } else if (batch.secCode === 'ADV' && originatorStatus !== '0') {
    context.add(record, 78, 79, 'ACH-ADV-ORIGINATOR-STATUS', 'sec', 'ACH Operator ADV batches require Originator Status Code 0', { expected: '0', actual: originatorStatus });
  } else if (batch.secCode !== 'ADV' && originatorStatus === '0') {
    context.add(record, 78, 79, 'ACH-SEC-ORIGINATOR-STATUS', 'sec', 'Originator Status Code 0 is reserved for ACH Operator ADV batches', { expected: '1 or 2', actual: originatorStatus });
  }
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

function validateMicroEntries(document: AchDocument, context: ValidationContext): void {
  type Candidate = {
    batch: AchBatch;
    entry: AchEntry;
    amount: bigint;
    direction: 'credit' | 'debit';
  };
  const groups = new Map<string, Candidate[]>();

  for (const batch of document.batches) {
    const rawDescription = batch.header.raw.substring(53, 63);
    const description = rawDescription.trim();
    const microLike = description.toUpperCase() === 'ACCTVERIFY';
    if (!microLike) { continue; }
    if (description !== 'ACCTVERIFY') {
      context.add(batch.header, 53, 63, 'ACH-MICRO-DESCRIPTION', 'field', 'A Micro-Entry batch must use uppercase ACCTVERIFY in the Company Entry Description field', {
        expected: 'ACCTVERIFY',
        actual: rawDescription,
      });
    }

    for (const entry of batch.entries) {
      if (entry.detail.raw.length !== 94) { continue; }
      const rule = transactionCodes.get(entry.detail.raw.substring(1, 3));
      const [amountStart, amountEnd] = entryAmountRangeForSec(batch.secCode);
      const amount = parseBigInt(entry.detail.raw.substring(amountStart, amountEnd));
      if (!rule || amount === undefined) { continue; }
      if (rule.kind !== 'payment') {
        context.add(entry.detail, 1, 3, 'ACH-MICRO-TRANSACTION-KIND', 'sec', 'Micro-Entries must use live payment transaction codes', {
          expected: 'payment transaction code',
          actual: `${rule.code} (${rule.kind})`,
          related: [related(batch.header, 53, 63, 'ACCTVERIFY Company Entry Description')],
        });
        continue;
      }
      if (rule.direction === 'credit' && (amount < 1n || amount >= 100n)) {
        context.add(entry.detail, 29, 39, 'ACH-MICRO-CREDIT-AMOUNT', 'sec', 'A credit Micro-Entry must be greater than zero and less than $1.00', {
          expected: '1-99 cents',
          actual: `${amount} cents`,
        });
      }
      const accountField = entry.detail.fields.find(field => /Account Number/i.test(field.name));
      const account = accountField?.rawValue.trim() ?? entry.detail.raw.substring(12, 29).trim();
      const key = [
        batch.header.raw.substring(40, 50),
        entry.detail.raw.substring(3, 12),
        account,
      ].join('|');
      const candidates = groups.get(key) ?? [];
      candidates.push({ batch, entry, amount, direction: rule.direction });
      groups.set(key, candidates);
    }
  }

  for (const candidates of groups.values()) {
    const credits = candidates.filter(candidate => candidate.direction === 'credit');
    const debits = candidates.filter(candidate => candidate.direction === 'debit');
    const credit = credits.reduce((sum, candidate) => sum + candidate.amount, 0n);
    const debit = debits.reduce((sum, candidate) => sum + candidate.amount, 0n);
    if (debit > credit) {
      const target = debits[0]?.entry.detail ?? candidates[0].entry.detail;
      context.add(target, 29, 39, 'ACH-MICRO-NET-DEBIT', 'sec', 'Micro-Entry debits exceed corresponding credits found for this receiver account in this file; verify whether additional credits were submitted simultaneously in another file', {
        severity: 1,
        expected: `at most ${credit} debit cents`,
        actual: `${debit} debit cents`,
        related: credits.map(candidate => related(candidate.entry.detail, 29, 39, 'Corresponding credit Micro-Entry')),
      });
    }
    if (debits.length > 0) {
      const dates = new Set(candidates.map(candidate => candidate.batch.header.raw.substring(69, 75)));
      if (dates.size > 1) {
        const target = debits[0].batch.header;
        context.add(target, 69, 75, 'ACH-MICRO-EFFECTIVE-DATE', 'sec', 'Potentially corresponding debit and credit Micro-Entries in this file use different Effective Entry Dates', {
          severity: 1,
          expected: credits[0]?.batch.header.raw.substring(69, 75),
          actual: target.raw.substring(69, 75),
          related: credits.map(candidate => related(candidate.batch.header, 69, 75, 'Credit Micro-Entry Effective Entry Date')),
        });
      }
    }
  }
}

function validateSecEntryFields(
  entry: AchEntry,
  batch: AchBatch,
  rule: TransactionCodeRule | undefined,
  context: ValidationContext,
): void {
  if (!rule) { return; }

  const record = entry.detail;
  const secCode = batch.secCode;
  if (secCode === 'IAT') {
    if (record.raw.substring(16, 29).trim().length > 0) {
      context.add(record, 16, 29, 'ACH-IAT-ENTRY-RESERVED', 'field', 'IAT Entry Detail reserved field must be blank', { expected: 'blank', actual: record.raw.substring(16, 29) });
    }
    if (record.raw.substring(39, 74).trim().length === 0) {
      context.add(record, 39, 74, 'ACH-IAT-ACCOUNT-REQUIRED', 'sec', 'Foreign Receiver Account Number is required for IAT entries');
    }
    for (const [start, label] of [[74, 'Gateway Operator'], [75, 'Secondary']] as const) {
      const indicator = record.raw.substring(start, start + 1);
      if (![' ', '0', '1'].includes(indicator)) {
        context.add(record, start, start + 1, 'ACH-IAT-OFAC-INDICATOR', 'field', `${label} OFAC Screening Indicator must be blank, 0, or 1`, { expected: 'blank, 0, or 1', actual: indicator });
      }
    }
    if (record.raw.substring(76, 78).trim().length > 0) {
      context.add(record, 76, 78, 'ACH-IAT-ENTRY-RESERVED', 'field', 'IAT Entry Detail reserved field must be blank', { expected: 'blank', actual: record.raw.substring(76, 78) });
    }
  }

  if (rule.kind === 'return') { return; }

  const standardAccountSecs = ['ACK', 'ARC', 'ATX', 'BOC', 'CCD', 'CIE', 'CTX', 'DNE', 'ENR', 'MTE', 'POP', 'POS', 'PPD', 'RCK', 'SHR', 'TEL', 'TRC', 'TRX', 'WEB', 'XCK'];
  if (standardAccountSecs.includes(secCode) && record.raw.substring(12, 29).trim().length === 0) {
    context.add(record, 12, 29, 'ACH-SEC-ACCOUNT-REQUIRED', 'sec', `DFI Account Number is required for ${secCode} entries`);
  }

  const receiverRange: [number, number] = secCode === 'CTX' ? [58, 74] : [54, 76];
  if (['CCD', 'CTX', 'PPD', 'RCK', 'TEL', 'WEB'].includes(secCode)
    && record.raw.substring(receiverRange[0], receiverRange[1]).trim().length === 0) {
    const receiverLabel = ['CCD', 'CTX'].includes(secCode) ? 'Receiving Company Name' : 'Individual Name';
    context.add(record, receiverRange[0], receiverRange[1], 'ACH-SEC-RECEIVER-NAME-REQUIRED', 'sec', `${receiverLabel} is required for ${secCode} entries`);
  }

  if (['ARC', 'BOC', 'RCK', 'TRC', 'XCK'].includes(secCode) && record.raw.substring(39, 54).trim().length === 0) {
    context.add(record, 39, 54, 'ACH-SEC-CHECK-SERIAL-REQUIRED', 'sec', `Check Serial Number is required for ${secCode} entries`);
  }

  if (secCode === 'POP') {
    const requiredFields: Array<[number, number, string, string]> = [
      [39, 48, 'ACH-POP-CHECK-SERIAL-REQUIRED', 'Check Serial Number'],
      [48, 52, 'ACH-POP-TERMINAL-CITY-REQUIRED', 'Terminal City'],
      [52, 54, 'ACH-POP-TERMINAL-STATE-REQUIRED', 'Terminal State'],
    ];
    for (const [start, end, code, label] of requiredFields) {
      const value = record.raw.substring(start, end);
      if (value.trim().length === 0 || /^0+$/.test(value.trim())) {
        context.add(record, start, end, code, 'sec', `${label} is required for POP entries`);
      }
    }
  }

  if (['ACK', 'ATX'].includes(secCode)) {
    const originalTrace = record.raw.substring(39, 54);
    if (!/^\d{15}$/.test(originalTrace)) {
      context.add(record, 39, 54, 'ACH-ACK-ORIGINAL-TRACE', 'sec', `${secCode} Original Entry Trace Number must contain 15 digits`, { expected: '15 digits', actual: originalTrace });
    }
    const acknowledgmentReceiverRange: [number, number] = secCode === 'ATX' ? [58, 74] : [54, 76];
    if (record.raw.substring(acknowledgmentReceiverRange[0], acknowledgmentReceiverRange[1]).trim().length === 0) {
      context.add(record, acknowledgmentReceiverRange[0], acknowledgmentReceiverRange[1], 'ACH-ACK-RECEIVER-REQUIRED', 'sec', `${secCode} Receiving Company Name${secCode === 'ATX' ? ' / ID Number' : ''} is required`);
    }
    if (secCode === 'ATX') {
      const declaredRaw = record.raw.substring(54, 58);
      if (!/^\d{4}$/.test(declaredRaw)) {
        context.add(record, 54, 58, 'ACH-ATX-ADDENDA-COUNT-NUMERIC', 'sec', 'ATX Number of Addenda Records must contain four digits', { actual: declaredRaw });
      } else {
        const expected = String(entry.addenda.length).padStart(4, '0');
        if (declaredRaw !== expected) {
          context.add(record, 54, 58, 'ACH-ATX-ADDENDA-COUNT', 'sec', 'Declared ATX addenda count does not match actual attached addenda records', { expected, actual: declaredRaw });
        }
      }
      if (record.raw.substring(74, 76).trim().length > 0) {
        context.add(record, 74, 76, 'ACH-ATX-RESERVED', 'field', 'ATX Entry Detail reserved field must be blank');
      }
    }
  }

  if (secCode === 'CIE') {
    if (record.raw.substring(39, 54).trim().length === 0) {
      context.add(record, 39, 54, 'ACH-CIE-INDIVIDUAL-NAME-REQUIRED', 'sec', 'Individual Name is required for a CIE entry');
    }
    if (record.raw.substring(54, 76).trim().length === 0) {
      context.add(record, 54, 76, 'ACH-CIE-INDIVIDUAL-ID-REQUIRED', 'sec', 'Individual Identification Number is required for a CIE entry');
    }
  }

  if (secCode === 'DNE' && record.raw.substring(54, 76).trim().length === 0) {
    context.add(record, 54, 76, 'ACH-DNE-INDIVIDUAL-NAME-REQUIRED', 'sec', 'Individual Name is required for a DNE entry');
  }

  if (secCode === 'ENR') {
    const declaredRaw = record.raw.substring(54, 58);
    if (!/^\d{4}$/.test(declaredRaw)) {
      context.add(record, 54, 58, 'ACH-ENR-ADDENDA-COUNT-NUMERIC', 'sec', 'ENR Number of Addenda Records must contain four digits', { actual: declaredRaw });
    } else {
      const expected = String(entry.addenda.length).padStart(4, '0');
      if (declaredRaw !== expected) {
        context.add(record, 54, 58, 'ACH-ENR-ADDENDA-COUNT', 'sec', 'Declared ENR addenda count does not match actual attached addenda records', { expected, actual: declaredRaw });
      }
    }
    if (record.raw.substring(58, 74).trim().length === 0) {
      context.add(record, 58, 74, 'ACH-ENR-RECEIVER-REQUIRED', 'sec', 'Receiving Company Name / ID Number is required for an ENR entry');
    }
    if (record.raw.substring(74, 76).trim().length > 0) {
      context.add(record, 74, 76, 'ACH-ENR-RESERVED', 'field', 'ENR Entry Detail reserved field must be blank');
    }
  }

  if (secCode === 'MTE') {
    if (record.raw.substring(39, 54).trim().length === 0) {
      context.add(record, 39, 54, 'ACH-MTE-INDIVIDUAL-NAME-REQUIRED', 'sec', 'Individual Name is required for an MTE entry');
    }
    if (record.raw.substring(54, 76).trim().length === 0) {
      context.add(record, 54, 76, 'ACH-MTE-INDIVIDUAL-ID-REQUIRED', 'sec', 'Individual Identification Number is required for an MTE entry');
    }
  }

  if (secCode === 'POS' && record.raw.substring(54, 76).trim().length === 0) {
    context.add(record, 54, 76, 'ACH-POS-INDIVIDUAL-NAME-REQUIRED', 'sec', 'Individual Name is required for a POS entry');
  }

  if (['POS', 'SHR'].includes(secCode)) {
    const cardType = record.raw.substring(76, 78);
    if (!cardTransactionTypeCodes.has(cardType)) {
      context.add(record, 76, 78, 'ACH-CARD-TRANSACTION-TYPE', 'sec', 'Card Transaction Type Code is not a recognized POS/SHR value', {
        expected: [...cardTransactionTypeCodes].join(', '),
        actual: cardType,
      });
    }
  }

  if (secCode === 'SHR') {
    const expiration = record.raw.substring(39, 43);
    if (!/^\d{4}$/.test(expiration) || Number(expiration.substring(0, 2)) < 1 || Number(expiration.substring(0, 2)) > 12) {
      context.add(record, 39, 43, 'ACH-SHR-CARD-EXPIRATION', 'sec', 'SHR Card Expiration Date must use a valid MMYY value', { expected: 'MMYY', actual: expiration });
    }
    const documentReference = record.raw.substring(43, 54);
    if (!/^\d{11}$/.test(documentReference)) {
      context.add(record, 43, 54, 'ACH-SHR-DOCUMENT-REFERENCE', 'sec', 'SHR Document Reference Number must contain 11 digits', { expected: '11 digits', actual: documentReference });
    }
    const cardAccount = record.raw.substring(54, 76);
    if (!/^\d{22}$/.test(cardAccount)) {
      context.add(record, 54, 76, 'ACH-SHR-CARD-ACCOUNT', 'sec', 'SHR Individual Card Account Number must contain 22 digits', { expected: '22 digits', actual: cardAccount });
    }
  }

  if (secCode === 'TRX') {
    const declaredRaw = record.raw.substring(54, 58);
    if (!/^\d{4}$/.test(declaredRaw)) {
      context.add(record, 54, 58, 'ACH-TRX-ADDENDA-COUNT-NUMERIC', 'sec', 'TRX Number of Addenda Records must contain four digits', { actual: declaredRaw });
    } else {
      const expected = String(entry.addenda.length).padStart(4, '0');
      if (declaredRaw !== expected) {
        context.add(record, 54, 58, 'ACH-TRX-ADDENDA-COUNT', 'sec', 'Declared TRX addenda count does not match actual attached addenda records', { expected, actual: declaredRaw });
      }
    }
    if (record.raw.substring(58, 74).trim().length === 0) {
      context.add(record, 58, 74, 'ACH-TRX-RECEIVER-REQUIRED', 'sec', 'Receiving Company Name / ID Number is required for a TRX entry');
    }
    if (record.raw.substring(74, 76).trim().length > 0) {
      context.add(record, 74, 76, 'ACH-TRX-RESERVED', 'field', 'TRX Entry Detail reserved field must be blank');
    }
  }

  if (secCode === 'WEB'
    && rule.direction === 'credit'
    && ['payment', 'prenote'].includes(rule.kind)
    && record.raw.substring(39, 54).trim().length === 0) {
    context.add(record, 39, 54, 'ACH-WEB-CREDIT-ORIGINATOR-NAME', 'sec', 'A WEB credit requires the consumer Originator name in the Individual Identification Number field');
  }
  if (secCode === 'WEB') {
    const paymentType = record.raw.substring(76, 78).trim();
    if (!['R', 'S', 'ST'].includes(paymentType)) {
      context.add(record, 76, 78, 'ACH-WEB-PAYMENT-TYPE', 'sec', 'WEB Payment Type Code must be R (recurring), S (single), or ST (standing authorization)', { expected: 'R, S, or ST', actual: record.raw.substring(76, 78) });
    }
  }

  if (secCode === 'CTX') {
    const declaredRaw = record.raw.substring(54, 58);
    if (!/^\d{4}$/.test(declaredRaw)) {
      context.add(record, 54, 58, 'ACH-CTX-ADDENDA-COUNT-NUMERIC', 'sec', 'CTX Number of Addenda Records must contain four digits', { actual: declaredRaw });
    } else {
      const expected = String(entry.addenda.length).padStart(4, '0');
      if (declaredRaw !== expected) {
        context.add(record, 54, 58, 'ACH-CTX-ADDENDA-COUNT', 'sec', 'Declared CTX addenda count does not match actual attached addenda records', { expected, actual: declaredRaw });
      }
    }
    if (record.raw.substring(74, 76).trim().length > 0) {
      context.add(record, 74, 76, 'ACH-CTX-RESERVED', 'field', 'CTX Entry Detail reserved field must be blank');
    }
  }
}

function validateAdvEntry(record: AchRecord, batch: AchBatch, context: ValidationContext): void {
  if (record.raw.substring(12, 27).trim().length === 0) {
    context.add(record, 12, 27, 'ACH-ADV-ACCOUNT-REQUIRED', 'sec', 'DFI Account Number is required for an ADV entry');
  }
  const adviceRouting = record.raw.substring(39, 48);
  if (!/^\d{9}$/.test(adviceRouting)) {
    context.add(record, 39, 48, 'ACH-ADV-ADVICE-ROUTING', 'field', 'ADV Advice Routing Number must contain 9 digits', { actual: adviceRouting });
  } else {
    const expected = String(calculateCheckDigit(adviceRouting.substring(0, 8)));
    if (adviceRouting.charAt(8) !== expected) {
      context.add(record, 47, 48, 'ACH-ADV-ADVICE-ROUTING-CHECK-DIGIT', 'field', `ADV Advice Routing Number check digit should be ${expected}`, { expected, actual: adviceRouting.charAt(8) });
    }
  }
  if (record.raw.substring(54, 76).trim().length === 0) {
    context.add(record, 54, 76, 'ACH-ADV-INDIVIDUAL-NAME-REQUIRED', 'sec', 'Individual Name is required for an ADV entry');
  }
  const operatorRouting = record.raw.substring(79, 87);
  if (!/^\d{8}$/.test(operatorRouting)) {
    context.add(record, 79, 87, 'ACH-ADV-OPERATOR-ROUTING', 'field', 'ADV Routing Number of ACH Operator must contain 8 digits', { actual: operatorRouting });
  }
  const julian = record.raw.substring(87, 90);
  if (!/^\d{3}$/.test(julian) || Number(julian) < 1 || Number(julian) > 366) {
    context.add(record, 87, 90, 'ACH-ADV-JULIAN-DATE', 'field', 'ADV Advice Creation Julian Date must be between 001 and 366', { expected: '001-366', actual: julian });
  }
  const sequence = record.raw.substring(90, 94);
  const expectedSequence = String(batch.entries.findIndex(entry => entry.detail === record) + 1).padStart(4, '0');
  if (!/^\d{4}$/.test(sequence) || sequence !== expectedSequence) {
    context.add(record, 90, 94, 'ACH-ADV-SEQUENCE', 'relational', 'ADV Sequence Number Within Batch must be consecutive beginning with 0001', { expected: expectedSequence, actual: sequence });
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
      context.add(record, 1, 3, 'ACH-SEC-TRANSACTION-CODE', 'sec', incompatibility, { actual: transactionCode });
    }
  }
  if (transactionCode === '55' && !batch.isReversal) {
    context.add(record, 1, 3, 'ACH-SEC-LOAN-DEBIT-REVERSAL-ONLY', 'sec', 'Transaction Code 55 is permitted only in a REVERSAL batch', { expected: 'REVERSAL batch', actual: batch.entryDescription || '<blank>' });
  }

  const [amountStart, amountEnd] = entryAmountRangeForSec(batch.secCode);
  const amountRaw = record.raw.substring(amountStart, amountEnd);
  const amount = parseBigInt(amountRaw);
  if (amount === undefined) {
    context.add(record, amountStart, amountEnd, 'ACH-FIELD-AMOUNT-NUMERIC', 'field', `Amount must contain ${amountEnd - amountStart} digits`, { actual: amountRaw });
  } else if (['ACK', 'ATX'].includes(batch.secCode) && amount !== 0n) {
    context.add(record, amountStart, amountEnd, 'ACH-ACK-AMOUNT-ZERO', 'sec', `${batch.secCode} acknowledgment entries must have a zero amount`, { expected: '0000000000', actual: amountRaw });
  } else if (['DNE', 'ENR'].includes(batch.secCode) && amount !== 0n) {
    context.add(record, amountStart, amountEnd, 'ACH-SEC-NONMONETARY-AMOUNT', 'sec', `${batch.secCode} entries must have a zero amount`, { expected: '0000000000', actual: amountRaw });
  } else if (rule && ['prenote', 'zeroDollar'].includes(rule.kind) && amount !== 0n) {
    const prenote = isPrenoteTransaction(rule, batch.secCode);
    const zeroDollar = isZeroDollarTransaction(rule, batch.secCode);
    context.add(
      record,
      amountStart,
      amountEnd,
      prenote ? 'ACH-PRENOTE-AMOUNT-ZERO' : zeroDollar ? 'ACH-ZERO-DOLLAR-AMOUNT' : 'ACH-FIELD-NONMONETARY-AMOUNT',
      'field',
      `${prenote ? 'Prenotification entry' : zeroDollar ? 'Zero-dollar entry' : rule.description} must have a zero amount`,
      { expected: '0000000000', actual: amountRaw },
    );
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

  if (batch.secCode === 'ADV') {
    validateAdvEntry(record, batch, context);
  } else {
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
  }

  validateSecEntryFields(entry, batch, rule, context);
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
    if (!validNotificationOfChangeCodes.has(code)) {
      context.add(addenda, 3, 6, 'ACH-NOC-CHANGE-CODE', 'field', 'Notification of Change code is not valid in the pinned ruleset', { expected: [...validNotificationOfChangeCodes].join(', '), actual: code });
    } else if (['C08', 'C14'].includes(code) && addenda.secCode !== 'IAT') {
      context.add(addenda, 3, 6, 'ACH-NOC-CHANGE-CODE-SEC', 'sec', `${code} is valid only for IAT Notifications of Change`, { expected: 'IAT', actual: addenda.secCode });
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
    const correctedData = addenda.raw.substring(35, correctedDataEnd);
    if (correctedData.trim().length === 0 && code !== 'C13') {
      context.add(addenda, 35, correctedDataEnd, 'ACH-NOC-CORRECTED-DATA-REQUIRED', 'field', 'Notification of Change Corrected Data must not be blank');
    }
    if (validNotificationOfChangeCodes.has(code)) {
      const invalid = validateNocCorrectedData(code, correctedData, addenda.secCode === 'IAT');
      if (invalid) {
        context.add(addenda, 35, correctedDataEnd, 'ACH-NOC-CORRECTED-DATA-FORMAT', 'field', invalid, { actual: correctedData });
      }
    }
  } else {
    if (!validReturnReasonCodes.has(code)) {
      const futureDate = futureReturnReasonCodes.get(code);
      const message = futureDate
        ? `Return Reason Code ${code} is not effective until ${futureDate}`
        : 'Return Reason Code is not valid in the pinned ruleset';
      context.add(addenda, 3, 6, 'ACH-RETURN-REASON-CODE', 'field', message, { expected: 'current Return Reason Code', actual: code });
    } else {
      const incompatibility = returnReasonSecCompatibility(code, addenda.secCode);
      if (incompatibility) {
        context.add(addenda, 3, 6, 'ACH-RETURN-REASON-CODE-SEC', 'sec', incompatibility, { actual: addenda.secCode });
      }
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
    if (code === 'R69') {
      const fieldErrors = addenda.raw.substring(addenda.secCode === 'IAT' ? 45 : 35, 79).trim();
      if (!/^(?:0[1-7])+$/.test(fieldErrors)) {
        context.add(addenda, addenda.secCode === 'IAT' ? 45 : 35, 79, 'ACH-RETURN-R69-FIELD-ERRORS', 'field', 'R69 Addenda Information must contain one or more two-digit Field Error codes from 01 through 07', { expected: '01-07 code(s)', actual: fieldErrors });
      }
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

function validateNocCorrectedData(code: string, raw: string, iat: boolean): string | undefined {
  const blankAfter = (end: number): boolean => raw.substring(end).trim().length === 0;
  const required = (start: number, end: number): boolean => raw.substring(start, end).trim().length > 0;
  const routingError = (routing: string): string | undefined => {
    if (!/^\d{9}$/.test(routing)) { return 'Corrected routing number must contain 9 digits'; }
    const expected = String(calculateCheckDigit(routing.substring(0, 8)));
    return routing.charAt(8) === expected ? undefined : `Corrected routing number check digit should be ${expected}`;
  };
  const transactionError = (transaction: string): string | undefined => {
    const rule = transactionCodes.get(transaction);
    return rule && !['return', 'settlement'].includes(rule.kind)
      ? undefined
      : 'Corrected Transaction Code must be a valid forward-entry transaction code';
  };

  if (code === 'C01') {
    const accountWidth = iat ? 35 : 17;
    return required(0, accountWidth) && blankAfter(accountWidth)
      ? undefined
      : `C01 Corrected Data must contain the corrected account number in the first ${accountWidth} positions`;
  }
  if (code === 'C02') {
    return routingError(raw.substring(0, 9))
      ?? (blankAfter(9) ? undefined : 'C02 positions after the corrected Routing Number must be blank');
  }
  if (code === 'C03') {
    return routingError(raw.substring(0, 9))
      ?? (raw.substring(9, 12) === '   ' ? undefined : 'C03 positions 10 through 12 must be blank')
      ?? (required(12, 29) ? undefined : 'C03 Corrected Data must include the corrected account number in positions 13 through 29');
  }
  if (code === 'C04') {
    return required(0, 22) && blankAfter(22)
      ? undefined
      : 'C04 Corrected Data must contain the corrected name in the first 22 positions';
  }
  if (code === 'C05') {
    return transactionError(raw.substring(0, 2))
      ?? (blankAfter(2) ? undefined : 'C05 positions after the corrected Transaction Code must be blank');
  }
  if (code === 'C06') {
    return !required(0, 17)
      ? 'C06 Corrected Data must include the corrected account number in positions 1 through 17'
      : raw.substring(17, 20) !== '   '
        ? 'C06 positions 18 through 20 must be blank'
        : transactionError(raw.substring(20, 22))
          ?? (blankAfter(22) ? undefined : 'C06 positions after the corrected Transaction Code must be blank');
  }
  if (code === 'C07') {
    return routingError(raw.substring(0, 9))
      ?? (required(9, 26) ? undefined : 'C07 Corrected Data must include the corrected account number in positions 10 through 26')
      ?? transactionError(raw.substring(26, 28))
      ?? (blankAfter(28) ? undefined : 'C07 position 29 must be blank');
  }
  if (code === 'C08') {
    return iat && required(0, 34) && blankAfter(34)
      ? undefined
      : 'C08 is IAT-only and must contain the corrected Receiving DFI Identification in the first 34 positions';
  }
  if (code === 'C09') {
    return required(0, 22) && blankAfter(22)
      ? undefined
      : 'C09 Corrected Data must contain the corrected identification number in the first 22 positions';
  }
  if (code === 'C13') {
    return raw.trim().length === 0 ? undefined : 'C13 Corrected Data must be blank because the change identifies an Addenda Format Error';
  }
  if (code === 'C14') {
    return iat && raw.substring(0, 3) === 'IAT' && blankAfter(3)
      ? undefined
      : 'C14 is IAT-only and must contain IAT in the first three Corrected Data positions';
  }
  return undefined;
}

function validateIatAddendaContent(entry: AchEntry, returnOrNoc: boolean, context: ValidationContext): void {
  const optional = entry.addenda.filter(addenda => ['17', '18'].includes(addenda.raw.substring(1, 3)));
  const type17 = optional.filter(addenda => addenda.raw.substring(1, 3) === '17');
  const type18 = optional.filter(addenda => addenda.raw.substring(1, 3) === '18');
  if (!returnOrNoc) {
    if (type17.length > 2) {
      context.add(type17[2], 1, 3, 'ACH-IAT-REMITTANCE-MAXIMUM', 'sec', 'IAT entries permit at most two type 17 remittance addenda records', { expected: '0-2', actual: String(type17.length) });
    }
    if (type18.length > 5) {
      context.add(type18[5], 1, 3, 'ACH-IAT-CORRESPONDENT-MAXIMUM', 'sec', 'IAT entries permit at most five type 18 correspondent-bank addenda records', { expected: '0-5', actual: String(type18.length) });
    }
    if (optional.length > 5) {
      context.add(optional[5], 1, 3, 'ACH-IAT-OPTIONAL-ADDENDA-MAXIMUM', 'sec', 'IAT entries permit at most five optional type 17/18 addenda records in total', { expected: '0-5', actual: String(optional.length) });
    }
    let seenType18 = false;
    for (const addenda of optional) {
      const type = addenda.raw.substring(1, 3);
      if (type === '18') { seenType18 = true; }
      if (type === '17' && seenType18) {
        context.add(addenda, 1, 3, 'ACH-IAT-OPTIONAL-ADDENDA-ORDER', 'sec', 'Type 17 remittance addenda records must precede type 18 correspondent-bank addenda records');
      }
    }
  }

  const sequenceByType = new Map<string, number>();
  const reservedRanges: Record<string, [number, number]> = {
    '10': [81, 87], '11': [73, 87], '12': [73, 87], '13': [77, 87],
    '14': [77, 87], '15': [53, 87], '16': [73, 87], '18': [77, 83],
  };
  const requiredRanges: Record<string, Array<[number, number, string]>> = {
    '10': [[3, 6, 'Transaction Type Code'], [6, 24, 'Foreign Payment Amount'], [46, 81, 'Receiving Company Name / Individual Name']],
    '11': [[3, 38, 'Originator Name'], [38, 73, 'Originator Street Address']],
    '12': [[3, 38, 'Originator City and State / Province'], [38, 73, 'Originator Country and Postal Code']],
    '13': [[3, 38, 'Originating DFI Name'], [38, 40, 'Originating DFI Identification Number Qualifier'], [40, 74, 'Originating DFI Identification'], [74, 77, 'Originating DFI Branch Country Code']],
    '14': [[3, 38, 'Receiving DFI Name'], [38, 40, 'Receiving DFI Identification Number Qualifier'], [40, 74, 'Receiving DFI Identification'], [74, 77, 'Receiving DFI Branch Country Code']],
    '15': [[18, 53, 'Receiver Street Address']],
    '16': [[3, 38, 'Receiver City and State / Province'], [38, 73, 'Receiver Country and Postal Code']],
    '18': [[3, 38, 'Foreign Correspondent Bank Name'], [38, 40, 'Foreign Correspondent Bank Identification Number Qualifier'], [40, 74, 'Foreign Correspondent Bank Identification'], [74, 77, 'Foreign Correspondent Bank Branch Country Code']],
  };

  for (const addenda of entry.addenda) {
    if (addenda.raw.length !== 94) { continue; }
    const type = addenda.raw.substring(1, 3);
    if (!/^1[0-8]$/.test(type)) { continue; }
    const reserved = reservedRanges[type];
    if (reserved && addenda.raw.substring(reserved[0], reserved[1]).trim().length > 0) {
      context.add(addenda, reserved[0], reserved[1], 'ACH-IAT-RESERVED', 'field', `IAT addenda type ${type} reserved field must be blank`, { expected: 'blank', actual: addenda.raw.substring(reserved[0], reserved[1]) });
    }
    for (const [start, end, label] of requiredRanges[type] ?? []) {
      if (addenda.raw.substring(start, end).trim().length === 0) {
        context.add(addenda, start, end, 'ACH-IAT-MANDATORY-FIELD', 'field', `${label} is required in IAT addenda type ${type}`);
      }
    }
    if (type === '10') {
      const transactionType = addenda.raw.substring(3, 6);
      if (!iatTransactionTypeCodes.has(transactionType)) {
        context.add(addenda, 3, 6, 'ACH-IAT-TRANSACTION-TYPE', 'field', 'IAT Transaction Type Code is not a permitted reason-for-payment or secondary SEC code', { expected: [...iatTransactionTypeCodes].join(', '), actual: transactionType });
      }
      const foreignAmount = addenda.raw.substring(6, 24);
      if (!/^\d{18}$/.test(foreignAmount)) {
        context.add(addenda, 6, 24, 'ACH-IAT-FOREIGN-AMOUNT', 'field', 'IAT Foreign Payment Amount must contain 18 digits', { actual: foreignAmount });
      }
    }
    if (['13', '14', '18'].includes(type)) {
      const qualifier = addenda.raw.substring(38, 40);
      if (!['01', '02', '03'].includes(qualifier)) {
        context.add(addenda, 38, 40, 'ACH-IAT-DFI-QUALIFIER', 'field', 'IAT financial-institution identification qualifier must be 01, 02, or 03', { expected: '01, 02, or 03', actual: qualifier });
      }
      const country = addenda.raw.substring(74, 77);
      if (!isoCountryCodes.has(country.substring(0, 2)) || country.charAt(2) !== ' ') {
        context.add(addenda, 74, 77, 'ACH-IAT-BRANCH-COUNTRY', 'field', 'IAT branch country code must contain a current ISO 3166-1 alpha-2 code followed by a space', { expected: 'ISO alpha-2 + space', actual: country });
      }
      const identifier = addenda.raw.substring(40, 74).trim();
      if (qualifier === '02' && !/^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/.test(identifier)) {
        context.add(addenda, 40, 74, 'ACH-IAT-DFI-IDENTIFICATION', 'field', 'A SWIFT BIC identifier must contain 8 or 11 uppercase letters/digits', { expected: '8 or 11 uppercase letters/digits', actual: identifier });
      } else if (qualifier === '03' && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(identifier)) {
        context.add(addenda, 40, 74, 'ACH-IAT-DFI-IDENTIFICATION', 'field', 'An IBAN identifier must contain 15-34 uppercase alphanumeric characters with a country/check prefix', { expected: 'ISO 13616 IBAN shape', actual: identifier });
      }
    }
    if (['12', '16'].includes(type)) {
      const countryAndPostal = addenda.raw.substring(38, 73).trim();
      const country = countryAndPostal.substring(0, 2);
      if (!isoCountryCodes.has(country) || !/^[A-Z]{2}\*/.test(countryAndPostal)) {
        context.add(addenda, 38, 73, 'ACH-IAT-ADDRESS-COUNTRY', 'field', 'IAT country/postal data must begin with a current two-letter ISO country code followed by the data-element separator', { expected: 'AA*postal data', actual: countryAndPostal });
      }
    }
    if (['17', '18'].includes(type)) {
      const sequence = (sequenceByType.get(type) ?? 0) + 1;
      sequenceByType.set(type, sequence);
      const expected = String(sequence).padStart(4, '0');
      const actual = addenda.raw.substring(83, 87);
      if (actual !== expected) {
        context.add(addenda, 83, 87, 'ACH-IAT-ADDENDA-SEQUENCE', 'relational', `IAT addenda type ${type} sequence must be consecutive beginning with 0001`, { expected, actual });
      }
    }
  }
}

function validateTerminalAddenda(addenda: AchRecord, secCode: string, context: ValidationContext): void {
  const requiredFields: Array<[start: number, end: number, label: string]> = [
    [13, 19, 'Terminal Identification Code'],
    [19, 25, 'Transaction Serial Number'],
    [35, 62, 'Terminal Location'],
    [62, 77, 'Terminal City'],
    [77, 79, 'Terminal State'],
  ];
  if (secCode === 'MTE') {
    requiredFields.unshift([3, 10, 'Transaction Description']);
  }
  for (const [start, end, label] of requiredFields) {
    if (addenda.raw.substring(start, end).trim().length === 0) {
      context.add(addenda, start, end, 'ACH-TERMINAL-ADDENDA-REQUIRED', 'sec', `${label} is required in a ${secCode} type 02 addenda record`);
    }
  }

  const transactionDate = addenda.raw.substring(25, 29);
  if (!isValidMonthDay(transactionDate)) {
    context.add(addenda, 25, 29, 'ACH-TERMINAL-TRANSACTION-DATE', 'sec', 'Terminal Transaction Date must be a real MMDD calendar date', { expected: 'valid MMDD', actual: transactionDate });
  }
  if (secCode === 'MTE') {
    const transactionTime = addenda.raw.substring(29, 35);
    if (!isValidAchTimeWithSeconds(transactionTime)) {
      context.add(addenda, 29, 35, 'ACH-MTE-TRANSACTION-TIME', 'sec', 'MTE Transaction Time must be a valid HHMMSS time', { expected: '000000-235959', actual: transactionTime });
    }
  }
  const trace = addenda.raw.substring(79, 94);
  if (!/^\d{15}$/.test(trace)) {
    context.add(addenda, 79, 94, 'ACH-TERMINAL-ADDENDA-TRACE-NUMERIC', 'field', 'Terminal addenda Trace Number must contain 15 digits', { expected: '15 digits', actual: trace });
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
  if (maximum !== undefined && actualCount > maximum) {
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
  } else if (rule?.kind === 'return' && (returnAddenda.length !== 1 || actualCount !== 1)) {
    context.add(detail, 78, 79, 'ACH-RETURN-ADDENDA-REQUIRED', 'sec', 'A return entry requires exactly one Return addenda record (type 99)', {
      expected: 'one type 99 addenda',
      actual: String(returnAddenda.length),
    });
  } else if (rule && rule.kind !== 'return' && returnOrNoc) {
    context.add(detail, 1, 3, 'ACH-RETURN-NOC-TRANSACTION-CODE', 'sec', 'Return/NOC addenda requires a return or Notification of Change transaction code', { actual: detail.raw.substring(1, 3) });
  }

  if (isZeroDollarTransaction(rule, batch.secCode) && ['CCD', 'CTX'].includes(batch.secCode) && actualCount === 0) {
    context.add(detail, 78, 79, 'ACH-ZERO-DOLLAR-ADDENDA-REQUIRED', 'sec', `Zero-dollar ${batch.secCode} entries require at least one addenda record`, {
      expected: '1',
      actual: '0',
    });
  }

  if (['DNE', 'ENR'].includes(batch.secCode) && rule?.kind !== 'return' && actualCount === 0) {
    context.add(detail, 78, 79, 'ACH-SEC-ADDENDA-REQUIRED', 'sec', `${batch.secCode} entries require at least one type 05 addenda record`, {
      expected: 'at least one type 05 addenda',
      actual: '0',
    });
  }

  if (['MTE', 'POS', 'SHR'].includes(batch.secCode)
    && rule?.kind !== 'return'
    && !isPrenoteTransaction(rule, batch.secCode)
    && entry.addenda.filter(addenda => addenda.raw.substring(1, 3) === '02').length !== 1) {
    const terminalAddendaCount = entry.addenda.filter(addenda => addenda.raw.substring(1, 3) === '02').length;
    context.add(detail, 78, 79, 'ACH-TERMINAL-ADDENDA-REQUIRED', 'sec', `${batch.secCode} live entries require exactly one type 02 addenda record`, {
      expected: 'one type 02 addenda',
      actual: `${terminalAddendaCount} type 02 addenda`,
    });
  }


  if (batch.secCode === 'TRX'
    && rule?.kind !== 'return'
    && !isPrenoteTransaction(rule, batch.secCode)
    && entry.addenda.filter(addenda => addenda.raw.substring(1, 3) === '05').length === 0) {
    context.add(detail, 78, 79, 'ACH-TRX-ADDENDA-REQUIRED', 'sec', 'TRX live entries require at least one type 05 addenda record', {
      expected: 'at least one type 05 addenda',
      actual: '0 type 05 addenda',
    });
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
    validateIatAddendaContent(entry, returnOrNoc, context);
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
    } else if (addendaType === '02' && ['MTE', 'POS', 'SHR'].includes(batch.secCode)) {
      validateTerminalAddenda(addenda, batch.secCode, context);
      const addendaTrace = addenda.raw.substring(79, 94);
      const detailTrace = detail.raw.substring(79, 94);
      if (addendaTrace !== detailTrace) {
        context.add(addenda, 79, 94, 'ACH-RELATION-TERMINAL-ADDENDA-TRACE', 'relational', 'Terminal addenda Trace Number must match the complete related Entry Detail Trace Number', {
          expected: detailTrace,
          actual: addendaTrace,
          related: [related(detail, 79, 94, 'Related Entry Detail trace number')],
        });
      }
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
      if (['DNE', 'ENR'].includes(batch.secCode) && addenda.raw.substring(3, 83).trim().length === 0) {
        context.add(addenda, 3, 83, 'ACH-SEC-ADDENDA-CONTENT-REQUIRED', 'sec', `${batch.secCode} Payment Related Information must not be blank`);
      }
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
    const [amountStart, amountEnd] = entryAmountRangeForSec(batch.secCode);
    const amount = parseBigInt(entry.detail.raw.substring(amountStart, amountEnd));
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
  const adv = batch.secCode === 'ADV';
  const debitRange: readonly [number, number] = adv ? [20, 40] : [20, 32];
  const creditRange: readonly [number, number] = adv ? [40, 60] : [32, 44];
  const amountWidth = adv ? 20 : 12;
  const expectedCount = String(totals.count).padStart(6, '0');
  const expectedHash = totals.hashValid ? (totals.hash % 10000000000n).toString().padStart(10, '0') : undefined;
  const expectedDebit = totals.amountsValid ? totals.debit.toString().padStart(amountWidth, '0') : undefined;
  const expectedCredit = totals.amountsValid ? totals.credit.toString().padStart(amountWidth, '0') : undefined;
  for (const [start, end, code, label, expected] of [
    [4, 10, 'ACH-FIELD-BATCH-ENTRY-COUNT', 'Entry/Addenda Count', expectedCount],
    [10, 20, 'ACH-FIELD-BATCH-HASH', 'Entry Hash', expectedHash],
    [debitRange[0], debitRange[1], 'ACH-FIELD-BATCH-DEBIT', 'Total Debit', expectedDebit],
    [creditRange[0], creditRange[1], 'ACH-FIELD-BATCH-CREDIT', 'Total Credit', expectedCredit],
  ] as const) {
    const value = control.raw.substring(start, end);
    if (!isDigits(value)) {
      context.add(control, start, end, code, 'field', `${label} must be numeric`, { actual: value, expected });
    }
  }
  if (!adv && control.raw.substring(73, 79).trim().length > 0) {
    context.add(control, 73, 79, 'ACH-FIELD-BATCH-CONTROL-RESERVED', 'field', 'Batch Control reserved field must be blank');
  }
  compareHeaderControl(batch.header, control, 1, 4, 1, 4, 'ACH-RELATION-SERVICE-CLASS', 'Service Class Code', context);
  if (!adv) {
    compareHeaderControl(batch.header, control, 40, 50, 44, 54, 'ACH-RELATION-COMPANY-ID', 'Company Identification', context);
  }
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
    const actualDebit = control.raw.substring(debitRange[0], debitRange[1]);
    const actualCredit = control.raw.substring(creditRange[0], creditRange[1]);
    if (expectedDebit && isDigits(actualDebit) && actualDebit !== expectedDebit) {
      context.add(control, debitRange[0], debitRange[1], 'ACH-RELATION-BATCH-DEBIT', 'relational', 'Batch debit total does not match the calculated total', { expected: expectedDebit, actual: actualDebit });
    }
    if (expectedCredit && isDigits(actualCredit) && actualCredit !== expectedCredit) {
      context.add(control, creditRange[0], creditRange[1], 'ACH-RELATION-BATCH-CREDIT', 'relational', 'Batch credit total does not match the calculated total', { expected: expectedCredit, actual: actualCredit });
    }

  }

  const serviceClass = batch.header.raw.substring(1, 4);
  const directions = batch.entries
    .map(entry => transactionCodes.get(entry.detail.raw.substring(1, 3))?.direction)
    .filter((direction): direction is 'credit' | 'debit' => direction !== undefined);
  if (serviceClass === '220' && directions.includes('debit')) {
    context.add(batch.header, 1, 4, 'ACH-SEC-SERVICE-CLASS-DIRECTION', 'sec', 'Credits-only Service Class 220 contains a debit Entry, including a zero-dollar prenote or return', { expected: 'credit entries only', actual: 'debit transaction code present' });
  }
  if (serviceClass === '225' && directions.includes('credit')) {
    context.add(batch.header, 1, 4, 'ACH-SEC-SERVICE-CLASS-DIRECTION', 'sec', 'Debits-only Service Class 225 contains a credit Entry, including a zero-dollar prenote or return', { expected: 'debit entries only', actual: 'credit transaction code present' });
  }
}

function validateFileControl(document: AchDocument, batchTotals: BatchTotals[], context: ValidationContext): void {
  const control = document.fileControls[0];
  if (!control || control.raw.length !== 94) { return; }
  const advBatches = document.batches.filter(batch => batch.secCode === 'ADV');
  const adv = advBatches.length > 0;
  if (adv && advBatches.length !== document.batches.length) {
    const firstNonAdv = document.batches.find(batch => batch.secCode !== 'ADV');
    context.add(firstNonAdv?.header ?? control, 50, 53, 'ACH-ADV-MIXED-FILE', 'sec', 'ADV batches cannot share a file because ADV uses a distinct File Control amount layout', {
      expected: 'all ADV batches or no ADV batches',
      actual: `${advBatches.length} ADV of ${document.batches.length} batches`,
    });
  }
  const debitRange: readonly [number, number] = adv ? [31, 51] : [31, 43];
  const creditRange: readonly [number, number] = adv ? [51, 71] : [43, 55];
  const reservedStart = adv ? 71 : 55;
  const amountWidth = adv ? 20 : 12;
  const expectedBatchCount = String(document.batches.length).padStart(6, '0');
  const physicalRecords = physicalRecordCount(document);
  const expectedBlockCount = String(Math.ceil(physicalRecords / 10)).padStart(6, '0');
  const totalCount = batchTotals.reduce((sum, totals) => sum + totals.count, 0);
  const expectedEntryCount = String(totalCount).padStart(8, '0');
  const expectedHash = batchTotals.every(totals => totals.hashValid)
    ? (batchTotals.reduce((sum, totals) => sum + totals.hash, 0n) % 10000000000n).toString().padStart(10, '0')
    : undefined;
  const expectedDebit = batchTotals.every(totals => totals.amountsValid)
    ? batchTotals.reduce((sum, totals) => sum + totals.debit, 0n).toString().padStart(amountWidth, '0')
    : undefined;
  const expectedCredit = batchTotals.every(totals => totals.amountsValid)
    ? batchTotals.reduce((sum, totals) => sum + totals.credit, 0n).toString().padStart(amountWidth, '0')
    : undefined;

  for (const [start, end, code, label, expected] of [
    [1, 7, 'ACH-FIELD-FILE-BATCH-COUNT', 'Batch Count', expectedBatchCount],
    [7, 13, 'ACH-FIELD-FILE-BLOCK-COUNT', 'Block Count', expectedBlockCount],
    [13, 21, 'ACH-FIELD-FILE-ENTRY-COUNT', 'Entry/Addenda Count', expectedEntryCount],
    [21, 31, 'ACH-FIELD-FILE-HASH', 'Entry Hash', expectedHash],
    [debitRange[0], debitRange[1], 'ACH-FIELD-FILE-DEBIT', 'Total Debit', expectedDebit],
    [creditRange[0], creditRange[1], 'ACH-FIELD-FILE-CREDIT', 'Total Credit', expectedCredit],
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
    const actualDebit = control.raw.substring(debitRange[0], debitRange[1]);
    const actualCredit = control.raw.substring(creditRange[0], creditRange[1]);
    if (isDigits(actualDebit) && actualDebit !== expectedDebit) {
      context.add(control, debitRange[0], debitRange[1], 'ACH-RELATION-FILE-DEBIT', 'relational', 'File debit total does not match the calculated total', { expected: expectedDebit, actual: actualDebit });
    }
    if (isDigits(actualCredit) && actualCredit !== expectedCredit) {
      context.add(control, creditRange[0], creditRange[1], 'ACH-RELATION-FILE-CREDIT', 'relational', 'File credit total does not match the calculated total', { expected: expectedCredit, actual: actualCredit });
    }
  }

  if (control.raw.substring(reservedStart, 94).trim().length > 0) {
    context.add(control, reservedStart, 94, 'ACH-FIELD-FILE-CONTROL-RESERVED', 'field', 'File Control reserved field must be blank');
  }
}

function validateSequencesAndComposition(document: AchDocument, context: ValidationContext): void {
  let previousBatchNumber: bigint | undefined;
  const traceLines = new Map<string, AchRecord>();

  for (const batch of document.batches) {
    const batchNumberRaw = batch.header.raw.substring(87, 94);
    if (/^\d{7}$/.test(batchNumberRaw)) {
      const batchNumber = BigInt(batchNumberRaw);
      if (previousBatchNumber !== undefined && batchNumber <= previousBatchNumber) {
        context.add(batch.header, 87, 94, 'ACH-RELATION-BATCH-NUMBER-ORDER', 'relational', 'Batch Numbers must be strictly ascending within the file', {
          expected: `greater than ${previousBatchNumber.toString().padStart(7, '0')}`,
          actual: batchNumberRaw,
        });
      }
      previousBatchNumber = batchNumber;
    }

    let previousTrace: bigint | undefined;
    let hasForward = false;
    let hasReturnOrNoc = false;
    for (const entry of batch.entries) {
      const rule = transactionCodes.get(entry.detail.raw.substring(1, 3));
      const specialAddenda = entry.addenda.some(addenda => ['98', '99'].includes(addenda.raw.substring(1, 3)));
      if (rule?.kind === 'return' || specialAddenda) { hasReturnOrNoc = true; }
      else { hasForward = true; }

      if (batch.secCode === 'ADV') { continue; }
      const trace = entry.detail.raw.substring(79, 94);
      if (!/^\d{15}$/.test(trace)) { continue; }
      const numericTrace = BigInt(trace);
      if (previousTrace !== undefined && numericTrace <= previousTrace) {
        context.add(entry.detail, 79, 94, 'ACH-RELATION-TRACE-ORDER', 'relational', 'Trace Numbers must be strictly ascending within a batch', {
          expected: `greater than ${previousTrace.toString().padStart(15, '0')}`,
          actual: trace,
        });
      }
      previousTrace = numericTrace;
      const duplicate = traceLines.get(trace);
      if (duplicate) {
        context.add(entry.detail, 79, 94, 'ACH-RELATION-TRACE-DUPLICATE', 'relational', 'Trace Numbers must be unique within a file', {
          actual: trace,
          related: [related(duplicate, 79, 94, 'First use of this Trace Number')],
        });
      } else {
        traceLines.set(trace, entry.detail);
      }
    }
    if (hasForward && hasReturnOrNoc) {
      context.add(batch.header, 50, 53, 'ACH-STRUCTURE-MIXED-FORWARD-RETURN-BATCH', 'structural', 'Forward Entries and Return/Notification-of-Change Entries must not be mixed in one batch');
    }
  }
}

function validateNetPosition(document: AchDocument, batchTotals: BatchTotals[], context: ValidationContext): void {
  if (!context.profile.requireNetZero || !batchTotals.every(totals => totals.amountsValid)) { return; }
  const debit = batchTotals.reduce((sum, totals) => sum + totals.debit, 0n);
  const credit = batchTotals.reduce((sum, totals) => sum + totals.credit, 0n);
  if (debit === credit) { return; }
  const target = document.fileControls[0] ?? document.records.at(-1);
  const fileControl = target?.kind === 'fileControl';
  const advFile = document.batches.some(batch => batch.secCode === 'ADV');
  context.add(
    target,
    fileControl ? 31 : 0,
    fileControl ? (advFile ? 71 : 55) : target?.raw.length ?? 0,
    'ACH-PROFILE-NET-ZERO',
    'relational',
    `${context.profile.displayName} requires total debits and credits to net to zero`,
    {
      expected: '0 cents',
      actual: `${credit - debit} cents`,
      related: document.batches
        .filter(batch => batch.control)
        .map(batch => related(batch.control!, 20, batch.secCode === 'ADV' ? 60 : 44, 'Batch debit and credit totals')),
    },
  );
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
  validateNetPosition(document, batchTotals, context);
  validateMicroEntries(document, context);
  validateSequencesAndComposition(document, context);
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
