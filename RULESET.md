# ACH Validation Ruleset

Ruleset version: `2026.07.8`

The validation ruleset is versioned independently from the VS Code extension package. JSON and SARIF reports include this version so validation results remain reproducible when extension and CLI releases change.

## Public reference scope

- Nacha ACH Guide for Developers record layouts and common transaction semantics.
- Nacha Operating Rules Basic Appendices for IAT addenda layouts and field requirements.
- Federal Reserve Financial Services IAT format guidance.
- U.S. Treasury Bureau of the Fiscal Service transaction-code definitions.

The public ruleset covers deterministic file-format validation. Institution/operator acceptance requirements belong in named validation profiles rather than being presented as universal NACHA rules.

## Profile overrides

Profiles may override an exact rule code, a category such as `category:physical`, or all rules with `*`. Each override records both a severity and an explanation. Supported severities are `error`, `warning`, `information`, `hint`, and `off`.

Suppressions are included in report profile metadata so reviewers can see which rules were intentionally disabled and why.

## Versioning policy

- Patch: rule metadata or message changes without changing acceptance behavior.
- Minor: new validations or compatibility mappings.
- Major: behavior changes that can materially change whether an existing file passes.
