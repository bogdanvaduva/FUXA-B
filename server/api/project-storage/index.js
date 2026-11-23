/**
 * 'api/project-storage': project storage (SQLite / PostgreSQL) for the editor settings, admin only
 *  GET  /api/project-storage         storage in use and settings (without password)
 *  POST /api/project-storage/test    check a PostgreSQL connection
 *  POST /api/project-storage/switch  copy the project to the other storage (its content backed up), use it,
 *                                    save storage in mysettings.json and reload the project
 */

'use strict';

const fs = require('fs');
const express = require('express');
const authJwt = require('../jwt-helper');
const prjstorage = require('../../runtime/project/prjstorage');

var runtime;
var secureFnc;
var checkGroupsFnc;
var switching = false;

const POSTGRES_FIELDS = ['host', 'port', 'database', 'user', 'password', 'ssl', 'maxPoolSize', 'schema', 'connectionTimeout'];

/**
 * Storage block from the request: type and the known PostgreSQL fields,
 * an empty password keeps the saved one (the client never receives it)
 */
function storageFromRequest(body) {
    const type = body && body.type;
    if (type !== 'sqlite' && type !== 'postgres') {
        throw new Error("type must be 'sqlite' or 'postgres'");
    }
    const current = (runtime.settings.storage && runtime.settings.storage.postgres) || {};
    const postgres = Object.assign({}, current);
    const requested = (body && body.postgres) || {};
    POSTGRES_FIELDS.forEach(field => {
        if (requested[field] !== undefined && requested[field] !== null && requested[field] !== '') {
            postgres[field] = requested[field];
        } else if (field !== 'password' && requested[field] === '') {
            delete postgres[field];
        }
    });
    if (postgres.port !== undefined) {
        postgres.port = Number(postgres.port);
    }
    if (postgres.maxPoolSize !== undefined) {
        postgres.maxPoolSize = Number(postgres.maxPoolSize);
    }
    postgres.ssl = !!(requested.ssl !== undefined ? requested.ssl : postgres.ssl);
    return { type: type, postgres: postgres };
}

function publicStorage(storage) {
    const postgres = Object.assign({}, (storage && storage.postgres) || {});
    const passwordSet = !!postgres.password;
    delete postgres.password;
    return { type: (storage && storage.type) || 'sqlite', postgres: Object.assign(postgres, { passwordSet: passwordSet }) };
}

/**
 * Save the storage block in mysettings.json (read at start, overrides settings.js)
 */
function persistStorage(storage) {
    const file = runtime.settings.userSettingsFile;
    if (!file) {
        return;
    }
    let mysettings = {};
    if (fs.existsSync(file)) {
        mysettings = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    mysettings.storage = storage;
    fs.writeFileSync(file, JSON.stringify(mysettings, null, 4));
}

function checkAdmin(req, res, name) {
    const permission = checkGroupsFnc(req);
    if (res.statusCode === 403) {
        runtime.logger.error(`api ${name}: Tocken Expired`);
        return false;
    }
    if (!authJwt.haveAdminPermission(permission)) {
        res.status(401).json({ error: 'unauthorized_error', message: 'Unauthorized!' });
        runtime.logger.error(`api ${name}: Unauthorized`);
        return false;
    }
    return true;
}

module.exports = {
    init: function (_runtime, _secureFnc, _checkGroupsFnc) {
        runtime = _runtime;
        secureFnc = _secureFnc;
        checkGroupsFnc = _checkGroupsFnc;
    },
    persistStorage: persistStorage,
    app: function () {
        var storageApp = express();
        storageApp.use(function (req, res, next) {
            if (!runtime.project) {
                res.status(404).end();
            } else {
                next();
            }
        });

        storageApp.get('/api/project-storage', secureFnc, function (req, res) {
            if (!checkAdmin(req, res, 'get project-storage')) {
                return;
            }
            res.json({ current: prjstorage.getCurrent(), settings: publicStorage(runtime.settings.storage), switching: switching });
        });

        storageApp.post('/api/project-storage/test', secureFnc, async function (req, res) {
            if (!checkAdmin(req, res, 'post project-storage/test')) {
                return;
            }
            try {
                const storage = storageFromRequest(req.body);
                await prjstorage.testConnection(Object.assign({}, runtime.settings, { storage: storage }));
                res.json({ ok: true });
            } catch (err) {
                res.status(400).json({ error: 'connection_failed', message: err.message });
            }
        });

        storageApp.post('/api/project-storage/switch', secureFnc, async function (req, res) {
            if (!checkAdmin(req, res, 'post project-storage/switch')) {
                return;
            }
            if (switching) {
                return res.status(409).json({ error: 'switch_in_progress', message: 'A storage switch is already running' });
            }
            switching = true;
            try {
                const storage = storageFromRequest(req.body);
                const newSettings = Object.assign({}, runtime.settings, { storage: storage });
                const result = await prjstorage.switchTo(newSettings);
                runtime.settings.storage = storage;
                persistStorage(storage);
                runtime.logger.info(`api project-storage/switch: ${result.from.type} -> ${result.to.type} by ${req.userId || 'unknown'}`, true);
                await runtime.restart(true);
                res.json({ ok: true, from: result.from, to: result.to, rows: result.rows, backup: result.backup });
            } catch (err) {
                runtime.logger.error(`api project-storage/switch failed: ${err.message}`);
                res.status(400).json({ error: 'switch_failed', message: err.message });
            } finally {
                switching = false;
            }
        });

        return storageApp;
    }
};
