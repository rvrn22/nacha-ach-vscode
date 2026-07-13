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
- **Privacy by Default**: Account numbers and individual identifiers are masked unless explicitly enabled in settings.
- **Validation Context**: File, batch, entry, record, and field nodes show error/warning badges and aggregate totals.

### ⚙️ Highly Customizable
- **Color Picker Support**: Choose your own colors for every record type (1-9) directly in the VS Code Settings UI.
- **Theme Friendly**: Supports standardized 8-character hex colors (#rrggbbaa) for transparency.

## Usage

Simply open any file with the `.ach` extension. The extension activates automatically and provides:
1. **Syntax Highlighting**: Different backgrounds for File Header, Batch Header, Entry Details, etc.
2. **Diagnostics**: Errors and warnings in the "Problems" panel for missing totals, invalid routing, or record length issues.
3. **Hover Info**: Detailed NACHA file specification data directly in your editor.
4. **Decoded ACH Explorer**: Expand the file hierarchy in the Explorer sidebar and select any field to reveal its raw source range.

## Extension Settings

This extension contributes the following settings:

* `nachaFileParser.validationProfile`: Choose strict NACHA blocking or allow institution-compatible unblocked files.
* `nachaFileParser.maskSensitiveValues`: Mask account numbers and individual identifiers in the Decoded ACH explorer (enabled by default).
* `nachaFileParser.recordTypeColors`: Customize background colors for each record type (1-9).
* `nachaFileParser.batchRowColors`: Colors for alternating batches.
* `nachaFileParser.fieldColors`: Text colors for alternating fields.
* `nachaFileParser.paddingRowColor`: Color for blocking/filler records.

## Installation

Install via the VS Code Marketplace or by downloading the `.vsix` file from the repository.

---
Developed by Ravi Ranjan.
