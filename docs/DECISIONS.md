# Decisions

## 2026-07-25 — Local-first, no implicit mutation

- **Choice:** All scan, analysis, plan and report operations are dry runs. Only the unified `PlanApplier` may rename files.
- **Reason:** Keeps SQL content untouched and makes changes reviewable and auditable.
- **Impact:** The Review UI is the explicit approval boundary; plans and manifests are persisted under `.sql-organizer/`.
- **Alternative:** Direct move commands were rejected because they bypass review and preflight checks.

## 2026-07-25 — Minimal SQL lexical analysis

- **Choice:** Use a bounded local lexer rather than executing or fully parsing SQL.
- **Reason:** It supports safe metadata extraction without database connections or a dialect-specific runtime.
- **Impact:** Nested/dialect-specific grammar may produce warnings and is never silently treated as certain.
- **Alternative:** A database parser/connection is out of scope and prohibited.
