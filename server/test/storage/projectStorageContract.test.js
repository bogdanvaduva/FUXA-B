'use strict';

/**
 * Project storage backend contract (runtime/project/storage/interface.md)
 * The same tests run on every backend through prjstorage.js.
 * PostgreSQL runs only with FUXA_TEST_PG=postgres://user:password@host:port/database
 * (e.g. docker compose -f test/compose.postgres.yml up -d, then
 *  FUXA_TEST_PG=postgres://fuxa:fuxa@127.0.0.1:55432/fuxa npm test), each test in a new schema.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { Pool } = require('pg');
const sqlite3 = require('sqlite3');

const PG_URL = process.env.FUXA_TEST_PG;

function makeLogger() {
    return { info: () => {}, warn: () => {}, error: () => {} };
}

function pgSettings(schema) {
    const url = new URL(PG_URL);
    return {
        type: 'postgres',
        postgres: {
            host: url.hostname,
            port: Number(url.port) || 5432,
            database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'fuxa',
            user: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
            schema: schema,
            maxPoolSize: 4,
        }
    };
}

/**
 * Backend fixtures: settings for a fresh empty store, cleanup after the test
 */
const backends = [
    {
        type: 'sqlite',
        enabled: () => true,
        create: () => {
            const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-prj-contract-'));
            return {
                settings: { workDir: workDir, appDir: workDir },
                cleanup: async () => {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
                }
            };
        }
    },
    {
        type: 'postgres',
        enabled: () => !!PG_URL,
        create: () => {
            const schema = 'fuxa_test_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-prj-contract-'));
            return {
                schema: schema,
                settings: { workDir: workDir, appDir: workDir, storage: pgSettings(schema) },
                cleanup: async () => {
                    const pool = new Pool({ connectionString: PG_URL });
                    try {
                        await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
                    } finally {
                        await pool.end();
                    }
                    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
                }
            };
        }
    }
];

