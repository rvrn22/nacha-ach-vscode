# ACH Workbench Roadmap

The extension should evolve from a syntax highlighter into an ACH workbench: the raw 94-character file remains authoritative while a canonical document model powers readable views, navigation, validation, and safe repairs.

## Delivery principles

- Never silently change payment instructions or ambiguous business data.
- Keep parsing and rule evaluation independent from the VS Code API so they can also power tests and a future CLI.
- Preserve exact source ranges for every record and field.
- Distinguish structural NACHA validity from institution-specific acceptance rules.
- Preview multi-record edits and keep every fix undoable.
- Treat account, identity, and payment data as sensitive by default.

## P0 — Canonical ACH document model

Status: Completed

Build a single parsed representation used by validation, summaries, navigation, hovers, decorations, and future fixes.

- [x] Model `File -> Batch -> Entry -> Addenda`, controls, padding, and unrecognized records.
- [x] Retain raw values, parsed field values, line numbers, and source ranges.
- [x] Track batch SEC context and parent-child relationships.
- [x] Parse once per VS Code document version and cache the result.
- [x] Refactor validation and summaries to consume the model.
- [x] Refactor decorations and hovers to consume the model.
- [x] Add parser tests for hierarchy, padding, malformed records, and multiple batches.

Definition of done: all existing behavior uses one model, existing tests pass, and model-specific hierarchy tests cover representative files.

## P0 — Validation correctness and rule engine

Status: Completed

- [x] Replace the permissive record-order flags with an explicit state machine.
- [x] Suppress dependent field errors when a record is too short.
- [x] Validate complete transaction codes with an explicit code table and SEC compatibility.
- [x] Use `bigint` cents for all amounts and aggregate totals.
- [x] Validate real calendar dates and valid times, not only digit shapes.
- [x] Associate addenda with their entry and validate indicators, counts, types, order, sequences, and traces.
- [x] Verify actual IAT addenda rather than only the declared count.
- [x] Detect missing or duplicate File Control records even when padding exists.
- [x] Validate padding placement and block packing.
- [x] Correct inverted batch-control mismatch messages.
- [x] Give diagnostics stable codes, expected/actual values, rule profiles, and related source locations.
- [x] Separate physical, structural, field, relational, SEC-specific, and institution-profile rules.

Definition of done: malformed files cannot pass because of padding or declared-but-missing records, and each diagnostic identifies a stable rule and actionable location.

## P1 — Decoded ACH explorer

Status: Completed

- [x] Add an expandable `File -> Batch -> Entry -> Addenda` side view.
- [x] Show raw and decoded values for the selected record.
- [x] Format amounts, dates, transaction codes, service classes, SEC codes, and routing components.
- [x] Mask account numbers and sensitive identifiers by default.
- [x] Synchronize selections between the explorer and raw editor.
- [x] Display validation badges and batch/file totals.

Definition of done: a user can understand a file without manually counting character positions while retaining direct access to the raw record.

## P1 — Navigation and reading aids

Status: Completed

- [x] Add document symbols, breadcrumbs, and folding ranges.
- [x] Add commands for matching batch header/control and entry/addenda navigation.
- [x] Add next/previous ACH problem commands.
- [x] Add an optional 1–94 ruler and field-name inlay hints.
- [x] Highlight related header/control, trace, count, hash, and total fields.
- [x] Add sticky batch context for large files through the ACH symbol hierarchy.

## P1 — Safe Quick Fixes

Status: Completed

- [x] Correct a routing check digit.
- [x] Recalculate batch controls and File Control.
- [x] Synchronize unambiguous control fields with their headers.
- [x] Renumber batches, traces, and addenda sequences through an explicit previewed operation.
- [x] Correct addenda indicators and counts from actual structure.
- [x] Add or remove file padding records.
- [x] Pad fields only when intent is unambiguous.
- [x] Add `Recalculate all derived fields` and `Apply all safe fixes` commands.
- [x] Preview multi-record workspace edits before applying them.
- [x] Explicitly prohibit automatic routing-number replacement, data truncation, or SEC guessing.

## P2 — Profiles, reporting, and automation

Status: Completed

- [x] Support named institution/operator validation profiles.
- [x] Version rules independently from extension releases.
- [x] Export redacted validation reports as JSON and SARIF.
- [x] Provide a headless validator for CI and pre-upload checks.
- [x] Add configurable severities and rule suppressions with explanations.
- [x] Detect ACH content in `.txt` files and offer to switch language mode.

## P2 — Performance, accessibility, and product polish

Status: Completed

