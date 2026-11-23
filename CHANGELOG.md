# Changelog

## Unreleased

### Added
- Project storage in PostgreSQL: `settings.storage.type = 'postgres'` saves the project (views, devices,
  scripts, alarms, ...) in the database of `settings.storage.postgres` instead of `_appdata/project.fuxap.db`.
  The default stays `'sqlite'`: existing installations are unchanged.
  See [docs/storage-migration.md](docs/storage-migration.md).
- `npm run migrate-storage -- --from sqlite --to postgres`: copies an existing SQLite project to PostgreSQL
  in one transaction (read-only source, refuses a non-empty target without `--force`, `--verify`).

### Changed
- The project storage is a pluggable backend (`server/runtime/project/storage`, selected like the DAQ
  storage); `prjstorage.js` keeps its API and forwards to the selected backend. The SQLite backend is the
  previous code, unchanged.
