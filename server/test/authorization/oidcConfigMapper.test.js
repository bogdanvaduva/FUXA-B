'use strict';

/**
 * OpenID Connect: settings validation (fail closed), boot refusal, user mapping, settings disclosure
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const oidcConfig = require('../../api/auth/oidc/config');
const mapper = require('../../api/auth/oidc/mapper');
const apiIndex = require('../../api');

function validSettings(oidc = {}, extra = {}) {
    return Object.assign({
        secureEnabled: true,
        enableRefreshCookieAuth: true,
        oidc: Object.assign({
            enabled: true,
            issuer: 'https://idp.example.com/realms/fuxa',
            clientId: 'fuxa',
            clientSecret: 'secret',
            redirectUri: 'https://fuxa.example.com/api/auth/oidc/callback',
        }, oidc)
    }, extra);
}

/**
 * In-memory runtime.users for the mapper
 */
function fakeUsers(initial = [], roles = []) {
    const rows = initial.map(u => Object.assign({ fullname: '', password: null, groups: 0, info: null, oidc_sub: null }, u));
    const calls = [];
    const pick = r => ({ username: r.username, fullname: r.fullname, password: r.password, groups: r.groups, info: r.info });
    return {
        rows: rows,
        calls: calls,
        getRoles: async () => roles,
        getUserByOidcSub: async (sub) => { const r = rows.find(x => x.oidc_sub === sub); return r ? pick(r) : undefined; },
        getOidcSub: async (username) => { const r = rows.find(x => x.username === username); return r ? r.oidc_sub : null; },
        getUsers: async (q) => { const r = rows.filter(x => x.username === q.username).map(pick); return r.length ? r : undefined; },
        linkOidcSub: async (username, sub) => { calls.push(['link', username, sub]); rows.find(x => x.username === username).oidc_sub = sub; },
        createOidcUser: async (u) => {
            calls.push(['create', u.username]);
            if (rows.some(x => x.username === u.username || x.oidc_sub === u.oidcSub)) throw new Error('UNIQUE constraint failed');
            rows.push({ username: u.username, fullname: u.fullname, password: null, groups: u.groups, info: u.info, oidc_sub: u.oidcSub });
        },
        setOidcUserPermissions: async (username, sub, groups, info) => {
            calls.push(['sync', username, groups]);
            Object.assign(rows.find(x => x.oidc_sub === sub), { groups: groups, info: info });
        },
    };
}

