import * as fs from 'fs';
import * as path from 'path';
import { parseAchDocument } from './achDocument';
import { resolveAchValidationProfile } from './achProfiles';
import { createAchJsonReport, createAchSarifRun, serializeAchReport, type AchReportInput } from './achReporting';
import { parseAch, parseAchSummary } from './nachaParser';
import type { AchRuleSeverityName } from './achTypes';

type OutputFormat = 'text' | 'json' | 'sarif';
type FailOn = 'error' | 'warning' | 'never';

export type CliIo = {
  readFile(fileName: string): string;
  write(text: string): void;
  writeError(text: string): void;
};

const defaultIo: CliIo = {
  readFile: fileName => fs.readFileSync(fileName, 'utf8'),
  write: text => process.stdout.write(text),
  writeError: text => process.stderr.write(text),
};

const severityNames = new Set<AchRuleSeverityName>(['error', 'warning', 'information', 'hint', 'off']);

function usage(): string {
  return `Usage: ach-validate [options] <file.ach> [...files]\n\n` +
    `Options:\n` +
    `  --format text|json|sarif       Output format (default: text)\n` +
    `  --profile nacha|unblocked      Validation profile (default: nacha)\n` +
    `  --rule CODE=SEVERITY[:REASON]  Override or suppress a rule\n` +
    `  --fail-on error|warning|never  Exit-code threshold (default: error)\n` +
    `  --help                         Show this help\n`;
}

export async function runCli(args: string[], io: CliIo = defaultIo): Promise<number> {
  let format: OutputFormat = 'text';
  let profileId = 'nacha';
  let failOn: FailOn = 'error';
  const files: string[] = [];
  const overrides: Record<string, { severity: AchRuleSeverityName; reason: string }> = {};

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      io.write(usage());
      return 0;
    }
    if (argument === '--format') {
      const value = args[++index] as OutputFormat;
      if (!['text', 'json', 'sarif'].includes(value)) {
        io.writeError(`Invalid --format value '${value}'.\n`);
        return 2;
      }
      format = value;
      continue;
    }
    if (argument === '--profile') {
      profileId = args[++index] ?? '';
      if (!profileId) { io.writeError('Missing --profile value.\n'); return 2; }
      continue;
    }
    if (argument === '--fail-on') {
      const value = args[++index] as FailOn;
      if (!['error', 'warning', 'never'].includes(value)) {
        io.writeError(`Invalid --fail-on value '${value}'.\n`);
        return 2;
      }
      failOn = value;
      continue;
    }
    if (argument === '--rule') {
      const value = args[++index] ?? '';
      const [assignment, ...reasonParts] = value.split(':');
      const separator = assignment.indexOf('=');
      const code = separator >= 0 ? assignment.substring(0, separator) : '';
      const severity = separator >= 0 ? assignment.substring(separator + 1) as AchRuleSeverityName : undefined;
      if (!code || !severity || !severityNames.has(severity)) {
        io.writeError(`Invalid --rule value '${value}'. Expected CODE=SEVERITY[:REASON].\n`);
        return 2;
      }
      overrides[code] = {
        severity,
        reason: reasonParts.join(':').trim() || `CLI override for ${code}`,
      };
      continue;
    }
    if (argument.startsWith('-')) {
      io.writeError(`Unknown option '${argument}'.\n`);
      return 2;
    }
    files.push(argument);
  }

  if (files.length === 0) {
    io.writeError(usage());
    return 2;
  }

  const profile = resolveAchValidationProfile(profileId, {}, overrides);
  const reports: AchReportInput[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = io.readFile(file);
    } catch (error) {
      io.writeError(`Unable to read '${file}': ${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
    const document = parseAchDocument(text);
    reports.push({
      fileName: path.basename(file),
      document,
      diagnostics: parseAch(document, profile),
      summary: parseAchSummary(document),
      profile,
    });
  }

  if (format === 'json') {
    const values = reports.map(report => createAchJsonReport(report));
    io.write(serializeAchReport(values.length === 1 ? values[0] : values));
  } else if (format === 'sarif') {
    io.write(serializeAchReport({
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: reports.map(report => createAchSarifRun(report)),
    }));
  } else {
    for (const report of reports) {
      const errors = report.diagnostics.filter(diagnostic => diagnostic.severity === 0).length;
      const warnings = report.diagnostics.filter(diagnostic => diagnostic.severity === 1).length;
      io.write(`${report.fileName}: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}\n`);
      for (const diagnostic of report.diagnostics) {
        const severity = diagnostic.severity === 0 ? 'error' : diagnostic.severity === 1 ? 'warning' : 'info';
        io.write(`  ${diagnostic.line + 1}:${diagnostic.start + 1} ${severity} ${diagnostic.code} ${diagnostic.message}\n`);
      }
    }
  }

  if (failOn === 'never') { return 0; }
  const failing = reports.some(report => report.diagnostics.some(diagnostic =>
    failOn === 'warning' ? diagnostic.severity <= 1 : diagnostic.severity === 0,
  ));
  return failing ? 1 : 0;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  process.exitCode = await runCli(args);
}
