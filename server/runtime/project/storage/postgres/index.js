/**
 *  Project storage backend: PostgreSQL, connection from settings.storage.postgres
 *  Same tables and behavior as the SQLite backend, contract: ../interface.md
 *  The values are parameterized ($1, $2), the table names come only from the TableType whitelist
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { TableType, ClearableTables } = require('../tables');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

var settings;       // Application settings
var logger;         // Application logger
var pool;           // Connection pool
var readerPool;     // Connection pool of the Repeater reader login (settings.storage.postgres.reader)
var readerKey;      // Connection of readerPool, to recreate it when the settings change

// a reader login must not read these tables (in any schema, also the prjstorage_backup_* copies)
const PROJECT_TABLE_NAMES = Object.values(TableType).map(table => table.toLowerCase());
// roles that read or run anything on the server
const UNSAFE_ROLES = ['pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program', 'pg_read_all_data'];
// unsafe if the login (or a role it is member of) is superuser, an unsafe role, or can read a project table
const READER_CHECK_SQL = `SELECT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE pg_has_role(current_user, r.oid, 'MEMBER')
      AND (r.rolsuper OR r.rolname = ANY($2::text[]) OR EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f') AND lower(c.relname) = ANY($1::text[])
            AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            AND n.nspname NOT LIKE 'pg\\_temp\\_%' AND n.nspname NOT LIKE 'pg\\_toast\\_temp\\_%'
            AND has_any_column_privilege(r.oid, c.oid, 'SELECT')))
) AS unsafe`;

function _ensureValidTable(table) {
    const tables = Object.values(TableType);
    if (!tables.includes(table)) {
        throw new Error(`invalid table '${table}'`);
    }
    return table;
}

/**
 * Connection options from settings.storage.postgres
 * @param {*} _settings
 */
function getConnectionOptions(_settings) {
    const cfg = (_settings && _settings.storage && _settings.storage.postgres) || {};
    const schema = cfg.schema || '';
    if (schema && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
        throw new Error(`settings.storage.postgres.schema '${schema}' not valid (letters, digits and _ only)`);
    }
    const options = {
        host: cfg.host || 'localhost',
        port: Number(cfg.port) || 5432,
        database: cfg.database || 'fuxa',
        user: cfg.user || 'fuxa',
        password: cfg.password || '',
        ssl: cfg.ssl || false,
        max: Number(cfg.maxPoolSize) || 10,
        connectionTimeoutMillis: Number(cfg.connectionTimeout) || 10000,
    };
    if (schema) {
        options.options = `-c search_path=${schema}`;
    }
    return { options: options, schema: schema };
}

/**
 * Description of the connection for the logs (without password)
 */
function _describe(options) {
    return `${options.user}@${options.host}:${options.port}/${options.database}`;
}

/**
 * Upsert of one row: the row gets a new seq (moves to the end of the read order) and
 * the devices legacy columns are reset, as SQLite INSERT OR REPLACE
 */
function _upsertSql(table) {
    var sql = `INSERT INTO ${table} (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, seq = EXCLUDED.seq`;
    if (table === TableType.DEVICES) {
        sql += ', connection = NULL, cntid = NULL, cntpwd = NULL';
    }
    return sql;
}

/**
 * Init and bind the database resource
 * Resolve true if the project tables already exist
 * @param {*} _settings
 * @param {*} _log
 */
function init(_settings, _log) {
    settings = _settings;
    logger = _log;

    return _bind();
}

/**
 * Connect (health check) and create the tables if not exist
 */
