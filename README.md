![fuxa logo](/client/src/favicon.ico)
# FUXA-B
FUXA-B is a web-based Process Visualization (SCADA/HMI/Dashboard) software forked from
[FUXA](https://github.com/frangoteam/FUXA/). With FUXA-B you can create modern process visualizations with
individual designs for your machines and real-time data display. It follows the upstream FUXA and adds:

- **Repeater**: a control that repeats a template view for every item of a list (URL with JSON/CSV, SQL on the
  DAQ storage or on the FUXA App DB), with live tag values and colors per item. See [Repeater](#repeater).
- **Dynamic map locations**: one map marker per item of a Repeater data source, with its tag value and actions.
  See [Maps and locations](#maps-and-locations).
- **PostgreSQL** as DAQ storage (data historian). See [PostgreSQL DAQ storage](#postgresql-daq-storage).
- **Reverse proxies** to use external HTTP services from the views without CORS. See [Proxies](#proxies).
- **Template views by URL**: a control bound to `tagName` shows the tag given in the URL
  (`?tagName=<tag id>`). See [Generic tagName view](#generic-tagname-view-template-by-url).
- **Create alarms** for all the tags of a device at once. See [Create alarms](#create-alarms-for-a-device).
- The editor menu button is hidden when nobody is logged in.
- [ChirpStack bridge](#chirpstack-lorawan) for the latest LoRaWAN values.

![fuxa editor](/screenshot/fuxa-editor.png)

![fuxa ani](/screenshot/fuxa-thinglinks.gif)

![fuxa action](/screenshot/feature-action-move.gif)

## ✨ Features
- **Industrial protocol support**
  Modbus RTU/TCP, Siemens S7 Protocol, OPC-UA, BACnet IP, MQTT, Ethernet/IP (Allen Bradley), ODBC, ADSclient, Gpio (Raspberry), WebCam, MELSEC, Redis, SNMP
- **Database and data storage**
  Built-in data historian (DAQ) with support for SQLite, InfluxDB, PostgreSQL and other time-series databases.
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
FUXA-B is developed with NodeJS (backend) and Angular (frontend). The built client is included in the
repository (`client/dist`), so only the server has to be installed.

Docker images, NPM packages, Electron and portable builds are not available for FUXA-B yet: the options 3 to 5
below install the upstream FUXA (without the FUXA-B features).

### 1° Option - From the repository

[Download the repository](https://github.com/bogdanvaduva/FUXA-B) (or `git clone`) and unpack it

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

### 2° Option - Docker

Not available for FUXA-B yet.

### 3° Option - Install upstream FUXA from [NPM](https://www.npmjs.com/package/@frangoteam/fuxa)

You need to have installed [Node.js](https://nodejs.org/en/about/previous-releases)
- Recommended: Node.js 22 LTS

**WARNING** In Linux, installing native dependencies may be challenging.
If you don't intend communicate with Siemens PLCs via S7 (node-snap7 library) you can install from [NPM @frangoteam/fuxa-min](https://www.npmjs.com/package/@frangoteam/fuxa-min)

```
npm install -g --unsafe-perm @frangoteam/fuxa
fuxa
```

Open up a browser (better Chrome) and navigate to http://localhost:1881

### 4° Option - Install upstream FUXA using prebuilt Electron Packages

You will need to be logged into github to access the download button for Electron Action Builds,
click on the workflow and scroll down to Artifacts and click the download icon for you system

[Electron Action Builds](https://github.com/frangoteam/FUXA/actions/workflows/electron_latest.yml)

<img width="2082" height="531" alt="image" src="https://github.com/user-attachments/assets/40f01e1d-cf39-4145-99a0-e8fedf791edf" />

### 5° Option - Upstream FUXA Headless Portable Binaries for Embedded Devices

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
| URL | `https://...` used as is (a GitHub `.../blob/...` file page is mapped to the raw file). A relative path (`/gis/rest/...`) goes to the FUXA server, e.g. to a [proxy](#proxies) |
| Data type | `JSON` (default) or `CSV` |
| Data properties | comma separated item fields to use, e.g. `name,city,value`. Empty: every field of the item |
| Data path | JSON only, dotted path to the items inside the response, e.g. `data` or `result.items`. Empty: the whole JSON |

Example: URL `https://raw.githubusercontent.com/sharmadhiraj/free-json-datasets/refs/heads/master/docs/climate-weather/countries_by_average_annual_precipitation.json`,
data type `JSON`, data path `data`, data properties `rank,country,average_annual_precipitation_mm,continent`.

- JSON: the items are the array (or the values of the object) found at the data path.
- CSV: the first row is the header, every following row is an item keyed by the header. The delimiter
  (`,` `;` or tab) is detected from the header, quoted fields (RFC 4180) are supported.

To read an external service without CORS problems use a [proxy](#proxies).

**DB**

| Field | Meaning |
|---|---|
| DAQ | the storage the query runs on: the DAQ SQLite databases (one per device), PostgreSQL if it is the DAQ storage, or **FUXA App DB** |
| SQL | a read-only query, every row is an item and every column a field |

The SQL runs on the server **from the saved project**: after editing a line, save the project before testing
it in the view. Queries are read-only (SQLite opened read-only, PostgreSQL in a `READ ONLY` transaction) and
`ATTACH` of other databases is blocked.

DAQ SQLite example (last values with the tag names, the tags map is attached as `map`):

```sql
SELECT m.name, d.value, d.dt FROM data d JOIN map.data m ON m.mapid = d.id ORDER BY d.dt DESC LIMIT 50
```

DAQ PostgreSQL example (table `data` in the configured schema):

```sql
SELECT deviceName, tagName, value, time FROM data ORDER BY time DESC LIMIT 50
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
-- one item per device, with its tags (live values and colors in the template: @tags.Temperature)
SELECT id, name AS device, type, status, tagList AS tags FROM devices WHERE enabled = 1 ORDER BY name

-- one item per tag (values at query time)
SELECT d.name AS device, t.key AS tag, json_extract(t.value, '$.value') AS value
FROM devices d, json_each(d.tagList) t

-- the tags of the devices whose id starts with 'd_' grouped by device, keeping the whole entries (live)
SELECT d.id, d.name AS device, json_group_object(t.key, json(t.value)) AS tags
FROM devices d, json_each(d.tagList) t
WHERE d.id LIKE 'd\_%' ESCAPE '\' AND d.enabled = 1
GROUP BY d.id ORDER BY d.name
```

Only whole tag entries (objects with `id` and `value`) are live in the template: with
`json_extract(t.value, '$.value')` only the value at query time is kept.

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
- **Colors by tag value**: a control of the template bound to a tag entry (tag field `@tags.Temperature`, also
  in its actions) works in every item like in a view: Value with ranges (text color), Shapes / Semaphore /
  Progress with ranges (fill and stroke colors), actions (hide, show, blink, ...). E.g. draw a rectangle as item
  background, set its tag to `@tags.Alarm` and its ranges `0 → green`, `1 → red`.
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

Example: one card per Modbus device with its state.

1. Repeater data line, type DB, DAQ **FUXA App DB**:
   `SELECT id, name AS device, status, tagList AS tags FROM devices WHERE type = 'ModbusTCP' ORDER BY name`
2. Template view `Device card`: a rectangle as background with tag `@tags.Alarm` and ranges `0 → green`,
   `1 → red`; an Output with tag `@device`; an Output with tag `@tags.Temperature` (format 1 decimal, unit °C);
   a click event *Open dialog* on the rectangle with the view `Device details`, where an Output with tag
   `@tags.Pressure` shows the live pressure of the clicked device.
3. In the main view draw a Repeater with this data and the view `Device card`.

### Generic `tagName` view (template by URL)

A control whose tag is set to `tagName` (type it in the tag field of the control) is bound to the tag given
in the URL: `http://<fuxa>/home?viewName=<view>&tagName=<tag id>`. Chart lines with id `tagName` work the
same way. The URL query parameters are also appended to the address of the iframes of the view. This way one
view can be used as template for many tags.

## Maps and locations

A **Maps** view shows an OpenStreetMap map with **locations** (markers). The map tiles are loaded from
`tile.openstreetmap.org`, the browser needs internet access for the map background.

### Add a map view

Editor → **Views** → **+** (Add View) → type **Maps**. Then on the map (editor, right click):

| Menu | Meaning |
|---|---|
| Add Location | new location at the clicked point (this map preselected in its *Maps (shown in)*) |
| Edit Location / Remove Location | on a marker: edit the location or remove it from this map |
| Import Location | show in this map locations already defined (e.g. in other maps) |
| Set as start Location | the map opens here, with the current zoom |
| Close all popups | close the open cards |

Add the map view to the navigation (Setup → **Layout**) or set it as start view to use it at runtime.

### Location settings

**General**

| Field | Meaning |
|---|---|
| Name | unique name of the location (required) |
| Source | **Static** (one marker at latitude/longitude) or **Dynamic** (one marker per item of a Repeater data source, see below) |
| Maps (shown in) | the map views that show the location: select one or more, deselect to remove it from a map |
| Latitude / Longitude | static: the position of the marker |
| Card | view opened as popup on the marker click |
| View | view opened (navigation) from the marker menu |
| URL | link opened from the marker menu |
| Description | free text |

**Marker**: icon (or image), name, value of a tag, background and color.
**Actions**: show, hide or color the marker by the value of a tag (with a value range).

### Locations list

Setup → **Locations** lists all the locations of the project:

| Column | Meaning |
|---|---|
| Name | name of the location |
| Maps | the map views that show the location (empty: in no map, choose them in *Maps (shown in)*) |
| Card | the view opened as popup |
| Description | the description |

A location can be in several maps; editing it changes it in all of them.

### Dynamic locations (Repeater data)

A dynamic location shows one marker for every item of a [Repeater data](#1-create-the-repeater-data) source.
Location settings → **Source** → *Dynamic*:

| Field | Meaning |
|---|---|
| Repeater data | the data source of the markers |
| Refresh (seconds) | reload the data (moving objects), empty or 0: load once |
| Latitude / Longitude field | item fields with the position (dotted paths allowed, e.g. `position.lat`) |
| Name field | item field shown as marker name (default: the location name) |
| Tag field | item field with the tag of the marker: a tag entry (`tags.Alarm` from `tagList`), a tag id or a tag name |

The field inputs suggest the fields of the first item. All the markers use the style of the location (icon,
colors, show name / value). For every marker:

- **Show Value** shows the live value of the item tag;
- **Actions** without a tag use the item tag (e.g. color red when `Alarm` is 1), an action tag `@field` uses the
  tag of that item field, other tags are the same for all the markers;
- the **Card** gets the item fields as placeholders (`@name`, `@tags.Temperature` bound to the tag);
- in the **URL** `{field}` is replaced with the item field (e.g. `https://example.com/device/{id}`).

Example: a DB line `SELECT id, name, lat, lng, tagList AS tags FROM ...` with latitude field `lat`,
longitude field `lng`, name field `name`, tag field `tags.Alarm`.

## PostgreSQL DAQ storage

Editor → **Setup** → **Settings** → **DAQ storage** → type **PostgreSQL**:

| Field | Meaning |
|---|---|
| URL | server address, e.g. `postgres://localhost:5432` |
| Database | database name (it must exist) |
| Schema | optional schema for the table (empty: default schema) |
| Username / Password | credentials of the PostgreSQL user |

The values of the tags with DAQ enabled are saved in the table `data` (`tagId`, `tagName`, `deviceId`,
`deviceName`, `value`, `dt`, `time`), created on start if missing. It can be read by the Repeater (DB line).

## PostgreSQL project storage

The project itself (views, devices, scripts, alarms, ...) is saved by default in `server/_appdata/project.fuxap.db`
(SQLite). To save it in PostgreSQL, set in `server/_appdata/settings.js` (restart the server):

```js
storage: {
    type: 'postgres',   // default 'sqlite'
    postgres: { host: 'localhost', port: 5432, database: 'fuxa', user: 'fuxa', password: '...', ssl: false, maxPoolSize: 10 }
},
```

To copy the existing project first: `cd server && npm run migrate-storage -- --from sqlite --to postgres --verify`
(see [docs/storage-migration.md](docs/storage-migration.md)). The users, alarm history and DAQ databases are not moved.

## Proxies

To use an external HTTP service from the views (Repeater URL, iframe, scripts) without CORS problems, add a
reverse proxy in `server/_appdata/settings.js` (restart the server) and use the relative path:

```js
proxies: [
    { path: '/gis', target: 'https://gis.example.com/gis' },
    { path: '/weather', target: 'http://10.0.0.5:8080', headers: { 'x-api-key': 'KEY' }, timeout: 10000 }
],
```

A request to `http://<fuxa>/gis/rest/query?f=json` is forwarded to `https://gis.example.com/gis/rest/query?f=json`.
FUXA credentials (cookie, authorization, x-access-token) are never forwarded. Optional per proxy: `headers`,
`timeout` (ms, default 30000), `rejectUnauthorized: false` for self-signed certificates.

## Create alarms for a device

Editor → **Setup** → **Devices** → open the tags of a device → menu (⋮) → **Create Alarms...**: one dialog with the alarm
settings (levels, colors, ack mode, actions) creates an alarm for every tag of the device, named
`<tag id> [<tag name>]`.

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
Build the frontend for production (the output in `client/dist` is served by the server)
```
cd ./client
npm install
npx ng build --configuration production
```

## Who uses FUXA

FUXA is used in industrial automation, IoT, monitoring and research environments.

### FUXA Pro

## License
MIT.
