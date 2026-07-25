# User Guide

Initialize in a single-folder workspace, scan files, configure `sqlOrganizer.model`, set the API key using the command palette, analyze, then create a plan. Review every action before approval. Low-confidence items remain in `unclassified`; exact duplicates are only proposed for quarantine. Similar candidates never move automatically.

## AI endpoint and protocol

Configure `ai.baseUrl` in `sql-organizer.config.yml`, or `sqlOrganizer.baseUrl` in VS Code settings, for an OpenAI-compatible endpoint. The endpoint must be an `http` or `https` URL without embedded credentials, query parameters, or a fragment. API keys still live exclusively in VS Code SecretStorage.

Use `responses` (the default) for the OpenAI Responses API. It uses structured JSON output, requests `store: false`, and reads the SDK's `output_text` result. Select `chat-completions` only for OpenAI-compatible servers that implement `/chat/completions` but not `/responses`.

An endpoint can provide multiple models. Set `ai.models` (or `sqlOrganizer.models`) to a list of model IDs; SQL Organizer prompts you to select one at the start of Analyze. The selected model is part of the classification cache key, so results from different models are never mixed. `ai.model` remains supported as a one-model default for automation or existing configuration.
