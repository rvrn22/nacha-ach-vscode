# Change Log

## Unreleased

- Added complete ACK/ATX Entry Detail layouts, original-trace and required-field validation, zero-amount enforcement, and ATX declared-count checks.
- Added focused ACK/ATX layout, decoding, addenda, and targeted-invalid regression coverage.
- Added complete ADV Entry Detail, Batch Control, and File Control parsing with service class 280 and transaction codes 81–88.
- Added ADV 12/20-digit arithmetic, field validation, summaries, navigation, safe control repair, and non-destructive sequence renumbering.
- Added SEC-aware Entry Detail field names and required-data validation for common domestic ARC, BOC, RCK, CCD, CTX, PPD, TEL, and WEB entries.
- Added WEB-credit Originator-name validation, Payment Type decoding, masked check serials, and representative SEC fixtures.
- Corrected the fixed-width field layouts for IAT addenda types 10–16 and added complete type 17/18 decoding.
- Added IAT required-field, reserved-column, qualifier, country, optional-count/order, per-type sequence, and Entry Detail linkage validation.
- Added `ACCTVERIFY` Micro-Entry classification, credit-amount and transaction-kind validation, offset warnings, counts, and safe description repair.
- Added exact net-position analysis and opt-in built-in/custom net-zero validation profiles.
- Added net position to decoded summaries and redacted JSON reports without inferring an offset account.
- Added SEC-aware zero-dollar classification, required-addenda validation, counts, and contextual ACK/ATX descriptions.
- Restricted ACK/ATX acknowledgment transaction codes to 24 and 34.
- Added SEC-aware prenote classification, counts, zero-amount validation, and IAT prenote regression coverage.
- Removed field-only non-monetary amount fixes that could leave aggregate controls stale.
- Added reversal-batch classification, explorer/report counts, description repair, and transaction-kind validation.
- Added dedicated domestic and IAT field layouts for Return (type 99) and Notification of Change (type 98) addenda.
- Added `COR` and `IATCOR` validation, Return/NOC field rules, full-trace navigation, and deterministic trace synchronization.
- Added Return/NOC, reversal, prenote, zero-dollar, net-position, Micro-Entry, complete-IAT, common domestic SEC, ADV, and ACK/ATX regression coverage and advanced the independent ruleset to `2026.07.11`.

All notable changes to the "nacha-file-parser" extension will be documented in this file.

## [0.0.6] - 2026-01-07
### Added
- Finalized premium extension icon with purple gradient and transparent border.
- Cleaned up green background artifacts from the logo asset.

## [0.0.5] - 2026-01-07
### Added
- Support for individual Color Pickers in the VS Code Settings UI for all record types.
- Standardized color settings to use 8-character hex strings (#rrggbbaa).
- Added a purple gradient and transparent padding to the extension icon.

## [0.0.4] - 2026-01-07
### Added
- Comprehensive IAT (International ACH Transaction) support.
- Logic to track SEC (Standard Entry Class) codes to provide context-aware field hovers.
- Validation for IAT-specific mandatory addenda records (Types 10-16).
- New high-quality extension icon.

## [0.0.3] - 2026-01-07
### Added
- Deep parsing validation for aggregate totals (Debit/Credit sums, Entry Hash).
- File/Batch count verification in File/Batch Control records.
- Block Count validation based on NACHA blocking factors.
- Problems panel diagnostics for validation errors.

## [0.0.2] - 2026-01-07
### Added
- Enhanced field-level tooltips (Hovers) for all NACHA record types.
- Routing number (RDFI/ODFI) checksum validation using the check digit algorithm.
- Record length and ordering validation.

## [0.0.1] - 2026-01-07
- Initial release with basic syntax highlighting for ACH files.
