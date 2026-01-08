# ACH Syntax Highlighter and Validator

A professional Visual Studio Code extension for developers and treasury professionals working with NACHA ACH files. It provides deep validation, intelligent syntax highlighting, and context-aware tooltips for standard and international transactions.

![Icon](icon.png)

## Features

### 🔍 Deep Validation
- **Bank Routing Checksums**: Automatically validates routing numbers (RDFI/ODFI) using the official NACHA check digit algorithm.
- **Aggregate Totals**: Verifies Batch Controls (Type 8) and File Controls (Type 9) against actual entry counts, debit/credit sums, and entry hashes.
- **Record Integrity**: Checks for correct record lengths (94 characters), mandatory fields, and proper record ordering (Header -> Batch -> Entry -> Control).

### 🌐 Full IAT Support
- **International Transactions**: Comprehensive support for International ACH Transactions (IAT).
- **Contextual Parsing**: Switches field definitions automatically when an IAT batch is detected.
- **Mandatory Addenda**: Validates the presence of the 7 required IAT addenda records (Types 10-16: Name, Address, Bank IDs, etc.).

### 🎨 Visual Intelligence
- **Alternating Field Highlighting**: Provides visual cues for field boundaries with alternating colors to make fixed-width files readable.
- **Interactive Hovers**: Hover over any position to see the field name, description, start/end positions, and the raw value.
- **Batch Separation**: Visual borders and unique alternating backgrounds per batch for easy navigation.

### ⚙️ Highly Customizable
- **Color Picker Support**: Choose your own colors for every record type (1-9) directly in the VS Code Settings UI.
- **Theme Friendly**: Supports standardized 8-character hex colors (#rrggbbaa) for transparency.

## Usage

Simply open any file with the `.ach` extension. The extension activates automatically and provides:
1. **Syntax Highlighting**: Different backgrounds for File Header, Batch Header, Entry Details, etc.
2. **Diagnostics**: Errors and warnings in the "Problems" panel for missing totals, invalid routing, or record length issues.
3. **Hover Info**: Detailed NACHA file specification data directly in your editor.

## Extension Settings

This extension contributes the following settings:

* `nachaFileParser.recordTypeColors`: Customize background colors for each record type (1-9).
* `nachaFileParser.batchRowColors`: Colors for alternating batches.
* `nachaFileParser.fieldColors`: Text colors for alternating fields.
* `nachaFileParser.paddingRowColor`: Color for blocking/filler records.

## Installation

Install via the VS Code Marketplace or by downloading the `.vsix` file from the repository.

---
Developed by Ravi Ranjan.
