# User Guide

Initialize a workspace, scan files, run **SQL Organizer: Configure**, then analyze and create a plan. In a multi-root workspace, use **SQL Organizer: Select Workspace Folder** to choose the SQL library that commands operate on. Review every action before approval. Low-confidence items remain in `unclassified`; exact duplicates are only proposed for quarantine. Similar candidates never move automatically.

## AI endpoint and protocol

Use **SQL Organizer: Configure** to create global endpoint profiles. Each profile has a name, Base URL, protocol, one or more models, and an API key. Profiles are stored in the extension's Global Storage so they are reusable across projects. API keys still live exclusively in VS Code SecretStorage. Project settings can provide a one-time migration/default, but endpoint profiles are no longer written to project files.

Use `responses` (the default) for the OpenAI Responses API. It uses structured JSON output, requests `store: false`, and reads the SDK's `output_text` result. Select `chat-completions` only for OpenAI-compatible servers that implement `/chat/completions` but not `/responses`.

An endpoint can provide multiple models. Set `ai.models` (or `sqlOrganizer.models`) to a list of model IDs; SQL Organizer prompts you to select one at the start of Analyze. The selected model is part of the classification cache key, so results from different models are never mixed. `ai.model` remains supported as a one-model default for automation or existing configuration.
