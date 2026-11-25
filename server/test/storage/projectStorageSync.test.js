/**
 * Several FUXA on the same PostgreSQL project storage: a write of one instance (NOTIFY) reaches the others (LISTEN)
 * Runs only with FUXA_TEST_PG=postgres://user:password@host:port/database
 */

'use strict';

const { Pool } = require('pg');

const PG_URL = process.env.FUXA_TEST_PG;
const BACKEND = '../../runtime/project/storage/postgres';

let expect;

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/**
 * A new copy of the backend module (another FUXA instance, own INSTANCE_ID)
 */
function newInstance() {
    delete require.cache[require.resolve(BACKEND)];
    return require(BACKEND);
}

function settingsFor(schema) {
    const url = new URL(PG_URL);
    return {
        storage: {
            type: 'postgres',
            postgres: {
                host: url.hostname, port: Number(url.port) || 5432, database: url.pathname.slice(1),
                user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), schema: schema
            }
        }
    };
}

function waitFor(predicate, timeout = 3000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (predicate()) {
                return resolve();
            }
            if (Date.now() - start > timeout) {
                return reject(new Error('timeout'));
            }
            setTimeout(check, 20);
        };
        check();
    });
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(PG_URL ? describe : describe.skip)('Project storage sync between FUXA instances (PostgreSQL)', function () {
    const schema = `fuxa_sync_${Date.now()}`;
    const otherSchema = `${schema}_other`;
    let a, b, c;

    before(async () => {
        const chai = await import('chai');
        expect = chai.expect;
        a = newInstance();
        b = newInstance();
        c = newInstance();
        await a.init(settingsFor(schema), logger);
        await b.init(settingsFor(schema), logger);
        await c.init(settingsFor(otherSchema), logger);
    });

    after(async () => {
        [a, b, c].forEach(instance => instance && instance.close());
        const pool = new Pool({ connectionString: PG_URL });
        await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await pool.query(`DROP SCHEMA IF EXISTS ${otherSchema} CASCADE`);
        await pool.end();
    });

    it('notifies the other instances on the same schema, not the writer nor other schemas', async () => {
        expect(a.INSTANCE_ID).to.not.equal(b.INSTANCE_ID);
        const changesA = [], changesB = [], changesC = [];
        a.listen(change => changesA.push(change));
        b.listen(change => changesB.push(change));
        c.listen(change => changesC.push(change));
        await delay(300);     // LISTEN connected

        await a.setSection({ table: 'views', name: 'v1', value: { id: 'v1' } });
        await waitFor(() => changesB.length === 1);
        expect(changesB[0]).to.deep.equal({ tables: ['views'], reconnected: false });

        await a.setSections([{ table: 'devices', name: 'd1', value: { id: 'd1' } }, { table: 'texts', name: 't1', value: {} }]);
        await waitFor(() => changesB.length === 2);
        expect(changesB[1].tables).to.have.members(['devices', 'texts']);

        await a.deleteSection({ table: 'views', name: 'v1' });
        await waitFor(() => changesB.length === 3);

        // the writer does not reload its own changes, the other schema is another project
        await delay(300);
        expect(changesA).to.have.length(0);
        expect(changesC).to.have.length(0);

        // B sees the content written by A
        const rows = await b.getSection('devices', 'd1');
        expect(JSON.parse(rows[0].value)).to.deep.equal({ id: 'd1' });
    });

    it('stops notifying after listen(null)', async () => {
        const changes = [];
        b.listen(change => changes.push(change));
        b.listen(null);
        await a.setSection({ table: 'views', name: 'v2', value: {} });
        await delay(300);
        expect(changes).to.have.length(0);
    });
});
