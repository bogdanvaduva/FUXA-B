/**
 *  Project data as the rows of the project storage tables (same layout as setProject saves them),
 *  used by the Repeater 'FUXA Project DB' to query the project with SQL
 *  { <table>: [{ name, value: <JSON text> }] }, devicesSecurity is never included
 */

'use strict';

const { TableType } = require('./storage/tables');

// project key -> table, the row name is the value of the item key
const LIST_TABLES = {
    texts: { table: TableType.TEXTS, key: 'name' },
    alarms: { table: TableType.ALARMS, key: 'name' },
    recipes: { table: TableType.RECIPES, key: 'id' },
    notifications: { table: TableType.NOTIFICATIONS, key: 'id' },
    scripts: { table: TableType.SCRIPTS, key: 'id' },
    reports: { table: TableType.REPORTS, key: 'id' },
    mapsLocations: { table: TableType.LOCATIONS, key: 'id' },
};

/**
 * The tables exposed for queries (all the project tables except devicesSecurity)
 */
const QUERY_TABLES = Object.values(TableType).filter(table => table !== TableType.DEVICESSECURITY);

function _row(name, value) {
    return { name: (name === undefined || name === null) ? null : String(name), value: (value === undefined) ? null : JSON.stringify(value) };
}

/**
 * Convert the project to table rows
 * @param {*} project the project data (already filtered/sanitized for the requester)
 */
function toTables(project) {
    const tables = {};
    QUERY_TABLES.forEach(table => tables[table] = []);
    if (!project || typeof project !== 'object') {
        return tables;
    }
    Object.keys(project).forEach(key => {
        const value = project[key];
        if (key === 'devices') {
            Object.values(value || {}).forEach(device => device && tables[TableType.DEVICES].push(_row(device.id, device)));
        } else if (key === 'server') {
            tables[TableType.DEVICES].push(_row('server', value));
        } else if (key === 'hmi') {
            Object.keys(value || {}).forEach(hk => {
                if (hk === 'views') {
                    (value.views || []).forEach(view => view && tables[TableType.VIEWS].push(_row(view.id, view)));
                } else {
                    tables[TableType.GENERAL].push(_row(hk, value[hk]));
                }
            });
        } else if (LIST_TABLES[key]) {
            const def = LIST_TABLES[key];
            (Array.isArray(value) ? value : []).forEach(item => item && tables[def.table].push(_row(item[def.key], item)));
        } else if (key === 'ar') {
            const settings = Object.assign({}, value);
            const markers = settings.markers || [];
            delete settings.markers;
            tables[TableType.GENERAL].push(_row(key, settings));
            markers.forEach(marker => marker && tables[TableType.ARMARKERS].push(_row(marker.id, marker)));
        } else {
            // charts, graphs, repeaters, version, ...
            tables[TableType.GENERAL].push(_row(key, value));
        }
    });
    return tables;
}

module.exports = {
    toTables: toTables,
    QUERY_TABLES: QUERY_TABLES,
};
