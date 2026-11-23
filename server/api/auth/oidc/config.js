/**
 * OpenID Connect settings (settings.oidc): defaults, normalization and the boot validation (fail closed)
 * See docs/oidc-security.md
 */

'use strict';

const DEFAULTS = {
    enabled: false,
    displayName: 'SSO',                     // label of the login button
    issuer: '',                             // https://idp.example.com/realms/fuxa (discovery: <issuer>/.well-known/openid-configuration)
    clientId: '',
    clientSecret: '',
    redirectUri: '',                        // https://fuxa.example.com/api/auth/oidc/callback (as registered at the IdP)
    scope: 'openid profile email',
    usernameClaim: 'preferred_username',    // FUXA username of a new user
    fullnameClaim: 'name',
    groupsClaim: '',                        // optional IdP claim with the groups/roles of the user, used with groupsMapping
    groupsMapping: {},                      // { '<IdP group>': '<FUXA group name | bitmask | role id/name>' }
    autoProvisionUsers: true,               // create the FUXA user on the first login
    defaultRole: 'operator',                // FUXA group (or role, with userRole) of a new user without mapped groups
    linkExistingUsers: false,               // link an IdP identity to an existing local user with the same username
    syncGroupsOnLogin: false,               // recompute the groups/roles of OIDC-only users on every login
    tokenEndpointAuthMethod: 'client_secret_basic',     // or 'client_secret_post'
    clockTolerance: 60,                     // seconds
    postLoginRedirect: '/',                 // path in FUXA (relative to BASE_PATH) opened after the login
};

const TOKEN_ENDPOINT_AUTH_METHODS = ['client_secret_basic', 'client_secret_post'];

// FUXA user groups (client/src/app/_models/user.ts UserGroups), 'admin' is the built-in administrator value
const GROUPS = {
    viewer: 1,
    operator: 2,
    engineer: 4,
    supervisor: 8,
    manager: 16,
    f: 32,
    g: 64,
    administrator: 128,
    admin: -1,
};

const CALLBACK_PATH = '/api/auth/oidc/callback';

/**
 * settings.oidc merged with the defaults
 * @param {*} settings application settings
 */
function getConfig(settings) {
    const cfg = Object.assign({}, DEFAULTS, (settings && settings.oidc) || {});
    cfg.groupsMapping = Object.assign({}, (settings && settings.oidc && settings.oidc.groupsMapping) || {});
    cfg.clockTolerance = Number(cfg.clockTolerance);
    return cfg;
}

function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/**
 * https, or http only to localhost (development)
 */
function checkUrl(value, name, errors) {
    let url;
    try {
        url = new URL(value);
    } catch (err) {
        errors.push(`${name} '${value}' is not an absolute URL`);
        return null;
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
        errors.push(`${name} must use https (http is accepted only for localhost)`);
    }
    return url;
}

/**
 * FUXA groups value of a group name or bitmask, null if not valid
 * @param {*} value
 */
function toGroupsValue(value) {
    if (typeof value === 'number' && Number.isInteger(value) && (value === -1 || (value >= 0 && value <= 255))) {
        return value;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
        return toGroupsValue(Number(value.trim()));
    }
    if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(GROUPS, value.trim().toLowerCase())) {
        return GROUPS[value.trim().toLowerCase()];
    }
    return null;
}

/**
 * Errors of the OIDC settings, empty if OIDC is disabled or correctly configured
 * FUXA does not start with errors (fail closed)
 * @param {*} settings application settings
 */
function validate(settings) {
    const errors = [];
    if (!settings || !settings.oidc || settings.oidc.enabled !== true) {
        return errors;
    }
    const cfg = getConfig(settings);
    if (!settings.secureEnabled) {
        errors.push('oidc.enabled requires secureEnabled: true');
    }
    if (!settings.enableRefreshCookieAuth) {
        errors.push('oidc.enabled requires enableRefreshCookieAuth: true (the login is completed with the refresh cookie)');
    }
    if (!cfg.issuer) {
        errors.push('oidc.issuer is required');
    } else {
        checkUrl(cfg.issuer, 'oidc.issuer', errors);
    }
    if (!cfg.clientId) {
        errors.push('oidc.clientId is required');
    }
    if (!TOKEN_ENDPOINT_AUTH_METHODS.includes(cfg.tokenEndpointAuthMethod)) {
        errors.push(`oidc.tokenEndpointAuthMethod must be one of ${TOKEN_ENDPOINT_AUTH_METHODS.join(', ')}`);
    }
    if (!cfg.clientSecret) {
        errors.push('oidc.clientSecret is required');
    }
    if (!cfg.redirectUri) {
        errors.push(`oidc.redirectUri is required (https://<fuxa>${CALLBACK_PATH})`);
    } else {
        const url = checkUrl(cfg.redirectUri, 'oidc.redirectUri', errors);
        if (url && !url.pathname.endsWith(CALLBACK_PATH)) {
            errors.push(`oidc.redirectUri path must end with ${CALLBACK_PATH}`);
        }
    }
    if (typeof cfg.scope !== 'string' || !cfg.scope.split(/\s+/).includes('openid')) {
        errors.push("oidc.scope must include 'openid'");
    }
    if (!cfg.usernameClaim || typeof cfg.usernameClaim !== 'string') {
        errors.push('oidc.usernameClaim is required');
    }
    if (typeof cfg.postLoginRedirect !== 'string' || !/^\/(?![\/\\])/.test(cfg.postLoginRedirect)) {
        errors.push("oidc.postLoginRedirect must be a path starting with a single '/'");
    }
    if (!Number.isFinite(cfg.clockTolerance) || cfg.clockTolerance < 0 || cfg.clockTolerance > 300) {
        errors.push('oidc.clockTolerance must be between 0 and 300 seconds');
    }
    if (typeof cfg.groupsMapping !== 'object' || Array.isArray(cfg.groupsMapping)) {
        errors.push('oidc.groupsMapping must be an object { "<IdP group>": "<FUXA group or role>" }');
    }
    if (!settings.userRole) {
        // groups mode: the values must be FUXA groups (roles are resolved at login, they are in the users database)
        if (toGroupsValue(cfg.defaultRole) === null) {
            errors.push(`oidc.defaultRole '${cfg.defaultRole}' is not a FUXA group (${Object.keys(GROUPS).join(', ')} or a bitmask 0-255)`);
        }
        Object.keys(cfg.groupsMapping || {}).forEach(key => {
            if (toGroupsValue(cfg.groupsMapping[key]) === null) {
                errors.push(`oidc.groupsMapping['${key}'] '${cfg.groupsMapping[key]}' is not a FUXA group`);
            }
        });
    }
    return errors;
}

/**
 * OIDC usable now: enabled, valid and the required security settings still on
 * (secureEnabled / enableRefreshCookieAuth can be changed at runtime from the editor)
 * @param {*} settings application settings
 */
function isActive(settings) {
    return !!(settings && settings.oidc && settings.oidc.enabled === true && settings.secureEnabled &&
        settings.enableRefreshCookieAuth && validate(settings).length === 0);
}

module.exports = {
    DEFAULTS: DEFAULTS,
    GROUPS: GROUPS,
    CALLBACK_PATH: CALLBACK_PATH,
    getConfig: getConfig,
    validate: validate,
    isActive: isActive,
    isLocalHost: isLocalHost,
    toGroupsValue: toGroupsValue,
};
