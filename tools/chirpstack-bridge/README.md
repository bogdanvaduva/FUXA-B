# ChirpStack bridge

A small companion service for FUXA-B that republishes the **latest uplink of every
ChirpStack device** to MQTT.

ChirpStack's MQTT integration only publishes an uplink when a device transmits, so after
a restart FUXA (or any MQTT client) shows no values until each sensor sends again — which
can take hours for LoRaWAN devices. The bridge reads the recent device events from the
ChirpStack API and publishes the newest uplink of each device on the same topic the MQTT
integration uses, so the values are available right away.

FUXA does not need to know about ChirpStack: configure an MQTT device in FUXA and
subscribe to the ChirpStack topics as usual.

## How it works

1. Authenticates to the ChirpStack v4 gRPC API (API key, or email + password).
2. Lists the devices of every configured application.
3. Streams the device events for `collectSeconds` and keeps the newest `up` event per device.
4. Publishes it to `application/{applicationId}/device/{devEui}/event/up` (configurable).

A replay runs:

- when the bridge starts (`replayOnStart`),
- whenever any message is published to `triggerTopic` (e.g. from a FUXA button or script),
- every `intervalMinutes`, if set.

Requests received while a replay is running are queued and run once afterwards.

## Install

Requires Node.js 18 or newer.

```
cd tools/chirpstack-bridge
npm install
cp config.example.json config.json     # then edit config.json
npm start                              # or: node index.js /path/to/config.json
```

The config file path can also be set with `CHIRPSTACK_BRIDGE_CONFIG`.

## Configuration

| Key | Default | Description |
| --- | --- | --- |
| `chirpstack.server` | — | gRPC API address, `host:port` (ChirpStack v4 serves it on the web port, default `8080`) |
| `chirpstack.tls` | `false` | `true` when the API is served over TLS |
| `chirpstack.apiToken` | — | API key created in ChirpStack (**API keys** menu). Recommended |
| `chirpstack.email` / `chirpstack.password` | — | user login, used when no `apiToken` is set |
| `applicationIds` | — | ChirpStack application IDs (UUIDs) to replay |
| `mqtt.url` | — | broker URL, e.g. `mqtt://localhost:1883` or `mqtts://host:8883` |
| `mqtt.username` / `mqtt.password` / `mqtt.clientId` | — | broker credentials, optional |
| `topicTemplate` | `application/{applicationId}/device/{devEui}/event/up` | topic for each uplink |
| `retain` | `false` | publish with the MQTT retain flag (new subscribers get the last value immediately) |
| `triggerTopic` | `chirpstack-bridge/replay` | publish anything here to request a replay; `""` disables it |
| `replayOnStart` | `true` | replay once at startup |
| `intervalMinutes` | `0` | periodic replay, `0` disables it |
| `collectSeconds` | `10` | how long to read the event stream of each device |
| `maxConcurrentStreams` | `50` | devices read in parallel |

Secrets can be kept out of the file with the environment variables
`CHIRPSTACK_API_TOKEN`, `CHIRPSTACK_PASSWORD` and `MQTT_PASSWORD`.

## Triggering a replay from FUXA

Add the MQTT device's topic `chirpstack-bridge/replay` as a publish tag and write any value
to it (for example from a button), or publish to it from a server script.

## Running as a service

Any process manager works, e.g. with [pm2](https://pm2.keymetrics.io/):

```
pm2 start index.js --name chirpstack-bridge -- /path/to/config.json
```
