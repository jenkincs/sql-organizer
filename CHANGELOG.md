# Changelog

## Unreleased

- Changed the default Apply behavior to archive fully organized source files under `archive/organized/`, with manifest-backed rollback.
- Added durable per-unit module indexing so future scans skip SQL that is already appended, including after a workspace relocation.
- Grouped Review by generated module file and added a safe module reassignment control.
- Excluded generated module files from the optional clean-Git Apply guard while preserving protection for user changes.
- Added module file section markers and a configurable maximum module file size.
- Kept SQL Server batch-delimited and MySQL custom-delimiter scripts together during conservative splitting.
- Changed organization output to one provenance-marked SQL file per business module under `modules/`.
- Normalized the compatible `plpgsql` dialect label to `postgresql`.
- Added adaptive local taxonomy discovery, proposal, approval, and persistence.
- Added conservative independent-statement extraction with provenance and source preservation by default.
- Added taxonomy-aware, relocation-safe incremental classification caching.
- Added Review details for SQL units, statement ranges, proposed categories, and extraction actions.
- Added guarded Apply and rollback for generated statement files.

## 0.1.9

- Fixed Responses-compatible endpoints that require an explicit JSON instruction in the request input when JSON-object mode is enabled.

## 0.1.8

- Added phase and per-file progress feedback to Scan and Create Plan.
- Added clear cancellation, partial-classification, and unexpected-error notifications with sanitized Output-channel diagnostics.

## 0.1.7

- Added a focused Workflow view to the SQL Organizer Activity Bar.
- Added direct sidebar actions and a title toolbar for Configure, Scan and Create Plan, Review, Apply, project rules, and rollback.
- Kept the Command Palette as an optional alternative instead of the primary workflow.

## 0.1.6

- Simplified the primary workflow to Configure → Scan and Create Plan → Review and Apply.
- Made Scan perform local scanning, AI classification, plan generation, reporting, and Review opening in one command.
- Kept Analyze and Create Plan available as advanced recovery commands.
- Kept Initialize optional; Scan now works with safe defaults and creates internal state automatically.

## 0.1.5

- Added global multi-endpoint profiles, per-endpoint SecretStorage keys, model selection, and connection testing in the configuration Webview.
- Made classification concurrent, retryable, cancellable, checkpointed, and safely diagnosable.
- Expanded Review with category, operation, risk, confidence, and duplicate filters; full details; and editable plan fields.
- Added multi-root workspace selection, scalable similarity candidate bucketing, and performance coverage.
- Prevented Initialize from overwriting existing configuration and aligned documentation, repository metadata, and formatting checks.

## 0.1.4

- Create the default configuration file before opening it in a new workspace.

## 0.1.3

- Added an in-extension LLM Configuration Webview with endpoint, protocol, model, API key, and connection-test controls.
- Kept advanced generation settings in the YAML configuration file.

## 0.1.2

- Added multi-model selection for a single configured AI endpoint.
- Included the selected model in classification cache keys.

## 0.1.1

- Added configurable OpenAI-compatible Base URL support.
- Added protocol selection for OpenAI Responses API and Chat Completions-compatible endpoints.
- Responses API calls now request `store: false` and consume structured `output_text`.

## 0.1.0

- Initial SQL Organizer extension: scan, local metadata analysis, AI classification, planning, review, guarded apply and rollback.
