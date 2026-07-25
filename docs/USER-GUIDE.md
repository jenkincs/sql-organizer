# User Guide

Run **SQL Organizer: Configure**, then use **SQL Organizer: Scan and Create Plan**. In a multi-root workspace, use **SQL Organizer: Select Workspace Folder** to choose the SQL library that commands operate on. The Scan command performs local scanning, AI classification, plan generation, and opens Review automatically. Review every action before approval. Low-confidence items remain in `unclassified`; exact duplicates are only proposed for quarantine. Similar candidates never move automatically.

## Install and first workflow

1. Install the VSIX from a terminal:

   ```bash
   code --install-extension sql-organizer-0.2.0.vsix
   ```

2. Open the workspace folder that contains the SQL files. In a multi-root workspace, run **SQL Organizer: Select Workspace Folder** and choose the SQL library to operate on.

3. Open the Command Palette (`Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux) and run **SQL Organizer: Configure**. Add an endpoint profile, enter its Base URL, select its protocol, add one model ID per line, enter the API key, then click **Save**. Use **Test Connection** before scanning. Endpoint profiles are global to VS Code.

4. Run **SQL Organizer: Scan and Create Plan**. This single command performs local SQL analysis, discovers existing categories, safely separates independent top-level statements, detects duplicate candidates, sends redacted units for classification, generates a dry-run plan, report, and index, then opens the Review panel. It supports cancellation, retries transient failures, and saves progress after each unit. It never modifies SQL files.

   The VS Code progress notification shows the active phase and each classification as `current/total`. A cancelled run keeps completed work. If scanning, endpoint setup, or plan generation fails, SQL Organizer shows an actionable error notification and writes sanitized details to the **SQL Organizer** Output channel. Partial classification failures are shown as a warning and remain visible in the Issues view.

5. Review every proposed action. The Review panel groups additions by generated module file, shows each unit's source range, primary and related categories, risk, and new-category proposals, and lets you reassign an item to a business module before approval. A query that joins several tables remains one unit; only independent statements are separated.

6. Select **Apply approved plan** in the Review panel. VS Code asks for a second confirmation. Only approved, conflict-free actions are appended to their module files after source-hash, statement-boundary, destination, path, symlink, size, collision, and Git-safety checks. Source files remain intact unless project rules enable archival. A manifest is created for auditing and rollback.

7. If the latest Apply must be undone, run **SQL Organizer: Roll Back Last Apply**. Rollback refuses to overwrite or replace files that changed after Apply.

**SQL Organizer: Initialize** is optional. Run it only when you want a project-specific `sql-organizer.config.yml` to customize taxonomy, mappings, thresholds, or safety rules. Scan uses safe defaults and creates the `.sql-organizer/` state directory automatically.

The shortest end-to-end workflow is:

```text
Configure → Scan and Create Plan → Review → Apply
```

The SQL Organizer Activity Bar view also shows pending analysis, duplicate items, low-confidence results, and pending plans.

## Adaptive categories and incremental organization

SQL Organizer maintains a local taxonomy in `.sql-organizer/taxonomy.json`. It combines configured categories, existing library folders, and previously approved results. During a scan the LLM receives the bounded category vocabulary and example metadata, so it reuses established categories whenever possible. When no category fits, it proposes a portable lowercase kebab-case category; Review shows it before Apply creates the destination folder and records it in the local taxonomy.

The classification cache is based on SQL content, selected model, prompt version, and taxonomy context—not an absolute path. You may move the complete SQL library to another location, open it there, and run Scan again. Existing results are rebound to the new paths, while new or changed SQL is analyzed incrementally. A local module index also prevents an already appended SQL unit from appearing in the next plan, even after the library moves. A plan created before moving files must be recreated because its source-hash safety checks intentionally reject stale paths.

Independent statements in a mixed SQL file can be organized separately. Procedures, transactions, dynamic SQL, malformed text, and ambiguous boundaries are deliberately kept together. The original mixed file is preserved by default.

## Module files

The default output model is one file per business module, under `modules/`: for example, customer-related SQL is appended to `modules/customer.sql` and booking-related SQL to `modules/booking.sql`. CRUD, DDL, and other SQL for the same business module share that module file. SQL Organizer uses stable section markers and per-unit provenance comments to keep these files readable and prevent re-adding the same content. Generated module files are excluded from the next scan and from the clean-Git Apply guard; other uncommitted work still blocks Apply when Git safety is enabled. The source inbox files remain unchanged unless you explicitly enable archival.

For a query that joins several modules, SQL Organizer chooses one **primary module** based on the query's business intent and keeps the other modules as related-category tags. For example, a booking search joined to customer data belongs in `booking.sql`; a cross-module aggregate belongs in `reporting.sql`; a query with no clear owner should use an explicit `integration` or `shared` module. The same query is never copied into multiple module files.

## Use the Activity Bar workflow

You do not need to use the Command Palette for day-to-day work. Select the SQL Organizer icon in the VS Code Activity Bar and use the **Workflow** view:

1. **Configure LLM** opens endpoint, model, and API-key settings.
2. **Scan and Create Plan** runs the complete safe preparation flow and opens Review.
3. **Review and Apply** reopens the current plan, where you approve individual actions before applying them.

The Workflow view also provides optional project rules and rollback actions. Its title toolbar offers the same primary actions for one-click access.

## AI endpoint and protocol

Use **SQL Organizer: Configure** to create global endpoint profiles. Each profile has a name, Base URL, protocol, one or more models, and an API key. Profiles are stored in the extension's Global Storage so they are reusable across projects. API keys still live exclusively in VS Code SecretStorage. Project settings can provide a one-time migration/default, but endpoint profiles are no longer written to project files.

Use `responses` (the default) for the OpenAI Responses API. It uses structured JSON output, requests `store: false`, and reads the SDK's `output_text` result. Select `chat-completions` only for OpenAI-compatible servers that implement `/chat/completions` but not `/responses`.

An endpoint can provide multiple models. Set `ai.models` (or `sqlOrganizer.models`) to a list of model IDs; SQL Organizer prompts you to select one at the start of Scan when more than one model is configured. The selected model is part of the classification cache key, so results from different models are never mixed. `ai.model` remains supported as a one-model default for automation or existing configuration.
