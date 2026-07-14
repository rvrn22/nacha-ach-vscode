/**
 * Effective-dated, deterministic ACH format tables used by the validator.
 *
 * This module deliberately contains only facts that can be established from
 * the bytes in an ACH file. Authorization, timing, sanctions screening,
 * agreements, routing-directory membership, and risk procedures require
 * evidence outside the file and are reported as compliance boundaries.
 */
export const ACH_RULES_EFFECTIVE_DATE = '2026-06-22';

export const validReturnReasonCodes = new Set([
  ...Array.from({ length: 47 }, (_, index) => `R${String(index + 1).padStart(2, '0')}`),
  'R50', 'R51', 'R52', 'R53',
  ...Array.from({ length: 17 }, (_, index) => `R${String(index + 61).padStart(2, '0')}`),
  'R80', 'R81', 'R82', 'R83', 'R84', 'R85',
]);

export const futureReturnReasonCodes = new Map([
  ['R90', '2028-03-17'],
]);

export type ReturnReasonSecRestriction = {
  allowed?: ReadonlySet<string>;
  excluded?: ReadonlySet<string>;
};

const allowed = (...secCodes: string[]): ReturnReasonSecRestriction => ({ allowed: new Set(secCodes) });
const excluded = (...secCodes: string[]): ReturnReasonSecRestriction => ({ excluded: new Set(secCodes) });

export const returnReasonSecRestrictions = new Map<string, ReturnReasonSecRestriction>([
  ['R05', allowed('CCD', 'CTX')],
  ['R10', excluded('CCD', 'CTX')],
  ['R11', excluded('CCD', 'CTX')],
  ['R21', allowed('CIE')],
  ['R29', allowed('CCD', 'CTX')],
  ['R31', allowed('CCD', 'CTX')],
  ['R33', allowed('XCK')],
  ['R35', excluded('CIE')],
  ['R36', excluded('ARC', 'BOC', 'POP', 'RCK', 'TEL', 'WEB', 'XCK')],
  ['R37', allowed('ARC', 'BOC', 'POP')],
  ['R38', allowed('ARC', 'BOC')],
  ['R39', allowed('ARC', 'BOC', 'POP')],
  ...Array.from({ length: 8 }, (_, index): [string, ReturnReasonSecRestriction] => [`R${40 + index}`, allowed('ENR')]),
  ...Array.from({ length: 4 }, (_, index): [string, ReturnReasonSecRestriction] => [`R${50 + index}`, allowed('RCK')]),
  ...Array.from({ length: 17 }, (_, index): [string, ReturnReasonSecRestriction] => [`R${61 + index}`, excluded('IAT')]),
  ...Array.from({ length: 6 }, (_, index): [string, ReturnReasonSecRestriction] => [`R${80 + index}`, allowed('IAT')]),
]);

export function returnReasonSecCompatibility(code: string, secCode: string): string | undefined {
  const restriction = returnReasonSecRestrictions.get(code);
  if (!restriction) { return undefined; }
  if (restriction.allowed && !restriction.allowed.has(secCode)) {
    return `${code} is valid only for SEC ${[...restriction.allowed].join(', ')}`;
  }
  if (restriction.excluded?.has(secCode)) {
    return `${code} is not valid for SEC ${secCode}`;
  }
  return undefined;
}

export const validNotificationOfChangeCodes = new Set([
  'C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C13', 'C14',
]);

export const isoCountryCodes = new Set(`
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/));

export const isoCurrencyCodes = new Set(`
AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD
CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP
GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW
KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD
NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP
SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES
VND VUV WST XAF XCD XCG XDR XOF XPF XSU YER ZAR ZMW ZWG ZWL
`.trim().split(/\s+/));

export const externalComplianceRequirements = [
  'Receiver authorization and authorization-date evidence',
  'Return, reversal, prenote, reinitiation, and settlement timing',
  'Routing-directory membership and participant eligibility',
  'OFAC and sanctions screening outcomes',
  'Originator, ODFI, RDFI, TPSP, and Third-Party Sender agreements',
  'Commercially reasonable fraud-monitoring processes and procedures',
  'Company Entry Description purpose classification, including PAYROLL and PURCHASE',
  'Application-specific addenda conventions and trading-partner schemas (for example X12, UN/EDIFACT, NACS, healthcare, and tax formats)',
  'Annual ACH Rules compliance audits and risk assessments',
] as const;
