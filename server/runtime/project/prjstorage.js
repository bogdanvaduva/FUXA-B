/**
 *  Project datastore: forwards to the storage backend selected by settings.storage.type
 *  (default 'sqlite', see storage/index.js and storage/interface.md)
 *  Table: 'general', 'views', 'devices', 'devicesSecurity', 'texts', 'alarms', 'recipes', 'notifications', 'scripts', 'reports', 'locations', 'arMarkers'
 *
 *  Switch between SQLite and PostgreSQL: the project is copied to the new storage (its previous content is
 *  backed up), live with switchTo() or at start when settings.storage.type differs from the storage of the
 *  last run (marker file <workDir>/prjstorage.json, the storage that holds the current project).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const { TableType } = require('./storage/tables');

const MARKER_FILE = 'prjstorage.json';

var backend = storage.getStorage();     // sqlite until init selects the configured backend
var currentSettings;
var logger;

function _markerFile(settings) {
    return path.join(settings.workDir, MARKER_FILE);
}

function _readMarker(settings) {
    try {
        const file = _markerFile(settings);
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    } catch (err) {
        logger && logger.warn(`prjstorage.marker unreadable: ${err.message}`);
        return null;
    }
}

function _writeMarker(settings, _backend) {
    try {
        const marker = Object.assign(_backend.describe(settings), { updated: new Date().toISOString() });
        fs.writeFileSync(_markerFile(settings), JSON.stringify(marker, null, 2));
    } catch (err) {
        logger && logger.warn(`prjstorage.marker write failed: ${err.message}`);
    }
}

function _sameStore(a, b) {
    if (!a || !b || a.type !== b.type) {
        return false;
    }
    if (a.type === 'postgres') {
        return a.host === b.host && Number(a.port) === Number(b.port) && a.database === b.database && (a.schema || '') === (b.schema || '');
    }
    return true;
}

function _countRows(data) {
    return Object.keys(data).reduce((count, table) => count + data[table].length, 0);
}

function _describeText(description) {
    return description.type === 'postgres'
        ? `PostgreSQL ${description.user}@${description.host}:${description.port}/${description.database}${description.schema ? ' schema ' + description.schema : ''}`
        : `SQLite ${description.file}`;
}

/**
 * Settings of the storage described by the marker (the previous one), null if it cannot be opened
 * (PostgreSQL: only if settings.storage.postgres still points to it, the marker has no password)
 */
function _previousSettings(settings, marker) {
    if (marker.type === 'sqlite') {
        return Object.assign({}, settings, { storage: { type: 'sqlite' } });
    }
    const candidate = Object.assign({}, settings, { storage: Object.assign({}, settings.storage, { type: 'postgres' }) });
    try {
        if (_sameStore(storage.getStorage(candidate).describe(candidate), marker)) {
            return candidate;
        }
    } catch (err) {
        // not valid
    }
    return null;
}

/**
 * Copy all the tables from a backend to another (target content backed up first)
 */
async function _copy(from, to) {
    const data = await from.exportTables();
    const result = await to.importTables(data, { backup: true });
    return { rows: _countRows(data), backup: result.backup };
}

/**
 * Select the backend from settings, init and bind the database resource
 * Copy the project if the storage type changed since the last run
 * Resolve true if the project store already exists
 * @param {*} _settings
 * @param {*} _log
 */
async function init(_settings, _log) {
    logger = _log;
    currentSettings = _settings;
    const target = storage.getStorage(_settings);
    const marker = _readMarker(_settings);
    const targetDescription = (() => { try { return target.describe(_settings); } catch (err) { return null; } })();

    if (marker && targetDescription && !_sameStore(marker, targetDescription)) {
        if (marker.type === targetDescription.type) {
            // same backend type, other server/database: nothing to copy from (one connection per backend)
            logger.warn(`prjstorage: the ${marker.type} connection changed since the last run, the project is not copied (${_describeText(marker)} -> ${_describeText(targetDescription)})`);
        } else {
            return _initWithCopy(_settings, target, marker, targetDescription);
        }
    }

    backend = target;
    const existed = await backend.init(_settings, _log);
    if (!marker && !_isSqlite(targetDescription)) {
        // first start with this marker: an existing SQLite project and an empty new storage, copy it
        const copied = await _copyLegacySqlite(_settings);
        if (copied) {
            _writeMarker(_settings, backend);
            return true;
        }
    }
    _writeMarker(_settings, backend);
    return existed;
}

function _isSqlite(description) {
    return !description || description.type === 'sqlite';
}

/**
 * Start: the storage type changed (settings edited by hand), copy from the previous storage
 * On failure keep running on the previous storage (it holds the current project)
 */
