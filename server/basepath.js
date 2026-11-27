/**
 * Base path (sub-folder) the application is served from, e.g. '/fuxa' for https://example.com/fuxa/
 *
 * Resolved once at startup by main.js, in order of priority:
 *   1. command line   --basePath /fuxa
 *   2. environment    BASE_PATH=/fuxa
 *   3. settings.js    basePath: '/fuxa'
 * The value is normalized to a leading slash and no trailing slash; the root is ''.
 */
'use strict';

let basePath = normalize(process.env.BASE_PATH);

function normalize(value) {
    if (typeof value !== 'string') {
        return '';
    }
    let result = value.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    if (result && !result.startsWith('/')) {
        result = '/' + result;
    }
    if (result && !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*$/.test(result)) {
        throw new Error(`Invalid base path "${value}"`);
    }
    return result;
}

function set(value) {
    basePath = normalize(value);
    return basePath;
}

function get() {
    return basePath;
}

/**
 * Remove the base path from a request path: '/fuxa/api/x' -> '/api/x', '/fuxa' -> '/'
 */
function strip(requestPath, base = basePath) {
    if (!base) return requestPath;
    if (requestPath === base) return '/';
    if (requestPath.startsWith(base + '/')) {
        return requestPath.slice(base.length);
    }
    return requestPath;
}

/**
 * True for requests that must not fall back to the Angular index.html (API, files, Node-RED, ...)
 */
function shouldBypassSpaCatchAll(requestPath, base = basePath) {
    const routePath = strip(requestPath, base);
    if (base && routePath === requestPath && routePath !== '/') {
        // outside of the base path
        return true;
    }
    return routePath === '/api' ||
        routePath.startsWith('/api/') ||
        routePath.startsWith('/api-docs') ||
        routePath.startsWith('/socket.io') ||
        routePath.includes('.') ||
        routePath.startsWith('/nodered') ||
        routePath.startsWith('/dashboard');
}

module.exports = { normalize, set, get, strip, shouldBypassSpaCatchAll };
