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
    // for the migration tool
    getConnectionOptions: getConnectionOptions,
    SCHEMA_FILE: SCHEMA_FILE,
};
