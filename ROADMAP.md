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

Status: Planned

- [ ] Add document symbols, breadcrumbs, and folding ranges.
- [ ] Add commands for matching batch header/control and entry/addenda navigation.
- [ ] Add next/previous ACH problem commands.
- [ ] Add an optional 1–94 ruler and field-name inlay hints.
- [ ] Highlight related header/control, trace, count, hash, and total fields.
- [ ] Add sticky batch context for large files.

## P1 — Safe Quick Fixes

Status: Planned

- [ ] Correct a routing check digit.
- [ ] Recalculate batch controls and File Control.
- [ ] Synchronize unambiguous control fields with their headers.
- [ ] Renumber batches, traces, and addenda sequences.
- [ ] Correct addenda indicators and counts from actual structure.
- [ ] Add or remove file padding records.
- [ ] Pad fields only when intent is unambiguous.
- [ ] Add `Recalculate all derived fields` and `Apply all safe fixes` commands.
- [ ] Preview multi-record workspace edits before applying them.
- [ ] Explicitly prohibit automatic routing-number replacement, data truncation, or SEC guessing.

## P2 — Profiles, reporting, and automation

Status: Planned

- [ ] Support named institution/operator validation profiles.
- [ ] Version rules independently from extension releases.
- [ ] Export redacted validation reports as JSON and SARIF.
- [ ] Provide a headless validator for CI and pre-upload checks.
- [ ] Add configurable severities and rule suppressions with explanations.
- [ ] Detect ACH content in `.txt` files and offer to switch language mode.

## P2 — Performance, accessibility, and product polish

Status: Planned

- [ ] Debounce edits and update only affected model regions where practical.
- [ ] Establish performance fixtures for large ACH files.
- [ ] Provide accessible palettes that do not rely on color alone.
- [ ] Contribute the settings documented in the README.
- [ ] Replace the placeholder `Hello World` command with ACH actions.
- [ ] Align README feature claims with verified behavior.

## Test strategy

- [ ] Golden valid/invalid fixtures for every supported SEC code.
- [ ] Returns, NOCs, reversals, prenotes, balanced/unbalanced files, and zero-dollar entries.
- [ ] IAT addenda presence, order, count, and trace relationships.
- [ ] CRLF/LF, tabs, non-ASCII characters, short/long records, and padding edge cases.
- [ ] Property-style mutations of counts, hashes, totals, routing digits, and record order.
- [ ] Code-action tests that assert exact previewed edits.
- [ ] Extension integration tests for diagnostics, hovers, symbols, folding, and cancellation.
- [ ] Large-file performance and memory regression tests.
