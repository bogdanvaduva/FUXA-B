'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const authJwt = require('../../api/jwt-helper');
const commandApi = require('../../api/command');

function request(server, method, path, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port: server.address().port, method, path,
            headers: { 'Content-Type': 'application/json' }
        }, response => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { text += chunk; });
            response.on('end', () => resolve({ statusCode: response.statusCode, body: text ? JSON.parse(text) : null }));
        });
        req.on('error', reject);
        req.end(body ? JSON.stringify(body) : undefined);
    });
}

describe('Remote FUXA REST API', () => {
    let server;
    let permission;

    beforeEach(async () => {
        permission = authJwt.adminGroups[0];
        const runtime = {
            project: {
                getDevices: () => ({
                    'd_plc': { id: 'd_plc', name: 'PLC', type: 'ModbusTCP', property: { address: '10.0.0.9' },
                        tags: { 't1': { id: 't1', name: 'temp', type: 'Float32', address: '40001', description: 'Temp' } } }
                }),
                getServer: () => ({ id: '0', name: 'FUXA Server', type: 'FuxaServer', tags: {} })
            },
            devices: {
                getTagValue: (id) => (id === 't1') ? { id, value: 12.5, ts: 100 } : null
            },
            logger: { error() {} }
        };
        commandApi.init(runtime, (req, res, next) => next(), () => permission);
        const app = express();
        app.use(express.json());
        app.use(commandApi.app());
        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    });

    afterEach(async () => {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });

    it('reads many values in one request, null for unknown ids', async () => {
        const response = await request(server, 'POST', '/api/remote/values', { ids: ['t1', 'nope'] });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.body, [{ id: 't1', value: 12.5, ts: 100 }, { id: 'nope', value: null }]);
    });

    it('rejects a request without ids', async () => {
        const response = await request(server, 'POST', '/api/remote/values', {});
        assert.equal(response.statusCode, 400);
    });

    it('lists devices and tags without the device property', async () => {
        const response = await request(server, 'GET', '/api/remote/browse');
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.body.map(d => d.id), ['0', 'd_plc']);
        assert.equal(response.body[1].property, undefined);
        assert.deepEqual(response.body[1].tags, [{ id: 't1', name: 'temp', type: 'Float32', description: 'Temp' }]);
    });

    it('requires admin permission', async () => {
        permission = null;
        assert.equal((await request(server, 'POST', '/api/remote/values', { ids: [] })).statusCode, 401);
        assert.equal((await request(server, 'GET', '/api/remote/browse')).statusCode, 401);
    });
});
