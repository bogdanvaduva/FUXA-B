#!/usr/bin/env node
/**
 * ChirpStack -> MQTT replay bridge (FUXA-B companion service)
 *
 * Republishes the latest uplink of every device of the configured ChirpStack
 * applications to MQTT, so MQTT clients (e.g. FUXA) get current values right away
 * instead of waiting for the next transmission of each sensor.
 *
 * Replays run on start (replayOnStart), on any message to the trigger topic,
 * and optionally every intervalMinutes.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const mqtt = require('mqtt');
const internalGrpc = require('@chirpstack/chirpstack-api/api/internal_grpc_pb');
const internalPb = require('@chirpstack/chirpstack-api/api/internal_pb');
const deviceGrpc = require('@chirpstack/chirpstack-api/api/device_grpc_pb');
const devicePb = require('@chirpstack/chirpstack-api/api/device_pb');

const PAGE_SIZE = 100;

// ---------------------------------------------------------------- logging

function log(level, message) {
    const line = `${new Date().toISOString()} [${level}] ${message}`;
    (level === 'ERROR' ? console.error : console.log)(line);
}

// ---------------------------------------------------------------- config

function loadConfig() {
    const file = process.argv[2] || process.env.CHIRPSTACK_BRIDGE_CONFIG || path.join(__dirname, 'config.json');
    if (!fs.existsSync(file)) {
        throw new Error(`config file not found: ${file} (copy config.example.json to config.json)`);
    }
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    cfg.chirpstack = cfg.chirpstack || {};
    cfg.mqtt = cfg.mqtt || {};
    // secrets can be kept out of the file
    cfg.chirpstack.apiToken = process.env.CHIRPSTACK_API_TOKEN || cfg.chirpstack.apiToken;
    cfg.chirpstack.password = process.env.CHIRPSTACK_PASSWORD || cfg.chirpstack.password;
    cfg.mqtt.password = process.env.MQTT_PASSWORD || cfg.mqtt.password;

    if (!cfg.chirpstack.server) {
        throw new Error('chirpstack.server is required (gRPC host:port, e.g. "localhost:8080")');
    }
    if (!cfg.chirpstack.apiToken && !(cfg.chirpstack.email && cfg.chirpstack.password)) {
        throw new Error('set chirpstack.apiToken (recommended) or chirpstack.email + chirpstack.password');
    }
    if (!Array.isArray(cfg.applicationIds) || !cfg.applicationIds.length) {
        throw new Error('applicationIds must be a non-empty array');
    }
    if (!cfg.mqtt.url) {
        throw new Error('mqtt.url is required (e.g. "mqtt://localhost:1883")');
    }
    return {
        chirpstack: cfg.chirpstack,
        applicationIds: cfg.applicationIds.map(String),
        mqtt: cfg.mqtt,
        topicTemplate: cfg.topicTemplate || 'application/{applicationId}/device/{devEui}/event/up',
        retain: !!cfg.retain,
        triggerTopic: cfg.triggerTopic === undefined ? 'chirpstack-bridge/replay' : cfg.triggerTopic,
        replayOnStart: cfg.replayOnStart !== false,
        intervalMinutes: Number(cfg.intervalMinutes) || 0,
        collectSeconds: Number(cfg.collectSeconds) > 0 ? Number(cfg.collectSeconds) : 10,
        maxConcurrentStreams: Number(cfg.maxConcurrentStreams) > 0 ? Number(cfg.maxConcurrentStreams) : 50
    };
}

// ---------------------------------------------------------------- ChirpStack

class ChirpStack {
    constructor(cfg) {
        this.cfg = cfg;
        const credentials = cfg.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
        this.internal = new internalGrpc.InternalServiceClient(cfg.server, credentials);
        this.devices = new deviceGrpc.DeviceServiceClient(cfg.server, credentials);
    }

    async metadata() {
        let token = this.cfg.apiToken;
        if (!token) {
            const req = new internalPb.LoginRequest();
            req.setEmail(this.cfg.email);
            req.setPassword(this.cfg.password);
            const res = await this.call(this.internal, 'login', req, new grpc.Metadata());
            token = res.getJwt();
        }
        const meta = new grpc.Metadata();
        meta.set('authorization', `Bearer ${token}`);
        return meta;
    }

    call(client, method, request, meta) {
        return new Promise((resolve, reject) => {
            client[method](request, meta, { deadline: Date.now() + 30000 }, (err, res) => err ? reject(err) : resolve(res));
        });
    }

    async listDevEuis(applicationId, meta) {
        const result = [];
        for (let offset = 0; ; offset += PAGE_SIZE) {
            const req = new devicePb.ListDevicesRequest();
            req.setApplicationId(applicationId);
            req.setLimit(PAGE_SIZE);
            req.setOffset(offset);
            const res = await this.call(this.devices, 'list', req, meta);
            const page = res.getResultList();
            page.forEach(d => result.push(d.getDevEui()));
            if (page.length < PAGE_SIZE || result.length >= res.getTotalCount()) {
                return result;
            }
        }
    }

    /**
     * Stream the device events for `seconds` and return the body (object) of the newest uplink, or null.
     */
    latestUplink(devEui, meta, seconds) {
        return new Promise((resolve) => {
            const req = new internalPb.StreamDeviceEventsRequest();
            req.setDevEui(devEui);
            let latest = null;
            let latestTime = -Infinity;
            let done = false;
            const call = this.internal.streamDeviceEvents(req, meta);
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                call.cancel();
                resolve(latest);
            };
            const timer = setTimeout(finish, seconds * 1000);
            call.on('data', (item) => {
                if (item.getDescription() !== 'up') return;
                try {
                    const body = JSON.parse(item.getBody());
                    const ts = item.getTime() ? item.getTime().toDate().getTime() : Date.parse(body.time) || 0;
                    if (ts >= latestTime) {
                        latestTime = ts;
                        latest = body;
                    }
                } catch (err) {
                    log('WARN', `device ${devEui}: invalid uplink body (${err.message})`);
                }
            });
            call.on('error', (err) => {
                if (err.code !== grpc.status.CANCELLED) {
                    log('WARN', `device ${devEui}: event stream error (${err.details || err.message})`);
                }
                finish();
            });
            call.on('end', finish);
        });
    }

    close() {
        this.internal.close();
        this.devices.close();
    }
}

