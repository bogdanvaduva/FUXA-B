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

## 2. Copy the existing project (optional)

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

## 3. Switch FUXA to PostgreSQL

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
... check settings.storage.postgres` and does not load the project.

With an empty database (no migration) FUXA starts with the default empty project, as
with a new SQLite file.

## Going back to SQLite

Set `storage.type` back to `'sqlite'` (or remove the `storage` block) and restart. FUXA
uses `project.fuxap.db` again, which the migration did not change: the changes made
while running on PostgreSQL are not in it. To keep them, save the project from the editor
(**Save project**, a `.fuxap` file) before switching and open it after.

## Tables

See [Project storage schema](storage-schema.md).
