# Security

- No database connection or SQL execution exists in this extension.
- API keys use VS Code `SecretStorage`; they are not written to settings, state, reports, plans, logs, or telemetry.
- SQL is redacted before remote classification; full SQL and full AI exchanges are not persisted.
- Apply permits only approved actions after source-hash, destination, path-traversal, symlink, collision and optional Git-clean checks.
- Renames use `workspace.fs.rename` with `overwrite: false`; deletion and content mutation are not implemented.
- Git status uses `execFile('git', ['status', '--porcelain'])` with fixed arguments, never shell interpolation.
- Webview has `default-src 'none'`, nonce-only script/style and Zod-validated messages.
