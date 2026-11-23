/**
 * 'FuxaRemote': another FUXA server as device (horizontal scaling)
 * The remote FUXA runs its own devices, this driver mirrors the chosen remote tags
 * tag.address = remote tag id, tag.memaddress = remote device id
 * Remote API: POST /api/remote/values, POST /api/setTagValue, GET /api/remote/browse (x-api-key header)
 */
'use strict';
const http = require('http');
const https = require('https');
const axios = require('axios');
const utils = require('../../utils');
const deviceUtils = require('../device-utils');

const CONNECT_ATTEMPT_TIMEOUT = 2000;
const DEFAULT_TIMEOUT = 5000;
const MAX_FAILED_POLLING = 3;           // polling errors in a row before the reconnection
const LEGACY_IDS_PER_REQUEST = 100;     // tags per GET /api/getTagValue for remote FUXA without /api/remote/values

function FuxaRemote(_data, _logger, _events, _runtime) {
    var runtime = _runtime;
    var data = JSON.parse(JSON.stringify(_data));   // Current Device data { id, name, tags, enabled, ... }
    var logger = _logger;
    var events = _events;               // Events to commit change to runtime
    var working = false;                // Working flag to manage overloading polling and connection
    var overloading = 0;                // Overloading counter
    var connected = false;
    var lastStatus = '';
    var varsValue = {};                 // Tags values { id: { id, value, type, daq, changed, timestamp } }
    var lastTimestampValue;             // Last Timestamp of read values
    var failedPolling = 0;
    var legacyRead = false;             // remote FUXA without POST /api/remote/values
    var getProperty = null;             // Function to read the stored security (API key)
    var apiKey = null;
    var client = null;                  // axios instance with the base URL and the API key

    /**
     * Check the remote FUXA (address and API key) by reading no tags
     */
    this.connect = function () {
        return new Promise(async function (resolve, reject) {
            const baseURL = _getBaseUrl();
            if (!baseURL) {
                logger.error(`'${data.name}' missing connection data!`);
                connected = false;
                _emitStatus('connect-failed');
                _clearVarsValue();
                return reject('missing address');
            }
            if (!_checkWorking(true)) {
                return reject('busy');
            }
            try {
                logger.info(`'${data.name}' try to connect ${baseURL}`, true);
                apiKey = await _readApiKey();
                client = _createClient(baseURL, apiKey);
                legacyRead = false;
                try {
                    await client.post('/api/remote/values', { ids: [] });
                } catch (err) {
                    if (err.response && err.response.status === 404) {
                        legacyRead = true;
                        logger.warn(`'${data.name}' remote FUXA without /api/remote/values, read with /api/getTagValue`);
                    } else {
                        throw err;
                    }
                }
                connected = true;
                failedPolling = 0;
                _clearVarsValue();
                _emitStatus('connect-ok');
                logger.info(`'${data.name}' connected!`, true);
                _checkWorking(false);
                resolve();
            } catch (err) {
                connected = false;
                _checkWorking(false);
                _emitStatus('connect-error');
                _clearVarsValue();
                const reason = _errorToString(err);
                reject(reason);
            }
        });
    }

    /**
     * Disconnect, clear all Tags values
     */
    this.disconnect = function () {
        return new Promise(function (resolve) {
            _checkWorking(false);
            connected = false;
            client = null;
            logger.info(`'${data.name}' disconnected!`, true);
            _emitStatus('connect-off');
            _clearVarsValue();
            resolve(true);
        });
    }

    /**
     * Read the remote tags values with one request, save in DAQ and emit to clients
     */
    this.polling = async function () {
        if (!_checkWorking(true)) {
            _emitStatus('connect-busy');
            return;
        }
        try {
            const ids = _getRemoteIds();
            const result = ids.length ? await _readValues(ids) : [];
            const changed = await _updateVarsValue(result);
            lastTimestampValue = new Date().getTime();
            failedPolling = 0;
            _emitValues(varsValue);
            if (this.addDaq && !utils.isEmptyObject(changed)) {
                this.addDaq(changed, data.name, data.id);
            }
            if (lastStatus !== 'connect-ok') {
                _emitStatus('connect-ok');
            }
        } catch (err) {
            logger.error(`'${data.name}' polling error! ${_errorToString(err)}`);
            if (++failedPolling >= MAX_FAILED_POLLING) {
                // let the device state machine reconnect
                connected = false;
                _emitStatus('connect-error');
                _clearVarsValue();
            }
        }
        _checkWorking(false);
    }

    /**
     * Load Tags to read by polling
     */
    this.load = function (_data) {
        data = JSON.parse(JSON.stringify(_data));
        const tags = data.tags || {};
        const loaded = {};
        for (const id in tags) {
            loaded[id] = varsValue[id] || { id: id, value: null };
            loaded[id].type = tags[id].type;
            loaded[id].daq = tags[id].daq;
        }
        varsValue = loaded;
        logger.info(`'${data.name}' data loaded (${Object.keys(tags).length})`, true);
    }

    this.getValues = function () {
        return varsValue;
    }

    /**
     * Return Tag value { id: <name>, value: <value>, ts: <lastTimestampValue> }
     */
    this.getValue = function (id) {
        if (varsValue[id]) {
            return { id: id, value: varsValue[id].value, ts: lastTimestampValue };
        }
        return null;
    }

    this.getStatus = function () {
        return lastStatus;
    }

    this.getTagProperty = function (id) {
        if (data.tags && data.tags[id]) {
            return { id: id, name: data.tags[id].name, type: data.tags[id].type, format: data.tags[id].format };
        }
        return null;
    }

    /**
     * Write the value to the remote tag
     */
    this.setValue = async function (tagId, value) {
        const tag = data.tags ? data.tags[tagId] : null;
        if (!tag || !tag.address) {
            logger.error(`'${data.name}' setValue tag '${tagId}' not found!`);
            return false;
        }
        if (!client || !connected) {
            logger.error(`'${data.name}' setValue '${tag.name}' not connected!`);
            return false;
        }
        try {
            const raw = await deviceUtils.tagRawCalculator(value, tag, runtime);
            await client.post('/api/setTagValue', { tags: [{ id: tag.address, value: raw }] });
            logger.info(`'${data.name}' setValue '${tag.name}' to ${value}`, true, true);
            return true;
        } catch (err) {
            logger.error(`'${data.name}' setValue '${tag.name}' error! ${_errorToString(err)}`);
            return false;
        }
    }

    this.isConnected = function () {
        return connected;
    }

    this.bindAddDaq = function (fnc) {
        this.addDaq = fnc;
    }
    this.addDaq = null;

    this.bindGetProperty = function (fnc) {
        getProperty = fnc;
    }

    this.lastReadTimestamp = () => {
        return lastTimestampValue;
    }

    this.getTagDaqSettings = (tagId) => {
        return data.tags && data.tags[tagId] ? data.tags[tagId].daq : null;
    }

    this.setTagDaqSettings = (tagId, settings) => {
        if (data.tags && data.tags[tagId]) {
            utils.mergeObjectsValues(data.tags[tagId].daq, settings);
        }
    }

    /**
     * Browse the remote FUXA: without node the remote devices, with node (device) its tags
     * return [{ id, name, class: 'Object' | 'Variable', type, parent }]
     */
    this.browse = async function (node) {
        if (!client) {
            throw 'not connected';
        }
        let res;
        try {
            res = await client.get('/api/remote/browse');
        } catch (err) {
            if (err.response && err.response.status === 404) {
                throw 'the remote FUXA does not support browse (update it to this version)';
            }
            throw _errorToString(err);
        }
        const devices = Array.isArray(res.data) ? res.data : [];
        if (!node || !node.id) {
            return devices.map(device => ({ id: device.id, name: device.name, class: 'Object', type: '' }));
        }
        const device = devices.find(d => d.id === node.id);
        if (!device) {
            return [];
        }
        return (device.tags || []).map(tag => ({
            id: tag.id,
            name: tag.label || tag.name || tag.id,
            class: 'Variable',
            type: tag.type,
            parent: device.id,
            deviceName: device.name,
            description: tag.description
        }));
    }

    var _getBaseUrl = function () {
        let address = (data.property && data.property.address || '').trim();
        if (!address) {
            return null;
        }
        if (!/^https?:\/\//i.test(address)) {
            address = 'http://' + address;
        }
        return address.replace(/\/+$/, '');
    }

    var _readApiKey = async function () {
        if (!getProperty) {
            return null;
        }
        const result = await getProperty({ query: 'security', name: data.id });
        if (result && result.value && result.value !== 'null') {
            const property = JSON.parse(result.value);
            return property.pwd || null;
        }
        return null;
    }

    var _createClient = function (baseURL, key) {
        const headers = { 'Content-Type': 'application/json' };
        if (key) {
            headers['x-api-key'] = key;
        }
        return axios.create({
            baseURL: baseURL,
            timeout: (data.property && data.property.timeout) || DEFAULT_TIMEOUT,
            headers: headers,
            httpAgent: new http.Agent({ keepAlive: true, autoSelectFamilyAttemptTimeout: CONNECT_ATTEMPT_TIMEOUT }),
            httpsAgent: new https.Agent({ keepAlive: true, autoSelectFamilyAttemptTimeout: CONNECT_ATTEMPT_TIMEOUT })
        });
    }

    /**
     * Remote tag ids to read, without duplicates
     */
    var _getRemoteIds = function () {
        const ids = new Set();
        for (const id in data.tags) {
            if (data.tags[id].address) {
                ids.add(data.tags[id].address);
            }
        }
        return Array.from(ids);
    }

    /**
     * Read the remote values, return [{ id: <remote tag id>, value }]
     */
    var _readValues = async function (ids) {
        if (!client) {
            throw 'not connected';
        }
        if (!legacyRead) {
            const res = await client.post('/api/remote/values', { ids: ids });
            return Array.isArray(res.data) ? res.data : [];
        }
        let result = [];
        for (let i = 0; i < ids.length; i += LEGACY_IDS_PER_REQUEST) {
            const chunk = ids.slice(i, i + LEGACY_IDS_PER_REQUEST);
            const res = await client.get('/api/getTagValue', { params: { ids: JSON.stringify(chunk) } });
            if (Array.isArray(res.data)) {
                result = result.concat(res.data);
            }
        }
        return result;
    }

    /**
     * Update the local tags from the remote values, return the values to save in DAQ
     */
    var _updateVarsValue = async function (remoteValues) {
        const timestamp = new Date().getTime();
        const remoteMap = new Map();
        for (const item of remoteValues) {
            if (item && item.id) {
                remoteMap.set(item.id, item.value);
            }
        }
        const changed = {};
        for (const id in data.tags) {
            const tag = data.tags[id];
            if (!tag.address) {
                continue;
            }
            const remoteValue = remoteMap.has(tag.address) ? remoteMap.get(tag.address) : null;
            const current = varsValue[id] || { id: id, value: null, type: tag.type, daq: tag.daq };
            const oldValue = current.value;
            let value = null;
            if (!utils.isNullOrUndefined(remoteValue)) {
                value = await deviceUtils.tagValueCompose(remoteValue, oldValue, tag, runtime);
            }
            current.changed = value !== oldValue;
            current.value = value;
            current.daq = tag.daq;
            current.timestamp = timestamp;
            if (!utils.isNullOrUndefined(value) && deviceUtils.tagDaqToSave(current, timestamp)) {
                changed[id] = current;
            }
            current.changed = false;
            varsValue[id] = current;
        }
        return changed;
    }

    var _clearVarsValue = function () {
        for (const id in varsValue) {
            varsValue[id].value = null;
        }
        _emitValues(varsValue);
    }

    var _emitStatus = function (status) {
        lastStatus = status;
        events.emit('device-status:changed', { id: data.id, status: status });
    }

    var _emitValues = function (values) {
        events.emit('device-value:changed', { id: data.id, values: values });
    }

    var _errorToString = function (err) {
        if (err && err.response) {
            const status = err.response.status;
            if (status === 401 || status === 403) {
                return `unauthorized (${status}), check the API key`;
            }
            const message = err.response.data && err.response.data.message;
            return `HTTP ${status}${message ? ' ' + message : ''}`;
        }
        return (err && (err.code || err.message)) || `${err}`;
    }

    var _checkWorking = function (check) {
        if (check && working) {
            overloading++;
            logger.warn(`'${data.name}' working (connection || polling) overload! ${overloading}`);
            if (overloading >= 3) {
                connected = false;
            } else {
                return false;
            }
        }
        working = check;
        overloading = 0;
        return true;
    }
}

module.exports = {
    init: function (settings) {
    },
    create: function (data, logger, events, manager, runtime) {
        return new FuxaRemote(data, logger, events, runtime);
    }
}
