import {
  ACH_RULESET_VERSION,
  balancedValidationProfile,
  nachaValidationProfile,
  unblockedValidationProfile,
  type AchRuleOverride,
  type AchRuleSeverityName,
  type AchValidationProfile,
} from './achTypes';

export type AchCustomProfileDefinition = {
  extends?: 'nacha' | 'unblocked' | 'balanced';
  displayName?: string;
  requireBlocking?: boolean;
  validateSecCompatibility?: boolean;
  validateAsciiCharacters?: boolean;
  requireNetZero?: boolean;
  ruleOverrides?: Record<string, AchRuleOverride | AchRuleSeverityName>;
};

const severityNames = new Set<AchRuleSeverityName>(['error', 'warning', 'information', 'hint', 'off']);

function normalizeOverride(value: unknown, fallbackReason: string): AchRuleOverride | undefined {
  if (typeof value === 'string' && severityNames.has(value as AchRuleSeverityName)) {
    return { severity: value as AchRuleSeverityName, reason: fallbackReason };
  }
  if (!value || typeof value !== 'object') { return undefined; }
  const candidate = value as { severity?: unknown; reason?: unknown };
  if (typeof candidate.severity !== 'string' || !severityNames.has(candidate.severity as AchRuleSeverityName)) {
    return undefined;
  }
  if (typeof candidate.reason !== 'string' || candidate.reason.trim().length === 0) {
    return undefined;
  }
  return { severity: candidate.severity as AchRuleSeverityName, reason: candidate.reason.trim() };
}

export function normalizeRuleOverrides(
  values: Record<string, unknown> | undefined,
  fallbackReason = 'Configured rule override',
): Record<string, AchRuleOverride> {
  const result: Record<string, AchRuleOverride> = {};
  for (const [rule, value] of Object.entries(values ?? {})) {
    const override = normalizeOverride(value, fallbackReason);
    if (override) { result[rule] = override; }
  }
  return result;
}

function baseProfile(id: string): AchValidationProfile {
  if (id === 'balanced' || id === balancedValidationProfile.id) { return balancedValidationProfile; }
  return id === 'unblocked' || id === unblockedValidationProfile.id
    ? unblockedValidationProfile
    : nachaValidationProfile;
}

export function isBuiltInAchValidationProfile(id: string): boolean {
  return ['nacha', nachaValidationProfile.id, 'unblocked', unblockedValidationProfile.id, 'balanced', balancedValidationProfile.id].includes(id);
}

export function resolveAchValidationProfile(
  requestedId: string,
  customProfiles: Record<string, AchCustomProfileDefinition> = {},
  globalOverrides: Record<string, unknown> = {},
): AchValidationProfile {
  const definition = customProfiles[requestedId];
  const base = baseProfile(definition?.extends ?? requestedId);
  const customOverrides = normalizeRuleOverrides(definition?.ruleOverrides as Record<string, unknown> | undefined, `Profile '${requestedId}' override`);
  const configuredOverrides = normalizeRuleOverrides(globalOverrides, 'Workspace rule override');
  if (!definition) {
    return {
      ...base,
      rulesVersion: ACH_RULESET_VERSION,
      ruleOverrides: { ...base.ruleOverrides, ...configuredOverrides },
    };
  }
  return {
    id: requestedId,
    displayName: definition.displayName?.trim() || requestedId,
    requireBlocking: definition.requireBlocking ?? base.requireBlocking,
    validateSecCompatibility: definition.validateSecCompatibility ?? base.validateSecCompatibility,
    validateAsciiCharacters: definition.validateAsciiCharacters ?? base.validateAsciiCharacters,
    requireNetZero: definition.requireNetZero ?? base.requireNetZero,
    rulesVersion: ACH_RULESET_VERSION,
    ruleOverrides: { ...base.ruleOverrides, ...customOverrides, ...configuredOverrides },
  };
}

export function validationProfileSignature(profile: AchValidationProfile): string {
  return JSON.stringify({
    id: profile.id,
    requireBlocking: profile.requireBlocking,
    validateSecCompatibility: profile.validateSecCompatibility,
    validateAsciiCharacters: profile.validateAsciiCharacters,
    requireNetZero: profile.requireNetZero,
    rulesVersion: profile.rulesVersion,
    ruleOverrides: profile.ruleOverrides,
  });
}
