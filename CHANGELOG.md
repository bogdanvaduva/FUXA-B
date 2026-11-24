# Changelog

## 1.3.7-3221 - 2026-11-24

### Added
- Setup → Settings → Project storage: **Use project in storage** opens the project already saved in PostgreSQL
  (for example by another FUXA) without copying the current one over it (`POST /api/project-storage/switch`
  `{ mode: 'use' }`, refused when the database/schema has no project). **Test connection** tells whether there is
  a project (views, devices). See docs/storage-migration.md "Connect a new FUXA to a project already in PostgreSQL".

## 1.3.7-3218 - 2026-11-23

### Added
- Repeater **FUXA Project DB**: the current tag values, `devices.tagList` (as in the FUXA App DB, its entries are
  live tags in the Repeater) and `tags.tagValue`, `tags.timestamp`, `tags.tag` (`{ id, name, value, timestamp }`,
  live tag field).

## 1.3.7-3215 - 2026-11-23

### Changed
- Repeater: the storage list shows the **FUXA Project DB** of the selected project storage only, **(SQLite)** or
  **(PostgreSQL)**. **FUXA Project DB (PostgreSQL)** now queries the project (sanitized, as temporary tables of
  the query, PostgreSQL syntax) together with your own tables, with the reader login.

### Added
- Setup → Settings → Project storage: **Repeater reader login** (user, password), checked before saving
  (`POST /api/project-storage/reader`).

### Fixed
- The Repeater line dialog showed the translation keys of the Test button and of the hints.

## 1.3.7-3212 - 2026-11-23

### Changed
- Repeater **FUXA Project DB**: the tables have the columns `id` (the key of the item, was `name`), `name` (the name
  of the item), `value` and one column per item property (`devices.type`, `devices.enabled`, ...), and a new
  `tags` table with the tags of all devices (`deviceId`, `deviceName`, `address`, ...).

### Added
- Repeater data line dialog: **Test** button that runs the SQL not saved yet (admins, `POST /api/daq/sql/test`) and
  shows the row count and the first rows, or the SQL error (before, a wrong query only showed an empty Repeater).

## 1.3.7-3209 - 2026-11-23

### Added
- Repeater **FUXA Project DB**: a DB line can query the project of the selected project storage (SQLite or
  PostgreSQL) as SQL tables (`views`, `devices`, `alarms`, ..., columns `name`, `value`). The rows are the project as
  the viewer gets it (views filtered by permission) without credentials, with the same sanitizer as `/api/project`,
  also for admins; `devicesSecurity` is never available. Read-only, in a temporary in-memory database.
- Repeater **FUXA Project DB (PostgreSQL)**: with the PostgreSQL project storage, read-only queries on the other
  tables of that database with a separate login (`storage.postgres.reader`). Refused when that login is superuser
  or can read the FUXA project tables; one statement per query, read-only transaction, statement timeout.

### Fixed
- The Repeater DB lines could query only the DAQ storages and the local SQLite FUXA App DB, not the project
  database selected in Setup → Settings → Project storage.

## 1.3.7-3206 - 2026-11-23

Merged with the upstream FUXA **1.3.6** release (security fixes: device property requests and device
configuration in the project restricted to admins, DAQ query limits, scheduler jobs reconciled with permissions,
initial view and login fixes).

### Added
- Remote FUXA servers (horizontal scaling): the **FuxaRemote** connection uses another FUXA server, started and
  configured on its own with its devices, and mirrors the remote tags chosen in a browse dialog (remote devices and
  their tags). All the tags of a connection are read with one request per polling, writes go to the remote tag,
  the API key is kept in the device security store. After 3 failed pollings the values are cleared and the
  connection reconnects. See [docs/HowTo-Remote-FUXA.md](docs/HowTo-Remote-FUXA.md).
- `POST /api/remote/values` (many tag values in one request) and `GET /api/remote/browse` (devices and tags without
  the device settings), admin or API key only, used by the FuxaRemote connection.
- Project storage in PostgreSQL: `settings.storage.type = 'postgres'` saves the project (views, devices,
  scripts, alarms, ...) in the database of `settings.storage.postgres` instead of `_appdata/project.fuxap.db`.
  The default stays `'sqlite'`: existing installations are unchanged.
  See [docs/storage-migration.md](docs/storage-migration.md).
- `npm run migrate-storage -- --from sqlite --to postgres`: copies an existing SQLite project to PostgreSQL
  in one transaction (read-only source, refuses a non-empty target without `--force`, `--verify`).
- Switch the project storage from the editor (**Setup → Settings → Project storage**) or by changing
  `storage.type`: the project is copied automatically to the new storage, SQLite → PostgreSQL and back; the previous
  content of the target is saved as a backup (`project.fuxap.backup-<time>.db` / schema `prjstorage_backup_<time>`).
- Single sign-on with OpenID Connect (`settings.oidc`, disabled by default): "Sign in with SSO" in the login
  dialog, authorization code flow with PKCE, state and nonce, ID token signature checked with the IdP keys.
  The identity (`sub`) is mapped to a FUXA user (new `oidc_sub` column in `users.fuxap.db`, added only when
  OIDC is enabled), FUXA issues its own token through the refresh cookie flow. Requires `secureEnabled` and
  `enableRefreshCookieAuth`; FUXA does not start with an invalid OIDC configuration.
  See [docs/oidc-security.md](docs/oidc-security.md).

### Fixed
- `GET /api/settings` returned the PostgreSQL project storage password; it is removed (only `storage.type` for
  non-admin users). The OIDC client secret is never returned.
- The settings written to the log on start (`daqstorage: settings - ...`) contained the JWT secret, the SMTP,
  DAQ and PostgreSQL passwords and the OIDC client secret; they are removed (one sanitizer for the API and the log).

### Changed
- The project storage is a pluggable backend (`server/runtime/project/storage`, selected like the DAQ
  storage); `prjstorage.js` keeps its API and forwards to the selected backend. The SQLite backend is the
  previous code, unchanged.