describe('OpenID Connect settings and mapping', function () {
    let expect;

    before(async () => {
        expect = (await import('chai')).expect;
    });

    describe('settings validation (fail closed)', () => {
        it('accepts disabled or missing oidc', () => {
            expect(oidcConfig.validate({})).to.deep.equal([]);
            expect(oidcConfig.validate({ oidc: { enabled: false } })).to.deep.equal([]);
            expect(oidcConfig.validate({ oidc: { enabled: 'yes' } })).to.deep.equal([]);
        });

        it('accepts a valid configuration', () => {
            expect(oidcConfig.validate(validSettings())).to.deep.equal([]);
            expect(oidcConfig.isActive(validSettings())).to.equal(true);
        });

        it('requires secureEnabled and enableRefreshCookieAuth', () => {
            expect(oidcConfig.validate(validSettings({}, { secureEnabled: false })).join()).to.contain('requires secureEnabled');
            expect(oidcConfig.validate(validSettings({}, { enableRefreshCookieAuth: false })).join()).to.contain('requires enableRefreshCookieAuth');
            expect(oidcConfig.isActive(validSettings({}, { secureEnabled: false }))).to.equal(false);
        });

        it('requires https except for localhost', () => {
            expect(oidcConfig.validate(validSettings({ issuer: 'http://idp.example.com' })).join()).to.contain('oidc.issuer must use https');
            expect(oidcConfig.validate(validSettings({ redirectUri: 'http://fuxa.example.com/api/auth/oidc/callback' })).join()).to.contain('oidc.redirectUri must use https');
            expect(oidcConfig.validate(validSettings({ issuer: 'http://localhost:8080/realms/x', redirectUri: 'http://127.0.0.1:1881/api/auth/oidc/callback' }))).to.deep.equal([]);
        });

        it('requires the mandatory fields', () => {
            const errors = oidcConfig.validate({ secureEnabled: true, enableRefreshCookieAuth: true, oidc: { enabled: true } }).join('\n');
            ['oidc.issuer', 'oidc.clientId', 'oidc.clientSecret', 'oidc.redirectUri'].forEach(name => expect(errors).to.contain(name));
        });

        it('checks the redirect URI path, scope, auth method and clock tolerance', () => {
            expect(oidcConfig.validate(validSettings({ redirectUri: 'https://fuxa.example.com/other' })).join()).to.contain('must end with /api/auth/oidc/callback');
            expect(oidcConfig.validate(validSettings({ redirectUri: 'https://fuxa.example.com/fuxa/api/auth/oidc/callback' }))).to.deep.equal([]);
            expect(oidcConfig.validate(validSettings({ scope: 'profile email' })).join()).to.contain("include 'openid'");
            expect(oidcConfig.validate(validSettings({ tokenEndpointAuthMethod: 'none' })).join()).to.contain('tokenEndpointAuthMethod');
            expect(oidcConfig.validate(validSettings({ clockTolerance: 1000 })).join()).to.contain('clockTolerance');
        });

        it('refuses an open redirect after login', () => {
            for (const value of ['https://evil.example.com', '//evil.example.com', '/\\evil.example.com', 'home']) {
                expect(oidcConfig.validate(validSettings({ postLoginRedirect: value })).join(), value).to.contain('postLoginRedirect');
            }
            expect(oidcConfig.validate(validSettings({ postLoginRedirect: '/home' }))).to.deep.equal([]);
        });

        it('checks the groups of defaultRole and groupsMapping (roles are resolved at login)', () => {
            expect(oidcConfig.validate(validSettings({ defaultRole: 'superuser' })).join()).to.contain('defaultRole');
            expect(oidcConfig.validate(validSettings({ groupsMapping: { a: 'engineer', b: 6, c: 'nope' } })).join()).to.contain("groupsMapping['c']");
            expect(oidcConfig.validate(validSettings({ defaultRole: 'any-role' }, { userRole: true }))).to.deep.equal([]);
        });

        it('FUXA refuses to start with an invalid enabled oidc', function (done) {
            this.timeout(30000);
            const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-oidc-boot-'));
            fs.mkdirSync(path.join(userDir, '_appdata'));
            const defaults = path.resolve(__dirname, '../../settings.default.js').replace(/\\/g, '/');
            fs.writeFileSync(path.join(userDir, '_appdata', 'settings.js'),
                `module.exports = Object.assign({}, require('${defaults}'), { uiPort: 0, secureEnabled: false, oidc: { enabled: true } });`);
            const child = spawn(process.execPath, [path.resolve(__dirname, '../../main.js'), '--userDir', userDir], { stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', d => { output += d; });
            child.stderr.on('data', d => { output += d; });
            const timer = setTimeout(() => child.kill(), 25000);
            child.on('exit', (code) => {
                clearTimeout(timer);
                try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
                try {
                    expect(code, output).to.equal(1);
                    expect(output).to.contain('oidc.enabled requires secureEnabled');
                    expect(output).to.contain('FUXA does not start');
                    expect(output).to.not.contain('WebServer is running');
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });
    });

    describe('settings disclosure', () => {
        it('never returns the client secret', () => {
            const settings = validSettings({ clientSecret: 'very-secret-value' });
            const admin = apiIndex._getSanitizedSettings(settings);
            const pub = apiIndex._getPublicSettings(settings);
            expect(JSON.stringify(admin)).to.not.contain('very-secret-value');
            expect(admin.oidc.clientId).to.equal('fuxa');
            expect(pub.oidc).to.deep.equal({ enabled: true });
            expect(settings.oidc.clientSecret).to.equal('very-secret-value');
        });
    });

    describe('mapper', () => {
        const cfg = (overrides = {}) => oidcConfig.getConfig({ oidc: Object.assign({ groupsClaim: 'groups', groupsMapping: { ops: 'operator', eng: 'engineer', adm: 'admin' } }, overrides) });

        it('sanitizes the username', () => {
            expect(mapper.sanitizeUsername(' alice ')).to.equal('alice');
            expect(mapper.sanitizeUsername('a.b-c_d@example.com')).to.equal('a.b-c_d@example.com');
            for (const bad of ['', 'a b', '<script>', 'x'.repeat(65), 'guest', 'GUEST', 42, null, ['a']]) {
                expect(mapper.sanitizeUsername(bad), String(bad)).to.equal(null);
            }
        });

        it('combines the mapped groups, admin wins, defaultRole otherwise', () => {
            expect(mapper.computeGroups({ groups: ['ops', 'eng', 'other'] }, cfg())).to.equal(6);
            expect(mapper.computeGroups({ groups: 'ops eng' }, cfg())).to.equal(6);
            expect(mapper.computeGroups({ groups: ['ops', 'adm'] }, cfg())).to.equal(-1);
            expect(mapper.computeGroups({ groups: ['other'] }, cfg())).to.equal(2);
            expect(mapper.computeGroups({}, cfg({ defaultRole: 'viewer' }))).to.equal(1);
            expect(mapper.computeGroups({ groups: [{ name: 'ops' }] }, cfg())).to.equal(2);
        });

        it('creates a new user without password', async () => {
            const users = fakeUsers();
            const result = await mapper.mapOidcUser({ sub: 's1', preferred_username: 'alice', name: 'Alice', groups: ['eng'] }, cfg(), users, false);
            expect(result.action).to.equal('created');
            expect(result.user).to.deep.equal({ username: 'alice', fullname: 'Alice', groups: 4, info: '{}' });
            expect(users.rows[0]).to.include({ username: 'alice', password: null, oidc_sub: 's1' });
        });

        it('returns the linked user by sub, whatever the username claim', async () => {
            const users = fakeUsers([{ username: 'alice', oidc_sub: 's1', groups: 2 }]);
            const result = await mapper.mapOidcUser({ sub: 's1', preferred_username: 'someone-else' }, cfg(), users, false);
            expect(result.action).to.equal('linked');
            expect(result.user.username).to.equal('alice');
            expect(users.calls).to.deep.equal([]);
        });

        it('refuses missing sub, missing or invalid username', async () => {
            const cases = [[{ preferred_username: 'a' }, 'missing_sub'], [{ sub: 's' }, 'missing_username_claim'], [{ sub: 's', preferred_username: 'a b' }, 'invalid_username'], [{ sub: 's', preferred_username: 'guest' }, 'invalid_username']];
            for (const [claims, reason] of cases) {
                let error;
                await mapper.mapOidcUser(claims, cfg(), fakeUsers(), false).catch(err => { error = err; });
                expect(error, reason).to.be.instanceOf(mapper.OidcMappingError);
                expect(error.reason).to.equal(reason);
            }
        });

        it('refuses a username linked to another identity (duplicate)', async () => {
            const users = fakeUsers([{ username: 'alice', oidc_sub: 's-original' }]);
            let error;
            await mapper.mapOidcUser({ sub: 's-other', preferred_username: 'alice' }, cfg({ linkExistingUsers: true }), users, false).catch(err => { error = err; });
            expect(error.reason).to.equal('username_linked_to_other_identity');
            expect(users.rows[0].oidc_sub).to.equal('s-original');
        });

        it('links an existing local user only with linkExistingUsers, without changing it', async () => {
            const local = { username: 'bob', password: '$2a$hash', groups: 8, info: '{"start":"v1"}' };
            let error;
            await mapper.mapOidcUser({ sub: 's2', preferred_username: 'bob', groups: ['adm'] }, cfg(), fakeUsers([local]), false).catch(err => { error = err; });
            expect(error.reason).to.equal('username_exists');

            const users = fakeUsers([local]);
            const result = await mapper.mapOidcUser({ sub: 's2', preferred_username: 'bob', groups: ['adm'] }, cfg({ linkExistingUsers: true, syncGroupsOnLogin: true }), users, false);
            expect(result.action).to.equal('linked-existing');
            expect(result.user).to.include({ username: 'bob', groups: 8, password: '$2a$hash' });
            expect(users.calls).to.deep.equal([['link', 'bob', 's2']]);
            // sync never applies to a user with a local password
            await mapper.mapOidcUser({ sub: 's2', preferred_username: 'bob', groups: ['adm'] }, cfg({ syncGroupsOnLogin: true }), users, false);
            expect(users.rows[0].groups).to.equal(8);
        });

        it('syncs only password-less users and keeps the other info fields', async () => {
            const users = fakeUsers([{ username: 'carl', oidc_sub: 's3', groups: 2, info: '{"start":"v2"}' }]);
            const result = await mapper.mapOidcUser({ sub: 's3', groups: ['eng'] }, cfg({ syncGroupsOnLogin: true }), users, false);
            expect(result.user.groups).to.equal(4);
            expect(users.rows[0]).to.include({ groups: 4, info: '{"start":"v2"}' });
        });

        it('refuses unknown identities without autoProvisionUsers', async () => {
            let error;
            await mapper.mapOidcUser({ sub: 's4', preferred_username: 'dan' }, cfg({ autoProvisionUsers: false }), fakeUsers(), false).catch(err => { error = err; });
            expect(error.reason).to.equal('not_provisioned');
        });

        it('maps to roles with userRole (by id or name)', async () => {
            const roles = [{ id: 'r-op', name: 'Operators' }, { id: 'r-eng', name: 'Engineers' }];
            const users = fakeUsers([], roles);
            const config = cfg({ groupsMapping: { eng: 'Engineers', ops: 'r-op' }, defaultRole: 'operators' });
            const created = await mapper.mapOidcUser({ sub: 's5', preferred_username: 'eve', groups: ['eng', 'ops'] }, config, users, true);
            expect(created.user.groups).to.equal(0);
            expect(JSON.parse(created.user.info).roles.sort()).to.deep.equal(['r-eng', 'r-op']);
            const byDefault = await mapper.mapOidcUser({ sub: 's6', preferred_username: 'fay' }, config, users, true);
            expect(JSON.parse(byDefault.user.info).roles).to.deep.equal(['r-op']);
            let error;
            await mapper.mapOidcUser({ sub: 's7', preferred_username: 'gus' }, cfg({ defaultRole: 'missing' }), users, true).catch(err => { error = err; });
            expect(error.reason).to.equal('invalid_default_role');
        });
    });
});
