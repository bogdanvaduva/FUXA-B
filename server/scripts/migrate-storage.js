#!/usr/bin/env node
/**
 *  Copy the FUXA project storage from SQLite (project.fuxap.db) to PostgreSQL
 *  See docs/storage-migration.md
 *
 *  node scripts/migrate-storage.js --from sqlite --to postgres \
 *      [--sqlite-path ./_appdata/project.fuxap.db] [--settings ./_appdata/settings.js] \
 *      [--pg-host localhost] [--pg-port 5432] [--pg-db fuxa] [--pg-user fuxa] [--pg-password ...] \
 *      [--pg-schema public] [--pg-ssl] [--force] [--verify] [--verify-only]
 *
 *  The SQLite file is opened read-only, the copy is one PostgreSQL transaction.
 *  Exit code: 0 done, 1 failed (nothing written), 2 invalid arguments or target not empty
 */

'use strict';

const fs = require('fs');
const path = require('path');
const nopt = require('nopt');
const sqlite3 = require('sqlite3');
const { Pool } = require('pg');
const { TableType } = require('../runtime/project/storage/tables');
const pgStorage = require('../runtime/project/storage/postgres');

const knownOpts = {
    'from': String,
    'to': String,
    'sqlite-path': path,
    'settings': path,
    'pg-host': String,
    'pg-port': Number,
    'pg-db': String,
    'pg-user': String,
    'pg-password': String,
    'pg-schema': String,
    'pg-ssl': Boolean,
    'force': Boolean,
    'verify': Boolean,
    'verify-only': Boolean,
    'help': Boolean,
};
const shortHands = { 'h': ['--help'] };

const EXIT_FAILED = 1;
const EXIT_REFUSED = 2;

class UsageError extends Error {}

// copy order: no foreign keys between the tables, the TableType order
const TABLES = Object.values(TableType);

function usage() {
    return [
        'Copy the FUXA project storage from SQLite to PostgreSQL',
        '',
        'node scripts/migrate-storage.js --from sqlite --to postgres [options]',
        '',
        '  --sqlite-path <file>   source, default _appdata/project.fuxap.db',
        '  --settings <file>      read the target from storage.postgres of this settings.js',
        '                         (default _appdata/settings.js if it exists)',
        '  --pg-host --pg-port --pg-db --pg-user --pg-password --pg-schema --pg-ssl',
        '                         target, override the settings (password also from PGPASSWORD)',
        '  --force                empty the target tables first if they are not empty',
        '  --verify               after the copy compare every row of the two databases',
        '  --verify-only          only compare, copy nothing',
    ].join('\n');
}

function log(msg) {
    process.stdout.write(msg + '\n');
}

/**
 * Target settings: storage.postgres from settings.js, then the --pg-* options
 */
function getTargetSettings(args) {
    var postgres = {};
    var settingsFile = args.settings;
    if (!settingsFile) {
        const defaultFile = path.resolve(__dirname, '..', '_appdata', 'settings.js');
        if (fs.existsSync(defaultFile)) {
            settingsFile = defaultFile;
        }
    } else if (!fs.existsSync(settingsFile)) {
        throw new UsageError(`settings file '${settingsFile}' not found`);
    }
    if (settingsFile) {
        const fileSettings = require(settingsFile);
        if (fileSettings.storage && fileSettings.storage.postgres) {
            postgres = Object.assign({}, fileSettings.storage.postgres);
        }
    }
    const map = { 'pg-host': 'host', 'pg-port': 'port', 'pg-db': 'database', 'pg-user': 'user', 'pg-password': 'password', 'pg-schema': 'schema', 'pg-ssl': 'ssl' };
    Object.keys(map).forEach(key => {
        if (args[key] !== undefined) {
            postgres[map[key]] = args[key];
        }
    });
    if (!postgres.password && process.env.PGPASSWORD) {
        postgres.password = process.env.PGPASSWORD;
    }
    return { storage: { type: 'postgres', postgres: postgres } };
}

// SQLite helpers (read-only)
function openSqlite(file) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, err => err ? reject(err) : resolve(db));
    });
}

function sqliteAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
}

function closeSqlite(db) {
    return new Promise(resolve => db.close(() => resolve()));
}

