# SQL Organizer

Local-first VS Code extension for scanning, classifying and safely organizing SQL files. It never executes SQL, connects to databases, deletes files, overwrites files, or stores API keys in workspace files.

## Workflow

1. Run **SQL Organizer: Initialize**.
2. Run **Scan**, then configure an OpenAI model and set its key in SecretStorage.
3. Run **Analyze** and **Create Plan**.
4. Review, edit, approve or reject each move in the Review panel.
5. Run **Apply Approved Plan** and use **Roll Back Last Apply** if safe preconditions still hold.

## Install

```bash
code --install-extension sql-organizer-0.1.0.vsix
```

## Safety

Only approved actions are renamed through VS Code's filesystem API. Apply rechecks source hashes, destination containment, symlinks, conflicts, and optional Git cleanliness. Full details are in [docs/SECURITY.md](docs/SECURITY.md).
