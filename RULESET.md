# ACH Validation Ruleset

Ruleset version: `2026.06.22.1`

Rules effective through: `2026-06-22`

The validation ruleset is versioned independently from the VS Code extension package. JSON and SARIF reports include this version so validation results remain reproducible when extension and CLI releases change.

## Public reference scope

- [Nacha ACH Guide for Developers — File Overview](https://achdevguide.nacha.org/ach-file-overview) and [File Details](https://achdevguide.nacha.org/index.php/ach-file-details) for record layouts and common transaction semantics.
- Nacha Operating Rules Basic Appendices for IAT addenda and specialized ACK, ATX, CIE, DNE, ENR, MTE, POS, SHR, and TRX layouts and requirements.
- [Federal Reserve Financial Services IAT guidance](https://www.frbservices.org/resources/financial-services/ach/faq/iat.html).
- [Nacha ISO 20022 return/NOC mapping guide](https://www.nacha.org/system/files/2023-08/NACHA_ISO20022_Guide_camt.053_returns%2008-09-23.pdf) for current Return/NOC codes and corrected-data positions.
- [U.S. Treasury Bureau of the Fiscal Service transaction-code definitions](https://www.fiscal.treasury.gov/data/FSv49/TRXv10/Transmission/Batch/BusinessTransaction/FinancialTransaction/CheckDetail/ACH_Info/index.html).
- Published Nacha rule changes for [Company Entry Descriptions](https://www.nacha.org/rules/risk-management-topics-company-entry-descriptions), [fraud monitoring](https://www.nacha.org/rules/risk-management-topics-fraud-monitoring-phase-2), and [future Return Reason Code R90](https://www.nacha.org/rules/new-return-reason-code-sanctions-compliance-obligations).

The public ruleset covers deterministic validations derivable from ACH file bytes. The authoritative machine-readable snapshot is [`rules/ach-rules-2026.06.22.json`](rules/ach-rules-2026.06.22.json). Current Return and NOC code tables are pinned to the effective date; future code R90 is intentionally rejected until its published March 17, 2028 effective date.

## Compliance boundary

Passing validation means the configured deterministic file-format rules passed. It does not certify compliance with the Nacha Operating Rules. The extension cannot establish from a file alone:

- Receiver authorization, authorization form/content, or authorization date.
- Return, reversal, prenote, reinitiation, settlement, or notification timing.
- Current routing-directory membership or participant eligibility.
- OFAC/sanctions screening results, fraud monitoring, or risk-management procedures.
- Originator/ODFI/operator agreements, warranties, or exposure limits.
- Whether `PAYROLL`, `PURCHASE`, or another purpose-specific Company Entry Description is required by the underlying payment purpose.
- Application-specific addenda conventions or trading-partner schemas.
- Annual ACH Rules compliance audits and risk assessments.

JSON and SARIF reports therefore set `complianceCertified` to `false` and list the external evidence required. Institution/operator acceptance requirements belong in named validation profiles rather than being presented as universal Nacha rules.

## Profile overrides

Profiles may override an exact rule code, a category such as `category:physical`, or all rules with `*`. Each override records both a severity and an explanation. Supported severities are `error`, `warning`, `information`, `hint`, and `off`.

Suppressions are included in report profile metadata so reviewers can see which rules were intentionally disabled and why.

## Versioning policy

- Patch: rule metadata or message changes without changing acceptance behavior.
- Minor: new validations or compatibility mappings.
- Major: behavior changes that can materially change whether an existing file passes.
