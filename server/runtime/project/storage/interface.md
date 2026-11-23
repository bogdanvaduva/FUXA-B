# Project storage backend contract

`server/runtime/project/prjstorage.js` is the only module the rest of the server uses.
It selects a backend with `storage/index.js` (`getStorage(settings)`, from
`settings.storage.type`, default `'sqlite'`) on `init()` and forwards every call to it.

A backend is a module (a singleton, like the SQLite one) that exports the members below
with exactly the behavior described. The behavior is the behavior of the original
SQLite `prjstorage.js`; a backend must not add or change semantics.

The schema is documented in [`docs/storage-schema.md`](../../../../docs/storage-schema.md).

## Types

```
TableType = {
    GENERAL: 'general', DEVICES: 'devices', VIEWS: 'views', DEVICESSECURITY: 'devicesSecurity',
    TEXTS: 'texts', ALARMS: 'alarms', RECIPES: 'recipes', NOTIFICATIONS: 'notifications',
    SCRIPTS: 'scripts', REPORTS: 'reports', LOCATIONS: 'locations', ARMARKERS: 'arMarkers'
}
Section = { table: TableType value, name: string, value: any }   // value is JSON.stringify'd
Row     = { name: string, value: string | null }                // value is the stored JSON text
```

Every table is a key/value store. A `table` that is not one of the `TableType` values is
an error (the table name is never taken from outside the whitelist).

## Methods

All methods return Promises, except `close()`.

| Method | Resolves | Rejects | Notes |
|--------|----------|---------|-------|
| `init(settings, logger)` | `true` if the store already existed, `false` if it was created now | without a value (after `logger.error`) if the store cannot be opened or the tables cannot be created | Creates the missing tables. The caller writes the defaults (`setDefault`) when it resolves `false`. |
| `close()` | - (returns nothing) | - | Releases the connection. Safe to call when not initialized. |
| `setDefault()` | nothing | with the error of `setSections` (`undefined`) | Writes `general.version = '1.00'` and the `devices.server` FUXA server device. |
| `setSection(section)` | nothing | without a value (after `logger.error`) | Insert or replace the row `section.name` of `section.table` with `JSON.stringify(section.value)`. Invalid table: rejects without a value. |
| `setSections(sections)` | nothing | without a value (after `logger.error`) | Like `setSection` for each item, all in one transaction: if one fails nothing is written. An empty list resolves. |
| `getSection(table, name?)` | `Row[]` | with the `Error` (invalid table or database error) | All the rows of the table when `name` is falsy (`undefined`, `null`, `''`), else the rows (0 or 1) with that name. Rows are in the order of their last write (oldest first). `value` is the stored text, never parsed. |
| `deleteSection(section)` | nothing | with the `Error` (invalid table or database error) | Deletes the row `section.name` of `section.table`. A missing row is not an error. |
| `clearAll()` | `true` | without a value (after `logger.error`) | Deletes the rows of every table **except `devicesSecurity`**, in one statement batch. |
| `TableType` | - | - | The table constants above (property, not a method). |

### Write semantics

- Insert or replace: writing an existing `name` replaces its value and the row moves to
  the end of the read order (SQLite `INSERT OR REPLACE` gives the row a new `rowid`).
- `devices` has the legacy columns `connection`, `cntid`, `cntpwd`; a write resets them to
  `NULL` (as `INSERT OR REPLACE` does).
- `value` is `JSON.stringify(section.value)`; `undefined` is stored as `NULL`
  (read back as `value: null`).
- The stored text is returned byte for byte: key order and formatting are preserved.

### Error logging

`setSection`, `setSections` and `clearAll` log with `logger.error('prjstorage.set failed! ...')`
/ `'prjstorage.clear failed! ...'` and reject without a value; `getSection` and
`deleteSection` reject with the error and do not log. Callers in `project/index.js`
log with their own messages.

## Backends

| `settings.storage.type` | Module | Store |
|-------------------------|--------|-------|
| `'sqlite'` (default) | `storage/sqlite` | `<workDir>/project.fuxap.db` |
| `'postgres'` | `storage/postgres` | the database in `settings.storage.postgres` |

## Adding a backend

1. Create `storage/<type>/index.js` exporting the members above.
2. Add the `case` in `storage/index.js`.
3. Add `<type>` to the backend list of `test/storage/projectStorageContract.test.js`:
   the same contract tests must pass.