async function sqliteTables(db) {
    const rows = await sqliteAll(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
    return rows.map(row => row.name);
}

/**
 * Rows of a source table in rowid order (the order FUXA reads them), with the devices legacy columns
 */
function readSourceRows(db, table) {
    const columns = table === TableType.DEVICES ? 'name, value, connection, cntid, cntpwd' : 'name, value';
    return sqliteAll(db, `SELECT ${columns} FROM ${table} ORDER BY rowid`);
}

function readTargetRows(client, table) {
    const columns = table === TableType.DEVICES ? 'name, value::text AS value, connection, cntid, cntpwd' : 'name, value::text AS value';
    return client.query(`SELECT ${columns} FROM ${table} ORDER BY seq`).then(result => result.rows);
}

async function openTarget(settings) {
    const connection = pgStorage.getConnectionOptions(settings);
    const pool = new Pool(connection.options);
    pool.on('error', () => {});
    const where = `${connection.options.user}@${connection.options.host}:${connection.options.port}/${connection.options.database}` +
        (connection.schema ? ` schema ${connection.schema}` : '');
    try {
        await pool.query('SELECT 1');
    } catch (err) {
        await pool.end().catch(() => {});
        throw new Error(`cannot connect to PostgreSQL ${where}: ${err.message}`);
    }
    return { pool: pool, schema: connection.schema, where: where };
}

/**
 * Copy all the tables in one transaction, rollback on any error
 */
async function migrate(source, target, force) {
    const sourceTables = await sqliteTables(source);
    const client = await target.pool.connect();
    const counts = {};
    try {
        await client.query('BEGIN');
        if (target.schema) {
            await client.query(`CREATE SCHEMA IF NOT EXISTS ${target.schema}`);
        }
        await client.query(fs.readFileSync(pgStorage.SCHEMA_FILE, 'utf8'));

        const notEmpty = [];
        for (const table of TABLES) {
            const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
            if (result.rows[0].count > 0) {
                notEmpty.push(`${table} (${result.rows[0].count})`);
            }
        }
        if (notEmpty.length) {
            if (!force) {
                const err = new UsageError(`target tables not empty: ${notEmpty.join(', ')}. Use --force to replace their content.`);
                throw err;
            }
            log(`--force: emptying the target tables ${notEmpty.join(', ')}`);
            for (const table of TABLES) {
                await client.query(`DELETE FROM ${table}`);
            }
        }

        for (const table of TABLES) {
            if (!sourceTables.includes(table)) {
                log(`  ${table}: not in the source, skipped`);
                counts[table] = 0;
                continue;
            }
            const rows = await readSourceRows(source, table);
            for (const row of rows) {
                try {
                    if (table === TableType.DEVICES) {
                        await client.query(`INSERT INTO ${table} (name, value, connection, cntid, cntpwd) VALUES ($1, $2, $3, $4, $5)`,
                            [row.name, row.value, row.connection, row.cntid, row.cntpwd]);
                    } else {
                        await client.query(`INSERT INTO ${table} (name, value) VALUES ($1, $2)`, [row.name, row.value]);
                    }
                } catch (err) {
                    throw new Error(`${table} '${row.name}': ${err.message}`);
                }
            }
            counts[table] = rows.length;
            log(`  ${table}: ${rows.length} rows`);
        }
        await client.query('COMMIT');
        return counts;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Compare every row: same names in the same order, same JSON text, same parsed value
 */
async function verify(source, target) {
    const sourceTables = await sqliteTables(source);
    const client = await target.pool.connect();
    const errors = [];
    try {
        for (const table of TABLES) {
            const srows = sourceTables.includes(table) ? await readSourceRows(source, table) : [];
            const trows = await readTargetRows(client, table);
            if (srows.length !== trows.length) {
                errors.push(`${table}: ${srows.length} rows in SQLite, ${trows.length} in PostgreSQL`);
                continue;
            }
            for (let i = 0; i < srows.length; i++) {
                const s = srows[i], t = trows[i];
                if (s.name !== t.name) {
                    errors.push(`${table}: row ${i} is '${s.name}' in SQLite, '${t.name}' in PostgreSQL`);
                    break;
                }
                if (s.value !== t.value) {
                    let same = false;
                    try {
                        same = JSON.stringify(JSON.parse(s.value)) === JSON.stringify(JSON.parse(t.value));
                    } catch (_) {}
                    errors.push(`${table} '${s.name}': value ${same ? 'text differs (same JSON)' : 'differs'}`);
                }
                if (table === TableType.DEVICES && (s.connection !== t.connection || s.cntid !== t.cntid || s.cntpwd !== t.cntpwd)) {
                    errors.push(`${table} '${s.name}': legacy columns differ`);
                }
            }
            log(`  ${table}: ${trows.length} rows ${errors.some(e => e.startsWith(table)) ? 'DIFFERENT' : 'ok'}`);
        }
    } finally {
        client.release();
    }
    return errors;
}

function summary(counts) {
    const parts = TABLES.filter(table => counts[table]).map(table => `${counts[table]} ${table}`);
    return parts.length ? parts.join(', ') : 'no rows';
}

async function main(argv) {
    const args = nopt(knownOpts, shortHands, argv, 2);
    if (args.help) {
        log(usage());
        return 0;
    }
    if (args.from !== 'sqlite' || args.to !== 'postgres') {
        throw new UsageError(`only --from sqlite --to postgres is supported\n\n${usage()}`);
    }
    const sqlitePath = args['sqlite-path'] || path.resolve(__dirname, '..', '_appdata', 'project.fuxap.db');
    if (!fs.existsSync(sqlitePath)) {
        throw new UsageError(`SQLite file '${sqlitePath}' not found (--sqlite-path)`);
    }
    const settings = getTargetSettings(args);

    const source = await openSqlite(sqlitePath);
    let target;
    try {
        target = await openTarget(settings);
        log(`Source: SQLite ${sqlitePath} (read-only)`);
        log(`Target: PostgreSQL ${target.where}`);
        if (!args['verify-only']) {
            log('Migrating...');
            const counts = await migrate(source, target, args.force);
            log(`Migrated ${summary(counts)}.`);
        }
        if (args.verify || args['verify-only']) {
            log('Verifying...');
            const errors = await verify(source, target);
            if (errors.length) {
                errors.forEach(err => log(`  ERROR ${err}`));
                throw new Error(`verify failed: ${errors.length} differences`);
            }
            log('Verify ok: the PostgreSQL tables are identical to the SQLite ones.');
        }
        return 0;
    } finally {
        await closeSqlite(source);
        if (target) {
            await target.pool.end().catch(() => {});
        }
    }
}

if (require.main === module) {
    main(process.argv).then(code => {
        process.exitCode = code;
    }).catch(err => {
        process.stderr.write(`migrate-storage failed: ${err.message}\n`);
        if (!(err instanceof UsageError)) {
            process.stderr.write('Nothing was written to PostgreSQL (transaction rolled back), the SQLite file is unchanged.\n');
        }
        process.exitCode = err instanceof UsageError ? EXIT_REFUSED : EXIT_FAILED;
    });
}

module.exports = { main: main, UsageError: UsageError };
