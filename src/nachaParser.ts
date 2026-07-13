import { parseAchDocument, type AchDocument } from './achDocument';
import { transactionCodes } from './achRules';

export type {
  AchDiagnostic,
  AchDiagnosticSeverity,
  AchRelatedLocation,
  AchRuleOverride,
  AchRuleCategory,
  AchRuleSeverityName,
  AchValidationProfile,
} from './achTypes';
export { ACH_RULESET_VERSION, nachaValidationProfile, unblockedValidationProfile } from './achTypes';
export { resolveAchValidationProfile, validationProfileSignature } from './achProfiles';
export { validateAch, validateAch as parseAch } from './achValidator';

export type AchSummary = {
  batches: number;
  entries: number;
  totalDebitCents: bigint;
  totalCreditCents: bigint;
  netAmountCents: bigint;
};

export function parseAchSummary(input: string | AchDocument): AchSummary {
  const document = typeof input === 'string' ? parseAchDocument(input) : input;
  let entries = 0;
  let totalDebitCents = 0n;
  let totalCreditCents = 0n;

  for (const batch of document.batches) {
    for (const entry of batch.entries) {
      entries++;
      const rule = transactionCodes.get(entry.detail.raw.substring(1, 3));
      const amountRaw = entry.detail.raw.substring(29, 39);
      if (!rule || !/^\d{10}$/.test(amountRaw)) {
        continue;
      }
      const amount = BigInt(amountRaw);
      if (rule.direction === 'credit') {
        totalCreditCents += amount;
      } else {
        totalDebitCents += amount;
      }
    }
  }

  return {
    batches: document.batches.length,
    entries,
    totalDebitCents,
    totalCreditCents,
    netAmountCents: totalCreditCents - totalDebitCents,
  };
}

/** Formats an exact bigint cent amount without converting through Number. */
export function formatAchCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const dollars = absolute / 100n;
  const remainder = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${dollars}.${remainder}`;
}
