# ACH Syntax Highlighter and Validator

A professional Visual Studio Code extension for developers and treasury professionals working with NACHA ACH files. It provides deep validation, intelligent syntax highlighting, and context-aware tooltips for standard and international transactions.

![Icon](icon.png)

## Features

### 🔍 Deep Validation
- **Bank Routing Checksums**: Automatically validates RDFI routing-number check digits using the standard routing checksum algorithm.
- **Aggregate Totals**: Verifies Batch Controls (Type 8) and File Controls (Type 9) against actual entry counts, debit/credit sums, and entry hashes.
- **Record Integrity**: Checks for correct record lengths (94 characters), mandatory fields, and proper record ordering (Header -> Batch -> Entry -> Control).
- **Rule-Based Diagnostics**: Reports stable rule codes, expected and actual values, and related header/control locations across physical, structural, field, relational, and SEC-specific validation.
- **Validation Profiles**: Supports strict 10-record blocking or an institution-compatible unblocked-file profile.

### 🌐 Full IAT Support
- **International Transactions**: Comprehensive support for International ACH Transactions (IAT).
- **Contextual Parsing**: Switches field definitions automatically when an IAT batch is detected.
- **Mandatory Addenda**: Validates the presence of the 7 required IAT addenda records (Types 10-16: Name, Address, Bank IDs, etc.).

### 🎨 Visual Intelligence
- **Alternating Field Highlighting**: Provides visual cues for field boundaries with alternating colors to make fixed-width files readable.
- **Interactive Hovers**: Hover over any position to see the field name, description, start/end positions, and the raw value.
- **Batch Separation**: Visual borders and unique alternating backgrounds per batch for easy navigation.

### 🧭 Decoded ACH Explorer
- **Expandable Hierarchy**: Browse files as batches, entries, addenda, records, and fields from the Explorer sidebar.
- **Raw and Decoded Values**: See fixed-width values beside formatted amounts, dates, transaction codes, service classes, and SEC descriptions.
- **Synchronized Navigation**: Selecting a decoded field reveals its exact raw characters, while moving the editor cursor selects the matching explorer field.
- **Privacy by Default**: Account, company/originator, and individual identifiers are masked unless explicitly enabled in settings.
- **Validation Context**: File, batch, entry, record, and field nodes show error/warning badges and aggregate totals.

### 🧱 Navigation and Reading Aids
- **Outline and Breadcrumbs**: Navigate file, batch, entry, and addenda symbols using VS Code Outline, breadcrumbs, and sticky scroll.
- **Structural Folding**: Collapse batches, entry/addenda groups, and file padding.
- **Matching Records**: Jump between file headers/controls, batch headers/controls, and entry/addenda records.
- **Problem Traversal**: Move directly to the next or previous ACH validation problem.
- **Fixed-Width Context**: See the current column and field in the status bar, with an optional column-94 guide and field-name inlay hints.
- **Related Fields**: Header/control values, aggregate totals, and entry/addenda trace relationships highlight together.

### 🛠 Safe Quick Fixes
- **Inline Quick Fixes**: Correct routing check digits, derived control values, header/control synchronization, and addenda metadata directly from Problems or the lightbulb menu.
- **Derived Recalculation**: Rebuild batch and file counts, hashes, debit/credit totals, and block counts from actual entries.
- **Safe Fix All**: Apply only deterministic fixed-format repairs, including padding and unambiguous trailing spaces.
- **Explicit Renumbering**: Renumber batches, traces, and addenda sequences only through a separately invoked command.
- **Diff Before Apply**: Every multi-record command opens a comparison and waits for confirmation.
- **Ambiguity Guardrails**: The extension never guesses routing numbers, dates, transaction/SEC codes, account data, or truncation.

### 📋 Profiles, Reports, and Automation
- **Named Profiles**: Define institution/operator profiles that extend strict or unblocked validation behavior.
- **Explained Overrides**: Change or suppress exact rules, categories, or all rules only with a recorded reason.
- **Versioned Rules**: Reports identify ruleset version `2026.07.1` independently from the extension version.
- **Redacted Reports**: Export JSON or SARIF without exposing account numbers and individual identifiers.
- **Headless CLI**: Run the same parser and validator in CI, scripts, and pre-upload workflows.
- **Text Detection**: High-confidence ACH content in `.txt` files can switch to ACH language mode with one click.

