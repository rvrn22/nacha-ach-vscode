// Public reference tables used by the rule engine:
// - https://achdevguide.nacha.org/ach-file-overview
// - https://www.fiscal.treasury.gov/data/FSv49/TRXv10/Transmission/Batch/BusinessTransaction/FinancialTransaction/CheckDetail/ACH_Info/index.html
// Institution-specific profiles may selectively relax compatibility checks; the
// transaction definitions themselves remain deterministic.

export type TransactionDirection = 'credit' | 'debit';
export type AccountType = 'checking' | 'savings' | 'generalLedger' | 'loan' | 'settlement';
export type TransactionKind = 'payment' | 'prenote' | 'zeroDollar' | 'return' | 'settlement';
export type ContextualTransactionKind = TransactionKind | 'acknowledgment' | 'deathNotice' | 'enrollment';

export type TransactionCodeRule = {
  code: string;
  direction: TransactionDirection;
  accountType: AccountType;
  kind: TransactionKind;
  description: string;
};

const transactionCodeRules: TransactionCodeRule[] = [
  { code: '21', direction: 'credit', accountType: 'checking', kind: 'return', description: 'Checking credit return or Notification of Change' },
  { code: '22', direction: 'credit', accountType: 'checking', kind: 'payment', description: 'Checking credit' },
  { code: '23', direction: 'credit', accountType: 'checking', kind: 'prenote', description: 'Checking credit prenote' },
  { code: '24', direction: 'credit', accountType: 'checking', kind: 'zeroDollar', description: 'Checking zero-dollar credit' },
  { code: '26', direction: 'debit', accountType: 'checking', kind: 'return', description: 'Checking debit return or Notification of Change' },
  { code: '27', direction: 'debit', accountType: 'checking', kind: 'payment', description: 'Checking debit' },
  { code: '28', direction: 'debit', accountType: 'checking', kind: 'prenote', description: 'Checking debit prenote' },
  { code: '29', direction: 'debit', accountType: 'checking', kind: 'zeroDollar', description: 'Checking zero-dollar debit' },
  { code: '31', direction: 'credit', accountType: 'savings', kind: 'return', description: 'Savings credit return or Notification of Change' },
  { code: '32', direction: 'credit', accountType: 'savings', kind: 'payment', description: 'Savings credit' },
  { code: '33', direction: 'credit', accountType: 'savings', kind: 'prenote', description: 'Savings credit prenote' },
  { code: '34', direction: 'credit', accountType: 'savings', kind: 'zeroDollar', description: 'Savings zero-dollar credit' },
  { code: '36', direction: 'debit', accountType: 'savings', kind: 'return', description: 'Savings debit return or Notification of Change' },
  { code: '37', direction: 'debit', accountType: 'savings', kind: 'payment', description: 'Savings debit' },
  { code: '38', direction: 'debit', accountType: 'savings', kind: 'prenote', description: 'Savings debit prenote' },
  { code: '39', direction: 'debit', accountType: 'savings', kind: 'zeroDollar', description: 'Savings zero-dollar debit' },
  { code: '41', direction: 'credit', accountType: 'generalLedger', kind: 'return', description: 'General-ledger credit return or Notification of Change' },
  { code: '42', direction: 'credit', accountType: 'generalLedger', kind: 'payment', description: 'General-ledger credit' },
  { code: '43', direction: 'credit', accountType: 'generalLedger', kind: 'prenote', description: 'General-ledger credit prenote' },
  { code: '44', direction: 'credit', accountType: 'generalLedger', kind: 'zeroDollar', description: 'General-ledger zero-dollar credit' },
  { code: '46', direction: 'debit', accountType: 'generalLedger', kind: 'return', description: 'General-ledger debit return or Notification of Change' },
  { code: '47', direction: 'debit', accountType: 'generalLedger', kind: 'payment', description: 'General-ledger debit' },
  { code: '48', direction: 'debit', accountType: 'generalLedger', kind: 'prenote', description: 'General-ledger debit prenote' },
  { code: '49', direction: 'debit', accountType: 'generalLedger', kind: 'zeroDollar', description: 'General-ledger zero-dollar debit' },
  { code: '51', direction: 'credit', accountType: 'loan', kind: 'return', description: 'Loan credit return or Notification of Change' },
  { code: '52', direction: 'credit', accountType: 'loan', kind: 'payment', description: 'Loan credit' },
  { code: '53', direction: 'credit', accountType: 'loan', kind: 'prenote', description: 'Loan credit prenote' },
  { code: '54', direction: 'credit', accountType: 'loan', kind: 'zeroDollar', description: 'Loan zero-dollar credit' },
  { code: '55', direction: 'debit', accountType: 'loan', kind: 'payment', description: 'Loan debit reversal' },
  { code: '56', direction: 'debit', accountType: 'loan', kind: 'return', description: 'Loan debit return or Notification of Change' },
  { code: '81', direction: 'credit', accountType: 'settlement', kind: 'settlement', description: 'Credit for ACH debits originated' },
  { code: '82', direction: 'debit', accountType: 'settlement', kind: 'settlement', description: 'Debit for ACH credits originated' },
  { code: '83', direction: 'credit', accountType: 'settlement', kind: 'settlement', description: 'Credit for ACH credits received' },
  { code: '84', direction: 'debit', accountType: 'settlement', kind: 'settlement', description: 'Debit for ACH debits received' },
  { code: '85', direction: 'credit', accountType: 'settlement', kind: 'settlement', description: 'Credit for ACH credits in rejected batches' },
  { code: '86', direction: 'debit', accountType: 'settlement', kind: 'settlement', description: 'Debit for ACH debits in rejected batches' },
  { code: '87', direction: 'credit', accountType: 'settlement', kind: 'settlement', description: 'Summary credit for respondent ACH activity' },
  { code: '88', direction: 'debit', accountType: 'settlement', kind: 'settlement', description: 'Summary debit for respondent ACH activity' },
];

