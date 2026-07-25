# Changelog

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
