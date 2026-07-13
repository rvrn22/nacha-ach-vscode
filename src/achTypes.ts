export type AchDiagnosticSeverity = 0 | 1 | 2 | 3;
export type AchRuleSeverityName = 'error' | 'warning' | 'information' | 'hint' | 'off';

export const ACH_RULESET_VERSION = '2026.07.11';

export type AchRuleCategory =
  | 'physical'
  | 'structural'
  | 'field'
  | 'relational'
  | 'sec';

export type AchRelatedLocation = {
  line: number;
  start: number;
  end: number;
  message: string;
};

export type AchDiagnostic = {
  line: number;
  start: number;
  end: number;
  message: string;
  severity: AchDiagnosticSeverity;
  code: string;
  category: AchRuleCategory;
  profile: string;
  rulesVersion: string;
  overrideReason?: string;
  expected?: string;
  actual?: string;
  related?: AchRelatedLocation[];
};

export type AchValidationProfile = {
  id: string;
  displayName: string;
  requireBlocking: boolean;
  validateSecCompatibility: boolean;
  validateAsciiCharacters: boolean;
  requireNetZero: boolean;
  rulesVersion: string;
  ruleOverrides: Record<string, AchRuleOverride>;
};

export type AchRuleOverride = {
  severity: AchRuleSeverityName;
  reason: string;
};

export const nachaValidationProfile: AchValidationProfile = {
  id: 'nacha-default',
  displayName: 'Nacha default',
  requireBlocking: true,
  validateSecCompatibility: true,
  validateAsciiCharacters: true,
  requireNetZero: false,
  rulesVersion: ACH_RULESET_VERSION,
  ruleOverrides: {},
};

/**
 * A compatibility profile for institutions that accept unblocked files while
 * retaining all structural, field, and control validations.
 */
export const unblockedValidationProfile: AchValidationProfile = {
  ...nachaValidationProfile,
  id: 'institution-unblocked',
  displayName: 'Institution-compatible unblocked file',
  requireBlocking: false,
};

/** An opt-in institution profile for files expected to carry their offset. */
export const balancedValidationProfile: AchValidationProfile = {
  ...nachaValidationProfile,
  id: 'nacha-balanced',
  displayName: 'Nacha format + net-zero totals',
  requireNetZero: true,
};
