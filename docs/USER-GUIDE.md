# User Guide

Initialize a workspace, scan files, run **SQL Organizer: Configure**, then analyze and create a plan. In a multi-root workspace, use **SQL Organizer: Select Workspace Folder** to choose the SQL library that commands operate on. Review every action before approval. Low-confidence items remain in `unclassified`; exact duplicates are only proposed for quarantine. Similar candidates never move automatically.

## Install and first workflow

1. Install the VSIX from a terminal:

   ```bash
   code --install-extension sql-organizer-0.1.5.vsix
   ```

2. Open the workspace folder that contains the SQL files. In a multi-root workspace, run **SQL Organizer: Select Workspace Folder** and choose the SQL library to operate on.

3. Open the Command Palette (`Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux) and run **SQL Organizer: Initialize**. This creates `sql-organizer.config.yml` and the `.sql-organizer/` state directory without creating business folders or changing SQL files.

4. Run **SQL Organizer: Configure**. Add an endpoint profile, enter its Base URL, select its protocol, add one model ID per line, enter the API key, then click **Save**. Use **Test Connection** before analyzing. Endpoint profiles are global to VS Code; project organization rules remain in `sql-organizer.config.yml`.

5. Run **SQL Organizer: Scan**. This performs local SQL analysis, extracts metadata, and detects duplicate candidates. It does not require an API key and does not modify SQL files.

6. Run **SQL Organizer: Analyze**. Choose an endpoint and model when prompted. SQL Organizer sends only redacted SQL for classification, supports cancellation, retries transient failures, and saves progress after each item.

7. Run **SQL Organizer: Create Plan**. This creates a dry-run plan, report, and index, then opens the Review panel. No file moves happen at this stage.

8. Review every proposed action. Use filters for status, category, operation, risk, low confidence, and exact duplicates. Open details to inspect metadata and risk notes; edit the category, operation folder, filename, destination, or review note as needed. Approve or reject each action explicitly.

9. Select **Apply approved plan** in the Review panel. VS Code asks for a second confirmation. Only approved, conflict-free actions are moved after source-hash, destination, path, symlink, collision, and Git-safety checks. A manifest is created for auditing.

10. If the latest Apply must be undone, run **SQL Organizer: Roll Back Last Apply**. Rollback refuses to overwrite or replace files that changed after Apply.

The shortest end-to-end workflow is:

```text
Initialize → Configure → Scan → Analyze → Create Plan → Review → Apply
```

The SQL Organizer Activity Bar view also shows pending analysis, duplicate items, low-confidence results, and pending plans.

## AI endpoint and protocol

Use **SQL Organizer: Configure** to create global endpoint profiles. Each profile has a name, Base URL, protocol, one or more models, and an API key. Profiles are stored in the extension's Global Storage so they are reusable across projects. API keys still live exclusively in VS Code SecretStorage. Project settings can provide a one-time migration/default, but endpoint profiles are no longer written to project files.

Use `responses` (the default) for the OpenAI Responses API. It uses structured JSON output, requests `store: false`, and reads the SDK's `output_text` result. Select `chat-completions` only for OpenAI-compatible servers that implement `/chat/completions` but not `/responses`.

An endpoint can provide multiple models. Set `ai.models` (or `sqlOrganizer.models`) to a list of model IDs; SQL Organizer prompts you to select one at the start of Analyze. The selected model is part of the classification cache key, so results from different models are never mixed. `ai.model` remains supported as a one-model default for automation or existing configuration.
