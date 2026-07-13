import type { AchField, AchRecord } from './achDocument';
import { transactionCodes } from './achRules';
import { formatAchCents } from './nachaParser';

export type DecodedAchValue = {
  display: string;
  raw: string;
  masked: boolean;
};

const serviceClassDescriptions: Record<string, string> = {
  '200': 'Mixed debits and credits',
  '220': 'Credits only',
  '225': 'Debits only',
};

const secDescriptions: Record<string, string> = {
  ACK: 'Acknowledgment Entry',
  ARC: 'Accounts Receivable Entry',
  ATX: 'Financial EDI Acknowledgment',
  BOC: 'Back Office Conversion',
  CCD: 'Corporate Credit or Debit',
  CIE: 'Customer Initiated Entry',
  CTX: 'Corporate Trade Exchange',
  IAT: 'International ACH Transaction',
  MTE: 'Machine Transfer Entry',
  POP: 'Point-of-Purchase Entry',
  POS: 'Point-of-Sale Entry',
  PPD: 'Prearranged Payment and Deposit',
  RCK: 'Re-presented Check Entry',
  SHR: 'Shared Network Transaction',
  TEL: 'Telephone-Initiated Entry',
  WEB: 'Internet-Initiated/Mobile Entry',
};

const sensitiveFieldPattern = /(?:account number|individual identification|receiver id|identification number|foreign receiver)/i;

export function isSensitiveAchField(fieldName: string): boolean {
  return sensitiveFieldPattern.test(fieldName);
}

export function maskAchValue(value: string, visibleSuffix = 4): string {
  if (value.length === 0) { return '<blank>'; }
  if (value.length <= visibleSuffix) { return '•'.repeat(Math.max(4, value.length)); }
  const suffixLength = Math.min(visibleSuffix, value.length);
  const suffix = value.slice(-suffixLength);
  const maskedLength = Math.max(4, value.length - suffixLength);
  return `${'•'.repeat(maskedLength)}${suffix}`;
}

function decodeDate(value: string): string | undefined {
  if (!/^\d{6}$/.test(value)) { return undefined; }
  return `20${value.substring(0, 2)}-${value.substring(2, 4)}-${value.substring(4, 6)}`;
}

function decodeTime(value: string): string | undefined {
  if (!/^\d{4}$/.test(value)) { return undefined; }
  return `${value.substring(0, 2)}:${value.substring(2, 4)}`;
}

function isCentAmountField(fieldName: string): boolean {
  return fieldName === 'Amount' || /Dollar Amount/i.test(fieldName);
}

export function decodeAchField(record: AchRecord, field: AchField, maskSensitiveValues = true): DecodedAchValue {
  const raw = field.rawValue;
  const value = field.value;

  if (maskSensitiveValues && isSensitiveAchField(field.name)) {
    return { display: maskAchValue(value), raw: maskAchValue(value), masked: true };
  }
  if (value.length === 0) {
    return { display: '<blank>', raw, masked: false };
  }

  if (field.name === 'Transaction Code') {
    const rule = transactionCodes.get(value);
    return { display: rule ? `${value} — ${rule.description}` : value, raw, masked: false };
  }
  if (field.name === 'Receiving DFI Identification' && /^\d{8}$/.test(value)) {
    const checkDigit = record.raw.substring(11, 12);
    const routingNumber = /^\d$/.test(checkDigit) ? `${value}${checkDigit}` : value;
    return { display: `${routingNumber} — routing number`, raw, masked: false };
  }
  if (field.name === 'Immediate Destination' && /^\d{9}$/.test(value)) {
    return { display: `${value} — routing number`, raw, masked: false };
  }
  if (field.name === 'Service Class Code') {
    const description = serviceClassDescriptions[value];
    return { display: description ? `${value} — ${description}` : value, raw, masked: false };
  }
  if (field.name === 'Standard Entry Class' || field.name === 'Standard Entry Class Code') {
    const description = secDescriptions[value];
    return { display: description ? `${value} — ${description}` : value, raw, masked: false };
  }
  if (isCentAmountField(field.name) && /^\d+$/.test(value)) {
    return { display: `$${formatAchCents(BigInt(value))}`, raw, masked: false };
  }
  if (field.name === 'File Creation Date' || field.name === 'Effective Entry Date') {
    const decoded = decodeDate(value);
    if (decoded) { return { display: decoded, raw, masked: false }; }
  }
  if (field.name === 'File Creation Time') {
    const decoded = decodeTime(value);
    if (decoded) { return { display: decoded, raw, masked: false }; }
  }
  if (field.name === 'Addenda Record Indicator') {
    const description = value === '1' ? 'Addenda attached' : value === '0' ? 'No addenda' : undefined;
    return { display: description ? `${value} — ${description}` : value, raw, masked: false };
  }
  if (field.name === 'Number of Addenda Records' && /^\d+$/.test(value)) {
    return { display: BigInt(value).toString(), raw, masked: false };
  }
  if (field.name === 'Record Type Code') {
    return { display: `${value} — ${record.kind}`, raw, masked: false };
  }

  return { display: value, raw, masked: false };
}
