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

## Test strategy

- [ ] Golden valid/invalid fixtures for every supported SEC code.
- [ ] Returns, NOCs, reversals, prenotes, balanced/unbalanced files, and zero-dollar entries.
  - [x] Returns and NOCs.
  - [x] Reversals.
  - [x] Prenotes.
- [ ] IAT addenda presence, order, count, and trace relationships.
- [ ] CRLF/LF, tabs, non-ASCII characters, short/long records, and padding edge cases.
- [ ] Property-style mutations of counts, hashes, totals, routing digits, and record order.
- [x] Code-action tests that assert exact previewed edits.
- [ ] Extension integration tests for diagnostics, hovers, symbols, folding, and cancellation.
- [x] Large-file performance regression tests.