export const transactionCodes = new Map(transactionCodeRules.map(rule => [rule.code, rule]));

export function isPrenoteTransaction(rule: TransactionCodeRule | undefined, secCode: string): boolean {
  return rule?.kind === 'prenote' && !['DNE', 'ENR'].includes(secCode);
}

export function isZeroDollarTransaction(rule: TransactionCodeRule | undefined, secCode: string): boolean {
  return rule?.kind === 'zeroDollar' && ['CCD', 'CTX', 'IAT'].includes(secCode);
}

export function contextualTransactionKind(
  rule: TransactionCodeRule | undefined,
  secCode: string,
): ContextualTransactionKind | 'unknown' {
  if (!rule) { return 'unknown'; }
  if (['ACK', 'ATX'].includes(secCode) && ['24', '34'].includes(rule.code)) { return 'acknowledgment'; }
  if (secCode === 'DNE' && ['23', '33'].includes(rule.code)) { return 'deathNotice'; }
  if (secCode === 'ENR' && ['23', '33'].includes(rule.code)) { return 'enrollment'; }
  return rule.kind;
}

export function describeTransactionCode(code: string, secCode: string): string | undefined {
  const rule = transactionCodes.get(code);
  if (!rule) { return undefined; }
  const account = rule.accountType === 'generalLedger'
    ? 'General-ledger'
    : `${rule.accountType.charAt(0).toUpperCase()}${rule.accountType.slice(1)}`;
  const kind = contextualTransactionKind(rule, secCode);
  if (kind === 'acknowledgment') { return `${account} acknowledgment`; }
  if (kind === 'deathNotice') { return `${account} death notification`; }
  if (kind === 'enrollment') { return `${account} automated enrollment`; }
  return rule.description;
}

