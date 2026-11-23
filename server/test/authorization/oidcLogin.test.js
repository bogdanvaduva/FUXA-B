'use strict';

/**
 * OpenID Connect login, end to end against a mock IdP:
 * FUXA /api/auth/oidc/login -> IdP /authorize -> FUXA /callback -> refresh cookie -> /api/refresh -> FUXA token
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const express = require('express');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const { startMockOidcProvider } = require('../help/mockOidcProvider');

const CLIENT_ID = 'fuxa-client';
const CLIENT_SECRET = 'fuxa-client-secret-123';
const SECRET_CODE = 'fuxa-test-jwt-secret';

function freshRequire(modulePath) {
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
}

/**
 * http request without redirects, with a cookie jar
 */
function request(jar, method, url, options = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const headers = Object.assign({}, options.headers || {});
        if (jar && jar.size) {
            headers.Cookie = Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
        }
        let body = options.body;
        if (body && typeof body !== 'string') {
            body = JSON.stringify(body);
            headers['Content-Type'] = 'application/json';
        }
        const req = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: method, headers: headers }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                (res.headers['set-cookie'] || []).forEach(cookie => {
                    const [pair, ...attrs] = cookie.split(';').map(s => s.trim());
                    const [name, ...rest] = pair.split('=');
                    const value = rest.join('=');
                    const expired = attrs.some(a => /^max-age=0$/i.test(a) || /^expires=thu, 01 jan 1970/i.test(a));
                    if (jar) {
                        if (!value || expired) {
                            jar.delete(name);
                        } else {
                            jar.set(name, value);
                        }
                    }
                });
                let json = null;
                try { json = data ? JSON.parse(data) : null; } catch (_) {}
                resolve({ status: res.statusCode, headers: res.headers, body: data, json: json, setCookie: res.headers['set-cookie'] || [] });
            });
        });
        req.on('error', reject);
        req.end(body);
    });
}

