# Scripts Folder

This repository now uses the PostgreSQL schema/migrations used by Docker Compose:

- `001-init.sql` (schema)
- `002-seed.sql` (sanitized/demo seed data should live here)

Legacy SQLite ingestion tooling has been archived under `scripts/legacy-sqlite/` to reduce confusion with the active PostgreSQL stack.