- [x] Debounce edits and limit expensive decoration/explorer rendering to practical working sets.
- [x] Establish performance fixtures for large ACH files.
- [x] Provide accessible palettes that do not rely on color alone.
- [x] Contribute the settings documented in the README.
- [x] Replace the placeholder `Hello World` command with an ACH file summary.
- [x] Align README feature claims with verified behavior.

## Post-roadmap — Returns and Notifications of Change

Status: Completed

- [x] Decode domestic type 99 Return and type 98 Notification of Change addenda layouts.
- [x] Decode the distinct IAT Return and NOC field widths.
- [x] Recognize `COR` batches and enforce their transaction-code, amount, and addenda requirements.
- [x] Validate Return/NOC codes, original identifiers, corrected data, reserved fields, and conditional dates.
- [x] Relate, highlight, and safely synchronize the complete 15-digit addenda trace.
- [x] Add valid and targeted-invalid regression coverage for Return and NOC workflows.

## Post-roadmap — Reversal awareness

Status: Completed

- [x] Classify reversal batches from the standardized uppercase `REVERSAL` description.
- [x] Surface reversal batches and entry counts in the explorer, summaries, and reports.
- [x] Validate unambiguous description formatting and incompatible transaction kinds.
- [x] Provide a deterministic fix for reversal description casing and padding.
- [x] Avoid unverifiable claims about the absent original entry or banking-day timing.
- [x] Add valid, invalid, fix, summary, and explorer regression coverage.

## Post-roadmap — Prenotification awareness

Status: Completed

- [x] Classify prenotes by transaction code with SEC-aware DNE/ENR exclusions.
- [x] Surface prenote counts in the explorer, summaries, and reports.
- [x] Require zero amounts with a dedicated diagnostic.
- [x] Support mixed live/prenote batches and SEC-compatible optional addenda.
- [x] Preserve mandatory IAT addenda validation for IAT prenotes.
- [x] Avoid unverifiable claims about the three-Banking-Day waiting period.
- [x] Remove the legacy field-only amount fix that could stale aggregate controls.

## Post-roadmap — Zero-dollar entry awareness

Status: Completed

- [x] Classify zero-dollar CCD, CTX, and IAT entries with SEC context.
- [x] Distinguish ACK/ATX acknowledgments that share transaction codes 24 and 34.
- [x] Require zero amounts and the mandated CCD/CTX addenda records.
- [x] Preserve mandatory IAT addenda validation for zero-dollar IAT entries.
- [x] Surface zero-dollar counts in the explorer, summaries, and reports.
- [x] Validate ACK/ATX transaction-code compatibility and contextual descriptions.
- [x] Add valid, invalid, IAT, ACK, explorer, and report regression coverage.

## Post-roadmap — Net position and balanced-file profiles

Status: Completed

- [x] Classify exact net-zero, net-credit, and net-debit positions with `bigint` cents.
- [x] Accept both balanced and unbalanced workflows under the default profile.
- [x] Add an opt-in built-in `balanced` profile and custom `requireNetZero` setting.
- [x] Report net position and signed cents through summaries, explorer, and JSON.
- [x] Emit related batch-total locations for net-zero profile failures.
- [x] Avoid claiming that arithmetic equality identifies a settlement offset entry.
- [x] Add net position, profile, explorer, and report regression coverage.

## Post-roadmap — Micro-Entry awareness

Status: Completed

- [x] Classify batches and entries using the standardized `ACCTVERIFY` description.
- [x] Validate uppercase description formatting, live transaction kinds, and 1–99 cent credits.
- [x] Group entries by originator and receiver account for offset review.
- [x] Warn about apparent net-debit and effective-date issues without assuming cross-file pairing.
- [x] Provide a deterministic description-casing fix.
- [x] Surface Micro-Entry counts in summaries, explorer, and reports.
- [x] Document Company Name, cross-file timing, verification completion, and fraud-monitoring boundaries.
- [x] Add valid, invalid, split-batch, fix, explorer, and report regression coverage.

## Post-roadmap — Complete IAT addenda support

Status: Completed

- [x] Correct the fixed-width definitions for mandatory IAT addenda types 10–16.
- [x] Add field definitions for optional remittance type 17 and foreign-correspondent-bank type 18.
- [x] Validate required fields, reserved columns, transaction types, foreign amounts, bank qualifiers, and branch-country formatting.
- [x] Validate type 17/18 ordering, per-type and combined maxima, and independent sequence numbers.
- [x] Relate every IAT addenda record to the last seven digits of its Entry Detail trace.
- [x] Replace simplified legacy IAT fixtures and add focused valid/invalid regression coverage.

