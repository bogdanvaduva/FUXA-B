'use strict';

/**
 * Repeater 'FUXA Project DB (PostgreSQL)': queries with the reader login of settings.storage.postgres.reader
 * Needs a PostgreSQL (see test/compose.postgres.yml): FUXA_TEST_PG=postgres://fuxa:fuxa@127.0.0.1:55432/fuxa
 */
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const postgres = require('../../runtime/project/storage/postgres');

const PG_URL = process.env.FUXA_TEST_PG;
const SCHEMA = 'fuxa_reader_test';
const READER = 'fuxa_reader_test_login';
const READER_PASSWORD = 'reader-pass';

function settings(reader) {
    const url = new URL(PG_URL);
    return {
        storage: {
            type: 'postgres',
            postgres: {
                host: url.hostname, port: Number(url.port) || 5432,
                database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'fuxa',
                user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
                schema: SCHEMA, maxPoolSize: 2, reader: reader
            }
        }
    };
}

describe('Project storage PostgreSQL reader login', function () {
    let admin;
    const logger = { info() {}, warn() {}, error() {} };

    before(async function () {
        if (!PG_URL) {
            this.skip();
        }
        admin = new Pool({ connectionString: PG_URL, max: 1 });
        await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
        await admin.query(`DROP ROLE IF EXISTS ${READER}`);
        await postgres.init(settings({ user: READER, password: READER_PASSWORD }), logger);
        await postgres.setSection({ table: 'devicesSecurity', name: 'd1', value: { pwd: 'device-secret' } });
        await admin.query(`CREATE ROLE ${READER} LOGIN PASSWORD '${READER_PASSWORD}'`);
        await admin.query(`CREATE TABLE ${SCHEMA}.plant_items (id INT, name TEXT)`);
        await admin.query(`INSERT INTO ${SCHEMA}.plant_items VALUES (1, 'Pump'), (2, 'Valve')`);
        await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${READER}`);
        await admin.query(`GRANT SELECT, INSERT ON ${SCHEMA}.plant_items TO ${READER}`);
    });

    after(async function () {
        if (!admin) {
            return;
        }
        postgres.close();
        await new Promise(resolve => setTimeout(resolve, 100));
        await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
        await admin.query(`DROP OWNED BY ${READER}`).catch(() => {});
        await admin.query(`DROP ROLE IF EXISTS ${READER}`);
        await admin.end();
    });

    it('reads the own tables of the database', async function () {
        const rows = await postgres.queryAsReader('SELECT id, name FROM plant_items ORDER BY id');
        assert.deepEqual(rows, [{ id: 1, name: 'Pump' }, { id: 2, name: 'Valve' }]);
    });

    it('cannot read the project tables', async function () {
        await assert.rejects(postgres.queryAsReader('SELECT * FROM devicessecurity'), /permission denied/);
        await assert.rejects(postgres.queryAsReader('SELECT * FROM devices'), /permission denied/);
    });

    it('is read only, one statement, and cannot take the FUXA login role', async function () {
        await assert.rejects(postgres.queryAsReader("INSERT INTO plant_items VALUES (3, 'x')"), /read-only transaction/);
        await assert.rejects(postgres.queryAsReader("SELECT 1; INSERT INTO plant_items VALUES (3, 'x')"), /multiple commands|cannot insert multiple/);
        const user = new URL(PG_URL).username;
        await assert.rejects(postgres.queryAsReader(`SELECT set_config('role', '${user}', true)`), /permission denied|must be member/);
        const count = await admin.query(`SELECT count(*)::int AS count FROM ${SCHEMA}.plant_items`);
        assert.equal(count.rows[0].count, 2);
    });

    it('refuses a reader login that can read a project table', async function () {
        await admin.query(`GRANT SELECT (name) ON ${SCHEMA}.devices TO ${READER}`);
        try {
            await assert.rejects(postgres.queryAsReader('SELECT 1 AS one'), /can read the FUXA project tables/);
        } finally {
            await admin.query(`REVOKE SELECT (name) ON ${SCHEMA}.devices FROM ${READER}`);
        }
        assert.deepEqual(await postgres.queryAsReader('SELECT 1 AS one'), [{ one: 1 }]);
    });

    it('refuses the FUXA login (superuser) as reader', async function () {
        const url = new URL(PG_URL);
        postgres.close();
        await postgres.init(settings({ user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }), logger);
        try {
            await assert.rejects(postgres.queryAsReader('SELECT 1 AS one'), /superuser/);
        } finally {
            postgres.close();
            await postgres.init(settings({ user: READER, password: READER_PASSWORD }), logger);
        }
    });
});