describe('OpenID Connect login (mock IdP)', function () {
    this.timeout(20000);
    let expect, idp, fuxa, workDir, users, logs, events, runtime, oidcApi;

    before(async () => {
        expect = (await import('chai')).expect;
        idp = await startMockOidcProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    });

    after(async () => {
        await idp.close();
    });

    /**
     * FUXA app: users store, auth API, OIDC API, a protected API and the admin users API
     */
    async function setup(oidcOverrides = {}, settingsOverrides = {}) {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-oidc-'));
        let handler = (req, res) => res.end();
        const server = http.createServer((req, res) => handler(req, res));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;

        logs = [];
        const logger = {
            info: (msg) => logs.push(['info', String(msg)]),
            warn: (msg) => logs.push(['warn', String(msg)]),
            error: (msg) => logs.push(['error', String(msg)]),
            debug: () => {}
        };
        const settings = Object.assign({
            workDir: workDir,
            secureEnabled: true,
            secretCode: SECRET_CODE,
            tokenExpiresIn: '1h',
            enableRefreshCookieAuth: true,
            refreshTokenExpiresIn: '7d',
            oidc: Object.assign({
                enabled: true,
                issuer: idp.issuer,
                clientId: CLIENT_ID,
                clientSecret: CLIENT_SECRET,
                redirectUri: base + '/api/auth/oidc/callback',
                groupsClaim: 'groups',
                groupsMapping: { 'fuxa-admins': 'admin', 'fuxa-engineers': 'engineer' },
                defaultRole: 'operator',
            }, oidcOverrides)
        }, settingsOverrides);

        users = freshRequire('../../runtime/users');
        await users.init(settings, logger);
        await new Promise(resolve => setTimeout(resolve, 50));     // _loadUsers
        events = new EventEmitter();
        runtime = { settings: settings, logger: logger, users: users, events: events, project: {} };

        const authJwt = require('../../api/jwt-helper');
        authJwt.init(settings.secureEnabled, settings.secretCode, settings.tokenExpiresIn);
        const authApi = freshRequire('../../api/auth');
        authApi.init(runtime, authJwt.secretCode, authJwt.tokenExpiresIn, settings.enableRefreshCookieAuth, settings.refreshTokenExpiresIn);
        oidcApi = freshRequire('../../api/auth/oidc');
        oidcApi.init(runtime, authApi);
        const usersApi = freshRequire('../../api/users');
        usersApi.init(runtime, authJwt.verifyToken, req => (req.isAuthenticated ? req.userGroups : 0));

        const app = express();
        app.use(express.json());
        app.use(authApi.app());
        app.use(oidcApi.app());
        app.get('/api/protected', authJwt.requireAuth, (req, res) => res.json({ id: req.userId, groups: req.userGroups }));
        app.use(usersApi.app());
        handler = app;

        fuxa = { base: base, server: server, settings: settings };
        return fuxa;
    }

    afterEach(async () => {
        if (fuxa) {
            await new Promise(resolve => fuxa.server.close(resolve));
            fuxa = null;
        }
        if (users) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
        idp.next = {};
    });

    /**
     * Browser: FUXA login -> IdP -> FUXA callback
     */
    async function login(jar = new Map()) {
        const start = await request(jar, 'GET', fuxa.base + '/api/auth/oidc/login');
        expect(start.status, start.body).to.equal(302);
        const authorize = await request(null, 'GET', start.headers.location);
        expect(authorize.status, authorize.body).to.equal(302);
        const callbackUrl = authorize.headers.location;
        const callback = await request(jar, 'GET', callbackUrl);
        return { jar: jar, start: start, callbackUrl: callbackUrl, callback: callback };
    }

    async function refresh(jar) {
        return request(jar, 'POST', fuxa.base + '/api/refresh', { body: {} });
    }

    function dbRows(sql, params = []) {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(path.join(workDir, 'users.fuxap.db'), sqlite3.OPEN_READONLY);
            db.all(sql, params, (err, rows) => db.close(() => err ? reject(err) : resolve(rows)));
        });
    }

    describe('metadata', () => {
        it('is enabled with the display name', async () => {
            await setup({ displayName: 'Company SSO' });
            const res = await request(null, 'GET', fuxa.base + '/api/auth/oidc/metadata');
            expect(res.json).to.deep.equal({ enabled: true, displayName: 'Company SSO' });
        });

        it('is disabled when oidc is disabled, and the login routes do not exist', async () => {
            await setup({ enabled: false });
            expect((await request(null, 'GET', fuxa.base + '/api/auth/oidc/metadata')).json).to.deep.equal({ enabled: false });
            expect((await request(null, 'GET', fuxa.base + '/api/auth/oidc/login')).status).to.equal(404);
            expect((await request(null, 'GET', fuxa.base + '/api/auth/oidc/callback?code=x&state=y')).status).to.equal(404);
        });

        it('fails closed when secureEnabled or the refresh cookie are disabled at runtime', async () => {
            await setup();
            fuxa.settings.secureEnabled = false;
            expect((await request(null, 'GET', fuxa.base + '/api/auth/oidc/metadata')).json.enabled).to.equal(false);
            expect((await request(null, 'GET', fuxa.base + '/api/auth/oidc/login')).status).to.equal(404);
            fuxa.settings.secureEnabled = true;
            fuxa.settings.enableRefreshCookieAuth = false;
            expect((await request(null, 'GET', fuxa.base + '/api/auth/oidc/login')).status).to.equal(404);
        });
    });

    describe('full flow', () => {
        it('provisions the user, issues the FUXA token and applies RBAC', async () => {
            await setup();
            const loginEvents = [];
            events.on('access:login', e => loginEvents.push(e));
            idp.next = { claims: { sub: 'sub-alice', preferred_username: 'alice', name: 'Alice Doe', groups: ['other'] } };
            const { jar, start, callback } = await login();

            // authorization request: PKCE S256, state, nonce, configured redirect
            const authz = idp.authorizeRequests[idp.authorizeRequests.length - 1];
            expect(authz.code_challenge_method).to.equal('S256');
            expect(authz.code_challenge).to.match(/^[A-Za-z0-9_-]{43}$/);
            expect(authz.state).to.have.length.greaterThan(20);
            expect(authz.nonce).to.have.length.greaterThan(20);
            expect(authz.redirect_uri).to.equal(fuxa.settings.oidc.redirectUri);
            expect(authz.scope).to.equal('openid profile email');
            expect(start.setCookie.join(';')).to.match(/fuxa_oidc_state=.*HttpOnly/i);
            const tokenReq = idp.tokenRequests[idp.tokenRequests.length - 1];
            expect(tokenReq.basic).to.equal(true);
            expect(tokenReq.body.code_verifier).to.match(/^[A-Za-z0-9_-]{43,128}$/);

            // callback: refresh cookie and redirect to FUXA, the token is never in the URL
            expect(callback.status).to.equal(302);
            expect(callback.headers.location).to.equal('/');
            expect(jar.has('fuxa_refresh')).to.equal(true);
            expect(jar.has('fuxa_oidc_state')).to.equal(false);

            // the client gets the token with the existing refresh flow
            const refreshed = await refresh(jar);
            expect(refreshed.status).to.equal(200);
            expect(refreshed.json.data).to.include({ username: 'alice', fullname: 'Alice Doe', groups: 2 });
            const token = refreshed.json.data.token;
            const decoded = jwt.verify(token, SECRET_CODE);
            expect(decoded.id).to.equal('alice');
            expect(decoded.groups).to.equal(2);
            expect(Object.keys(decoded).sort()).to.deep.equal(['exp', 'groups', 'iat', 'id']);

            // protected API ok, admin API refused
            const protectedRes = await request(null, 'GET', fuxa.base + '/api/protected', { headers: { 'x-access-token': token } });
            expect(protectedRes.json).to.deep.equal({ id: 'alice', groups: 2 });
            const adminRes = await request(null, 'GET', fuxa.base + '/api/users', { headers: { 'x-access-token': token } });
            expect(adminRes.status).to.equal(401);

            // user stored with the subject, without password
            const rows = await dbRows('SELECT username, fullname, password, groups, oidc_sub FROM users WHERE username = ?', ['alice']);
            expect(rows).to.deep.equal([{ username: 'alice', fullname: 'Alice Doe', password: null, groups: 2, oidc_sub: 'sub-alice' }]);
            expect(users.getUserCache('alice').groups).to.equal(2);

            // a password-less OIDC user cannot use the password login
            const signin = await request(null, 'POST', fuxa.base + '/api/signin', { body: { username: 'alice', password: '' } });
            expect(signin.status).to.equal(401);

            // audit
            expect(loginEvents).to.deep.equal([{ username: 'alice', fullname: 'Alice Doe' }]);
            expect(logs.some(([level, msg]) => level === 'info' && msg.includes('oidc-login: success') && msg.includes('sub=sub-alice') && msg.includes('username=alice'))).to.equal(true);
        });

        it('reuses the linked user on the next login, by subject (not username)', async () => {
            await setup();
            idp.next = { claims: { sub: 'sub-bob', preferred_username: 'bob' } };
            await login();
            idp.next = { claims: { sub: 'sub-bob', preferred_username: 'bob.renamed', email: 'bob@example.com' } };
            const { jar, callback } = await login();
            expect(callback.status).to.equal(302);
            expect((await refresh(jar)).json.data.username).to.equal('bob');
            expect(await dbRows('SELECT username FROM users WHERE oidc_sub IS NOT NULL')).to.deep.equal([{ username: 'bob' }]);
        });

        it('maps the IdP groups (admin can call the admin API)', async () => {
            await setup();
            idp.next = { claims: { sub: 'sub-carol', preferred_username: 'carol', groups: ['fuxa-admins'] } };
            const { jar } = await login();
            const data = (await refresh(jar)).json.data;
            expect(data.groups).to.equal(-1);
            const res = await request(null, 'GET', fuxa.base + '/api/users', { headers: { 'x-access-token': data.token } });
            expect(res.status).to.equal(200);
            expect(res.json.map(u => u.username).sort()).to.deep.equal(['admin', 'carol']);
        });

        it('takes the username from userinfo when it is not in the ID token', async () => {
            await setup();
            idp.next = { claims: { sub: 'sub-dave' }, userinfo: { preferred_username: 'dave', name: 'Dave' } };
            const { jar, callback } = await login();
            expect(callback.status).to.equal(302);
            expect((await refresh(jar)).json.data).to.include({ username: 'dave', fullname: 'Dave' });
        });

        it('supports client_secret_post and postLoginRedirect', async () => {
            await setup({ tokenEndpointAuthMethod: 'client_secret_post', postLoginRedirect: '/home' });
            idp.next = { claims: { sub: 'sub-erin', preferred_username: 'erin' } };
            const { callback } = await login();
            expect(callback.headers.location).to.equal('/home');
            const tokenReq = idp.tokenRequests[idp.tokenRequests.length - 1];
            expect(tokenReq.basic).to.equal(false);
            expect(tokenReq.body.client_secret).to.equal(CLIENT_SECRET);
        });
    });

    describe('existing local users', () => {
        it('refuses an IdP username equal to a local user (no takeover of admin)', async () => {
            await setup();
            idp.next = { claims: { sub: 'sub-evil', preferred_username: 'admin', groups: [] } };
            const { jar, callback } = await login();
            expect(callback.status).to.equal(403);
            expect(jar.has('fuxa_refresh')).to.equal(false);
            expect(await dbRows("SELECT oidc_sub, groups FROM users WHERE username = 'admin'")).to.deep.equal([{ oidc_sub: null, groups: -1 }]);
            expect(logs.some(([level, msg]) => level === 'warn' && msg.includes('reason=username_exists'))).to.equal(true);
        });

        it('links the local user with linkExistingUsers, keeping its groups and password', async () => {
            await setup({ linkExistingUsers: true });
            const before = await dbRows("SELECT password FROM users WHERE username = 'admin'");
            idp.next = { claims: { sub: 'sub-admin', preferred_username: 'admin', groups: [] } };
            const { jar } = await login();
            expect((await refresh(jar)).json.data).to.include({ username: 'admin', groups: -1 });
            expect(await dbRows("SELECT password, oidc_sub FROM users WHERE username = 'admin'")).to.deep.equal([{ password: before[0].password, oidc_sub: 'sub-admin' }]);
            // another identity with the same username is refused
            idp.next = { claims: { sub: 'sub-other', preferred_username: 'admin' } };
            expect((await login()).callback.status).to.equal(403);
        });

        it('refuses unknown identities without autoProvisionUsers', async () => {
            await setup({ autoProvisionUsers: false });
            idp.next = { claims: { sub: 'sub-frank', preferred_username: 'frank' } };
            expect((await login()).callback.status).to.equal(403);
            expect(await dbRows("SELECT username FROM users WHERE username = 'frank'")).to.deep.equal([]);
        });

        it('syncGroupsOnLogin updates OIDC users from the IdP groups', async () => {
            await setup({ syncGroupsOnLogin: true });
            idp.next = { claims: { sub: 'sub-gina', preferred_username: 'gina', groups: [] } };
            await login();
            idp.next = { claims: { sub: 'sub-gina', preferred_username: 'gina', groups: ['fuxa-engineers'] } };
            const { jar } = await login();
            expect((await refresh(jar)).json.data.groups).to.equal(4);
            expect(users.getUserCache('gina').groups).to.equal(4);
        });

        it('does not change the groups without syncGroupsOnLogin', async () => {
            await setup();
            idp.next = { claims: { sub: 'sub-hank', preferred_username: 'hank', groups: [] } };
            await login();
            idp.next = { claims: { sub: 'sub-hank', preferred_username: 'hank', groups: ['fuxa-admins'] } };
            const { jar } = await login();
            expect((await refresh(jar)).json.data.groups).to.equal(2);
        });
    });

    describe('state, nonce and ID token validation', () => {
        async function expectRefused(callback, jar, reason) {
            expect(callback.status).to.equal(401);
            expect(callback.headers.location).to.equal(undefined);
            expect(jar.has('fuxa_refresh')).to.equal(false);
            expect(callback.body).to.not.match(/eyJ/);    // no token in the page
            if (reason) {
                expect(logs.some(([level, msg]) => level === 'warn' && msg.includes(`reason=${reason}`)), JSON.stringify(logs)).to.equal(true);
            }
        }

        for (const tamper of ['signature', 'nonce', 'audience', 'expired', 'issuer']) {
            it(`refuses an ID token with a wrong ${tamper}`, async () => {
                await setup();
                idp.next = { claims: { sub: 'sub-tamper', preferred_username: 'tamper' }, tamper: tamper };
                const { jar, callback } = await login();
                await expectRefused(callback, jar, 'token_validation');
                expect(await dbRows("SELECT username FROM users WHERE username = 'tamper'")).to.deep.equal([]);
            });
        }

        it('refuses a callback without the state cookie (login CSRF)', async () => {
            await setup();
            idp.next = { claims: { sub: 'sub-x', preferred_username: 'x' } };
            const jar = new Map();
            const start = await request(jar, 'GET', fuxa.base + '/api/auth/oidc/login');
            const authorize = await request(null, 'GET', start.headers.location);
            const victim = new Map();
            await expectRefused(await request(victim, 'GET', authorize.headers.location), victim, 'state_mismatch');
        });

        it('refuses a mismatched state', async () => {
            await setup();
            idp.next = { claims: { sub: 'sub-x', preferred_username: 'x' } };
            const jar = new Map();
            const start = await request(jar, 'GET', fuxa.base + '/api/auth/oidc/login');
            const authorize = await request(null, 'GET', start.headers.location);
            const url = new URL(authorize.headers.location);
            url.searchParams.set('state', 'forged-state');
            await expectRefused(await request(jar, 'GET', url.href), jar, 'state_mismatch');
        });

        it('refuses a replayed callback (state is single use)', async () => {
            await setup();
            idp.next = { claims: { sub: 'sub-y', preferred_username: 'y' } };
            const jar = new Map();
            const start = await request(jar, 'GET', fuxa.base + '/api/auth/oidc/login');
            const stateCookie = jar.get('fuxa_oidc_state');
            const authorize = await request(null, 'GET', start.headers.location);
            expect((await request(jar, 'GET', authorize.headers.location)).status).to.equal(302);
            const replayJar = new Map([['fuxa_oidc_state', stateCookie]]);
            await expectRefused(await request(replayJar, 'GET', authorize.headers.location), replayJar, 'state_unknown_or_expired');
            expect(oidcApi._pendingCount()).to.equal(0);
        });

        it('refuses an IdP error response', async () => {
            await setup();
            idp.next = { authorizeError: 'access_denied' };
            const { jar, callback } = await login();
            await expectRefused(callback, jar, 'idp_error');
        });

        it('never logs tokens, codes or the client secret', async () => {
            await setup();
            idp.next = { claims: { sub: 'sub-z', preferred_username: 'z' } };
            const { callbackUrl } = await login();
            const code = new URL(callbackUrl).searchParams.get('code');
            const all = logs.map(l => l[1]).join('\n');
            expect(all).to.not.contain(code);
            expect(all).to.not.contain(CLIENT_SECRET);
            expect(all).to.not.match(/eyJ[A-Za-z0-9_-]+\./);
        });
    });

    describe('rate limit', () => {
        it('limits the login and callback requests', async () => {
            await setup({}, { authRateLimitMax: 3 });
            const statuses = [];
            for (let i = 0; i < 4; i++) {
                statuses.push((await request(null, 'GET', fuxa.base + '/api/auth/oidc/login')).status);
            }
            expect(statuses).to.deep.equal([302, 302, 302, 429]);
        });
    });
});
