'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const daqApi = require('../../api/daq');
const projectsApi = require('../../api/projects');
const daqStorage = require('../../runtime/storage/daqstorage');
const projectTables = require('../../runtime/project/project-tables');

function project() {
    return {
        version: '1.00',
        hmi: { layout: { start: 'v1' }, views: [{ id: 'v1', name: 'Main', items: {} }, { id: 'v2', name: 'Plant', items: {} }] },
        devices: {
            d1: { id: 'd1', name: 'PLC 1', type: 'ModbusTCP', property: { address: '10.0.0.1', password: 'device-pass' }, tags: { t1: { id: 't1', name: 'temp' } } },
            d2: { id: 'd2', name: 'Broker', type: 'MQTTclient', property: { address: 'mqtt://b?token=abc', options: { username: 'u', password: 'mqtt-pass' } }, tags: {} }
        },
        server: { id: '0', name: 'FUXA Server', type: 'FuxaServer', tags: {} },
        alarms: [{ name: 'High', property: { variableId: 't1' } }],
        scripts: [{ id: 's1', name: 'ServerJob', mode: 'SERVER', code: 'secret-code()' }, { id: 's2', name: 'Ui', mode: 'CLIENT', code: 'ui()' }],
        notifications: [{ id: 'n1', name: 'Mail', receiver: 'boss@example.com', options: { webhookToken: 'hook-secret' } }],
        mapsLocations: [{ id: 'l1', name: 'Site A', lat: 1, lng: 2 }],
        ar: { enabled: true, markers: [{ id: 'm1', name: 'Marker' }] },
        repeaters: [{ id: 'r1', name: 'Devices', lines: [] }]
    };
}

describe('Project tables', function () {
    it('maps the project to the storage tables, without devicesSecurity', function () {
        const tables = projectTables.toTables(project());
        assert.equal(tables.devicesSecurity, undefined);
        assert.deepEqual(tables.views.map(r => r.name), ['v1', 'v2']);
        assert.deepEqual(tables.devices.map(r => r.name), ['d1', 'd2', 'server']);
        assert.deepEqual(tables.alarms.map(r => r.name), ['High']);
        assert.deepEqual(tables.locations.map(r => r.name), ['l1']);
        assert.deepEqual(tables.arMarkers.map(r => r.name), ['m1']);
        assert.deepEqual(tables.general.map(r => r.name).sort(), ['ar', 'layout', 'repeaters', 'version']);
        assert.equal(JSON.parse(tables.general.find(r => r.name === 'ar').value).markers, undefined);
    });
});

describe('daqstorage.queryTables', function () {
    const tables = { views: [{ name: 'v1', value: '{"name":"Main"}' }], devices: [{ name: 'd1', value: '{"name":"PLC 1","tags":{"t1":{}}}' }] };

    it('runs SQL with the JSON functions and parses JSON values', async function () {
        const rows = await daqStorage.queryTables(tables, "SELECT name, json_extract(value, '$.name') AS title, value FROM views");
        assert.deepEqual(rows, [{ name: 'v1', title: 'Main', value: { name: 'Main' } }]);
    });

    it('is read only and cannot attach other databases', async function () {
        await assert.rejects(daqStorage.queryTables(tables, "INSERT INTO views VALUES ('x', 'y')"), /readonly|read-only|query_only/i);
        await assert.rejects(daqStorage.queryTables(tables, "ATTACH DATABASE 'project.fuxap.db' AS p"), /too many attached|attach/i);
    });

    it('lists the FUXA Project DB, the PostgreSQL one only with a reader login', function () {
        // init opens the current values database: run it in a child process that exits
        const nodeIds = (storage) => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-repeater-'));
            const script = `
                const daq = require(${JSON.stringify(require.resolve('../../runtime/storage/daqstorage'))});
                const logger = { info() {}, warn() {}, error() {} };
                daq.init({ workDir: ${JSON.stringify(dir)}, dbDir: ${JSON.stringify(dir)}, storage: ${JSON.stringify(storage)} },
                    logger, { project: { getDevices: () => ({}) } });
                process.stdout.write(JSON.stringify(daq.getSqlNodes().map(n => n.id)));
                process.exit(0);`;
            const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 });
            fs.rmSync(dir, { recursive: true, force: true });
            return JSON.parse(result.stdout);
        };
        let ids = nodeIds({ type: 'sqlite' });
        assert.ok(ids.includes('@project'));
        assert.ok(!ids.includes('@project-pg'));
        ids = nodeIds({ type: 'postgres', postgres: { reader: { user: 'fx_reader' } } });
        assert.ok(ids.includes('@project-pg'));
    });
});

describe('Repeater FUXA Project DB API', function () {
    let server;
    let line;
    let getProjectArgs;

    beforeEach(async function () {
        getProjectArgs = null;
        line = { id: 'l1', type: 'db', daq: '@project', sql: '' };
        const runtime = {
            settings: { secureEnabled: true },
            project: {
                getRepeaters: () => [{ id: 'r1', lines: [line] }],
                getProject: async (userId, permission) => {
                    getProjectArgs = [userId, permission];
                    return project();
                }
            },
            daqStorage: daqStorage,
            scriptsMgr: { isAuthorised: () => true },
            logger: { error() {} }
        };
        projectsApi.init(runtime, (req, res, next) => next(), () => 1);
        daqApi.init(runtime, (req, res, next) => { req.userId = 'operator'; next(); }, () => 1);
        const app = express();
        app.use(daqApi.app());
        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    });

    afterEach(async function () {
        await new Promise(resolve => server.close(resolve));
    });

    function query(sql) {
        line.sql = sql;
        return new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:${server.address().port}/api/daq/sql/repeater?repeater=r1&line=l1`, res => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
            }).on('error', reject);
        });
    }

    it('queries the project of the requester', async function () {
        const res = await query("SELECT name, json_extract(value, '$.name') AS title FROM views ORDER BY name");
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, [{ name: 'v1', title: 'Main' }, { name: 'v2', title: 'Plant' }]);
        assert.deepEqual(getProjectArgs, ['operator', 1]);
    });

    it('never returns credentials', async function () {
        const res = await query('SELECT value FROM devices UNION ALL SELECT value FROM scripts UNION ALL SELECT value FROM notifications');
        assert.equal(res.status, 200);
        const text = JSON.stringify(res.body);
        for (const secret of ['device-pass', 'mqtt-pass', 'secret-code', 'boss@example.com', 'hook-secret', 'token=abc']) {
            assert.ok(!text.includes(secret), `${secret} must not be returned`);
        }
        assert.ok(text.includes('ui()'), 'client script code stays');
        assert.ok(text.includes('10.0.0.1'), 'device address stays');
    });

    it('has no devicesSecurity table', async function () {
        const res = await query('SELECT * FROM devicesSecurity');
        assert.equal(res.status, 400);
        assert.match(res.body.message, /no such table/);
    });
});
