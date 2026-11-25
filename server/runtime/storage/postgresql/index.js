/**
 * Module to manage the DAQ with PostgreSQL
 * The values are saved in the table 'data' (in the configured schema):
 * tagId, tagName, deviceId, deviceName, value (text), dt (timestamp in ms), time (insert time)
 */

"use strict";

var utils = require('../../utils');
const { Pool } = require('pg');
const { URL } = require('url');

function PostgreSQL(_settings, _log, _currentStorate) {
    var settings = _settings; // Application settings
    var logger = _log; // Application logger
    var currentStorage = _currentStorate; // Database to set the last value (current)
    var status = PostgreSQLStatusEnum.CLOSE;

    var client = null;
    var tableName = 'data';
    var fncGetTagProp = null;

    this.init = async function () {
        if (!settings.daqstore.credentials) {
            logger.error('postgresql-init failed! credentials missing');
            return;
        }
        try {
            const parsedUrl = new URL(settings.daqstore.url);
            const schema = settings.daqstore.schema || '';
            if (schema && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
                throw new Error(`schema name '${schema}' not valid (letters, digits and _ only)`);
            }
            tableName = schema ? `"${schema}".data` : 'data';
            client = new Pool({
                user: settings.daqstore.credentials.username,
                password: settings.daqstore.credentials.password,
                database: settings.daqstore.database,
                host: parsedUrl.hostname,
                port: parsedUrl.port || 5432,
            });
            client.on('error', (err) => logger.error(`postgresql-pool error: ${err}`));
            if (schema) {
                // as the project storage: the schema is created if missing
                await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
            }
            await client.query(`CREATE TABLE IF NOT EXISTS ${tableName} (id serial PRIMARY KEY, tagId text, tagName text, deviceId text, deviceName text, value text, dt numeric, time timestamp);`);
            await client.query(`CREATE INDEX IF NOT EXISTS data_tagid_dt_idx ON ${tableName} (tagId, dt);`);
            status = PostgreSQLStatusEnum.OPEN;
            logger.info('postgresql-init successful!');
        } catch (error) {
            logger.error(`postgresql-init failed! ${error}`);
        }
    };

    this.close = function () {
        try {
            status = PostgreSQLStatusEnum.CLOSE;
            client?.end().then(() => {
                logger.info('postgresql-close FINISHED');
            }).catch((e) => {
                logger.error(`postgresql-close failed! ${e}`);
            });
        } catch (error) {
            logger.error(`postgresql-close failed! ${error}`);
        }
    };

    this.setCall = function (_fncGetProp) {
        fncGetTagProp = _fncGetProp;
        return this.addDaqValues;
    };

    this.addDaqValue = function (tagId, tagValue) {
        logger.error('postgresql-addDaqValue Not supported!');
    };

    this.addDaqValues = function (tagsValues, deviceName, deviceId) {
        const rows = [];
        const dataToRestore = [];
        for (var tagid in tagsValues) {
            const tag = tagsValues[tagid];
            if (!tag.daq) {
                continue;
            }
            if (tag.daq.restored) {
                dataToRestore.push({ id: tag.id, deviceId: deviceId, value: tag.value });
            }
            if (!tag.daq.enabled || utils.isNullOrUndefined(tag.value) || Number.isNaN(tag.value)) {
                continue;
            }
            const value = utils.isBoolean(tag.value) ? tag.value * 1 : tag.value;
            rows.push([
                tag.id,
                tag.tagref?.name || utils.getTagName(tag) || null,
                deviceId,
                deviceName,
                typeof value === 'object' ? JSON.stringify(value) : String(value),
                tag.timestamp || new Date().getTime()
            ]);
        }
        if (rows.length && client && status === PostgreSQLStatusEnum.OPEN) {
            // one statement with parameters for all the values: ($1,$2,...,$6, CURRENT_TIMESTAMP),(...)
            const params = [];
            const values = rows.map(row => {
                const first = params.length + 1;
                params.push(...row);
                return `($${first}, $${first + 1}, $${first + 2}, $${first + 3}, $${first + 4}, $${first + 5}, CURRENT_TIMESTAMP)`;
            });
            client.query(`INSERT INTO ${tableName} (tagId, tagName, deviceId, deviceName, value, dt, time) VALUES ${values.join(', ')}`, params)
                .catch(err => logger.error(`postgresql-addDaqValues failed! ${err}`));
        }
        if (dataToRestore.length && currentStorage) {
            currentStorage.setValues(dataToRestore);
        }
    };

    /**
     * Run a SQL query in a read-only transaction, the extended protocol allows a single statement only
     */
    this.query = async function (sql) {
        if (!client || status !== PostgreSQLStatusEnum.OPEN) {
            throw new Error('PostgreSQL is not connected');
        }
        const conn = await client.connect();
        try {
            await conn.query('BEGIN READ ONLY');
            const result = await conn.query({ text: sql, queryMode: 'extended' });
            return result.rows;
        } finally {
            await conn.query('ROLLBACK').catch(() => {});
            conn.release();
        }
    };

    this.getDaqMap = function (tagid) {
        var dummy = {};
        dummy[tagid] = true;
        return dummy;
    };

    /**
     * Values of the tag between the timestamps (ms), numeric texts returned as numbers
     */
    this.getDaqValue = function (tagid, fromts, tots) {
        if (!client || status !== PostgreSQLStatusEnum.OPEN) {
            return Promise.reject(new Error('PostgreSQL is not connected'));
        }
        return client.query(`SELECT value, dt FROM ${tableName} WHERE tagId = $1 AND dt >= $2 AND dt <= $3 ORDER BY dt ASC`,
            [tagid, fromts, tots]).then(result => result.rows.map(row => {
                const number = Number(row.value);
                return {
                    dt: Number(row.dt),
                    value: (row.value !== null && row.value !== '' && !Number.isNaN(number)) ? number : row.value
                };
            })).catch(error => {
                logger.error(`postgresql-getDaqValue failed! ${error}`);
                throw error;
            });
    };

    this.init();
}

module.exports = {
    create: function (data, logger, currentStorate) {
        return new PostgreSQL(data, logger, currentStorate);
    }
};

var PostgreSQLStatusEnum = {
    OPEN: 'open',
    CLOSE: 'close',
};