async function _bind() {
    var connection;
    try {
        connection = getConnectionOptions(settings);
    } catch (err) {
        logger.error(`prjstorage.bind failed! ${err.message}`);
        throw err;
    }
    const options = connection.options;
    if (pool) {
        close();
    }
    pool = new Pool(options);
    pool.on('error', (err) => logger.error(`prjstorage.postgres pool error: ${err}`));
    try {
        await pool.query('SELECT 1');
    } catch (err) {
        const message = `prjstorage.bind failed! cannot connect to PostgreSQL ${_describe(options)}, check settings.storage.postgres: ${err.message}`;
        logger.error(message);
        close();
        throw new Error(message);
    }
    try {
        if (connection.schema) {
            await pool.query(`CREATE SCHEMA IF NOT EXISTS ${connection.schema}`);
        }
        const exist = await pool.query(`SELECT to_regclass('${TableType.GENERAL}') IS NOT NULL AS exist`);
        await pool.query(fs.readFileSync(SCHEMA_FILE, 'utf8'));
        logger.info(`prjstorage.connected-to ${_describe(options)}${connection.schema ? ' schema ' + connection.schema : ''} database`, true);
        return exist.rows[0].exist;
    } catch (err) {
        const message = `prjstorage.bind failed! ${err.message}`;
        logger.error(message);
        close();
        throw new Error(message);
    }
}

/**
 * Set default project value in database
 */
function setDefault() {
    return new Promise(function (resolve, reject) {
        var scs = [];
        scs.push({ table: TableType.GENERAL, name: 'version', value: '1.00' });
        scs.push({ table: TableType.DEVICES, name: 'server', value: { 'id': '0', 'name': 'FUXA Server', 'type': 'FuxaServer', 'property': {} } });
        setSections(scs).then(() => {
            resolve();
        }).catch(function (err) {
            reject(err);
        });
    });
}

/**
 * Insert the list of values in database tables, if exist replace the value of name(key)
 * All in one transaction
 * @param {*} sections
 */
function setSections(sections) {
    return new Promise(async function (resolve, reject) {
        var client;
        try {
            client = await pool.connect();
        } catch (err) {
            logger.error(`prjstorage.set failed! ${err}`);
            return reject();
        }
        try {
            await client.query('BEGIN');
            for (var i = 0; i < sections.length; i++) {
                var table = _ensureValidTable(sections[i].table);
                var value = JSON.stringify(sections[i].value);
                await client.query(_upsertSql(table), [sections[i].name, value]);
            }
            await client.query('COMMIT');
            resolve();
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch (_) {}
            logger.error(`prjstorage.set failed! ${err}`);
            reject();
        } finally {
            client.release();
        }
    });
}

/**
 * Insert the values in database table, if exist replace the value of name(key)
 * @param {*} section
 */
function setSection(section) {
    return new Promise(function (resolve, reject) {
        try {
            var table = _ensureValidTable(section.table);
            var value = JSON.stringify(section.value);
            pool.query(_upsertSql(table), [section.name, value]).then(function () {
                resolve();
            }).catch(function (err) {
                logger.error(`prjstorage.set failed! ${err}`);
                reject();
            });
        } catch (err) {
            logger.error(`prjstorage.set failed! ${err}`);
            reject();
        }
    });
}

/**
 * Return all values of table with this name, the value as stored JSON text
 * If name is null return all values in table, in the order of the last write
 * @param {*} table
 * @param {*} name
 */
