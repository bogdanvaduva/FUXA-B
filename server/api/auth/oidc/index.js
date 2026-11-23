/**
 * 'api/auth/oidc': OpenID Connect single sign-on
 *  GET /api/auth/oidc/metadata  { enabled, displayName } for the login dialog
 *  GET /api/auth/oidc/login     redirect to the IdP (authorization code + PKCE, state, nonce)
 *  GET /api/auth/oidc/callback  validate, map the identity to a FUXA user, set the refresh cookie, redirect to FUXA
 * See docs/oidc-security.md
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const oidcConfig = require('./config');
const oidcClient = require('./client');
const mapper = require('./mapper');

// In order to work under a reverse proxy, I import the BASE PATH
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

const STATE_COOKIE = 'fuxa_oidc_state';
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_MAX_PENDING = 1000;

var runtime;
var authApi;
var cfg;
var client;
var pending = new Map();            // state -> { nonce, codeVerifier, expires }

function isActive() {
    return oidcConfig.isActive(runtime && runtime.settings);
}

function getCookieValue(req, name) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    for (const cookie of cookieHeader.split(';')) {
        const [key, ...rest] = cookie.trim().split('=');
        if (key === name) {
            try {
                return decodeURIComponent(rest.join('='));
            } catch (err) {
                return null;
            }
        }
    }
    return null;
}

function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        // from the configured public URL, not from the request
        secure: new URL(cfg.redirectUri).protocol === 'https:',
        path: BASE_PATH + '/api/auth/oidc',
    };
}

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    const ba = Buffer.from(a), bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function prunePending() {
    const now = Date.now();
    for (const [state, entry] of pending) {
        if (entry.expires <= now) {
            pending.delete(state);
        }
    }
    // keep the newest when flooded
    while (pending.size >= STATE_MAX_PENDING) {
        pending.delete(pending.keys().next().value);
    }
}

/**
 * Take (single use) the pending login of the state
 */
function takePending(state) {
    const entry = pending.get(state);
    pending.delete(state);
    if (!entry || entry.expires <= Date.now()) {
        return null;
    }
    return entry;
}

function audit(success, details) {
    const text = Object.keys(details).filter(key => details[key] !== undefined && details[key] !== null)
        .map(key => `${key}=${String(details[key]).replace(/[\r\n]/g, ' ').slice(0, 200)}`).join(' ');
    if (success) {
        runtime.logger.info(`oidc-login: success ${text}`);
    } else {
        runtime.logger.warn(`oidc-login: failed ${text}`);
    }
}

function sendErrorPage(res, status) {
    res.status(status).set('Cache-Control', 'no-store').type('html').send(
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Sign-in failed</title></head><body style="font-family:sans-serif;margin:40px">' +
        '<h3>Single sign-on failed</h3><p>The sign-in could not be completed. Try again or contact the administrator.</p>' +
        `<p><a href="${BASE_PATH}/">Return to FUXA</a></p></body></html>`);
}

/**
 * The callback URL validated by openid-client: the configured redirectUri with the query of the request
 * (never built from the Host header)
 */
function getCallbackUrl(req) {
    const url = new URL(cfg.redirectUri);
    const index = req.originalUrl.indexOf('?');
    url.search = index >= 0 ? req.originalUrl.slice(index + 1) : '';
    return url;
}

module.exports = {
    init: function (_runtime, _authApi) {
        runtime = _runtime;
        authApi = _authApi;
        cfg = oidcConfig.getConfig(runtime.settings);
        pending = new Map();
        client = null;
        if (isActive()) {
            client = oidcClient.create(cfg);
            // discovery at boot, retried on the first login if the IdP is not reachable now
            client.getConfiguration().then(() => {
                runtime.logger.info(`oidc: provider ${cfg.issuer} ready`, true);
            }).catch(err => {
                runtime.logger.error(`oidc: discovery of ${cfg.issuer} failed, retry on login: ${err.message}`);
            });
        }
    },
    app: function () {
        var oidcApp = express();
        const limiter = rateLimit({
            windowMs: runtime.settings.authRateLimitWindowMs || 5 * 60 * 1000,
            max: runtime.settings.authRateLimitMax || 100,
        });

        /**
         * GET OIDC metadata for the login dialog
         */
        oidcApp.get('/api/auth/oidc/metadata', function (req, res) {
            const active = isActive() && !!client;
            res.set('Cache-Control', 'no-store').json({ enabled: active, displayName: active ? cfg.displayName : undefined });
        });

        /**
         * GET OIDC login: redirect to the IdP
         */
        oidcApp.get('/api/auth/oidc/login', limiter, async function (req, res) {
            if (!isActive() || !client) {
                return res.status(404).end();
            }
            try {
                const login = await client.startLogin();
                prunePending();
                pending.set(login.state, { nonce: login.nonce, codeVerifier: login.codeVerifier, expires: Date.now() + STATE_TTL_MS });
                res.cookie(STATE_COOKIE, login.state, Object.assign({ maxAge: STATE_TTL_MS }, cookieOptions()));
                res.set('Cache-Control', 'no-store');
                res.redirect(302, login.url.href);
            } catch (err) {
                audit(false, { reason: 'provider_unavailable', error: err.message });
                sendErrorPage(res, 503);
            }
        });

        /**
         * GET OIDC callback: validate the response, map the user, start the FUXA session
         */
        oidcApp.get('/api/auth/oidc/callback', limiter, async function (req, res) {
            if (!isActive() || !client) {
                return res.status(404).end();
            }
            const state = typeof req.query.state === 'string' ? req.query.state : null;
            const cookieState = getCookieValue(req, STATE_COOKIE);
            res.clearCookie(STATE_COOKIE, cookieOptions());
            if (typeof req.query.error === 'string') {
                if (state && safeEqual(state, cookieState)) {
                    pending.delete(state);
                }
                audit(false, { reason: 'idp_error', error: req.query.error });
                return sendErrorPage(res, 401);
            }
            if (!state || !safeEqual(state, cookieState)) {
                audit(false, { reason: 'state_mismatch' });
                return sendErrorPage(res, 401);
            }
            const checks = takePending(state);
            if (!checks) {
                audit(false, { reason: 'state_unknown_or_expired' });
                return sendErrorPage(res, 401);
            }
            let claims;
            try {
                claims = await client.finishLogin(getCallbackUrl(req), { state: state, nonce: checks.nonce, codeVerifier: checks.codeVerifier });
            } catch (err) {
                audit(false, { reason: 'token_validation', error: err.message });
                return sendErrorPage(res, 401);
            }
            try {
                const result = await mapper.mapOidcUser(claims, cfg, runtime.users, !!runtime.settings.userRole);
                const user = result.user;
                if (!authApi.setLoginSession(res, user)) {
                    audit(false, { reason: 'refresh_cookie_disabled', sub: claims.sub });
                    return sendErrorPage(res, 503);
                }
                audit(true, { sub: claims.sub, username: user.username, user: result.action, groups: user.groups });
                runtime.events.emit('access:login', { username: user.username, fullname: user.fullname });
                res.set('Cache-Control', 'no-store');
                res.redirect(302, BASE_PATH + cfg.postLoginRedirect);
            } catch (err) {
                audit(false, { reason: err.reason || 'mapping_failed', sub: claims && claims.sub, error: err.message });
                sendErrorPage(res, 403);
            }
        });

        return oidcApp;
    },
    // for the tests
    _pendingCount: () => pending.size,
};
