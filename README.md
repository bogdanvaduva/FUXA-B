![fuxa logo](/client/src/favicon.ico)
# FUXA-B
FUXA-B is a web-based Process Visualization (SCADA/HMI/Dashboard) software forked from FUXA found at https://github.com/frangoteam/FUXA/. With FUXA-B you can create modern process visualizations with individual designs for your machines and real-time data display. FUXA-B has a few other features than the original FUXA. It has  been added a new DAQ type which is PostgreSQL (we plan to add MySQL/MariaDB as well), a new data source called Repeater Data, a new component called Repeater. Also within the FUXA-B logic we integrated a generic tagName that can be provided to the view through URL query params allowing to build templates.

![fuxa editor](/screenshot/fuxa-editor.png)

![fuxa ani](/screenshot/fuxa-thinglinks.gif)

![fuxa action](/screenshot/feature-action-move.gif)

## ✨ Features
- **Industrial protocol support**
  Modbus RTU/TCP, Siemens S7 Protocol, OPC-UA, BACnet IP, MQTT, Ethernet/IP (Allen Bradley), ODBC, ADSclient, Gpio (Raspberry), WebCam, MELSEC, Redis, SNMP
- **Database and data storage**
  Built-in data historian (DAQ) with support for SQLite, InfluxDB and other time-series databases.
  External integrations via ODBC and Redis.
- **SCADA/HMI Web-Editor**
  Engineering and Design completely web-based
- **Cross-platform architecture**
  Backend: Node.js
  Frontend: Angular, HTML5, CSS, SVG

## Why FUXA

FUXA provides a modern **web-based platform for industrial monitoring, SCADA/HMI applications and IoT dashboards**.

It is designed to simplify the creation of real-time visualizations and industrial integrations using standard web technologies.

Key advantages:

- Modern **web-based SCADA / HMI architecture**
- Visual editor for dashboards and process visualization
- Support for industrial protocols (Modbus, OPC-UA, MQTT, Siemens S7 and more)
- Built with modern technologies (Node.js, Angular, SVG)
- Runs on **Linux, Windows, macOS, Docker, Raspberry Pi and more**
- Open-source and extensible

