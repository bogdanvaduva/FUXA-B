# Changelog

## Unreleased

### Added
- Project storage in PostgreSQL: `settings.storage.type = 'postgres'` saves the project (views, devices,
  scripts, alarms, ...) in the database of `settings.storage.postgres` instead of `_appdata/project.fuxap.db`.
  The default stays `'sqlite'`: existing installations are unchanged.
  See [docs/storage-migration.md](docs/storage-migration.md).
- `npm run migrate-storage -- --from sqlite --to postgres`: copies an existing SQLite project to PostgreSQL
  in one transaction (read-only source, refuses a non-empty target without `--force`, `--verify`).
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
