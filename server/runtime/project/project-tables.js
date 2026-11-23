/**
 *  Project data as SQL tables, used by the Repeater 'FUXA Project DB' to query the project with SQL.
 *  The tables are the ones of the project storage (same rows as setProject saves them) plus 'tags'
 *  (the tags of all devices). Every row has the columns:
 *   - id: the key of the row in the project storage (device id, view id, alarm name, 'layout', ...)
 *   - name: the name of the item (or the key when the item has none)
 *   - value: the whole item as JSON text
 *   - one column for each top level property of the items (type, enabled, property, tags, ...),
 *     objects and arrays as JSON text, booleans as 1/0
 *  With the current values: devices.tagList { <tag name>: { id, name, label, type, address, value, timestamp } } and
 *  tags.tagValue, tags.timestamp, tags.tag ({ id, name, value, timestamp }: the Repeater binds it to the live value)
 *  devicesSecurity is never included
 */

'use strict';

const { TableType } = require('./storage/tables');

const TAGS_TABLE = 'tags';

// project key -> table, the row id is the value of the item key
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
 * The tables exposed for queries (all the project tables except devicesSecurity, plus tags)
 */
const QUERY_TABLES = Object.values(TableType).filter(table => table !== TableType.DEVICESSECURITY).concat(TAGS_TABLE);

const RESERVED = ['id', 'name', 'value'];

function _row(id, item, extra) {
    const row = {
        id: (id === undefined || id === null) ? null : String(id),
        name: (item && typeof item === 'object' && !Array.isArray(item) && typeof item.name === 'string') ? item.name : ((id === undefined || id === null) ? null : String(id)),
        value: (item === undefined) ? null : item,
    };
    Object.assign(row, extra || {});
    if (item && typeof item === 'object' && !Array.isArray(item)) {
        Object.keys(item).forEach(key => {
            if (!RESERVED.includes(key) && !(key in row)) {
                row[key] = item[key];
            }
        });
    }
    return row;
}

/**
 * Tags of a device as object keyed by tag name with the current values:
 * { <name>: { id, name, label, type, address, value, timestamp } }
 */
function deviceTagList(device, values) {
    const list = {};
    Object.values((device && device.tags) || {}).forEach(tag => {
        if (!tag || typeof tag !== 'object') {
            return;
        }
        const current = (values || {})[tag.id];
        list[tag.name || tag.id] = {
            id: tag.id, name: tag.name, label: tag.label ?? null, type: tag.type ?? null,
            address: tag.address ?? null, value: current?.value ?? null, timestamp: current?.timestamp ?? null
        };
    });
    return list;
}

function _addDevice(tables, id, device, withTags, values) {
    const deviceValues = (values && values[device.id ?? id]) || {};
    tables[TableType.DEVICES].push(_row(id, device, { tagList: deviceTagList(device, deviceValues) }));
    Object.values((withTags !== false && device.tags) || {}).forEach(tag => {
        if (tag && typeof tag === 'object') {
            const current = deviceValues[tag.id];
            const tagValue = current?.value ?? null;
            const timestamp = current?.timestamp ?? null;
            tables[TAGS_TABLE].push(_row(tag.id, tag, {
                deviceId: device.id ?? id, deviceName: device.name ?? null, tagValue: tagValue, timestamp: timestamp,
                tag: { id: tag.id, name: tag.name ?? null, value: tagValue, timestamp: timestamp }
            }));
        }
    });
}

/**
 * Convert the project to table rows { <table>: [{ id, name, value, <item properties> }] }
 * @param {*} project the project data (already filtered/sanitized for the requester)
 * @param {*} values the current tag values { <device id>: { <tag id>: { value, timestamp } } } (optional)
 */
function toTables(project, values) {
    const tables = {};
    QUERY_TABLES.forEach(table => tables[table] = []);
    if (!project || typeof project !== 'object') {
        return tables;
    }
    Object.keys(project).forEach(key => {
        const value = project[key];
        if (key === 'devices') {
            Object.values(value || {}).forEach(device => device && _addDevice(tables, device.id, device, true, values));
        } else if (key === 'server') {
            // the server is also in devices (same id): its tags only once
            value && _addDevice(tables, 'server', value, !(project.devices && project.devices[value.id]), values);
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
    deviceTagList: deviceTagList,
    QUERY_TABLES: QUERY_TABLES,
};