async function _initWithCopy(_settings, target, marker, targetDescription) {
    const previousSettings = _previousSettings(_settings, marker);
    if (!previousSettings) {
        logger.error(`prjstorage: the project storage changed to ${_describeText(targetDescription)} but the previous ${_describeText(marker)} is not configured any more (storage.postgres), the project is not copied`);
        backend = target;
        const existed = await backend.init(_settings, logger);
        _writeMarker(_settings, backend);
        return existed;
    }
    const previous = storage.getStorage(previousSettings);
    await previous.init(previousSettings, logger);
    try {
        await target.init(_settings, logger);
        const result = await _copy(previous, target);
        previous.close();
        backend = target;
        _writeMarker(_settings, backend);
        logger.info(`prjstorage: project copied from ${_describeText(marker)} to ${_describeText(targetDescription)}: ${result.rows} rows` +
            (result.backup ? `, previous content saved in ${result.backup}` : ''), true);
        return true;
    } catch (err) {
        try { target.close(); } catch (_) {}
        backend = previous;
        currentSettings = previousSettings;
        logger.error(`prjstorage: copy of the project to ${_describeText(targetDescription)} failed, FUXA keeps using ${_describeText(marker)}: ${err && err.message ? err.message : err}`);
        return true;
    }
}

/**
 * Start without marker (installation before this version) on PostgreSQL: copy project.fuxap.db if
 * it has a project and PostgreSQL is empty
 */
async function _copyLegacySqlite(_settings) {
    const sqliteSettings = Object.assign({}, _settings, { storage: { type: 'sqlite' } });
    const sqliteBackend = storage.getStorage(sqliteSettings);
    if (sqliteBackend === backend || !fs.existsSync(sqliteBackend.describe(sqliteSettings).file)) {
        return false;
    }
    if (_countRows(await backend.exportTables())) {
        return false;
    }
    try {
        await sqliteBackend.init(sqliteSettings, logger);
        const result = await _copy(sqliteBackend, backend);
        logger.info(`prjstorage: project copied from ${_describeText(sqliteBackend.describe(sqliteSettings))} to ${_describeText(backend.describe(_settings))}: ${result.rows} rows`, true);
        return result.rows > 0;
    } finally {
        sqliteBackend.close();
    }
}

/**
 * Switch the live project storage: copy the current project to the storage of _settings
 * (its content backed up first), then use it. On error the current storage is kept.
 * The caller persists the settings and reloads the project.
 * Resolve { from, to, rows, backup }
 * @param {*} _settings application settings with the new storage block
 */
async function switchTo(_settings) {
    const target = storage.getStorage(_settings);
    if (target === backend) {
        throw new Error('the project already uses this storage type, switch between sqlite and postgres');
    }
    const from = backend.describe(currentSettings);
    const to = target.describe(_settings);
    try {
        await target.init(_settings, logger);
    } catch (err) {
        throw new Error(`cannot open ${_describeText(to)}: ${err && err.message ? err.message : 'init failed'}`);
    }
    let result;
    try {
        result = await _copy(backend, target);
    } catch (err) {
        try { target.close(); } catch (_) {}
        throw new Error(`copy of the project to ${_describeText(to)} failed: ${err.message}`);
    }
    const previous = backend;
    backend = target;
    currentSettings = _settings;
    previous.close();
    _writeMarker(_settings, backend);
    logger.info(`prjstorage: project storage switched from ${_describeText(from)} to ${_describeText(to)}: ${result.rows} rows` +
        (result.backup ? `, previous content saved in ${result.backup}` : ''), true);
    return { from: from, to: to, rows: result.rows, backup: result.backup };
}

/**
 * Check the connection of a storage block without changing anything
 * @param {*} _settings application settings with the storage block to test
 */
async function testConnection(_settings) {
    const target = storage.getStorage(_settings);
    if (target.testConnection) {
        await target.testConnection(_settings);
    }
}

/**
 * Description (without password) of the storage in use
 */
function getCurrent() {
    return currentSettings ? backend.describe(currentSettings) : null;
}

module.exports = {
    init: init,
    close: () => backend.close(),
    clearAll: () => backend.clearAll(),
    getSection: (table, name) => backend.getSection(table, name),
    setSections: (sections) => backend.setSections(sections),
    setSection: (section) => backend.setSection(section),
    deleteSection: (section) => backend.deleteSection(section),
    setDefault: () => backend.setDefault(),
    switchTo: switchTo,
    testConnection: testConnection,
    getCurrent: getCurrent,
    // Repeater 'FUXA Project DB (PostgreSQL)': read-only query with the reader login (PostgreSQL storage only)
    queryAsReader: (sql, tables) => backend && backend.queryAsReader ? backend.queryAsReader(sql, tables)
        : Promise.reject(new Error('the project storage is not PostgreSQL')),
    TableType: TableType,
};
