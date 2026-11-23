/**
 * OpenID Connect: map the validated claims of the IdP to a FUXA user
 * The subject (sub) is the identity; the username claim only names a new user.
 * Existing local users are never linked or changed without the explicit policy (linkExistingUsers / syncGroupsOnLogin).
 */

'use strict';

const { toGroupsValue } = require('./config');

const USERNAME_PATTERN = /^[A-Za-z0-9._@+-]{1,64}$/;
const RESERVED_USERNAMES = ['guest'];

/**
 * Login refused, reason is a stable code for the audit log
 */
class OidcMappingError extends Error {
    constructor(reason, message) {
        super(message || reason);
        this.reason = reason;
    }
}

function sanitizeUsername(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const username = value.trim();
    if (!USERNAME_PATTERN.test(username) || RESERVED_USERNAMES.includes(username.toLowerCase())) {
        return null;
    }
    return username;
}

/**
 * IdP groups of the claims (array or space/comma separated string)
 */
function getClaimGroups(claims, groupsClaim) {
    if (!groupsClaim) {
        return [];
    }
    const value = claims[groupsClaim];
    if (Array.isArray(value)) {
        return value.filter(v => typeof v === 'string');
    }
    if (typeof value === 'string') {
        return value.split(/[\s,]+/).filter(v => v);
    }
    return [];
}

/**
 * groups mode: FUXA groups bitmask from the mapped IdP groups, defaultRole if none
 */
function computeGroups(claims, cfg) {
    let result = 0;
    let mapped = false;
    getClaimGroups(claims, cfg.groupsClaim).forEach(group => {
        if (Object.prototype.hasOwnProperty.call(cfg.groupsMapping, group)) {
            const value = toGroupsValue(cfg.groupsMapping[group]);
            if (value === null) {
                return;
            }
            mapped = true;
            result = (value === -1 || result === -1) ? -1 : (result | value);
        }
    });
    if (!mapped) {
        result = toGroupsValue(cfg.defaultRole);
    }
    if (result === null) {
        throw new OidcMappingError('invalid_default_role');
    }
    return result;
}

/**
 * roles mode (settings.userRole): FUXA role ids from the mapped IdP groups, defaultRole if none
 * the values can be role ids or names
 */
async function computeRoles(claims, cfg, users) {
    const roles = (await users.getRoles()) || [];
    const resolve = (value) => {
        if (typeof value !== 'string') {
            return null;
        }
        const role = roles.find(r => r.id === value) || roles.find(r => typeof r.name === 'string' && r.name.toLowerCase() === value.toLowerCase());
        return role ? role.id : null;
    };
    const result = new Set();
    getClaimGroups(claims, cfg.groupsClaim).forEach(group => {
        if (Object.prototype.hasOwnProperty.call(cfg.groupsMapping, group)) {
            const id = resolve(cfg.groupsMapping[group]);
            if (id) {
                result.add(id);
            }
        }
    });
    if (!result.size) {
        const id = resolve(cfg.defaultRole);
        if (!id) {
            throw new OidcMappingError('invalid_default_role', `oidc.defaultRole '${cfg.defaultRole}' is not a FUXA role`);
        }
        result.add(id);
    }
    return Array.from(result);
}

/**
 * groups and info of a user from the claims
 * @param {*} previousInfo info (JSON) to keep the other fields (start view, ...)
 */
async function computePermissions(claims, cfg, users, userRole, previousInfo) {
    let info = {};
    try {
        info = (previousInfo && JSON.parse(previousInfo)) || {};
    } catch (err) {
        info = {};
    }
    if (userRole) {
        info.roles = await computeRoles(claims, cfg, users);
        return { groups: 0, info: JSON.stringify(info) };
    }
    return { groups: computeGroups(claims, cfg), info: JSON.stringify(info) };
}

/**
 * Return the FUXA user { username, fullname, groups, info } of the IdP identity
 * Look up by sub, then (policy) link by username, then (policy) create
 * @param {*} claims validated ID token claims (+ userinfo)
 * @param {*} cfg oidc config (config.getConfig)
 * @param {*} users runtime.users
 * @param {*} userRole settings.userRole
 */
async function mapOidcUser(claims, cfg, users, userRole) {
    const sub = claims && claims.sub;
    if (typeof sub !== 'string' || !sub) {
        throw new OidcMappingError('missing_sub');
    }

    // 1. identity already linked
    const linked = await users.getUserByOidcSub(sub);
    if (linked) {
        if (cfg.syncGroupsOnLogin && !linked.password) {
            // only users without local password (created by OIDC) follow the IdP groups
            const permissions = await computePermissions(claims, cfg, users, userRole, linked.info);
            if (permissions.groups !== linked.groups || permissions.info !== linked.info) {
                await users.setOidcUserPermissions(linked.username, sub, permissions.groups, permissions.info);
                linked.groups = permissions.groups;
                linked.info = permissions.info;
            }
        }
        return { user: linked, action: 'linked' };
    }

    const rawUsername = claims[cfg.usernameClaim];
    if (rawUsername === undefined || rawUsername === null || rawUsername === '') {
        throw new OidcMappingError('missing_username_claim', `claim '${cfg.usernameClaim}' missing`);
    }
    const username = sanitizeUsername(rawUsername);
    if (!username) {
        throw new OidcMappingError('invalid_username', `claim '${cfg.usernameClaim}' is not a valid FUXA username`);
    }

    // 2. existing local user with the same username
    const existing = await users.getUsers({ username: username });
    if (existing && existing.length) {
        const existingSub = await users.getOidcSub(username);
        if (existingSub) {
            // linked to another identity
            throw new OidcMappingError('username_linked_to_other_identity', `user '${username}' is linked to another identity`);
        }
        if (!cfg.linkExistingUsers) {
            throw new OidcMappingError('username_exists', `local user '${username}' exists and oidc.linkExistingUsers is false`);
        }
        await users.linkOidcSub(username, sub);
        return { user: existing[0], action: 'linked-existing' };
    }

    // 3. new user
    if (!cfg.autoProvisionUsers) {
        throw new OidcMappingError('not_provisioned', `no FUXA user for this identity and oidc.autoProvisionUsers is false`);
    }
    const permissions = await computePermissions(claims, cfg, users, userRole, null);
    const fullname = typeof claims[cfg.fullnameClaim] === 'string' ? claims[cfg.fullnameClaim].slice(0, 128) : username;
    const user = { username: username, fullname: fullname, groups: permissions.groups, info: permissions.info, oidcSub: sub };
    try {
        await users.createOidcUser(user);
    } catch (err) {
        throw new OidcMappingError('provisioning_failed', `create user '${username}' failed: ${err.message}`);
    }
    return { user: { username: user.username, fullname: user.fullname, groups: user.groups, info: user.info }, action: 'created' };
}

module.exports = {
    mapOidcUser: mapOidcUser,
    sanitizeUsername: sanitizeUsername,
    getClaimGroups: getClaimGroups,
    computeGroups: computeGroups,
    OidcMappingError: OidcMappingError,
};
