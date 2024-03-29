/**
 * Module to manage the DAQ with PostgreSQL
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

    var postgresError = { error: null, timestamp: 0 };
    var client = null;
    var clientOptions = null;
    var fncGetTagProp = null;

    this.init = async function (){
        if (settings.daqstore.credentials) {
            try {
                const parsedUrl = new URL(settings.daqstore.url);
                const [host] = parsedUrl.host.split(':');

                clientOptions = { 
                    user: settings.daqstore.credentials.username,
                    database: settings.daqstore.database,
                    schema: settings.daqstore.schema || "",
                    password: settings.daqstore.credentials.password,
                    port: parsedUrl.port,
                    host: host};
            } catch (error) {
                logger.error(`postgresql-init failed! ${error}`);
                reject(error);
            }
            client =  new Pool(clientOptions);
            await client.connect(); 
            client.query("CREATE TABLE if not exists " + (clientOptions.schema === "" ? "": clientOptions.schema + ".") + "data(id serial PRIMARY KEY, tagId text, tagName text, deviceId text, deviceName text, value text, dt numeric, time timestamp);",
                (err, res) => {
                    if (err) {
                        logger.error(`postgresql-init failed! ${err}`);
                    } else {
                        logger.info(`postgresql-init succesfull! ${JSON.stringify(res)}`);
                    }
                });

            status = PostgreSQLStatusEnum.OPEN;
        }
    };

    this.close = function () {
        try {
            status = PostgreSQLStatusEnum.CLOSE;
            client.end().then(() => {
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
        var dataToRestore = [];
        for (var tagid in tagsValues) {
            let tag = tagsValues[tagid];
            if (!tag.daq || utils.isNullOrUndefined(tag.value) || Number.isNaN(tag.value)) {
                if (tag.daq.restored) {
                    dataToRestore.push({ id: tag.id, deviceId: deviceId, value: tag.value });
                }
                if (!tag.daq.enabled) {
                    continue;
                }
            }
            const tags = {
                id: tag.id,
                devicename: deviceName,
                timestamp: tag.timestamp || new Date().getTime()
            };
            const fields = {
                value: utils.isBoolean(tag.value) ? tag.value * 1 : tag.value
            };
            const text = "INSERT INTO " + (clientOptions.schema === "" ? "": clientOptions.schema + ".") + "data (tagId, tagName, deviceId, deviceName, value, dt, time) VALUES ('" 
                +  tags.id + "','" +  (tag.tagref ? tag.tagref.name : tag.name) + "','" +  deviceId + "','" +  tags.devicename + "','" +  fields.value + "'," + tags.timestamp + ", CURRENT_TIMESTAMP);";
            client.query(text, (err, res) => {
                if (err) {
                    console.log(err, res);
                }
            });
        }
    };

    this.getDaqMap = function (tagid) {
        var dummy = {};
        dummy[tagid] = true;
        return dummy;
    };

    this.getDaqValue = function (tagid, fromts, tots) {
        return new Promise(function (resolve, reject) {
            try {
                fromts *= 1000000;
                tots *= 1000000;
                const query = `SELECT * FROM ` + (clientOptions.schema === "" ? "": clientOptions.schema + ".") + `data WHERE tagId = '${tagid}' WHERE time >= ${fromts} AND time <= ${tots}`;
                client.query(query).then((result) => {
                    resolve(result.map(row => {
                        return {
                            dt: new Date(row.time).getTime(),
                            value: row.value
                        };
                    }));
                }).catch((error) => {
                        logger.error(`postgres-getDaqValue failed! ${error}`);
                        reject(error);
                    });
            } catch (error) {
                logger.error(`postgres-getDaqValue failed! ${error}`);
                reject(error);
            }
        });
    };

    function setError(error) {
        postgresError.error = error;
        postgresError.timestamp = new Date().getTime();
    }

    this.init();
};


module.exports = {
    create: function (data, logger, currentStorate) {
        return new PostgreSQL(data, logger, currentStorate);
    }
};

var PostgreSQLStatusEnum = {
    OPEN: 'open',
    CLOSE: 'close',
}