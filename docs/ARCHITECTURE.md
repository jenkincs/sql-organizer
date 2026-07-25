# Architecture

The extension separates deterministic local work from AI classification. Scanner modules read via `workspace.fs`, analyze metadata, redact before AI calls, and persist only hashes and metadata. AI providers return schema-validated classifications. Plans are dry-run artifacts; `PlanApplier` is the sole file rename path. The Review Webview is isolated with a strict CSP and validates inbound messages with Zod.
