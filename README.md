# SQL Organizer

Local-first VS Code extension for scanning, classifying and safely organizing SQL files. It never executes SQL, connects to databases, deletes files, overwrites files, or stores API keys in workspace files.

## Workflow

1. Run **SQL Organizer: Configure**. Add an endpoint profile, choose its protocol and model, and save the API key.
2. Run **SQL Organizer: Scan and Create Plan**. It scans locally, classifies SQL, generates a dry-run plan, and opens Review automatically.
3. Review, edit, and approve the proposed actions, then choose **Apply approved plan**. Use **Roll Back Last Apply** if safe preconditions still hold.

`SQL Organizer: Initialize` is optional. Use it only when you want to create and edit a project-specific `sql-organizer.config.yml`; Scan uses safe defaults and creates its internal state automatically.

All primary actions are available in the **SQL Organizer** Activity Bar view. The Workflow panel provides direct Configure, Scan and Create Plan, Review and Apply, project-rules, and rollback actions; the Command Palette is only an alternative entry point.

## Install

```bash
code --install-extension sql-organizer-0.1.8.vsix
```

See the [User Guide](docs/USER-GUIDE.md) for installation, endpoint configuration, review, Apply, and rollback instructions.

## Safety

Only approved actions are renamed through VS Code's filesystem API. Apply rechecks source hashes, destination containment, symlinks, conflicts, and optional Git cleanliness. Full details are in [docs/SECURITY.md](docs/SECURITY.md).
