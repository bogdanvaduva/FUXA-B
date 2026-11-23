/**
 * 'api/daq': DAQ API to GET/POST storage daq data
 */

var express = require("express");
const authJwt = require('../jwt-helper');
const utils = require('../../runtime/utils');
const projectTables = require('../../runtime/project/project-tables');
const prjstorage = require('../../runtime/project/prjstorage');
const projectsApi = require('../projects');

const TIME_CHUNK_SIZE = 6 * 60 * 60 * 1000;
const MAX_TIME_CHUNKS = 744; // Maximum history range: 186 days
const TEST_MAX_ROWS = 20;

var runtime;
var secureFnc;
var checkGroupsFnc;

module.exports = {
    init: function (_runtime, _secureFnc, _checkGroupsFnc) {
        runtime = _runtime;
        secureFnc = _secureFnc;
        checkGroupsFnc = _checkGroupsFnc;
    },
    app: function () {
        var daqApp = express();
        daqApp.use(function (req, res, next) {
            if (!runtime.project) {
                res.status(404).end();
            } else {
                next();
            }
        });
        
        /**
         * GET daq data
         * Take from daq storage data and reply 
         */
         daqApp.get("/api/daq", secureFnc, function(req, res) {
            try {
                if (req.query && req.query.query) {
                    var query = JSON.parse(req.query.query);
                    const maxSids = 100;
                    if (!query || !Array.isArray(query.sids) || query.sids.length > maxSids) {
                        return res.status(400).json({
                            error: "invalid_query",
                            message: `sids must be an array containing at most ${maxSids} items`
                        });
                    }
                    const isCurrentValues = query.to === query.from;
                    if (!Number.isFinite(query.from) || !Number.isFinite(query.to) ||
                        (!isCurrentValues && (query.from >= query.to ||
                            query.to - query.from > TIME_CHUNK_SIZE * MAX_TIME_CHUNKS))) {
                        return res.status(400).json({
                            error: "invalid_query",
                            message: "invalid DAQ time range (maximum history range is 186 days)"
                        });
                    }

                    var dbfncs = [];
                    if (isCurrentValues) {
                        for (let i = 0; i < query.sids.length; i++) {
                            dbfncs.push([runtime.devices.getTagValue(query.sids[i], true)]);
                        }
                    }
                    if (query.to === query.from) {  // current values
                        res.json(dbfncs);
                    } else {
                        const timeChunks = utils.chunkTimeRange(query.from, query.to, TIME_CHUNK_SIZE);
                        (async () => {
                            const values = [];
                            // Process one tag and time chunk at a time to avoid concurrent
                            // unbounded SQLite result materialization across tags.
                            for (const sid of query.sids) {
                                const tagValues = [];
                                for (let chunkIndex = 0; chunkIndex < timeChunks.length; chunkIndex++) {
                                    const chunk = timeChunks[chunkIndex];
                                    // Storage ranges are inclusive; advance later chunks by 1 ms
                                    // so samples on a boundary are not returned twice.
                                    const chunkStart = chunkIndex === 0 ? chunk.start : chunk.start + 1;
                                    const chunkValues = await runtime.daqStorage.getNodeValues(sid, chunkStart, chunk.end);
                                    for (const value of chunkValues) {
                                        tagValues.push(value);
                                    }
                                }
                                values.push(tagValues);
                            }
                            res.json(values);
                        })().catch(reason => {
                            if (reason && reason.stack) {
                                runtime.logger.error(`api get daq: Not Found!: ${reason.stack}`);
                                res.status(400).json({error:"unexpected_error", message: reason.stack});
                            } else {
                                runtime.logger.error(`api get daq: Not Found!: ${reason}`);
                                res.status(400).json({error:"unexpected_error", message: reason});
                            }
                        });
                    }
                } else {
                    res.status(404).end();
                    runtime.logger.error("api get daq: Not Found!");
                }
            } catch (err) {
                if (err instanceof RangeError && err.message === 'DAQ time range cannot be safely chunked') {
                    return res.status(400).json({
                        error: 'invalid_query',
                        message: err.message
                    });
                }
                if (err && err.code) {
                    res.status(400).json({error:err.code, message: err.message});
                } else {
                    res.status(400).json({error:"unexpected_error", message:err.toString()});
                }
                runtime.logger.error("api get daq: " + err.message);
            }
        });
        /**
         * GET the DAQ storages that can run SQL queries (used by the Repeater data)
         */
        daqApp.get("/api/daq/sql/nodes", secureFnc, function (req, res) {
            try {
                res.json(runtime.daqStorage.getSqlNodes());
            } catch (err) {
                runtime.logger.error("api get daq sql nodes: " + err.message);
                res.status(400).json({ error: "unexpected_error", message: err.toString() });
            }
        });

        /**
         * GET the rows of a Repeater data line of type DB, the SQL is taken from the saved project
         * (not from the request) and runs read-only
         */
        daqApp.get("/api/daq/sql/repeater", secureFnc, function (req, res) {
            const repeater = (runtime.project.getRepeaters() || []).find(r => r.id === req.query.repeater);
            const line = repeater?.lines?.find(l => l.id === req.query.line) || (!req.query.line ? repeater?.lines?.[0] : null);
            if (!line || line.type !== 'db' || !line.daq || !line.sql) {
                return res.status(404).json({ error: "not_found", message: "Repeater DB data line not found" });
            }
            _queryRepeaterLine(req, line).then(rows => {
                res.json(rows);
            }).catch(err => {
                runtime.logger.error(`api get daq sql repeater: ${err.message || err}`);
                res.status(400).json({ error: "query_error", message: (err.message || err).toString() });
            });
        });

        /**
         * POST a Repeater DB query to test it in the editor before saving { daq, sql } (admin only),
         * it runs like the saved line (same read-only rules), the result is limited to the first rows
         */
        daqApp.post("/api/daq/sql/test", secureFnc, function (req, res) {
            const permission = checkGroupsFnc(req);
            if (res.statusCode === 403) {
                runtime.logger.error("api post daq sql test: Tocken Expired");
                return;
            }
            if (!authJwt.haveAdminPermission(permission)) {
                runtime.logger.error("api post daq sql test: Unauthorized");
                return res.status(401).json({ error: "unauthorized_error", message: "Unauthorized!" });
            }
            const line = { daq: req.body?.daq, sql: req.body?.sql };
            if (typeof line.daq !== 'string' || !line.daq || typeof line.sql !== 'string' || !line.sql.trim()) {
                return res.status(400).json({ error: "invalid_request", message: "daq and sql are required" });
            }
            _queryRepeaterLine(req, line).then(rows => {
                rows = rows || [];
                res.json({ count: rows.length, rows: rows.slice(0, TEST_MAX_ROWS) });
            }).catch(err => {
                res.status(400).json({ error: "query_error", message: (err.message || err).toString() });
            });
        });
        return daqApp;
    }
}

/**
 * Run the SQL of a Repeater DB line on its storage:
 * - 'FUXA Project DB': the project of the selected project storage as the requester gets it (views filtered by
 *   permission), without credentials (same sanitizer as /api/project for viewers, also for admins), as tables
 * - 'FUXA Project DB (PostgreSQL)': the PostgreSQL project database with the reader login
 * - else the DAQ storage or the FUXA App DB
 */
async function _queryRepeaterLine(req, line) {
    const daqStorage = runtime.daqStorage;
    if (line.daq === daqStorage.PROJECT_DB_ID || line.daq === daqStorage.PROJECT_PG_ID) {
        const permission = checkGroupsFnc(req);
        const project = await runtime.project.getProject(req.userId, permission);
        const sanitized = projectsApi.sanitizeProjectForViewer(project || {}, permission);
        const tables = projectTables.toTables(sanitized);
        return (line.daq === daqStorage.PROJECT_PG_ID) ? prjstorage.queryAsReader(line.sql, tables) : daqStorage.queryTables(tables, line.sql);
    }
    return daqStorage.querySql(line.daq, line.sql);
}
