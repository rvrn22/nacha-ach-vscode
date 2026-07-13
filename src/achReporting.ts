import { getAchFieldAtPosition, type AchDocument } from './achDocument';
import { isSensitiveAchField } from './achDecode';
import type { AchSummary } from './nachaParser';
import type { AchDiagnostic, AchValidationProfile } from './achTypes';

export type AchReportInput = {
  fileName: string;
  document: AchDocument;
  diagnostics: AchDiagnostic[];
  summary: AchSummary;
  profile: AchValidationProfile;
  generatedAt?: string;
};

function severityName(severity: number): string {
  return severity === 0 ? 'error' : severity === 1 ? 'warning' : severity === 2 ? 'information' : 'hint';
}

function sarifLevel(severity: number): 'error' | 'warning' | 'note' {
  return severity === 0 ? 'error' : severity === 1 ? 'warning' : 'note';
}

function sensitiveDiagnostic(document: AchDocument, diagnostic: AchDiagnostic): boolean {
  const record = document.recordByLine.get(diagnostic.line);
  const field = record ? getAchFieldAtPosition(record, diagnostic.start) : undefined;
  return field ? isSensitiveAchField(field.name) : false;
}

function reportDiagnostic(document: AchDocument, diagnostic: AchDiagnostic) {
  const sensitive = sensitiveDiagnostic(document, diagnostic);
  return {
    code: diagnostic.code,
    category: diagnostic.category,
    severity: severityName(diagnostic.severity),
    message: diagnostic.message,
    location: {
      line: diagnostic.line + 1,
      startColumn: diagnostic.start + 1,
      endColumn: Math.max(diagnostic.start + 1, diagnostic.end),
    },
    expected: sensitive && diagnostic.expected !== undefined ? '[REDACTED]' : diagnostic.expected,
    actual: sensitive && diagnostic.actual !== undefined ? '[REDACTED]' : diagnostic.actual,
    overriddenBecause: diagnostic.overrideReason,
    related: diagnostic.related?.map(item => ({
      line: item.line + 1,
      startColumn: item.start + 1,
      endColumn: Math.max(item.start + 1, item.end),
      message: item.message,
    })),
  };
}

export function createAchJsonReport(input: AchReportInput) {
  return {
    schema: 'nacha-ach-validation-report/v1',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    redacted: true,
    rulesVersion: input.profile.rulesVersion,
    profile: {
      id: input.profile.id,
      displayName: input.profile.displayName,
      requireBlocking: input.profile.requireBlocking,
      validateSecCompatibility: input.profile.validateSecCompatibility,
      validateAsciiCharacters: input.profile.validateAsciiCharacters,
      ruleOverrides: input.profile.ruleOverrides,
    },
    file: {
      name: input.fileName,
      records: input.document.records.length,
      batches: input.summary.batches,
      entries: input.summary.entries,
    },
    result: {
      valid: input.diagnostics.every(diagnostic => diagnostic.severity !== 0),
      errors: input.diagnostics.filter(diagnostic => diagnostic.severity === 0).length,
      warnings: input.diagnostics.filter(diagnostic => diagnostic.severity === 1).length,
      information: input.diagnostics.filter(diagnostic => diagnostic.severity >= 2).length,
    },
    diagnostics: input.diagnostics.map(diagnostic => reportDiagnostic(input.document, diagnostic)),
  };
}

export function createAchSarifRun(input: AchReportInput) {
  const rules = new Map<string, AchDiagnostic>();
  for (const diagnostic of input.diagnostics) { rules.set(diagnostic.code, diagnostic); }
  return {
    tool: {
      driver: {
        name: 'nacha-file-parser',
        informationUri: 'https://github.com/rvrn22/nacha-file-parser',
        semanticVersion: input.profile.rulesVersion,
        rules: [...rules.values()].map(diagnostic => ({
          id: diagnostic.code,
          shortDescription: { text: diagnostic.message },
          properties: { category: diagnostic.category },
        })),
      },
    },
    artifacts: [{ location: { uri: input.fileName } }],
    results: input.diagnostics.map(diagnostic => {
      const reported = reportDiagnostic(input.document, diagnostic);
      return {
        ruleId: diagnostic.code,
        level: sarifLevel(diagnostic.severity),
        message: { text: diagnostic.message },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: input.fileName },
            region: {
              startLine: reported.location.line,
              startColumn: reported.location.startColumn,
              endColumn: reported.location.endColumn,
            },
          },
        }],
        properties: {
          category: diagnostic.category,
          profile: diagnostic.profile,
          rulesVersion: diagnostic.rulesVersion,
          expected: reported.expected,
          actual: reported.actual,
          overriddenBecause: diagnostic.overrideReason,
        },
      };
    }),
  };
}

export function createAchSarifReport(input: AchReportInput) {
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [createAchSarifRun(input)],
  };
}

export function serializeAchReport(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