### ⚙️ Highly Customizable
- **Color Picker Support**: Choose your own colors for every record type (1-9) directly in the VS Code Settings UI.
- **Theme Friendly**: Supports standardized 8-character hex colors (#rrggbbaa) for transparency.

### ♿ Accessible and Large-File Friendly
- **Non-Color Labels**: Textual record labels appear after column 94, so record meaning never depends on color alone.
- **High-Contrast Boundaries**: High-contrast themes automatically add dotted field boundaries; the option is also independently configurable.
- **Debounced Analysis**: Active edits wait briefly before triggering full validation.
- **Viewport Rendering**: Field decorations and record labels are limited to the visible editor region plus a buffer.
- **Bounded UI Trees**: The explorer limits materialized Entry nodes while totals and validation continue to cover the complete file.
- **Bounded Problems**: VS Code Problems can be capped while JSON, SARIF, and CLI results remain complete.
- **Performance Regression**: The automated suite parses, validates, and summarizes a 10,000-entry ACH file.

## Usage

Simply open any file with the `.ach` extension. The extension activates automatically and provides:
1. **Syntax Highlighting**: Different backgrounds for File Header, Batch Header, Entry Details, etc.
2. **Diagnostics**: Errors and warnings in the "Problems" panel for missing totals, invalid routing, or record length issues.
3. **Hover Info**: Detailed NACHA file specification data directly in your editor.
4. **Decoded ACH Explorer**: Expand the file hierarchy in the Explorer sidebar and select any field to reveal its raw source range.
5. **ACH Navigation Commands**: Use the Command Palette or editor context menu to jump to matching records and validation problems.
6. **Safe Repairs**: Use individual Quick Fixes or preview `Recalculate All Derived Fields`, `Apply All Safe Fixes`, and sequence-renumbering commands.
7. **Reports and CI**: Export redacted reports from VS Code or run `ach-validate` from the command line.

## Headless Validation

```bash
ach-validate payments.ach
ach-validate --format sarif payments.ach > ach-results.sarif
ach-validate --fail-on warning payments.ach
ach-validate --rule 'ACH-PHYSICAL-PADDING-COUNT=off:Processor accepts unblocked files' payments.ach
```

The CLI exits `1` when the configured threshold is reached, `2` for usage/read failures, and `0` otherwise.

## Named Profile Example

```json
{
  "nachaFileParser.validationProfile": "partner-bank",
  "nachaFileParser.validationProfiles": {
    "partner-bank": {
      "extends": "unblocked",
      "displayName": "Partner Bank",
      "ruleOverrides": {
        "ACH-SEC-TRANSACTION-CODE": {
          "severity": "warning",
          "reason": "Partner performs this compatibility check after upload"
        }
      }
    }
  }
}
```

## Extension Settings

This extension contributes the following settings:

* `nachaFileParser.validationProfile`: Select the built-in `nacha`/`unblocked` profile or a custom named profile.
* `nachaFileParser.validationProfiles`: Define named institution/operator profiles.
* `nachaFileParser.ruleOverrides`: Override exact rules, categories, or all rules with a severity and explanation.
* `nachaFileParser.rowColoring`: Color complete batches or individual record types.
* `nachaFileParser.recordTypeColors`: Customize background colors for each record type (1-9).
* `nachaFileParser.batchRowColors`: Colors for alternating batches.
* `nachaFileParser.fieldColors`: Text colors for alternating fields.
* `nachaFileParser.paddingRowColor`: Color for blocking/filler records.
* `nachaFileParser.showRecordTypeLabels`: Show textual record labels after column 94 (enabled by default).
* `nachaFileParser.accessibleFieldBoundaries`: Add non-color field boundaries (automatic in high-contrast themes).
* `nachaFileParser.maskSensitiveValues`: Mask account numbers and individual identifiers in the Decoded ACH explorer (enabled by default).
* `nachaFileParser.showColumnRuler`: Show the fixed-width boundary at column 94 (enabled by default).
* `nachaFileParser.showFieldInlayHints`: Show field names directly at fixed-width boundaries (disabled by default).
* `nachaFileParser.detectAchInTextFiles`: Offer ACH language mode for high-confidence `.txt` files (enabled by default).
* `nachaFileParser.validationDebounceMs`: Configure the edit-to-validation delay.
* `nachaFileParser.explorerEntryLimit`: Limit Entry nodes rendered in the Decoded ACH explorer.
* `nachaFileParser.maxDiagnostics`: Limit Problems entries without limiting reports or CLI results.

## Installation

Install via the VS Code Marketplace or by downloading the `.vsix` file from the repository.

---
Developed by Ravi Ranjan.
