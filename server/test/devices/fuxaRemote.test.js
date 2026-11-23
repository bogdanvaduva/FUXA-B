'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const driver = require('../../runtime/devices/fuxaremote');

const API_KEY = 'secret-key';

/**
 * Fake remote FUXA with two devices, records the requests
 */
function createRemote(options = {}) {
    const values = { 'rt_1': 21.5, 'rt_2': true, 'rt_3': 'text' };
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const url = new URL(req.url, 'http://localhost');
            requests.push({ method: req.method, path: url.pathname, body: body ? JSON.parse(body) : null, query: url.searchParams });
            res.setHeader('Content-Type', 'application/json');
            if (req.headers['x-api-key'] !== API_KEY) {
                res.statusCode = 401;
                return res.end(JSON.stringify({ error: 'unauthorized_error', message: 'Invalid API Key' }));
            }
            if (req.method === 'POST' && url.pathname === '/api/remote/values' && !options.legacy) {
                const ids = JSON.parse(body).ids;
                return res.end(JSON.stringify(ids.map(id => ({ id, value: (id in values) ? values[id] : null, ts: 1 }))));
            }
            if (req.method === 'GET' && url.pathname === '/api/getTagValue') {
                const ids = JSON.parse(url.searchParams.get('ids'));
                return res.end(JSON.stringify(ids.map(id => ({ id, value: (id in values) ? values[id] : null }))));
            }
            if (req.method === 'POST' && url.pathname === '/api/setTagValue') {
                for (const tag of JSON.parse(body).tags) {
                    values[tag.id] = tag.value;
                }
                return res.end();
            }
            if (req.method === 'GET' && url.pathname === '/api/remote/browse' && !options.legacy) {
                return res.end(JSON.stringify([
                    { id: '0', name: 'FUXA Server', type: 'FuxaServer', tags: [] },
                    { id: 'd_plc', name: 'PLC 1', type: 'ModbusTCP', tags: [
                        { id: 'rt_1', name: 'temperature', type: 'Float32' },
                        { id: 'rt_2', name: 'running', label: 'Running', type: 'Bool' }
                    ] }
                ]));
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'not_found' }));
        });
    });
    return { server, values, requests };
}

describe('FuxaRemote device', function () {
    let remote;
    let client;
    let errors;

    async function start(options, apiKey = API_KEY, tags) {
        remote = createRemote(options);
        await new Promise(resolve => remote.server.listen(0, '127.0.0.1', resolve));
        errors = [];
        const data = {
            id: 'd_remote', name: 'Edge 1', type: 'FuxaRemote', polling: 1000,
            property: { address: `127.0.0.1:${remote.server.address().port}/` },
            tags: tags || {
                t_temp: { id: 't_temp', name: 'temp', address: 'rt_1', memaddress: 'd_plc', type: 'Float32' },
                t_run: { id: 't_run', name: 'run', address: 'rt_2', memaddress: 'd_plc', type: 'Bool' },
                t_temp2: { id: 't_temp2', name: 'temp copy', address: 'rt_1', memaddress: 'd_plc', type: 'Float32' },
                t_gone: { id: 't_gone', name: 'gone', address: 'rt_missing', memaddress: 'd_plc', type: 'Float32' }
            }
        };
        const logger = { info() {}, warn() {}, error(message) { errors.push(message); } };
        client = driver.create(data, logger, new EventEmitter(), null, undefined);
        client.bindGetProperty(async () => ({ value: JSON.stringify({ pwd: apiKey }) }));
        client.load(data);
    }

    afterEach(async function () {
        if (client) await client.disconnect();
        client = null;
        remote.server.closeAllConnections();
        await new Promise(resolve => remote.server.close(resolve));
    });

    it('reads all tags with one request and maps the remote ids', async function () {
        await start();
        await client.connect();
        assert.equal(client.isConnected(), true);
        remote.requests.length = 0;
        await client.polling();
        assert.deepEqual(errors, []);
        const reads = remote.requests.filter(r => r.path === '/api/remote/values');
        assert.equal(reads.length, 1);
        assert.deepEqual(reads[0].body.ids.sort(), ['rt_1', 'rt_2', 'rt_missing']);
        assert.equal(client.getValue('t_temp').value, 21.5);
        assert.equal(client.getValue('t_temp2').value, 21.5);
        assert.equal(client.getValue('t_run').value, true);
        assert.equal(client.getValue('t_gone').value, null);
        assert.ok(client.lastReadTimestamp() > 0);
    });

    it('writes the value to the remote tag id', async function () {
        await start();
        await client.connect();
        assert.equal(await client.setValue('t_temp', 30), true);
        const write = remote.requests.find(r => r.path === '/api/setTagValue');
        assert.deepEqual(write.body, { tags: [{ id: 'rt_1', value: 30 }] });
        await client.polling();
        assert.equal(client.getValue('t_temp').value, 30);
    });

    it('rejects the connection with a wrong API key', async function () {
        await start({}, 'wrong');
        await assert.rejects(client.connect(), /unauthorized \(401\)/);
        assert.equal(client.isConnected(), false);
        assert.equal(client.getStatus(), 'connect-error');
    });

    it('browses the remote devices and their tags', async function () {
        await start();
        await client.connect();
        const devices = await client.browse(null);
        assert.deepEqual(devices.map(d => d.id), ['0', 'd_plc']);
        assert.equal(devices[1].class, 'Object');
        const tags = await client.browse({ id: 'd_plc' });
        assert.deepEqual(tags.map(t => [t.id, t.name, t.class, t.parent]),
            [['rt_1', 'temperature', 'Variable', 'd_plc'], ['rt_2', 'Running', 'Variable', 'd_plc']]);
    });

    it('falls back to /api/getTagValue for a remote FUXA without /api/remote/values', async function () {
        const tags = {};
        for (let i = 0; i < 250; i++) {
            tags['t' + i] = { id: 't' + i, name: 'tag ' + i, address: (i % 2) ? 'rt_1' : 'rt_x' + i, type: 'Float32' };
        }
        await start({ legacy: true }, API_KEY, tags);
        await client.connect();
        remote.requests.length = 0;
        await client.polling();
        assert.deepEqual(errors, []);
        assert.equal(remote.requests.filter(r => r.path === '/api/getTagValue').length, 2);
        assert.equal(client.getValue('t1').value, 21.5);
        assert.equal(client.getValue('t0').value, null);
    });

    it('drops the connection after failed polling so the device reconnects', async function () {
        await start();
        await client.connect();
        remote.server.closeAllConnections();
        await new Promise(resolve => remote.server.close(resolve));
        for (let i = 0; i < 3; i++) {
            await client.polling();
        }
        assert.equal(client.isConnected(), false);
        assert.equal(client.getValue('t_temp').value, null);
        // reopen for afterEach
        await new Promise(resolve => remote.server.listen(0, '127.0.0.1', resolve));
    });
});