export const knownSecCodes = new Set([
  'ACK', 'ADV', 'ARC', 'ATX', 'BOC', 'CCD', 'CIE', 'COR', 'CTX', 'DNE', 'ENR',
  'IAT', 'MTE', 'POP', 'POS', 'PPD', 'RCK', 'SHR', 'TEL', 'TRX', 'WEB',
]);

const consumerAccountSecCodes = new Set(['ARC', 'BOC', 'CIE', 'MTE', 'POP', 'POS', 'PPD', 'RCK', 'SHR', 'TEL', 'WEB']);
const zeroDollarSecCodes = new Set(['CCD', 'CTX', 'IAT']);
const debitOnlySecCodes = new Set(['ARC', 'BOC', 'POP', 'POS', 'RCK', 'TEL']);
const creditOnlySecCodes = new Set(['ACK', 'ATX', 'CIE', 'DNE', 'ENR']);
const type05AddendaSecCodes = new Set(['ACK', 'ATX', 'CCD', 'CIE', 'CTX', 'DNE', 'ENR', 'PPD', 'TRX', 'WEB']);
const type02AddendaSecCodes = new Set(['MTE', 'POS', 'SHR']);

export function transactionCodeCompatibility(rule: TransactionCodeRule, secCode: string): string | undefined {
  if (secCode === 'ADV' && rule.kind !== 'settlement') {
    return `ADV entries require an Automated Accounting Advice transaction code from 81 through 88`;
  }
  if (rule.kind === 'settlement' && secCode !== 'ADV') {
    return `Automated Accounting Advice transaction code ${rule.code} is valid only for SEC ADV`;
  }
  if (secCode === 'COR' && !['21', '26', '41', '46', '51', '56'].includes(rule.code)) {
    return `COR entries require transaction code 21, 26, 41, 46, 51, or 56`;
  }
  if (consumerAccountSecCodes.has(secCode) && !['checking', 'savings'].includes(rule.accountType)) {
    return `${secCode} entries use consumer checking or savings transaction codes`;
  }
  if (['ACK', 'ATX'].includes(secCode) && !['24', '34'].includes(rule.code)) {
    return `${secCode} acknowledgment entries require transaction code 24 or 34`;
  }
  if (rule.kind === 'zeroDollar' && !zeroDollarSecCodes.has(secCode) && !['ACK', 'ATX'].includes(secCode)) {
    return `Transaction code ${rule.code} is a zero-dollar code not supported by SEC ${secCode}`;
  }
  if (debitOnlySecCodes.has(secCode) && rule.direction !== 'debit') {
    return `${secCode} is a debit-only SEC code`;
  }
  if (creditOnlySecCodes.has(secCode) && rule.direction !== 'credit') {
    return `${secCode} is a credit-only SEC code`;
  }
  return undefined;
}

export function entryAmountRangeForSec(secCode: string): readonly [start: number, end: number] {
  return secCode === 'ADV' ? [27, 39] : [29, 39];
}

export function maximumAddendaForSec(secCode: string): number | undefined {
  if (['ACK', 'ATX'].includes(secCode)) { return 1; }
  if (secCode === 'COR') { return 1; }
  if (['PPD', 'CCD', 'WEB'].includes(secCode)) { return 1; }
  if (['ARC', 'BOC', 'POP', 'RCK', 'TEL'].includes(secCode)) { return 0; }
  if (type02AddendaSecCodes.has(secCode)) { return 1; }
  if (secCode === 'CTX') { return 9999; }
  if (secCode === 'IAT') { return 12; }
  return undefined;
}

export function allowedAddendaTypesForSec(secCode: string): ReadonlySet<string> | undefined {
  if (secCode === 'COR') { return new Set(['98']); }
  if (type05AddendaSecCodes.has(secCode)) { return new Set(['05']); }
  if (type02AddendaSecCodes.has(secCode)) { return new Set(['02']); }
  if (secCode === 'IAT') { return new Set(['10', '11', '12', '13', '14', '15', '16', '17', '18']); }
  return undefined;
}