function getSection(table, name) {
    return new Promise(function (resolve, reject) {
        try {
            var safeTable = _ensureValidTable(table);
            var sql = `SELECT name, value::text AS value FROM ${safeTable}`;
            var params = [];
            if (name) {
                sql += ' WHERE name = $1';
                params.push(name);
            }
            sql += ' ORDER BY seq';
            pool.query(sql, params).then(result => resolve(result.rows)).catch(reject);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Delete the values in database table
 * @param {*} section
 */
function deleteSection(section) {
    return new Promise(function (resolve, reject) {
        try {
            var table = _ensureValidTable(section.table);
            pool.query(`DELETE FROM ${table} WHERE name = $1`, [section.name]).then(function () {
                resolve();
            }).catch(reject);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Close the database
 */
function close() {
    _closeReader();
    if (pool) {
        const _pool = pool;
        pool = null;
        _pool.end().catch(err => logger && logger.error(`prjstorage.close failed! ${err}`));
    }
}

/**
 * Clear all table in database (except devicesSecurity)
 */
function clearAll() {
    return new Promise(function (resolve, reject) {
        // multi-statement simple query: one implicit transaction
        var sql = ClearableTables.map(table => `DELETE FROM ${table};`).join('');
        Promise.resolve().then(() => pool.query(sql)).then(() => {
            resolve(true);
        }).catch(err => {
            logger.error(`prjstorage.clear failed! ${err}`);
            reject();
        });
    });
}

/**
 * Export all the tables: { table: [{ name, value }] } with the stored JSON text, in read order
 */
async function exportTables() {
    const data = {};
    for (const table of Object.values(TableType)) {
        data[table] = (await pool.query(`SELECT name, value::text AS value FROM ${table} ORDER BY seq`)).rows;
    }
    return data;
}

/**
 * Replace all the tables (including devicesSecurity) with the exported data, in one transaction
 * If the tables are not empty and options.backup, first copy them to the schema prjstorage_backup_<time>
 * Resolve { backup: schema | null, rows: count }
 * @param {*} data exportTables() of a backend
 * @param {*} options { backup: true }
 */
async function importTables(data, options = {}) {
    const client = await pool.connect();
    let backup = null;
    let rows = 0;
    try {
        await client.query('BEGIN');
        let existing = 0;
        for (const table of Object.values(TableType)) {
            existing += (await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;
        }
        if (existing && options.backup) {
            backup = `prjstorage_backup_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
            await client.query(`CREATE SCHEMA ${backup}`);
            for (const table of Object.values(TableType)) {
                await client.query(`CREATE TABLE ${backup}.${table} AS SELECT * FROM ${table}`);
            }
        }
        for (const table of Object.values(TableType)) {
            await client.query(`DELETE FROM ${table}`);
            for (const row of (data[table] || [])) {
                await client.query(`INSERT INTO ${table} (name, value) VALUES ($1, $2)`, [row.name, row.value]);
                rows++;
            }
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
    return { backup: backup, rows: rows };
}

/**
 * Description of the store, without password (for the logs and the storage marker)
 */
function describe(_settings) {
    const connection = getConnectionOptions(_settings || settings);
    return {
        type: 'postgres', host: connection.options.host, port: connection.options.port,
        database: connection.options.database, user: connection.options.user, schema: connection.schema || ''
    };
}

/**
 * Check a connection (settings.storage.postgres) without changing the backend: SELECT 1
 */
async function testConnection(_settings) {
    const connection = getConnectionOptions(_settings);
    const testPool = new Pool(Object.assign({}, connection.options, { max: 1 }));
    testPool.on('error', () => {});
    try {
        await testPool.query('SELECT 1');
        // a FUXA project already in the database/schema (to use it instead of copying the current one)
        const exist = await testPool.query(`SELECT to_regclass('${TableType.GENERAL}') IS NOT NULL AND to_regclass('${TableType.VIEWS}') IS NOT NULL
            AND to_regclass('${TableType.DEVICES}') IS NOT NULL AS exist`);
        if (!exist.rows[0].exist) {
            return { project: null };
        }
        const counts = await testPool.query(`SELECT (SELECT count(*)::int FROM ${TableType.VIEWS}) AS views,
            (SELECT count(*)::int FROM ${TableType.DEVICES}) AS devices, (SELECT count(*)::int FROM ${TableType.GENERAL}) AS general`);
        const row = counts.rows[0];
        return { project: (row.views || row.devices || row.general) ? { views: row.views, devices: row.devices } : null };
    } finally {
        await testPool.end().catch(() => {});
    }
}

/**
 * Run a read-only query (Repeater 'FUXA Project DB (PostgreSQL)') with the reader login of
 * settings.storage.postgres.reader { user, password, statementTimeout }: its own connection (the query
 * cannot take the privileges of the FUXA login), one statement, READ ONLY transaction, rolled back.
 * Refused when the login can read the project tables (credentials) or is superuser.
 * With tables { <table>: [{ <column>: <value> }] } (the sanitized project) they are created as temporary tables
 * of the transaction, dropped at the end, before the query: column names in lower case (unquoted SQL names
 * match them), types from the values (boolean, double precision, text, else jsonb), id/name text, value jsonb
 */
async function queryAsReader(sql, tables) {
    const reader = settings && settings.storage && settings.storage.postgres && settings.storage.postgres.reader;
    if (!reader || !reader.user) {
        throw new Error('settings.storage.postgres.reader not defined');
    }
    const connection = getConnectionOptions(settings);
    const options = Object.assign({}, connection.options, { user: reader.user, password: reader.password || '', max: 2 });
    const key = JSON.stringify([options.host, options.port, options.database, options.user, options.password, options.options || '']);
    if (!readerPool || readerKey !== key) {
        _closeReader();
        readerPool = new Pool(options);
        readerPool.on('error', (err) => logger && logger.error(`prjstorage.postgres reader pool error: ${err}`));
        readerKey = key;
    }
    const timeout = Number(reader.statementTimeout) || 30000;
    const client = await readerPool.connect();
    try {
        // read-write only for the temporary tables, then read only before the query
        await client.query(tables ? 'BEGIN' : 'BEGIN READ ONLY');
        await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeout)}`);
        const check = await client.query(READER_CHECK_SQL, [PROJECT_TABLE_NAMES, UNSAFE_ROLES]);
        if (check.rows[0].unsafe) {
            throw new Error(`the reader login '${reader.user}' can read the FUXA project tables or is a superuser, ` +
                'use a login with SELECT only on your own tables (see docs/storage-migration.md)');
        }
        if (tables) {
            for (const table of Object.keys(tables)) {
                await _createTempTable(client, table, tables[table] || []);
            }
            await client.query('SET TRANSACTION READ ONLY');
        }
        // extended protocol: a single statement (no 'COMMIT; ...')
        const result = await client.query({ text: sql, queryMode: 'extended' });
        return result.rows;
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
    }
}

function _pgType(values) {
    const set = values.filter(v => v !== null && v !== undefined);
    if (set.length && set.every(v => typeof v === 'boolean')) {
        return 'boolean';
    }
    if (set.length && set.every(v => typeof v === 'number' && isFinite(v))) {
        return 'double precision';
    }
    if (set.every(v => typeof v === 'string')) {
        return 'text';
    }
    return 'jsonb';
}

/**
 * Temporary table (dropped at the end of the transaction) with the rows, filled with one jsonb parameter
 */
async function _createTempTable(client, table, rows) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
        return;
    }
    const columns = new Map();      // lower case name -> row key
    ['id', 'name', 'value'].forEach(key => columns.set(key, key));
    rows.forEach(row => Object.keys(row || {}).forEach(key => {
        const lower = key.toLowerCase();
        if (/^[a-z_][a-z0-9_]*$/.test(lower) && !columns.has(lower)) {
            columns.set(lower, key);
        }
    }));
    const defs = [];
    columns.forEach((key, column) => {
        const type = (column === 'id' || column === 'name') ? 'text' : (column === 'value') ? 'jsonb' : _pgType(rows.map(row => row[key]));
        defs.push(`"${column}" ${type}`);
    });
    const name = table.toLowerCase();
    await client.query(`CREATE TEMP TABLE "${name}" (${defs.join(', ')}) ON COMMIT DROP`);
    if (!rows.length) {
        return;
    }
    const records = rows.map(row => {
        const record = {};
        columns.forEach((key, column) => record[column] = (row[key] === undefined) ? null : row[key]);
        return record;
    });
    await client.query(`INSERT INTO "${name}" SELECT * FROM jsonb_populate_recordset(NULL::"${name}", $1::jsonb)`, [JSON.stringify(records)]);
}

function _closeReader() {
    if (readerPool) {
        const _pool = readerPool;
        readerPool = null;
        readerKey = null;
        _pool.end().catch(() => {});
    }
}

module.exports = {
    init: init,
    close: close,
    clearAll: clearAll,
    getSection: getSection,
    setSections: setSections,
    setSection: setSection,
    deleteSection: deleteSection,
    setDefault: setDefault,
    TableType: TableType,
    exportTables: exportTables,
    importTables: importTables,
    describe: describe,
    testConnection: testConnection,
    queryAsReader: queryAsReader,
    // for the migration tool
    getConnectionOptions: getConnectionOptions,
    SCHEMA_FILE: SCHEMA_FILE,
};
