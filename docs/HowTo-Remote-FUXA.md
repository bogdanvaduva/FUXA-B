A FUXA server can use other FUXA servers as connections (**FuxaRemote**). Each remote FUXA is started and
configured on its own, with its own devices, and the central FUXA mirrors the remote tags you choose. This spreads
the devices over several servers (horizontal scaling): for example 100 edge FUXA with 100 devices each, and one
central FUXA with the views, alarms and history of the whole plant.

```
               central FUXA  (views, alarms, scripts, DAQ)
               /      |       \
      FuxaRemote  FuxaRemote  FuxaRemote      one connection per edge FUXA
             |        |         |
        edge FUXA  edge FUXA  edge FUXA       each one polls its own devices
        (devices)  (devices)  (devices)       (Modbus, S7, OPC UA, ...)
```

All the device polling of a FUXA runs in one Node.js process: splitting the devices over several servers keeps
each process light. The central FUXA still receives every mirrored value, so mirror only the tags it needs.

**Prepare the remote FUXA**

1. Install and start the FUXA as usual (another computer, or the same one with another port and user directory:
   `npm start -- --port 1891 --userDir /opt/fuxa-edge1`) and configure its devices and tags.
2. If its security is enabled (`secureEnabled`), create an API key in **Setup → API keys**. The key gives
   administrator rights on that FUXA: keep it secret and give each central FUXA its own key, so it can be disabled alone.

**Add the connection in the central FUXA**

Add a Device in **Connections** and select **FuxaRemote**. In the device property set:

- **Remote FUXA address**: the address of the remote server, for example `http://192.168.1.20:1881`
  (`http://` is added when missing, use `https://` behind a TLS proxy)
- **API key**: the key created on the remote FUXA (empty when its security is disabled). It is stored in the device
  security store of the server, never in the project file: after importing a project you have to enter it again.
- **Timeout (ms)** of each request, and the **polling** interval

The device is connected when the remote FUXA answers with the key; a wrong key is logged as
`unauthorized (401), check the API key`. After 3 polling errors in a row the values are cleared (`null`) and the
device reconnects.

**Tags**

Click **+** in the tags list of the connection: a dialog shows the devices of the remote FUXA, expand one and
select its tags. Each selected tag becomes a tag of the connection named `<remote device>.<remote tag>`, with:

- the address set to the remote tag id, and the remote device id kept with it
- the type of the remote tag

The mirrored tags work as any other tag: views, alarms, scripts, DAQ history and the tag options (scale,
deadband) of the central FUXA. Writing a mirrored tag (from a control, a script or the API) writes the remote tag.
The value of a remote tag whose device is disconnected is `null`.

The **FUXA Server** device of the remote FUXA is in the list too: its connection status tags show the status of the
remote devices in the central FUXA.

Only the tags that the remote server runs can be mirrored: device tags and FUXA Server tags. The tags of an
`internal` connection live in the browser of the remote FUXA and are not available.

**Requests and limits**

Every polling reads all the mirrored tags of the connection with one request; writes are sent one by one. The REST
API of each FUXA allows by default 1000 requests in 5 minutes for each client address (`apiRateLimitMax`,
`apiRateLimitWindowMs` in its settings): one connection polling every second uses 300 of them. With more
connections from the same central FUXA to the same remote one, or many writes, raise the limit on the remote FUXA.

Remote API used (on the remote FUXA, header `x-api-key`):

| Request | Use |
|---|---|
| `POST /api/remote/values` `{ "ids": ["<tag id>", ...] }` | read many tag values, reply `[{ id, value, ts }]` (`value` null for unknown ids) |
| `GET /api/remote/browse` | the devices and tags (id, name, type), without the device settings |
| `POST /api/setTagValue` `{ "tags": [{ "id", "value" }] }` | write tag values |

A remote FUXA of an older version (without `/api/remote/values`) is read with `GET /api/getTagValue`, 100 tags per
request; browsing its tags needs this version.