## Post-roadmap — SEC-aware domestic Entry Detail fields

Status: Completed

- [x] Decode converted-check serial numbers for ARC, BOC, and RCK entries.
- [x] Decode CCD/CTX corporate Receiver fields and WEB/TEL Payment Type Codes contextually.
- [x] Validate required account, Receiver-name, and converted-check-serial fields for common domestic SEC layouts.
- [x] Require the consumer Originator name for Person-to-Person WEB credits.
- [x] Decode conventional Payment Type values without rejecting permitted Originator-defined codes.
- [x] Mask converted-check serial numbers in decoded views.
- [x] Add representative valid and targeted-invalid fixtures for ARC, BOC, RCK, CCD, CTX, PPD, TEL, and WEB.

## Post-roadmap — Automated Accounting Advice support

Status: Completed

- [x] Decode the distinct ADV Entry Detail, Batch Control, and File Control layouts.
- [x] Support service class 280 and restrict transaction codes 81–88 to ADV entries.
- [x] Calculate, display, validate, and safely repair 12-digit entry amounts and 20-digit control totals.
- [x] Validate ADV account/name requirements, routing fields, Julian dates, and within-batch sequences.
- [x] Prevent mixed ADV/non-ADV files whose File Control layouts would be ambiguous.
- [x] Preserve ADV Operator routing/date fields during explicit sequence renumbering.
- [x] Add valid, targeted-invalid, decoding, summary, control-fix, and sequence-fix regression coverage.

## Post-roadmap — ACK/ATX acknowledgment support

Status: Completed

- [x] Decode ACK and ATX Entry Detail fields using their acknowledgment-specific meanings.
- [x] Validate zero amounts, required account/company data, and Original Entry Trace Numbers.
- [x] Validate ATX declared addenda counts and reserved columns.
- [x] Enforce the optional single type `05` addenda and its sequence/trace relationships.
- [x] Add focused ACK/ATX layout and validation regression coverage.

## Post-roadmap — CIE/DNE/ENR specialized entries

Status: Completed

- [x] Decode CIE's reversed Individual Name/Identification fields and ENR's four-digit addenda-count layout.
- [x] Validate required CIE, DNE, and ENR account, individual, and Receiver data.
- [x] Enforce DNE/ENR transaction codes, zero amounts, mandatory type `05` addenda, and nonblank convention data.
- [x] Enforce CIE/DNE single-addenda limits and ENR's 9,999-addenda maximum.
- [x] Validate and safely repair ENR declared addenda counts.
- [x] Add valid, targeted-invalid, layout, content, and fix regression coverage.

## Post-roadmap — MTE/POS/SHR terminal entries

Status: Completed

- [x] Decode the distinct MTE, POS, and SHR Entry Detail fields.
- [x] Decode type `02` terminal addenda without mislabeling its full trace as type `05` sequence fields.
- [x] Validate required terminal identity/location fields, MMDD transaction dates, and MTE HHMMSS times.
- [x] Validate POS/SHR card transaction codes and SHR expiration, document-reference, card-account, and debit-only rules.
- [x] Require one type `02` addenda for live entries while permitting terminal prenotes without addenda.
- [x] Navigate, safely synchronize, and explicitly renumber complete terminal addenda traces.
- [x] Add valid, prenote, targeted-invalid, decoding, navigation, and fix regression coverage.

## Test strategy

- [ ] Golden valid/invalid fixtures for every supported SEC code.
  - [x] Common domestic ARC, BOC, RCK, CCD, CTX, PPD, TEL, and WEB layouts.
  - [x] Specialized ADV layout.
  - [x] Specialized ACK and ATX layouts.
  - [x] Specialized CIE, DNE, and ENR layouts.
  - [x] Specialized MTE, POS, and SHR layouts.
  - [ ] Specialized TRX layout.
- [ ] Returns, NOCs, reversals, prenotes, balanced/unbalanced files, and zero-dollar entries.
  - [x] Returns and NOCs.
  - [x] Reversals.
  - [x] Prenotes.
  - [x] Zero-dollar entries.
  - [x] Balanced/unbalanced file analysis.
- [x] IAT addenda presence, order, count, field content, sequences, and trace relationships.
- [ ] CRLF/LF, tabs, non-ASCII characters, short/long records, and padding edge cases.
- [ ] Property-style mutations of counts, hashes, totals, routing digits, and record order.
- [x] Code-action tests that assert exact previewed edits.
- [ ] Extension integration tests for diagnostics, hovers, symbols, folding, and cancellation.
- [x] Large-file performance regression tests.
