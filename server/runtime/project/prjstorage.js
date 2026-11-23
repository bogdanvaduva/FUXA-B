/**
 *  Project datastore: forwards to the storage backend selected by settings.storage.type
 *  (default 'sqlite', see storage/index.js and storage/interface.md)
 *  Table: 'general', 'views', 'devices', 'devicesSecurity', 'texts', 'alarms', 'recipes', 'notifications', 'scripts', 'reports', 'locations', 'arMarkers'
 */

'use strict';

const storage = require('./storage');
const { TableType } = require('./storage/tables');

var backend = storage.getStorage();     // sqlite until init selects the configured backend

/**
 * Select the backend from settings, init and bind the database resource
 * Resolve true if the project store already exists
 * @param {*} _settings
 * @param {*} _log
 */
function init(_settings, _log) {
    try {
        backend = storage.getStorage(_settings);
    } catch (err) {
        return Promise.reject(err);
    }
    return backend.init(_settings, _log);
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
    TableType: TableType,
};
