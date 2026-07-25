# User Guide

Run **SQL Organizer: Configure**, then use **SQL Organizer: Scan and Create Plan**. In a multi-root workspace, use **SQL Organizer: Select Workspace Folder** to choose the SQL library that commands operate on. The Scan command performs local scanning, AI classification, plan generation, and opens Review automatically. Review every action before approval. Low-confidence items remain in `unclassified`; exact duplicates are only proposed for quarantine. Similar candidates never move automatically.

## Install and first workflow

1. Install the VSIX from a terminal:

   ```bash
   code --install-extension sql-organizer-0.1.7.vsix
   ```

2. Open the workspace folder that contains the SQL files. In a multi-root workspace, run **SQL Organizer: Select Workspace Folder** and choose the SQL library to operate on.

3. Open the Command Palette (`Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux) and run **SQL Organizer: Configure**. Add an endpoint profile, enter its Base URL, select its protocol, add one model ID per line, enter the API key, then click **Save**. Use **Test Connection** before scanning. Endpoint profiles are global to VS Code.

4. Run **SQL Organizer: Scan and Create Plan**. This single command performs local SQL analysis, extracts metadata, detects duplicate candidates, sends redacted SQL for classification, generates a dry-run plan, report, and index, then opens the Review panel. It supports cancellation, retries transient failures, and saves progress after each item. It never modifies SQL files.

5. Review every proposed action. Use filters for status, category, operation, risk, low confidence, and exact duplicates. Open details to inspect metadata and risk notes; edit the category, operation folder, filename, destination, or review note as needed. Approve or reject each action explicitly.

6. Select **Apply approved plan** in the Review panel. VS Code asks for a second confirmation. Only approved, conflict-free actions are moved after source-hash, destination, path, symlink, collision, and Git-safety checks. A manifest is created for auditing.

7. If the latest Apply must be undone, run **SQL Organizer: Roll Back Last Apply**. Rollback refuses to overwrite or replace files that changed after Apply.

**SQL Organizer: Initialize** is optional. Run it only when you want a project-specific `sql-organizer.config.yml` to customize taxonomy, mappings, thresholds, or safety rules. Scan uses safe defaults and creates the `.sql-organizer/` state directory automatically.

The shortest end-to-end workflow is:

```text
Configure → Scan and Create Plan → Review → Apply
```

The SQL Organizer Activity Bar view also shows pending analysis, duplicate items, low-confidence results, and pending plans.

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
