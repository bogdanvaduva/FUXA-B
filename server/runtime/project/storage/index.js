/**
 *  Factory of the project storage backend, selected by settings.storage.type (default 'sqlite')
 *  All the backends implement the contract described in interface.md
 */

'use strict';

const SqliteStorage = require('./sqlite');
const PostgresStorage = require('./postgres');

const StorageTypeEnum = {
    sqlite: 'sqlite',
    postgres: 'postgres',
};

function getStorageType(settings) {
    return (settings && settings.storage && settings.storage.type) || StorageTypeEnum.sqlite;
}

function getStorage(settings) {
    const type = getStorageType(settings);
    switch (type) {
        case StorageTypeEnum.sqlite:
            return SqliteStorage;
        case StorageTypeEnum.postgres:
            return PostgresStorage;
        default:
            throw new Error(`Unknown project storage type '${type}' (settings.storage.type)`);
    }
}

module.exports = {
    getStorage: getStorage,
    getStorageType: getStorageType,
    StorageTypeEnum: StorageTypeEnum,
};
