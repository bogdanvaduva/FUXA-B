'use strict';

/**
 * Minimal OpenID Connect provider for the tests (authorization code + PKCE S256, RS256 ID token, JWKS, userinfo)
 * provider.next = { claims, userinfo, tamper } sets what the next login returns
 *   tamper: 'signature' | 'nonce' | 'audience' | 'expired' | 'issuer'
 */

const crypto = require('crypto');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

function base64url(buffer) {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function startMockOidcProvider(options) {
    const clientId = options.clientId;
    const clientSecret = options.clientSecret;
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otherKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = Object.assign(keys.publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
    const codes = new Map();
    const accessTokens = new Map();
    const provider = {
        next: {},
        authorizeRequests: [],
        tokenRequests: [],
    };

    const app = express();
    app.use(express.urlencoded({ extended: false }));

    app.get('/.well-known/openid-configuration', (req, res) => {
        res.json({
            issuer: provider.issuer,
            authorization_endpoint: provider.issuer + '/authorize',
            token_endpoint: provider.issuer + '/token',
            jwks_uri: provider.issuer + '/jwks',
            userinfo_endpoint: provider.issuer + '/userinfo',
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        });
    });

    app.get('/jwks', (req, res) => res.json({ keys: [jwk] }));

    app.get('/authorize', (req, res) => {
        const q = req.query;
        provider.authorizeRequests.push(Object.assign({}, q));
        if (q.client_id !== clientId || q.response_type !== 'code' || !q.redirect_uri || q.code_challenge_method !== 'S256' || !q.code_challenge || !q.state || !q.nonce) {
            return res.status(400).send('invalid authorization request');
        }
        const redirect = new URL(q.redirect_uri);
        if (provider.next.authorizeError) {
            redirect.searchParams.set('error', provider.next.authorizeError);
            redirect.searchParams.set('state', q.state);
            return res.redirect(302, redirect.href);
        }
        const code = base64url(crypto.randomBytes(24));
        codes.set(code, { nonce: q.nonce, challenge: q.code_challenge, redirectUri: q.redirect_uri, next: provider.next });
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', q.state);
        res.redirect(302, redirect.href);
    });

    app.post('/token', (req, res) => {
        let id, secret;
        const auth = req.headers.authorization;
        if (auth && auth.startsWith('Basic ')) {
            const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
            id = decodeURIComponent(user);
            secret = decodeURIComponent(pass);
        } else {
            id = req.body.client_id;
            secret = req.body.client_secret;
        }
        provider.tokenRequests.push({ basic: !!auth, body: Object.assign({}, req.body) });
        if (id !== clientId || secret !== clientSecret) {
            return res.status(401).json({ error: 'invalid_client' });
        }
        const entry = codes.get(req.body.code);
        codes.delete(req.body.code);
        if (req.body.grant_type !== 'authorization_code' || !entry || entry.redirectUri !== req.body.redirect_uri) {
            return res.status(400).json({ error: 'invalid_grant' });
        }
        const challenge = base64url(crypto.createHash('sha256').update(req.body.code_verifier || '').digest());
        if (challenge !== entry.challenge) {
            return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
        }
        const now = Math.floor(Date.now() / 1000);
        const tamper = entry.next.tamper;
        const payload = Object.assign({
            iss: tamper === 'issuer' ? 'https://evil.example.com' : provider.issuer,
            aud: tamper === 'audience' ? 'another-client' : clientId,
            nonce: tamper === 'nonce' ? 'wrong-nonce' : entry.nonce,
            iat: tamper === 'expired' ? now - 7200 : now,
            exp: tamper === 'expired' ? now - 3600 : now + 300,
        }, entry.next.claims || { sub: 'user-1' });
        const signingKey = tamper === 'signature' ? otherKeys.privateKey : keys.privateKey;
        const idToken = jwt.sign(payload, signingKey, { algorithm: 'RS256', keyid: 'k1' });
        const accessToken = base64url(crypto.randomBytes(24));
        accessTokens.set(accessToken, Object.assign({ sub: payload.sub }, entry.next.userinfo || {}));
        res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 300, id_token: idToken });
    });

    app.get('/userinfo', (req, res) => {
        const auth = req.headers.authorization || '';
        const info = accessTokens.get(auth.replace(/^Bearer /, ''));
        if (!info) {
            return res.status(401).end();
        }
        res.json(info);
    });

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    provider.issuer = `http://127.0.0.1:${server.address().port}`;
    provider.close = () => new Promise(resolve => server.close(resolve));
    return provider;
}

module.exports = { startMockOidcProvider: startMockOidcProvider };
