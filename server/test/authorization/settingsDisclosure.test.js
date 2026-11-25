'use strict';

const apiIndex = require('../../api');

let expect;

function makeSettings() {
    return {
        language: 'en',
        secureEnabled: true,
        secretCode: 'jwt-secret',
        https: {
            key: Buffer.from('tls-private-key'),
            cert: Buffer.from('tls-certificate')
        },
        smtp: {
            host: 'smtp.internal',
            port: 587,
            username: 'smtp-user',
            password: 'smtp-secret',
            mailsender: 'fuxa@example.com'
        },
        daqstore: {
            type: 'influxDB',
            url: 'http://influx.internal:8086',
            host: 'questdb.internal',
            configurationString: 'http::addr=questdb.internal:9000;username=daq-user;password=daq-secret;',
            database: 'fuxa',
            credentials: {
                username: 'daq-user',
                password: 'daq-secret'
            }
        },
        storage: {
            type: 'postgres',
            postgres: { host: 'pg.internal', port: 5432, database: 'fuxa', user: 'fuxa', password: 'pg-secret', reader: { user: 'fuxa_reader', password: 'reader-secret' } }
        }
    };
}

describe('Security - settings disclosure', () => {
    before(async () => {
        const chai = await import('chai');
        expect = chai.expect;
    });

    it('always removes passwords, credentials and the JWT secret', () => {
        const settings = makeSettings();

        for (const result of [
            apiIndex._getSanitizedSettings(settings),
            apiIndex._getPublicSettings(settings)
        ]) {
            expect(result).to.not.have.property('secretCode');
            expect(result).to.not.have.property('https');
            expect(result.smtp).to.not.have.property('password');
            expect(JSON.stringify(result.daqstore.credentials || {})).to.not.contain('daq-secret');
            expect(JSON.stringify(result)).to.not.contain('pg-secret');
            expect(JSON.stringify(result)).to.not.contain('reader-secret');
        }

        expect(settings).to.deep.equal(makeSettings());
    });

    it('removes infrastructure connection details from public settings', () => {
        const publicSettings = apiIndex._getPublicSettings(makeSettings());

        expect(publicSettings.daqstore).to.not.have.property('credentials');
        expect(publicSettings.smtp).to.not.have.property('host');
        expect(publicSettings.smtp).to.not.have.property('port');
        expect(publicSettings.smtp).to.not.have.property('username');
        expect(publicSettings.smtp.mailsender).to.equal('fuxa@example.com');
        expect(publicSettings.daqstore).to.not.have.property('url');
        expect(publicSettings.daqstore).to.not.have.property('host');
        expect(publicSettings.daqstore).to.not.have.property('configurationString');
        expect(publicSettings.daqstore).to.include({
            type: 'influxDB',
            database: 'fuxa'
        });
        expect(publicSettings.storage).to.deep.equal({ type: 'postgres' });
    });

    it('keeps non-secret connection details available to admins', () => {
        const adminSettings = apiIndex._getSanitizedSettings(makeSettings());

        expect(adminSettings.smtp).to.include({
            host: 'smtp.internal',
            port: 587,
            username: 'smtp-user'
        });
        // DAQ login as the project storage: user name and 'password saved', never the password
        expect(adminSettings.daqstore.credentials).to.deep.equal({ username: 'daq-user', passwordSet: true, tokenSet: false });
        expect(adminSettings.daqstore).to.include({
            url: 'http://influx.internal:8086',
            host: 'questdb.internal',
            configurationString: 'http::addr=questdb.internal:9000;username=daq-user;password=daq-secret;'
        });
    });

    it('keeps the saved DAQ password when the editor sends it empty', () => {
        const merge = apiIndex._mergeDaqCredentials;
        const saved = { username: 'daq-user', password: 'daq-secret' };
        // the editor receives { username, passwordSet } and sends it back with an empty password
        expect(merge({ username: 'daq-user', password: '', passwordSet: true, tokenSet: false }, saved)).to.deep.equal(saved);
        expect(merge({ username: 'other' }, saved)).to.deep.equal({ username: 'other', password: 'daq-secret' });
        expect(merge({ password: 'new-secret' }, saved)).to.deep.equal({ username: 'daq-user', password: 'new-secret' });
        expect(merge({}, saved)).to.deep.equal(saved);
        expect(merge(undefined, saved)).to.deep.equal(saved);
        expect(merge({ username: '' }, saved)).to.deep.equal({ password: 'daq-secret' });
        expect(merge({ token: 'tok' }, null)).to.deep.equal({ token: 'tok' });
    });

    it('does not write secrets to the log when the DAQ storage starts', () => {
        const daqstorage = require('../../runtime/storage/daqstorage');
        const settings = Object.assign(makeSettings(), { oidc: { enabled: true, clientId: 'fuxa', clientSecret: 'oidc-secret' } });
        const lines = [];
        const logger = { info: (msg) => lines.push(msg), warn: () => {}, error: () => {}, debug: () => {} };
        daqstorage.init(settings, logger, {});
        const text = lines.join(' | ');
        expect(text).to.contain('daqstorage: settings');
        for (const secret of ['jwt-secret', 'tls-private-key', 'smtp-secret', 'daq-secret', 'pg-secret', 'reader-secret', 'oidc-secret']) {
            expect(text, secret).to.not.contain(secret);
        }
        expect(settings.oidc.clientSecret).to.equal('oidc-secret');
    });
});