describe('Project storage contract', function () {
    this.timeout(20000);
    let expect;

    before(async () => {
        expect = (await import('chai')).expect;
    });

    backends.forEach(backend => {
        describe(`backend: ${backend.type}`, function () {
            let storage, fixture, logger, errors;

            before(function () {
                if (!backend.enabled()) {
                    this.skip();
                }
            });

            beforeEach(async () => {
                delete require.cache[require.resolve('../../runtime/project/prjstorage')];
                storage = require('../../runtime/project/prjstorage');
                // close only an open store: the SQLite backend throws SQLITE_MISUSE on a second close
                // (patched on the module, so the project manager in the integration tests is tracked too)
                const realInit = storage.init, realClose = storage.close;
                let open = false;
                storage.init = (...args) => realInit(...args).then(result => { open = true; return result; });
                storage.close = () => {
                    if (open) {
                        open = false;
                        realClose();
                    }
                };
                fixture = backend.create();
                errors = [];
                logger = { info: () => {}, warn: () => {}, error: (msg) => errors.push(msg) };
            });

            afterEach(async () => {
                if (storage) {
                    storage.close();
                }
                if (fixture) {
                    await fixture.cleanup();
                }
            });

            const T = () => storage.TableType;
            const names = rows => rows.map(r => r.name);

            describe('init / close', () => {
                it('resolves false on a new store and true when it exists', async () => {
                    expect(await storage.init(fixture.settings, logger)).to.equal(false);
                    storage.close();
                    expect(await storage.init(fixture.settings, logger)).to.equal(true);
                });

                it('creates all the tables empty', async () => {
                    await storage.init(fixture.settings, logger);
                    for (const table of Object.values(T())) {
                        expect(await storage.getSection(table), table).to.deep.equal([]);
                    }
                });

                it('rejects an unknown storage type', async () => {
                    let error;
                    await storage.init(Object.assign({}, fixture.settings, { storage: { type: 'nope' } }), logger).catch(err => { error = err; });
                    expect(error).to.be.instanceOf(Error);
                    expect(error.message).to.contain('nope');
                });
            });

            describe('with an initialized store', () => {
                beforeEach(async () => {
                    await storage.init(fixture.settings, logger);
                });

                it('setDefault writes the version and the FUXA server device', async () => {
                    await storage.setDefault();
                    expect(await storage.getSection(T().GENERAL)).to.deep.equal([{ name: 'version', value: '"1.00"' }]);
                    const devices = await storage.getSection(T().DEVICES);
                    expect(names(devices)).to.deep.equal(['server']);
                    expect(JSON.parse(devices[0].value)).to.deep.equal({ id: '0', name: 'FUXA Server', type: 'FuxaServer', property: {} });
                });

                it('setSection / getSection by name', async () => {
                    await storage.setSection({ table: T().GENERAL, name: 'app-name', value: { title: 'FUXA' } });
                    const rows = await storage.getSection(T().GENERAL, 'app-name');
                    expect(rows).to.deep.equal([{ name: 'app-name', value: '{"title":"FUXA"}' }]);
                });

                it('getSection of a missing name resolves []', async () => {
                    await storage.setSection({ table: T().VIEWS, name: 'v1', value: {} });
                    expect(await storage.getSection(T().VIEWS, 'missing')).to.deep.equal([]);
                });

                it('getSection with a falsy name returns all the rows', async () => {
                    await storage.setSections([
                        { table: T().VIEWS, name: 'v1', value: 1 },
                        { table: T().VIEWS, name: 'v2', value: 2 }
                    ]);
                    for (const name of [undefined, null, '']) {
                        expect(names(await storage.getSection(T().VIEWS, name))).to.deep.equal(['v1', 'v2']);
                    }
                });

                it('JSON round trip keeps the exact text, key order and types', async () => {
                    const value = {
                        z: 1, a: { y: [1, 'two', null, true, { b: 2, a: 1 }], x: -0.5e-10 }, '10': 'ten', '2': 'two',
                        text: 'àéîõü 中文 😀 "quoted" \\ \n\t', empty: '', nul: null, big: 12345678901234567, f: false,
                        svg: '<svg><rect id="one" style="fill:#fff"/></svg>'
                    };
                    await storage.setSection({ table: T().VIEWS, name: 'v', value: value });
                    const rows = await storage.getSection(T().VIEWS, 'v');
                    expect(rows[0].value).to.equal(JSON.stringify(value));
                    expect(Object.keys(JSON.parse(rows[0].value))).to.deep.equal(Object.keys(value));
                    expect(JSON.parse(rows[0].value)).to.deep.equal(value);
                });

                it('scalar values and undefined (stored as null)', async () => {
                    await storage.setSections([
                        { table: T().GENERAL, name: 'string', value: 'text' },
                        { table: T().GENERAL, name: 'number', value: 42 },
                        { table: T().GENERAL, name: 'bool', value: true },
                        { table: T().GENERAL, name: 'null', value: null },
                        { table: T().GENERAL, name: 'undefined', value: undefined }
                    ]);
                    expect(await storage.getSection(T().GENERAL)).to.deep.equal([
                        { name: 'string', value: '"text"' },
                        { name: 'number', value: '42' },
                        { name: 'bool', value: 'true' },
                        { name: 'null', value: 'null' },
                        { name: 'undefined', value: null }
                    ]);
                });

                it('upsert is idempotent and moves the row to the end of the read order', async () => {
                    await storage.setSections([
                        { table: T().VIEWS, name: 'a', value: { v: 1 } },
                        { table: T().VIEWS, name: 'b', value: { v: 1 } },
                        { table: T().VIEWS, name: 'c', value: { v: 1 } }
                    ]);
                    await storage.setSection({ table: T().VIEWS, name: 'a', value: { v: 2 } });
                    await storage.setSection({ table: T().VIEWS, name: 'a', value: { v: 2 } });
                    const rows = await storage.getSection(T().VIEWS);
                    expect(names(rows)).to.deep.equal(['b', 'c', 'a']);
                    expect(rows[2].value).to.equal('{"v":2}');
                });

                it('the tables are independent', async () => {
                    await storage.setSection({ table: T().SCRIPTS, name: 'same', value: 's' });
                    await storage.setSection({ table: T().ALARMS, name: 'same', value: 'a' });
                    expect(await storage.getSection(T().SCRIPTS)).to.deep.equal([{ name: 'same', value: '"s"' }]);
                    expect(await storage.getSection(T().ALARMS)).to.deep.equal([{ name: 'same', value: '"a"' }]);
                });

                it('every table supports set / get / delete', async () => {
                    for (const table of Object.values(T())) {
                        await storage.setSection({ table: table, name: 'k', value: { table: table } });
                        expect(JSON.parse((await storage.getSection(table, 'k'))[0].value)).to.deep.equal({ table: table });
                        await storage.deleteSection({ table: table, name: 'k' });
                        expect(await storage.getSection(table)).to.deep.equal([]);
                    }
                });

                it('setSections with an empty list resolves', async () => {
                    await storage.setSections([]);
                });

                it('setSections is atomic: an invalid item writes nothing and rejects without a value', async () => {
                    await storage.setSection({ table: T().VIEWS, name: 'keep', value: 1 });
                    let rejected = false, reason = 'not called';
                    await storage.setSections([
                        { table: T().VIEWS, name: 'keep', value: 2 },
                        { table: T().VIEWS, name: 'new', value: 3 },
                        { table: 'nope', name: 'x', value: 4 }
                    ]).catch(err => { rejected = true; reason = err; });
                    expect(rejected).to.equal(true);
                    expect(reason).to.equal(undefined);
                    expect(await storage.getSection(T().VIEWS)).to.deep.equal([{ name: 'keep', value: '1' }]);
                    expect(errors.some(e => e.startsWith('prjstorage.set failed!'))).to.equal(true);
                });

                it('setSection with an invalid table rejects without a value', async () => {
                    let rejected = false, reason = 'not called';
                    await storage.setSection({ table: 'nope', name: 'x', value: 1 }).catch(err => { rejected = true; reason = err; });
                    expect(rejected).to.equal(true);
                    expect(reason).to.equal(undefined);
                    expect(errors.some(e => e.startsWith('prjstorage.set failed!'))).to.equal(true);
                });

                it('getSection and deleteSection with an invalid table reject with an Error', async () => {
                    for (const call of [() => storage.getSection('nope'), () => storage.deleteSection({ table: 'views; DROP TABLE views', name: 'x' })]) {
                        let error;
                        await call().catch(err => { error = err; });
                        expect(error).to.be.instanceOf(Error);
                        expect(error.message).to.contain('invalid table');
                    }
                    expect(await storage.getSection(T().VIEWS)).to.deep.equal([]);
                });

                it('names and values are parameters, not SQL', async () => {
                    const name = "x'); DELETE FROM views; --";
                    await storage.setSection({ table: T().VIEWS, name: 'other', value: 1 });
                    await storage.setSection({ table: T().VIEWS, name: name, value: "'; DROP TABLE views; --" });
                    expect(await storage.getSection(T().VIEWS, name)).to.deep.equal([{ name: name, value: '"\'; DROP TABLE views; --"' }]);
                    await storage.deleteSection({ table: T().VIEWS, name: name });
                    expect(names(await storage.getSection(T().VIEWS))).to.deep.equal(['other']);
                });

                it('deleteSection of a missing name resolves', async () => {
                    await storage.deleteSection({ table: T().VIEWS, name: 'missing' });
                });

                it('clearAll empties every table except devicesSecurity and resolves true', async () => {
                    const sections = Object.values(T()).map(table => ({ table: table, name: 'k', value: 1 }));
                    await storage.setSections(sections);
                    expect(await storage.clearAll()).to.equal(true);
                    for (const table of Object.values(T())) {
                        const expected = table === T().DEVICESSECURITY ? [{ name: 'k', value: '1' }] : [];
                        expect(await storage.getSection(table), table).to.deep.equal(expected);
                    }
                });

                it('data survives close and init', async () => {
                    await storage.setSection({ table: T().DEVICES, name: 'd1', value: { id: 'd1', tags: { b: {}, a: {} } } });
                    storage.close();
                    await storage.init(fixture.settings, logger);
                    expect(await storage.getSection(T().DEVICES)).to.deep.equal([{ name: 'd1', value: '{"id":"d1","tags":{"b":{},"a":{}}}' }]);
                });
            });

            describe('project manager and web API (integration)', () => {
                let project, server, runtime;
                const projectsApi = require('../../api/projects');

                function request(method, route, value) {
                    return new Promise((resolve, reject) => {
                        const req = http.request({ host: '127.0.0.1', port: server.address().port, method: method, path: route,
                            headers: { 'Content-Type': 'application/json' } }, res => {
                            let body = '';
                            res.on('data', chunk => { body += chunk; });
                            res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
                        });
                        req.on('error', reject);
                        req.end(value ? JSON.stringify(value) : undefined);
                    });
                }

                beforeEach(async () => {
                    delete require.cache[require.resolve('../../runtime/project')];
                    project = require('../../runtime/project');
                    runtime = { project: project, logger: makeLogger(), settings: fixture.settings,
                        checkPermission: () => ({ enabled: true, show: true }), restart: () => project.load(), update: () => Promise.resolve() };
                    await project.init(fixture.settings, makeLogger(), runtime);
                    await project.load();
                    projectsApi.init(runtime, (req, res, next) => { req.userId = 'fixture-admin'; next(); }, () => 255);
                    const app = express();
                    app.use(express.json({ limit: '10mb' }));
                    app.use(projectsApi.app());
                    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
                });

                afterEach(async () => {
                    if (server) {
                        await new Promise(resolve => server.close(resolve));
                    }
                });

                it('a new store gets the default project', async () => {
                    const prj = (await request('GET', '/api/project')).body;
                    expect(prj.version).to.equal('1.00');
                    expect(prj.server.type).to.equal('FuxaServer');
                });

                it('saves a project from the editor and loads it after a restart', async () => {
                    const fixtureProject = {
                        version: '1.00',
                        hmi: { views: [
                            { id: 'v2', name: 'Second', type: 'svg', profile: { width: 800 }, svgcontent: '<svg/>', items: {} },
                            { id: 'v1', name: 'Main', type: 'svg', profile: { width: 1024 }, svgcontent: '<svg><rect id="r"/></svg>', items: { r: { id: 'r', type: 'rect' } } }
                        ] },
                        devices: { d1: { id: 'd1', name: 'PLC', type: 'ModbusTCP', tags: { t2: { id: 't2' }, t1: { id: 't1' } } } },
                        texts: [{ id: 'tx', name: 'tx', value: 'Hello' }],
                        alarms: [{ name: 'al1', property: {} }],
                        scripts: [{ id: 's1', name: 'script', code: 'return 1;' }],
                        server: { id: '0', name: 'FUXA Server', type: 'FuxaServer', property: {} }
                    };
                    expect((await request('POST', '/api/project', fixtureProject)).status).to.equal(200);

                    // DB state
                    expect((await storage.getSection(storage.TableType.VIEWS)).map(r => r.name)).to.deep.equal(['v2', 'v1']);
                    expect(JSON.parse((await storage.getSection(storage.TableType.DEVICES, 'd1'))[0].value)).to.deep.equal(fixtureProject.devices.d1);
                    expect((await storage.getSection(storage.TableType.SCRIPTS)).map(r => r.name)).to.deep.equal(['s1']);

                    // restart: new manager on the same store
                    storage.close();
                    await project.init(fixture.settings, makeLogger(), runtime);
                    await project.load();
                    const prj = (await request('GET', '/api/project')).body;
                    expect(prj.hmi.views.map(v => v.id)).to.deep.equal(['v2', 'v1']);
                    expect(prj.hmi.views[1].svgcontent).to.equal('<svg><rect id="r"/></svg>');
                    expect(Object.keys(prj.devices.d1.tags)).to.deep.equal(['t2', 't1']);
                    expect(prj.scripts).to.deep.equal(fixtureProject.scripts);
                });

                it('saves a single view with the project data API', async () => {
                    expect((await request('POST', '/api/projectData', { cmd: 'set-view', data: { id: 'vx', name: 'X', svgcontent: '<svg/>' } })).status).to.equal(200);
                    const rows = await storage.getSection(storage.TableType.VIEWS, 'vx');
                    expect(JSON.parse(rows[0].value)).to.deep.equal({ id: 'vx', name: 'X', svgcontent: '<svg/>' });
                    expect((await request('POST', '/api/projectData', { cmd: 'del-view', data: { id: 'vx' } })).status).to.equal(200);
                    expect(await storage.getSection(storage.TableType.VIEWS, 'vx')).to.deep.equal([]);
                });
            });

            if (backend.type === 'postgres') {
                describe('migrate-storage (SQLite to PostgreSQL)', () => {
                    const migrate = require('../../scripts/migrate-storage');
                    let sqliteDir, sqliteFile;

                    function quiet(fn) {
                        const write = process.stdout.write;
                        process.stdout.write = () => true;
                        return fn().finally(() => { process.stdout.write = write; });
                    }

                    function pgArgs(extra) {
                        const pg = fixture.settings.storage.postgres;
                        return ['node', 'migrate-storage', '--from', 'sqlite', '--to', 'postgres', '--sqlite-path', sqliteFile,
                            '--settings', path.join(sqliteDir, 'settings.js'),
                            '--pg-host', pg.host, '--pg-port', String(pg.port), '--pg-db', pg.database, '--pg-user', pg.user,
                            '--pg-password', pg.password, '--pg-schema', pg.schema].concat(extra || []);
                    }

                    beforeEach(async () => {
                        // source: a SQLite project written by the SQLite backend
                        sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-prj-migrate-'));
                        fs.writeFileSync(path.join(sqliteDir, 'settings.js'), 'module.exports = {};');
                        sqliteFile = path.join(sqliteDir, 'project.fuxap.db');
                        await storage.init({ workDir: sqliteDir }, logger);
                        await storage.setDefault();
                        await storage.setSections([
                            { table: storage.TableType.VIEWS, name: 'v2', value: { id: 'v2', b: 1, a: 2 } },
                            { table: storage.TableType.VIEWS, name: 'v1', value: { id: 'v1' } },
                            { table: storage.TableType.DEVICESSECURITY, name: 'd1', value: { user: 'u' } },
                            { table: storage.TableType.SCRIPTS, name: 's1', value: { id: 's1', code: 'x' } }
                        ]);
                        await storage.setSection({ table: storage.TableType.VIEWS, name: 'v2', value: { id: 'v2', b: 1, a: 3 } });
                        await new Promise(resolve => setTimeout(resolve, 50));
                        storage.close();
                    });

                    afterEach(() => {
                        try { fs.rmSync(sqliteDir, { recursive: true, force: true }); } catch (_) {}
                    });

                    async function readAll(settings) {
                        const all = {};
                        await storage.init(settings, logger);
                        for (const table of Object.values(storage.TableType)) {
                            all[table] = await storage.getSection(table);
                        }
                        storage.close();
                        await new Promise(resolve => setTimeout(resolve, 50));
                        return all;
                    }

                    it('copies every table with the same rows in the same order, then verifies', async () => {
                        const before = fs.readFileSync(sqliteFile);
                        expect(await quiet(() => migrate.main(pgArgs(['--verify'])))).to.equal(0);
                        expect(fs.readFileSync(sqliteFile).equals(before), 'source unchanged').to.equal(true);
                        const source = await readAll({ workDir: sqliteDir });
                        const target = await readAll(fixture.settings);
                        expect(target).to.deep.equal(source);
                        expect(target.views.map(r => r.name)).to.deep.equal(['v1', 'v2']);
                    });

                    it('refuses a non-empty target without --force', async () => {
                        await quiet(() => migrate.main(pgArgs()));
                        let error;
                        await quiet(() => migrate.main(pgArgs())).catch(err => { error = err; });
                        expect(error).to.be.instanceOf(migrate.UsageError);
                        expect(error.message).to.contain('--force');
                        expect(await quiet(() => migrate.main(pgArgs(['--force', '--verify'])))).to.equal(0);
                    });

                    it('rolls back everything on an invalid row', async () => {
                        const db = new sqlite3.Database(sqliteFile);
                        await new Promise((resolve, reject) => db.run("INSERT INTO scripts (name, value) VALUES ('broken', '{oops')", err => err ? reject(err) : resolve()));
                        await new Promise(resolve => db.close(resolve));
                        let error;
                        await quiet(() => migrate.main(pgArgs())).catch(err => { error = err; });
                        expect(error.message).to.contain("scripts 'broken'");
                        const pool = new Pool({ connectionString: PG_URL });
                        try {
                            const tables = await pool.query('SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1', [fixture.schema]);
                            expect(tables.rows[0].count).to.equal(0);
                        } finally {
                            await pool.end();
                        }
                    });
                });
            }
        });
    });
});
