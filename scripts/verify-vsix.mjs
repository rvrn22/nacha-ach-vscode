import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const vsix = resolve(process.argv[2] ?? 'nacha-file-parser-1.0.0.vsix');
const expectedVersion = '1.0.0';
const requiredFiles = [
  'extension/package.json',
  'extension/bin/ach-validate.js',
  'extension/dist/extension.js',
  'extension/dist/cli.js',
  'extension/rules/ach-rules-2026.06.22.json',
];

function archiveText(...args) {
  return execFileSync('unzip', args, { encoding: 'utf8' });
}

const entries = new Set(archiveText('-Z1', vsix).trim().split(/\r?\n/));
for (const required of requiredFiles) {
  if (!entries.has(required)) { throw new Error(`VSIX is missing ${required}`); }
}

const manifest = JSON.parse(archiveText('-p', vsix, 'extension/package.json'));
if (manifest.version !== expectedVersion) {
  throw new Error(`Expected package version ${expectedVersion}; found ${manifest.version}`);
}
if (!basename(vsix).includes(expectedVersion)) {
  throw new Error(`VSIX filename must include ${expectedVersion}`);
}
if (manifest.main !== './dist/extension.js' || manifest.bin?.['ach-validate'] !== './bin/ach-validate.js') {
  throw new Error('Packaged extension/CLI entry points are incorrect');
}
if (!manifest.activationEvents?.includes('onLanguage:ach')) {
  throw new Error('Packaged extension is missing ACH activation');
}
if (!manifest.contributes?.commands?.some(command => command.command === 'nacha-file-parser.applyAllSafeFixes')) {
  throw new Error('Packaged extension is missing current validation/fix commands');
}

const extensionBytes = execFileSync('unzip', ['-p', vsix, 'extension/dist/extension.js']);
const cliBytes = execFileSync('unzip', ['-p', vsix, 'extension/dist/cli.js']);
if (extensionBytes.length < 100_000 || cliBytes.length < 50_000) {
  throw new Error('Packaged bundles are unexpectedly small and may be stale');
}

const temporary = mkdtempSync(join(tmpdir(), 'nacha-vsix-smoke-'));
try {
  execFileSync('unzip', ['-q', vsix, '-d', temporary]);
  const emptyFile = join(temporary, 'empty.ach');
  writeFileSync(emptyFile, '');
  const cli = spawnSync(process.execPath, [
    join(temporary, 'extension', 'bin', 'ach-validate.js'),
    '--format', 'json', emptyFile,
  ], { encoding: 'utf8' });
  if (cli.status !== 1) { throw new Error(`Packaged CLI accepted an empty file (exit ${cli.status})`); }
  const report = JSON.parse(cli.stdout);
  if (report.result?.formatValid !== false || report.result?.complianceCertified !== false) {
    throw new Error('Packaged CLI report does not expose fail-closed format and compliance scope');
  }
  if (!report.diagnostics?.some(diagnostic => diagnostic.code === 'ACH-STRUCTURE-MISSING-FILE-HEADER')) {
    throw new Error('Packaged CLI did not report the missing File Header');
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write(`Verified ${basename(vsix)}: version, contents, bundle freshness, activation, and packaged CLI.\n`);
