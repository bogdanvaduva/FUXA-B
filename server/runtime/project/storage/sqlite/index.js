/**
 *  Project storage backend: SQLite (default), file <workDir>/project.fuxap.db
 *  Table: 'general', 'views', 'devices', 'chart', 'texts', 'alarms', 'recipes', 'notifications', 'scripts', 'reports', 'locations', 'arMarkers'
 *  Contract: ../interface.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
var sqlite3 = require('sqlite3').verbose();
const { TableType } = require('../tables');

var settings        // Application settings
var logger;         // Application logger
var db_prj;         // Database of project

function _run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db_prj.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

function _all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db_prj.all(sql, params, function (err, rows) {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

function _ensureValidTable(table) {
    const tables = Object.values(TableType);
    if (!tables.includes(table)) {
        throw new Error(`invalid table '${table}'`);
    }
    return table;
}

/**
 * Init and bind the database resource
 * @param {*} _settings
 * @param {*} _log
 */
function init(_settings, _log) {
    settings = _settings;
    logger = _log;

    return _bind();
}

/**
 * Bind the database resource by create the table if not exist
 */
function _bind() {
    return new Promise(function (resolve, reject) {
        var dbfile = path.join(settings.workDir, 'project.fuxap.db');
        var dbfileExist = fs.existsSync(dbfile);
        db_prj = new sqlite3.Database(dbfile, function (err) {
            if (err) {
                logger.error(`prjstorage.bind failed! ${err}`);
                reject();
            }
            logger.info(`prjstorage.connected-to ${dbfile} database`, true);
        });
        // prepare query
        var sql = "CREATE TABLE if not exists general (name TEXT PRIMARY KEY, value TEXT);";
        sql += "CREATE TABLE if not exists views (name TEXT PRIMARY KEY, value TEXT);";
        sql += "CREATE TABLE if not exists devices (name TEXT PRIMARY KEY, value TEXT, connection TEXT, cntid TEXT, cntpwd TEXT);";
        sql += "CREATE TABLE if not exists devicesSecurity (name TEXT PRIMARY KEY, value TEXT);";
        sql += "CREATE TABLE if not exists texts (name TEXT PRIMARY KEY, value TEXT);";
        sql += "CREATE TABLE if not exists alarms (name TEXT PRIMARY KEY, value TEXT);";
        sql += "CREATE TABLE if not exists recipes (name TEXT PRIMARY KEY, value TEXT);";
        sql += "CREATE TABLE if not exists notifications (name TEXT PRIMARY KEY, value TEXT);";
        sql += "CREATE TABLE if not exists scripts (name TEXT PRIMARY KEY, value TEXT);";
        sql += "CREATE TABLE if not exists reports (name TEXT PRIMARY KEY, value TEXT);";
        sql += "CREATE TABLE if not exists locations (name TEXT PRIMARY KEY, value TEXT);";
        sql += "CREATE TABLE if not exists arMarkers (name TEXT PRIMARY KEY, value TEXT);";
        db_prj.exec(sql, function (err) {
            if (err) {
                logger.error(`prjstorage.bind failed! ${err}`);
                reject();
            } else {
                resolve(dbfileExist);
            }
        });
    });
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
 * The section contains the name of table, name(key) and value
 * @param {*} sections
 */
function setSections(sections) {
    return new Promise(async function (resolve, reject) {
        try {
            await _run('BEGIN TRANSACTION');
            for (var i = 0; i < sections.length; i++) {
                var table = _ensureValidTable(sections[i].table);
                var value = JSON.stringify(sections[i].value);
                await _run(`INSERT OR REPLACE INTO ${table} (name, value) VALUES(?, ?)`, [sections[i].name, value]);
            }
            await _run('COMMIT');
            resolve();
        } catch (err) {
            try {
                await _run('ROLLBACK');
            } catch (_) {}
            logger.error(`prjstorage.set failed! ${err}`);
            reject();
        }
    });
}

/**
 * Insert the values in database table, if exist replace the value of name(key)
 * The section contains the name of table, name(key) and value
 * @param {*} section
 */
function setSection(section) {
    return new Promise(function (resolve, reject) {
        try {
            var table = _ensureValidTable(section.table);
            var value = JSON.stringify(section.value);
            _run(`INSERT OR REPLACE INTO ${table} (name, value) VALUES(?, ?)`, [section.name, value]).then(function () {
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
 * Return all values of table with this name
 * If name is null return all values in table
 * @param {*} table
 * @param {*} name
 */
function getSection(table, name) {
    return new Promise(function (resolve, reject) {
        try {
            var safeTable = _ensureValidTable(table);
            var sql = `SELECT name, value FROM ${safeTable}`;
            var params = [];
            if (name) {
                sql += " WHERE name = ?";
                params.push(name);
            }
            _all(sql, params).then(resolve).catch(reject);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Delete the values in database table
 * The section contains the name of table, name(key)
 * @param {*} section
 */
function deleteSection(section) {
    return new Promise(function (resolve, reject) {
        try {
            var table = _ensureValidTable(section.table);
            _run(`DELETE FROM ${table} WHERE name = ?`, [section.name]).then(function () {
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
    if (db_prj) {
        db_prj.close();
    }
}

/**
 * Clear all table in database
 */
function clearAll() {
    return new Promise(function (resolve, reject) {
        // prepare query
        var sql = "DELETE FROM general;";
        sql += "DELETE FROM views;";
        sql += "DELETE FROM devices;";
        sql += "DELETE FROM texts;";
        sql += "DELETE FROM alarms;";
        sql += "DELETE FROM recipes;";
        sql += "DELETE FROM notifications;";
        sql += "DELETE FROM scripts;";
        sql += "DELETE FROM reports;";
        sql += "DELETE FROM locations;";
        sql += "DELETE FROM arMarkers;";
        db_prj.exec(sql, function (err) {
            if (err) {
                logger.error(`prjstorage.clear failed! ${err}`);
                reject();
            } else {
                resolve(true);
            }
        });
    });
}

/**
 * Export all the tables: { table: [{ name, value }] } with the stored JSON text, in read order
 */
async function exportTables() {
    const data = {};
    for (const table of Object.values(TableType)) {
        data[table] = await _all(`SELECT name, value FROM ${table} ORDER BY rowid`);
    }
    return data;
}

/**
 * Replace all the tables (including devicesSecurity) with the exported data, in one transaction
 * If the tables are not empty and options.backup, first copy the database to project.fuxap.backup-<time>.db
 * Resolve { backup: file | null, rows: count }
 * @param {*} data exportTables() of a backend
 * @param {*} options { backup: true }
 */
async function importTables(data, options = {}) {
    let existing = 0;
    for (const table of Object.values(TableType)) {
        existing += (await _all(`SELECT count(*) AS count FROM ${table}`))[0].count;
    }
    let backup = null;
    if (existing && options.backup) {
        backup = path.join(settings.workDir, `project.fuxap.backup-${_timestamp()}.db`);
        await _run('VACUUM INTO ?', [backup]);
    }
    let rows = 0;
    try {
        await _run('BEGIN TRANSACTION');
        for (const table of Object.values(TableType)) {
            await _run(`DELETE FROM ${table}`);
            for (const row of (data[table] || [])) {
                await _run(`INSERT INTO ${table} (name, value) VALUES(?, ?)`, [row.name, row.value]);
                rows++;
            }
        }
        await _run('COMMIT');
    } catch (err) {
        try {
            await _run('ROLLBACK');
        } catch (_) {}
        throw err;
    }
    return { backup: backup, rows: rows };
}

function _timestamp() {
    return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/**
 * Description of the store (for the logs and the storage marker)
 */
function describe(_settings) {
    return { type: 'sqlite', file: path.join((_settings || settings).workDir, 'project.fuxap.db') };
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
};
