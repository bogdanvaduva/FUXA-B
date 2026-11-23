# Project storage: SQLite or PostgreSQL

The project (views, devices, scripts, alarms, texts, recipes, notifications, reports,
locations, AR markers and the general settings) is stored by default in the SQLite file
`server/_appdata/project.fuxap.db`. It can be stored in a PostgreSQL database instead.

Only the project moves. The users, the alarm history, the API keys, the recipes runtime
data, the scheduler and the DAQ values keep their own stores (the DAQ values can be saved in
PostgreSQL with the separate **DAQ storage** setting).

## 1. Prepare the database

Create a database and a user that can create tables in it, for example:

```sql
CREATE USER fuxa WITH PASSWORD 'change-me';
CREATE DATABASE fuxa OWNER fuxa;
```

FUXA creates its tables (`schema.sql`, `CREATE TABLE IF NOT EXISTS`) on every start.
With the `schema` option the tables are created in that schema (created if missing),
so the project can share a database with other applications.

## 2. Switch from the editor (recommended)

Editor → **Setup** → **Settings** → **Project storage**:

1. **In use** shows the storage of the current project.
2. Select **PostgreSQL** (or **SQLite** to go back), fill the connection (host, port, database, schema,
   user, password, SSL) and press **Test connection**.
3. Press **Switch and copy project** and confirm.

FUXA copies the whole project (views, devices, device security, scripts, alarms, ...) to the selected
storage in one transaction, then uses it and reloads the project. If the copy fails nothing changes.
If the selected storage already contains a project, its content is saved first:

| Target | Backup |
|--------|--------|
| SQLite | `_appdata/project.fuxap.backup-<yyyyMMddHHmmss>.db` |
| PostgreSQL | schema `prjstorage_backup_<yyyyMMddHHmmss>` in the same database |

The storage settings are saved in `_appdata/mysettings.json` (they override the `storage` block of
`settings.js`). The password is never sent back to the browser: leave it empty to keep the saved one.
Switching copies only between SQLite and PostgreSQL; to move to another PostgreSQL server switch to
SQLite first, then to the new server.

### Switch by editing settings.js

If `storage.type` is changed by hand in `settings.js` (and there is no `storage` in `mysettings.json`),
FUXA copies the project at the next start, with the same backup. The file `_appdata/prjstorage.json`
records which storage holds the current project. If the copy fails (e.g. PostgreSQL not reachable)
FUXA logs an error and keeps using the previous storage; the copy is tried again at the next start.
To go back from PostgreSQL to SQLite the `storage.postgres` block must still point to the database.

## 3. Copy with the command line tool (optional)

Stop FUXA, then from the `server` folder:

```bash
# target from storage.postgres of _appdata/settings.js, or from the --pg-* options
PGPASSWORD=change-me npm run migrate-storage -- --from sqlite --to postgres \
    --pg-host localhost --pg-port 5432 --pg-db fuxa --pg-user fuxa --verify
```

| Option | Meaning |
|--------|---------|
| `--sqlite-path <file>` | source, default `_appdata/project.fuxap.db` |
| `--settings <file>` | read the target from `storage.postgres` of this `settings.js` (default `_appdata/settings.js`) |
| `--pg-host`, `--pg-port`, `--pg-db`, `--pg-user`, `--pg-password`, `--pg-schema`, `--pg-ssl` | target, override the settings; the password can also be given with `PGPASSWORD` (better than the command line) |
| `--force` | the target tables are not empty: empty them and copy again |
| `--verify` | after the copy, compare every row of the two databases |
| `--verify-only` | only compare, copy nothing |

The tool:

- opens the SQLite file **read-only**, it is never changed;
- creates the tables and copies every table in **one transaction**: on any error (for
  example a value that is not valid JSON) everything is rolled back and nothing is written;
- **refuses** to write into non-empty tables unless `--force` is given;
- keeps the row order (the order of the views in the editor);
- prints the rows copied per table: `Migrated 4 general, 5 devices, 6 views, 1 locations.`

Exit code: `0` done, `1` failed (rolled back), `2` invalid options or target not empty.

## 4. Switch FUXA to PostgreSQL by hand

In `server/_appdata/settings.js` (restart FUXA after the change):

```js
storage: {
    type: 'postgres',
    postgres: {
        host: 'localhost',
        port: 5432,
        database: 'fuxa',
        user: 'fuxa',
        password: 'change-me',
        ssl: false,             // or the node-postgres ssl options: { rejectUnauthorized: false, ca: '...' }
        maxPoolSize: 10,
        // schema: 'fuxa',      // default public
        // connectionTimeout: 10000
    }
},
```

On start the log shows `prjstorage.connected-to fuxa@localhost:5432/fuxa database`. If the
database cannot be reached FUXA logs `prjstorage.bind failed! cannot connect to PostgreSQL
... check settings.storage.postgres`: if the project is still in SQLite (switch pending) FUXA
keeps using SQLite and copies the project at the next start, otherwise the project is not loaded.

If the database is empty, the existing SQLite project is copied into it on this first start;
without an SQLite project FUXA starts with the default empty project.

## Going back to SQLite

From the editor (**Project storage** → **SQLite** → **Switch and copy project**) or by setting
`storage.type` back to `'sqlite'` and restarting: the project, with the changes made on PostgreSQL,
is copied back to `project.fuxap.db` (the previous file is saved as a backup).

## Repeater queries on the project database

A Repeater **DB** line can query the project database selected here:

- **FUXA Project DB** (any storage): the project tables (`general`, `views`, `devices`, `texts`, `alarms`,
  `recipes`, `notifications`, `scripts`, `reports`, `locations`, `arMarkers`, columns `name` and `value` with the
  JSON) read from the selected storage, SQLite syntax (`json_extract`, `json_each`). They hold the project as the
  viewer of the Repeater gets it: views filtered by permission, without credentials (device passwords and user
  names, tokens, server script code, notification and report receivers), also for admins. `devicesSecurity` is
  not available.
- **FUXA Project DB (PostgreSQL)**: with the PostgreSQL storage, the other tables of the same database (your
  own data), PostgreSQL syntax. It is listed only when `storage.postgres.reader` is set: a separate login, used
  only for these queries, in a read-only transaction (one statement, `statementTimeout` default 30 s).

Create the reader login with access only to your tables:

```sql
CREATE ROLE fuxa_reader LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA plant TO fuxa_reader;
GRANT SELECT ON plant.items, plant.sites TO fuxa_reader;
```

```js
storage: {
    type: 'postgres',
    postgres: { /* ... */, reader: { user: 'fuxa_reader', password: '...' } }
},
```

FUXA refuses to run the query when the reader login, or a role it is member of, is superuser, is one of
`pg_read_all_data`, `pg_read_server_files`, `pg_write_server_files`, `pg_execute_server_program`, or can read
a table with the name of a project table (in any schema, also the `prjstorage_backup_*` copies). Do not grant it
views or functions that read the project tables: they run with the privileges of their owner. The reader password
is never returned by the API nor written to the log.

## Tables

See [Project storage schema](storage-schema.md).
