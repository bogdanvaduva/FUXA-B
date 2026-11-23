'use strict';

/**
 * Switch of the project storage between SQLite and PostgreSQL (copy of the project, backup of the target):
 * live (prjstorage.switchTo, /api/project-storage) and at start (settings changed by hand)
 * Runs only with FUXA_TEST_PG=postgres://user:password@host:port/database (see test/compose.postgres.yml)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const sqlite3 = require('sqlite3');
const { Pool } = require('pg');

const PG_URL = process.env.FUXA_TEST_PG;

describe('Project storage switch (SQLite <-> PostgreSQL)', function () {
    this.timeout(30000);
    let expect, storage, workDir, schema, logs, logger;

    function pgBlock(overrides = {}) {
        const url = new URL(PG_URL);
        return Object.assign({
            host: url.hostname, port: Number(url.port) || 5432, database: url.pathname.slice(1),
            user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), schema: schema, maxPoolSize: 4,
        }, overrides);
    }
    const sqliteSettings = () => ({ workDir: workDir, storage: { type: 'sqlite', postgres: pgBlock({ reader: { user: 'fuxa_reader', password: 'reader-secret' } }) } });
    const pgSettings = (overrides) => ({ workDir: workDir, storage: { type: 'postgres', postgres: pgBlock(overrides) } });

    async function pgQuery(sql, params) {
        const pool = new Pool({ connectionString: PG_URL });
        try {
            return (await pool.query(sql, params)).rows;
        } finally {
            await pool.end();
        }
    }

    function sqliteRows(file, sql) {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY);
            db.all(sql, (err, rows) => db.close(() => err ? reject(err) : resolve(rows)));
        });
    }

    const marker = () => JSON.parse(fs.readFileSync(path.join(workDir, 'prjstorage.json'), 'utf8'));
    const views = async () => (await storage.getSection(storage.TableType.VIEWS)).map(r => [r.name, r.value]);
    const settle = () => new Promise(resolve => setTimeout(resolve, 60));

    async function closeStore() {
        storage.close();
        await settle();
    }

    before(async function () {
        if (!PG_URL) {
            this.skip();
        }
        expect = (await import('chai')).expect;
    });

    beforeEach(async () => {
        delete require.cache[require.resolve('../../runtime/project/prjstorage')];
        storage = require('../../runtime/project/prjstorage');
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-prj-switch-'));
        schema = 'fuxa_switch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        logs = [];
        logger = { info: m => logs.push(['info', m]), warn: m => logs.push(['warn', m]), error: m => logs.push(['error', m]) };
    });

    afterEach(async () => {
        try { storage.close(); } catch (_) {}
        await settle();
        const backups = await pgQuery("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'prjstorage_backup_%' OR nspname = $1", [schema]);
        for (const row of backups) {
            await pgQuery(`DROP SCHEMA IF EXISTS ${row.nspname} CASCADE`);
        }
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
    });

    async function sqliteProject() {
        await storage.init(sqliteSettings(), logger);
        await storage.setDefault();
        await storage.setSections([
            { table: storage.TableType.VIEWS, name: 'v2', value: { id: 'v2', z: 1, a: 2 } },
            { table: storage.TableType.VIEWS, name: 'v1', value: { id: 'v1', svg: '<svg/>' } },
            { table: storage.TableType.DEVICESSECURITY, name: 'd1', value: { user: 'plc' } },
        ]);
    }

    describe('live (switchTo)', () => {
        it('copies the project from SQLite to an empty PostgreSQL and uses it', async () => {
            await sqliteProject();
            const before = await views();
            const result = await storage.switchTo(pgSettings());
            expect(result).to.include({ rows: 5, backup: null });
            expect(result.to).to.include({ type: 'postgres', schema: schema });
            expect(result.to).to.not.have.property('password');
            expect(await views()).to.deep.equal(before);
            expect(await storage.getSection(storage.TableType.DEVICESSECURITY)).to.deep.equal([{ name: 'd1', value: '{"user":"plc"}' }]);
            expect((await pgQuery(`SELECT name FROM ${schema}.views ORDER BY seq`)).map(r => r.name)).to.deep.equal(['v2', 'v1']);
            expect(marker()).to.include({ type: 'postgres', schema: schema });
            expect(marker()).to.not.have.property('password');
            expect(storage.getCurrent().type).to.equal('postgres');
        });

        it('switches back to SQLite with the changes, keeping a backup of the old SQLite project', async () => {
            await sqliteProject();
            await storage.switchTo(pgSettings());
            await storage.setSection({ table: storage.TableType.VIEWS, name: 'v3', value: { id: 'v3' } });
            await storage.deleteSection({ table: storage.TableType.VIEWS, name: 'v1' });
            const onPostgres = await views();
            const result = await storage.switchTo(sqliteSettings());
            expect(result.backup).to.match(/project\.fuxap\.backup-\d{14}\.db$/);
            expect(await views()).to.deep.equal(onPostgres);
            expect(marker().type).to.equal('sqlite');
            const backupViews = await sqliteRows(result.backup, 'SELECT name FROM views ORDER BY rowid');
            expect(backupViews.map(r => r.name)).to.deep.equal(['v2', 'v1']);
        });

        it('backs up a non-empty PostgreSQL target in a backup schema', async () => {
            await storage.init(pgSettings(), logger);
            await storage.setSection({ table: storage.TableType.VIEWS, name: 'old-pg', value: 1 });
            await storage.switchTo(sqliteSettings());
            await storage.setSection({ table: storage.TableType.VIEWS, name: 'new-sqlite', value: 2 });
            const result = await storage.switchTo(pgSettings());
            expect(result.backup).to.match(/^prjstorage_backup_\d{14}$/);
            expect(await pgQuery(`SELECT name FROM ${result.backup}.views`)).to.deep.equal([{ name: 'old-pg' }]);
            expect((await views()).map(v => v[0])).to.deep.equal(['old-pg', 'new-sqlite']);
        });

        it('keeps the current storage when the target cannot be opened', async () => {
            await sqliteProject();
            const before = await views();
            const markerBefore = marker();
            let error;
            await storage.switchTo(pgSettings({ port: 1, connectionTimeout: 2000 })).catch(err => { error = err; });
            expect(error.message).to.contain('cannot open PostgreSQL');
            expect(error.message).to.not.match(/password/i);
            expect(await views()).to.deep.equal(before);
            expect(storage.getCurrent().type).to.equal('sqlite');
            expect(marker()).to.deep.equal(markerBefore);
        });

        it('refuses a switch to the same storage type', async () => {
            await sqliteProject();
            let error;
            await storage.switchTo(sqliteSettings()).catch(err => { error = err; });
            expect(error.message).to.contain('already uses this storage type');
        });
    });

    describe('at start (settings changed by hand)', () => {
        it('copies the project when storage.type changed, then back', async () => {
            await sqliteProject();
            const before = await views();
            await closeStore();

            expect(await storage.init(pgSettings(), logger)).to.equal(true);
            expect(storage.getCurrent().type).to.equal('postgres');
            expect(await views()).to.deep.equal(before);
            expect(logs.some(([l, m]) => l === 'info' && /project copied from SQLite .* to PostgreSQL/.test(m))).to.equal(true);
            await storage.setSection({ table: storage.TableType.VIEWS, name: 'pg-only', value: true });
            await closeStore();

            expect(await storage.init(sqliteSettings(), logger)).to.equal(true);
            expect(storage.getCurrent().type).to.equal('sqlite');
            expect((await views()).map(v => v[0])).to.deep.equal(['v2', 'v1', 'pg-only']);
            expect(fs.readdirSync(workDir).some(f => /^project\.fuxap\.backup-\d{14}\.db$/.test(f))).to.equal(true);
        });

        it('keeps using the previous storage when the copy fails (PostgreSQL unreachable)', async () => {
            await sqliteProject();
            const before = await views();
            await closeStore();
            expect(await storage.init(pgSettings({ port: 1, connectionTimeout: 2000 }), logger)).to.equal(true);
            expect(storage.getCurrent().type).to.equal('sqlite');
            expect(await views()).to.deep.equal(before);
            expect(marker().type).to.equal('sqlite');
            expect(logs.some(([l, m]) => l === 'error' && m.includes('FUXA keeps using SQLite'))).to.equal(true);
        });

        it('does not copy without the previous PostgreSQL connection', async () => {
            await storage.init(pgSettings(), logger);
            await storage.setSection({ table: storage.TableType.VIEWS, name: 'on-pg', value: 1 });
            await closeStore();
            const settings = sqliteSettings();
            delete settings.storage.postgres;
            await storage.init(settings, logger);
            expect(await views()).to.deep.equal([]);
            expect(logs.some(([l, m]) => l === 'error' && m.includes('is not configured any more'))).to.equal(true);
        });

        it('copies an existing SQLite project to an empty PostgreSQL on the first start without marker', async () => {
            await sqliteProject();
            const before = await views();
            await closeStore();
            fs.unlinkSync(path.join(workDir, 'prjstorage.json'));
            expect(await storage.init(pgSettings(), logger)).to.equal(true);
            expect(await views()).to.deep.equal(before);
        });

        it('does not overwrite a PostgreSQL project on the first start without marker', async () => {
            await storage.init(pgSettings(), logger);
            await storage.setSection({ table: storage.TableType.VIEWS, name: 'pg-project', value: 1 });
            await closeStore();
            await storage.init(sqliteSettings(), logger);     // creates project.fuxap.db (another project)
            await storage.setSection({ table: storage.TableType.VIEWS, name: 'sqlite-project', value: 1 });
            await closeStore();
            fs.unlinkSync(path.join(workDir, 'prjstorage.json'));
            await storage.init(pgSettings(), logger);
            expect((await views()).map(v => v[0])).to.deep.equal(['pg-project']);
        });
    });

    describe('API /api/project-storage', () => {
        let server, runtime, restarted;

        async function call(method, route, body) {
            return new Promise((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port: server.address().port, method: method, path: route, headers: { 'Content-Type': 'application/json' } }, res => {
                    let data = '';
                    res.on('data', c => { data += c; });
                    res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null, body: data }));
                });
                req.on('error', reject);
                req.end(body ? JSON.stringify(body) : undefined);
            });
        }

        beforeEach(async () => {
            await sqliteProject();
            restarted = 0;
            const settings = Object.assign(sqliteSettings(), { userSettingsFile: path.join(workDir, 'mysettings.json') });
            fs.writeFileSync(settings.userSettingsFile, JSON.stringify({ language: 'en' }));
            runtime = { settings: settings, logger: logger, project: {}, restart: async () => { restarted++; } };
            delete require.cache[require.resolve('../../api/project-storage')];
            const api = require('../../api/project-storage');
            api.init(runtime, (req, res, next) => next(), () => -1);
            const app = express();
            app.use(express.json());
            app.use(api.app());
            server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        });

        afterEach(async () => {
            await new Promise(resolve => server.close(resolve));
        });

        it('returns the storage in use without password', async () => {
            const res = await call('GET', '/api/project-storage');
            expect(res.json.current.type).to.equal('sqlite');
            expect(res.json.settings.postgres.passwordSet).to.equal(true);
            expect(res.json.settings.postgres).to.not.have.property('password');
            expect(res.json.settings.postgres.reader).to.deep.equal({ user: 'fuxa_reader', passwordSet: true });
        });

        it('tests a connection, the saved password is used when empty', async () => {
            expect((await call('POST', '/api/project-storage/test', { type: 'postgres', postgres: Object.assign(pgBlock(), { password: '' }) })).json).to.deep.equal({ ok: true });
            const bad = await call('POST', '/api/project-storage/test', { type: 'postgres', postgres: Object.assign(pgBlock(), { password: 'wrong-password' }) });
            expect(bad.status).to.equal(400);
            expect(bad.json.error).to.equal('connection_failed');
        });

        it('switches, saves the storage in mysettings.json and reloads the project', async () => {
            const res = await call('POST', '/api/project-storage/switch', { type: 'postgres', postgres: Object.assign(pgBlock(), { password: '' }) });
            expect(res.status, res.body).to.equal(200);
            expect(res.json).to.include({ ok: true, rows: 5 });
            expect(restarted).to.equal(1);
            expect(runtime.settings.storage.type).to.equal('postgres');
            const saved = JSON.parse(fs.readFileSync(runtime.settings.userSettingsFile, 'utf8'));
            expect(saved.language).to.equal('en');
            expect(saved.storage).to.deep.include({ type: 'postgres' });
            expect(saved.storage.postgres.password).to.equal(pgBlock().password);
            expect(storage.getCurrent().type).to.equal('postgres');
        });

        it('reports a failed switch and keeps the storage', async () => {
            const res = await call('POST', '/api/project-storage/switch', { type: 'postgres', postgres: Object.assign(pgBlock(), { port: 1, connectionTimeout: 2000 }) });
            expect(res.status).to.equal(400);
            expect(res.json.error).to.equal('switch_failed');
            expect(restarted).to.equal(0);
            expect(runtime.settings.storage.type).to.equal('sqlite');
            expect(JSON.parse(fs.readFileSync(runtime.settings.userSettingsFile, 'utf8')).storage).to.equal(undefined);
        });

        it('refuses non-admin users', async () => {
            const api = require('../../api/project-storage');
            api.init(runtime, (req, res, next) => next(), () => 2);
            expect((await call('POST', '/api/project-storage/switch', { type: 'postgres', postgres: pgBlock() })).status).to.equal(401);
            expect((await call('GET', '/api/project-storage')).status).to.equal(401);
        });
    });
});
