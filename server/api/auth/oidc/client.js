/**
 * OpenID Connect client (openid-client): discovery, authorization URL (state, nonce, PKCE S256)
 * and the callback (code exchange, ID token signature and claims validation, userinfo)
 */

'use strict';

const { isLocalHost } = require('./config');

var oidcLib;

/**
 * openid-client is an ES module
 */
async function getLib() {
    if (!oidcLib) {
        oidcLib = await import('openid-client');
    }
    return oidcLib;
}

/**
 * OIDC client of the configuration, the IdP metadata is discovered once (retried after a failure)
 * @param {*} cfg oidc config (config.getConfig)
 */
function create(cfg) {
    var configurationPromise = null;

    async function discover() {
        const lib = await getLib();
        const issuer = new URL(cfg.issuer);
        const clientAuth = cfg.tokenEndpointAuthMethod === 'client_secret_post'
            ? lib.ClientSecretPost(cfg.clientSecret)
            : lib.ClientSecretBasic(cfg.clientSecret);
        const metadata = {
            redirect_uris: [cfg.redirectUri],
            response_types: ['code'],
            [lib.clockTolerance]: cfg.clockTolerance,
        };
        const options = { timeout: 10 };
        if (issuer.protocol === 'http:' && isLocalHost(issuer.hostname)) {
            // development only, validated in config: http is refused for other hosts
            options.execute = [lib.allowInsecureRequests];
        }
        const configuration = await lib.discovery(issuer, cfg.clientId, metadata, clientAuth, options);
        // verify the ID token signature with the IdP JWKS (not only the TLS channel)
        lib.enableNonRepudiationChecks(configuration);
        const methods = configuration.serverMetadata().code_challenge_methods_supported;
        if (Array.isArray(methods) && !methods.includes('S256')) {
            throw new Error('the IdP does not support PKCE S256');
        }
        return configuration;
    }

    function getConfiguration() {
        if (!configurationPromise) {
            configurationPromise = discover().catch(err => {
                configurationPromise = null;
                throw err;
            });
        }
        return configurationPromise;
    }

    /**
     * Authorization request: URL of the IdP and the checks to keep until the callback
     */
    async function startLogin() {
        const lib = await getLib();
        const configuration = await getConfiguration();
        const codeVerifier = lib.randomPKCECodeVerifier();
        const codeChallenge = await lib.calculatePKCECodeChallenge(codeVerifier);
        const state = lib.randomState();
        const nonce = lib.randomNonce();
        const url = lib.buildAuthorizationUrl(configuration, {
            redirect_uri: cfg.redirectUri,
            scope: cfg.scope,
            response_type: 'code',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state: state,
            nonce: nonce,
        });
        return { url: url, state: state, nonce: nonce, codeVerifier: codeVerifier };
    }

    /**
     * Callback: exchange the code and validate the ID token, return its claims (+ userinfo)
     * @param {URL} callbackUrl redirectUri with the query of the callback request
     * @param {*} checks { state, nonce, codeVerifier } of startLogin
     */
    async function finishLogin(callbackUrl, checks) {
        const lib = await getLib();
        const configuration = await getConfiguration();
        const tokens = await lib.authorizationCodeGrant(configuration, callbackUrl, {
            pkceCodeVerifier: checks.codeVerifier,
            expectedState: checks.state,
            expectedNonce: checks.nonce,
            idTokenExpected: true,
        });
        const claims = Object.assign({}, tokens.claims());
        const needed = [cfg.usernameClaim, cfg.fullnameClaim, cfg.groupsClaim].filter(name => name);
        if (needed.some(name => claims[name] === undefined) && tokens.access_token && configuration.serverMetadata().userinfo_endpoint) {
            // the subject of the userinfo must be the ID token one (checked by fetchUserInfo)
            const userinfo = await lib.fetchUserInfo(configuration, tokens.access_token, claims.sub);
            Object.keys(userinfo).forEach(key => {
                if (claims[key] === undefined) {
                    claims[key] = userinfo[key];
                }
            });
        }
        return claims;
    }

    return {
        getConfiguration: getConfiguration,
        startLogin: startLogin,
        finishLogin: finishLogin,
    };
}

module.exports = {
    create: create,
    getLib: getLib,
};
