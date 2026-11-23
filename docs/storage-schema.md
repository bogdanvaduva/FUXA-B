# Project storage schema

The project configuration (views, devices, scripts, alarms, ...) is stored by the
project storage backend selected with `settings.storage.type`
(see [Settings](Settings.md) and [Project storage migration](storage-migration.md)).

The users (`users.fuxap.db`), alarm history (`alarms.fuxap.db`), API keys, recipes,
scheduler and DAQ databases are separate stores and are not part of the project storage.

## Tables

Every table is a key/value store: `name` is the key, `value` is the JSON text of the
object (`JSON.stringify` on write, the caller does `JSON.parse` on read).

| Table             | `TableType`       | Key (`name`)                     | Value                                   | Removed by `clearAll` |
|-------------------|-------------------|----------------------------------|-----------------------------------------|:---------------------:|
| `general`         | `GENERAL`         | project property (`version`, `layout`, `charts`, `graphs`, `clientAccess`, `ar`, ...) | property value | yes |
| `views`           | `VIEWS`           | view id                          | view                                    | yes |
| `devices`         | `DEVICES`         | device id (`server` for the FUXA server device) | device                   | yes |
| `devicesSecurity` | `DEVICESSECURITY` | device id                        | device security (credentials)           | **no** |
| `texts`           | `TEXTS`           | text name                        | text                                    | yes |
| `alarms`          | `ALARMS`          | alarm name                       | alarm definition                        | yes |
| `recipes`         | `RECIPES`         | recipe id                        | recipe                                  | yes |
| `notifications`   | `NOTIFICATIONS`   | notification id                  | notification                            | yes |
| `scripts`         | `SCRIPTS`         | script id                        | script                                  | yes |
| `reports`         | `REPORTS`         | report id                        | report                                  | yes |
| `locations`       | `LOCATIONS`       | location id                      | map location                            | yes |
| `arMarkers`       | `ARMARKERS`       | marker id                        | AR marker                               | yes |

There are no foreign keys and no indexes other than the primary keys.

## SQLite (`<workDir>/project.fuxap.db`, default `_appdata/project.fuxap.db`)

```sql
CREATE TABLE if not exists general (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE if not exists views (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE if not exists devices (name TEXT PRIMARY KEY, value TEXT, connection TEXT, cntid TEXT, cntpwd TEXT);
CREATE TABLE if not exists devicesSecurity (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE if not exists texts (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE if not exists alarms (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE if not exists recipes (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE if not exists notifications (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE if not exists scripts (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE if not exists reports (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE if not exists locations (name TEXT PRIMARY KEY, value TEXT);
CREATE TABLE if not exists arMarkers (name TEXT PRIMARY KEY, value TEXT);
```

Notes:

- `devices.connection`, `devices.cntid` and `devices.cntpwd` are legacy columns: no code
  writes them, and `INSERT OR REPLACE` resets them to `NULL` on every save.
- Writes use `INSERT OR REPLACE`, which deletes and re-inserts the row: a saved row gets a
  new `rowid` and moves to the end of the table. A read without `ORDER BY` returns the
  rows in `rowid` order, so the views (and the other lists) are loaded in the order they
  were last saved.

## PostgreSQL

See [`server/runtime/project/storage/postgres/schema.sql`](../server/runtime/project/storage/postgres/schema.sql).
The same tables and columns, plus a `seq` column that reproduces the SQLite `rowid` order:

| SQLite                 | PostgreSQL                         | Why |
|------------------------|------------------------------------|-----|
| `name TEXT PRIMARY KEY`| `name TEXT PRIMARY KEY`            | same |
| `value TEXT`           | `value JSON`                       | `json` keeps the text exactly as written (key order, spacing) and checks that it is valid JSON. `jsonb` is not used because it reorders the object keys, which would change the order of the loaded objects. |
| implicit `rowid`       | `seq BIGINT` from one shared sequence, renewed on every write, `ORDER BY seq` on read | same row order as SQLite after `INSERT OR REPLACE` |
| `devicesSecurity`, `arMarkers` | `devicessecurity`, `armarkers` | unquoted PostgreSQL identifiers are lower case; the backend uses them unquoted, so the names are the same in the code |