// ---------------------------------------------------------------- bridge

function topicFor(template, applicationId, devEui) {
    return template.replace(/\{applicationId\}/g, applicationId).replace(/\{devEui\}/g, devEui);
}

function publish(client, topic, payload, retain) {
    return new Promise((resolve, reject) => {
        client.publish(topic, payload, { qos: 0, retain }, (err) => err ? reject(err) : resolve());
    });
}

async function replay(cfg, chirpstack, mqttClient) {
    const started = Date.now();
    const meta = await chirpstack.metadata();
    let published = 0;
    let devicesTotal = 0;
    for (const applicationId of cfg.applicationIds) {
        let devEuis;
        try {
            devEuis = await chirpstack.listDevEuis(applicationId, meta);
        } catch (err) {
            log('ERROR', `application ${applicationId}: cannot list devices (${err.details || err.message})`);
            continue;
        }
        devicesTotal += devEuis.length;
        for (let i = 0; i < devEuis.length; i += cfg.maxConcurrentStreams) {
            const batch = devEuis.slice(i, i + cfg.maxConcurrentStreams);
            const uplinks = await Promise.all(batch.map(eui => chirpstack.latestUplink(eui, meta, cfg.collectSeconds)));
            for (let k = 0; k < batch.length; k++) {
                if (!uplinks[k]) continue;
                await publish(mqttClient, topicFor(cfg.topicTemplate, applicationId, batch[k]), JSON.stringify(uplinks[k]), cfg.retain);
                published++;
            }
        }
    }
    log('INFO', `replay done: ${published}/${devicesTotal} devices published in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

function main() {
    let cfg;
    try {
        cfg = loadConfig();
    } catch (err) {
        log('ERROR', err.message);
        process.exit(1);
    }
    const chirpstack = new ChirpStack(cfg.chirpstack);
    const mqttClient = mqtt.connect(cfg.mqtt.url, {
        clientId: cfg.mqtt.clientId || `chirpstack-bridge-${Math.random().toString(16).slice(2, 10)}`,
        username: cfg.mqtt.username,
        password: cfg.mqtt.password,
        reconnectPeriod: 5000
    });

    let running = false;
    let pending = false;
    const runReplay = async (reason) => {
        if (running) {
            pending = true;     // run once more after the current replay
            return;
        }
        running = true;
        log('INFO', `replay started (${reason})`);
        try {
            await replay(cfg, chirpstack, mqttClient);
        } catch (err) {
            log('ERROR', `replay failed: ${err.details || err.message}`);
        } finally {
            running = false;
            if (pending) {
                pending = false;
                runReplay('queued trigger');
            }
        }
    };

    let firstConnect = true;
    mqttClient.on('connect', () => {
        log('INFO', `connected to MQTT ${cfg.mqtt.url}`);
        if (cfg.triggerTopic) {
            mqttClient.subscribe(cfg.triggerTopic, (err) => err
                ? log('ERROR', `cannot subscribe ${cfg.triggerTopic}: ${err.message}`)
                : log('INFO', `listening for replay requests on "${cfg.triggerTopic}"`));
        }
        if (firstConnect && cfg.replayOnStart) {
            runReplay('start');
        }
        firstConnect = false;
    });
    mqttClient.on('message', (topic) => {
        if (topic === cfg.triggerTopic) {
            runReplay(`trigger ${topic}`);
        }
    });
    mqttClient.on('error', (err) => log('ERROR', `MQTT: ${err.message}`));

    let interval = null;
    if (cfg.intervalMinutes > 0) {
        interval = setInterval(() => runReplay('interval'), cfg.intervalMinutes * 60000);
    }

    const shutdown = () => {
        log('INFO', 'stopping');
        if (interval) clearInterval(interval);
        chirpstack.close();
        mqttClient.end(false, () => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

if (require.main === module) {
    main();
}

module.exports = { ChirpStack, replay, topicFor };
