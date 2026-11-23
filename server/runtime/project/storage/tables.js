/**
 *  Tables of the project storage, shared by all the backends (see interface.md)
 */

'use strict';

/**
 * Database Table
 */
const TableType = {
    GENERAL: 'general',
    DEVICES: 'devices',
    VIEWS: 'views',
    DEVICESSECURITY: 'devicesSecurity',
    TEXTS: 'texts',
    ALARMS: 'alarms',
    RECIPES: 'recipes',
    NOTIFICATIONS: 'notifications',
    SCRIPTS: 'scripts',
    REPORTS: 'reports',
    LOCATIONS: 'locations',
    ARMARKERS: 'arMarkers',
}

/**
 * Tables emptied by clearAll (all except devicesSecurity)
 */
const ClearableTables = Object.values(TableType).filter(table => table !== TableType.DEVICESSECURITY);

module.exports = {
    TableType: TableType,
    ClearableTables: ClearableTables,
};