## 🚀 Live Demo
Here is a [live demo](https://frangoteam.github.io) example of FUXA editor.

## 📚 Documentation

Official documentation is available at:

👉 https://frangoteam.github.io/FUXA/

The documentation source is located in the `/docs` directory of this repository.

The site is built using MkDocs (Material theme) and automatically deployed via GitHub Actions.

## 🛠 Installing and Running
FUXA is developed with NodeJS (backend) and Angular (frontend).

running from docker it's not yet available for FUXA-B

[Download the latest release](https://github.com/bogdanvaduva/FUXA-B) and unpack it

You need to have installed [Node.js](https://nodejs.org/en/about/previous-releases)
- Recommended: Node.js 22 LTS

**Note** Starting from FUXA 1.2.7, Node.js 14 and older versions are not supported due to upstream dependency updates.

**WARNING** On Linux systems (especially Raspberry Pi), installing native dependencies may require additional build tools.
If you do not intend to use specific features, you can safely remove them from ```server/package.json```:
- Remove ```node-snap7``` if you do not need Siemens S7 communication
- Remove ```odbc``` if you do not need external database connectivity

```
cd ./server
npm install
npm start
```

Open up a browser (better Chrome) and navigate to http://localhost:1881

### 3° Option - Install from [NPM](https://www.npmjs.com/package/@frangoteam/fuxa)

You need to have installed [Node.js](https://nodejs.org/en/about/previous-releases)
- Recommended: Node.js 22 LTS

**WARNING** In Linux, installing native dependencies may be challenging.
If you don't intend communicate with Siemens PLCs via S7 (node-snap7 library) you can install from [NPM @frangoteam/fuxa-min](https://www.npmjs.com/package/@frangoteam/fuxa-min)

```
npm install -g --unsafe-perm @frangoteam/fuxa
fuxa
```

Open up a browser (better Chrome) and navigate to http://localhost:1881

### 4° Option - Install using prebuilt Electron Packages

You will need to be logged into github to access the download button for Electron Action Builds,
click on the workflow and scroll down to Artifacts and click the download icon for you system

[Electron Action Builds](https://github.com/frangoteam/FUXA/actions/workflows/electron_latest.yml)

<img width="2082" height="531" alt="image" src="https://github.com/user-attachments/assets/40f01e1d-cf39-4145-99a0-e8fedf791edf" />

### 5° Option - Headless Portable Binaries for Embedded Devices

For headless deployments on embedded devices or servers without GUI, FUXA provides self-contained portable binaries for Windows, macOS, and Linux.

These binaries include everything needed (server, client) and run as standalone executables.

Download the latest builds from GitHub Actions artifacts:

[Headless Portable Builds](https://github.com/frangoteam/FUXA/actions/workflows/headless_packaging.yml)

For detailed installation and running instructions, see the documentation.

### Creating the Electron Application
Electron is a framework for building cross-platform desktop applications using web technologies. An Electron application is standalone, meaning it can be run independently on your desktop without needing a web browser.

To create the Electron application, you need to have node.js 18 installed. Follow these steps:

Build Server and Client First
```
cd ./server
npm install
cd ../client
npm install
npm run build
```

Packaging
```
cd ./app
npm install
npm run package
```

After following these steps, you will have a standalone Electron application for FUXA. The application can be found in the ./app directory.

## Repeater

The Repeater is a control that draws one copy of a view for every item of a list (a "template" view repeated
per item). The list comes from a **Repeater data** source: a URL returning JSON or CSV, or an SQL query on a
DAQ storage or on the FUXA App DB. Typical uses: one card per device, per sensor of a GIS service, per row of a
database table.

### 1. Create the Repeater data

Editor → **Setup** → **Repeater data** → add a data source (name) and a **line** in it. The Repeater uses the
first line of the source. A line has a **Type**:

**URL**

| Field | Meaning |
|---|---|
| URL | `https://raw.githubusercontent.com/sharmadhiraj/free-json-datasets/refs/heads/master/docs/climate-weather/countries_by_average_annual_precipitation.json` used as is (a GitHub `.../blob/...` file page is mapped to the raw file). A relative path (`/gis/rest/...`) goes to the FUXA server, e.g. to a proxy configured in `settings.js` (see below) |
| Data type | `JSON` (default) or `CSV` |
| Data properties | comma separated item fields to use, e.g. `name,city,value`. Empty: every field of the item |
| Data path | JSON only, dotted path to the items inside the response, e.g. `data` or `result.items`. Empty: the whole JSON |

- JSON: the items are the array (or the values of the object) found at the data path.
- CSV: the first row is the header, every following row is an item keyed by the header. The delimiter
  (`,` `;` or tab) is detected from the header, quoted fields (RFC 4180) are supported.

To read an external service without CORS problems, add a reverse proxy in `server/_appdata/settings.js`
and use the relative path in the URL field:

```js
proxies: [
    { path: '/gis', target: 'https://gis.example.com/gis' },
    { path: '/weather', target: 'http://10.0.0.5:8080', headers: { 'x-api-key': 'KEY' }, timeout: 10000 }
],
```

A request to `http://<fuxa>/gis/rest/query?f=json` is forwarded to `https://gis.example.com/gis/rest/query?f=json`.
FUXA credentials (cookie, authorization, x-access-token) are never forwarded. Optional per proxy: `headers`,
`timeout` (ms, default 30000), `rejectUnauthorized: false` for self-signed certificates.

**DB**

| Field | Meaning |
|---|---|
| DAQ | the storage the query runs on: the DAQ SQLite databases (one per device), PostgreSQL if it is the DAQ storage, or **FUXA App DB** |
| SQL | a read-only query, every row is an item and every column a field |

The SQL runs on the server **from the saved project**: after editing a line, save the project before testing
it in the view. Queries are read-only (SQLite opened read-only, PostgreSQL in a `READ ONLY` transaction) and
`ATTACH` of other databases is blocked.

DAQ SQLite example (values with the tag names):

```sql
SELECT d.id, d.name AS device,
       json_group_object(t.key, json_extract(t.value, '$.value')) AS tags
FROM devices d, json_each(d.tagList) t
WHERE d.id LIKE 'd\_%' ESCAPE '\' AND d.enabled = 1
GROUP BY d.id
ORDER BY d.name
```

#### FUXA App DB

The **FUXA App DB** entry reads the FUXA application data (`alarms.fuxap.db`, plus the existing optional ones):

| Table | Content |
|---|---|
| `alarms`, `chronicle` | active alarms and alarm history |
| `notifications.<table>` | notifications (if `notifications.fuxap.db` exists) |
| `recipes.recipes` | recipes (if `recipes.db` exists) |
| `scheduler.schedulers` | scheduler (if `scheduler.db` exists) |
| `devices` | the devices of the running project (built on every query) |

Users, API keys and the project database (passwords and credentials) are not accessible.

`devices` columns: `id`, `name`, `type`, `enabled` (1/0), `polling`, `address`, `port`, `slaveid`,
`tags` (number of tags), `status` (e.g. `connect-ok`), `tagList`.

`tagList` is an object with the tags of the device keyed by tag name, with the current values:

```json
{ "Temperature": { "id": "t1", "name": "Temperature", "label": null, "type": "Float32", "address": 1, "value": 21.5, "timestamp": 1732000000000 } }
```

```sql
-- one item per device
SELECT name, type, address, status, tagList FROM devices WHERE enabled = 1 ORDER BY name

-- one item per tag
SELECT d.name AS device, t.key AS tag, json_extract(t.value, '$.value') AS value
FROM devices d, json_each(d.tagList) t
```

To keep the live values with a grouped query, keep the whole entry: `json_group_object(t.key, json(t.value)) AS tags`
(with `json_extract(t.value, '$.value')` only the value at query time is kept, not live).

Text values of App DB rows that look like JSON (`{...}` or `[...]`, e.g. `tagList` or your own
`json_object(...)` columns) are returned as objects. Note: in `LIKE`, `_` is a wildcard
(use `LIKE 'd\_%' ESCAPE '\'` for a literal underscore).

### 2. Create the template view

Create a view with the size of one item (e.g. a card) and add the controls showing the item fields:

- **Output / value controls**: set the tag of the control to `@<field>`, e.g. `@name`. Nested fields use a
  dotted path: `@tagList.Temperature.value`, `@tagList.Run.Status.value` (tag names with dots work too).
  An object field without path (`@tagList`) is shown as JSON.
- **Live tag values**: when the bound field is a tag entry (an object with `id` and `value`, as the entries of
  `devices.tagList`), the control shows the current value of that tag and is updated live. With
  `SELECT d.id, d.name AS device, d.tagList AS tags FROM devices d` use `@tags.Temperature`
  (or `@tags.Temperature.value`). Other fields of the entry (`@tags.Temperature.type`) are static.
  Fields with JSON text (e.g. from PostgreSQL or a URL source) are decoded, so the paths work on them too.
- **Text**: a text whose content is `@<field>` is replaced with the item field value.
- **Events**: the events of the template controls work for each item. *Open view / dialog / card* events get
  the item fields as placeholder values (`@country` → item.country, objects as JSON), so the opened view can
  show them in controls bound to `@country`. CLIENT scripts are run on click.
- **Tags in the opened view**: an object field is passed as JSON (`@tags`). In the opened view a control bound
  to a path of it that is a tag entry, e.g. `@tags.Temperature`, is decoded and bound to that tag: it shows
  the live value like a control bound directly to the tag (format, ranges, actions and events included).

The template view must not contain the Repeater itself (a Repeater cannot repeat the view it is placed in).

### 3. Place the Repeater

In the view, draw a **Repeater** (editor toolbar) and set its properties:

| Property | Meaning |
|---|---|
| Name | name of the control |
| Repeater data | the data source (or create a new one) |
| Property to show | item field used as fallback text for `@` texts without a value |
| View | the template view |

Several Repeaters can be placed in the same view.

In the running view the Repeater shows a search input on top (it stays visible while the items scroll):
only the items containing the text are shown (case insensitive, in any field or text).

### Generic `tagName` view (template by URL)

A control whose tag is set to `tagName` (type it in the tag field of the control) is bound to the tag given
in the URL: `http://<fuxa>/home?viewName=<view>&tagName=<tag id>`. Chart lines with id `tagName` work the
same way. The URL query parameters are also appended to the address of the iframes of the view. This way one
view can be used as template for many tags.

## ChirpStack (LoRaWAN)
FUXA-B reads ChirpStack uplinks through a standard MQTT device. To get the latest values right away
(instead of waiting for each sensor to transmit again), run the companion service in
[tools/chirpstack-bridge](tools/chirpstack-bridge/README.md).

## Usage and Documentation
- 📚 Official Documentation: https://frangoteam.github.io/FUXA/
- Look video from [frangoteam](https://www.youtube.com/@umbertonocelli5301)
- Look video from [Fusion Automate - Urvish Nakum](https://youtube.com/playlist?list=PLxrSjjYyzaaK8uY3kVaFzfGnwhVXiCEAO&si=aU1OxgkUvLQ3bXHq)
- Browse the [DeepWiki](https://deepwiki.com/frangoteam/FUXA) for AI-assisted docs and code navigation

## Community SVG Widgets

Looking for ready-made, reusable SVG widgets?
Check out the companion repository **FUXA-SVG-Widgets**:

- Repository: https://github.com/frangoteam/FUXA-SVG-Widgets
- Authoring guide & examples: see the repo README and the Wiki page:
  https://github.com/frangoteam/FUXA/wiki/HowTo-Widgets

## 🧪 To Debug (Full Stack)
Install and start to serve the frontend
```
cd ./client
npm install
npm start
```

Start the Server and Client (Browser) in Debug Mode
```
In vscode: Debug ‘Server & Client’
```

## 🏗 To Build
Build the frontend for production
```
cd ./client
ng build --configuration=production
```

## Who uses FUXA

FUXA is used in industrial automation, IoT, monitoring and research environments.

### FUXA Pro

## License
MIT.
