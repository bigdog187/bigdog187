# Wyelec Mill SCADA — Grain Handling & Flour Milling

A browser-based SCADA / HMI for a grain handling and flour milling plant,
designed to connect to an **Allen-Bradley ControlLogix / CompactLogix** PLC.

It runs **stand-alone in any browser** out of the box using a built-in process
simulator, and switches to a **live PLC** by pointing it at the included
Node.js EtherNet/IP gateway.

![overview](../images/industrial.jpg)

---

## Quick start (simulator — no hardware)

**Easiest — single file:** just open **`scada/demo.html`** directly in any
browser (double-click it). Everything (CSS + JS) is inlined, so it needs no
server and no install. The connection pill shows **SIMULATION** and a realistic
process model drives every page.

**Multi-file version** (the maintainable source `index.html` loads `css/` +
`js/`). Some browsers restrict loading separate files over `file://`, so serve
it:

```bash
# from the repo root
cd scada
python3 -m http.server 8000      # or any static file server
# open http://localhost:8000
```

> `demo.html` is generated from `index.html` + `css/` + `js/` — edit the source
> files and rebuild it by inlining them. It always mirrors the real source.

---

## Pages

Styled after **FactoryTalk View**, with a **light / dark theme** toggle (top
bar — light is the steel "control-room" look, dark is high-contrast for dim
rooms). Every page has animated **SVG process mimics** built from real
equipment symbols — drag conveyors, screw augers, bucket elevators, silos, roll
stands, plansifters, purifiers, fans and pumps — with live material-flow
animation. Click any **M** (motor) symbol in a mimic to open its faceplate.

| Page | What it does |
|------|--------------|
| **Dashboard** | Live KPIs (mill rate, intake, extraction, flour today), three area equipment panels with start/stop sequencing, and live trends. |
| **Process Overview** | The **whole-plant process diagram** — intake → storage → tempering → milling → flour/bran — in one mimic, with inter-area flow arrows and start/stop for each sequence. |
| **Silo Filling** | Process mimic of the intake line (tip pit → pre-cleaner → elevator → distributor → silos), 6 storage silos with live level/grain type, wheat inventory, and setpoints for destination silo, grain/blend component and fill rate (t/h). |
| **Grain Tempering** | Process mimic (weigher → dampener + water addition → elevator → temper bins → screws), inlet & tempered moisture gauges, auto-calculated water, and setpoints for **target moisture %** and **dwell/temper time**. |
| **Milling** | Process mimic of the roll passages (break → plansifter → reduction → purifier → packing), recipe/blend selector that loads setpoints, and setpoints for **milling rate (t/h)** and roll gaps. Live rate & extraction trend. |
| **Reporting** | Daily production counters, production-by-recipe breakdown, **operator efficiency leaderboard**, 14-day production trend, and a full recipe production log with CSV export. |
| **Settings** | PLC connection (driver, IP, slot, gateway URL, tag prefix), background process settings (alarm limits, water K-factor, scale span, bulk density), HMI/scan/theme settings and data maintenance. |

### Motor faceplates
Click **any motor** anywhere in the HMI to open its faceplate:
- **Auto / Manual** mode switch and manual **Start / Stop**
- Live status: running/stopped/faulted, current vs FLC, speed %
- **Runtime & maintenance:** number of starts, run hours, winding temp, next service due
- **Motor nameplate:** rated kW, voltage, **poles**, synchronous & rated **rpm**, full-load current, frame size, service factor, slip, starter type (DOL / VSD)
- A **Sim Fault / Reset** button for training and alarm testing

---

## Connecting to a real Allen-Bradley PLC

A browser cannot speak EtherNet/IP (CIP) directly, so a small gateway sits on
the mill network and bridges PLC tags to the HMI over WebSocket.

```
┌───────────┐   EtherNet/IP   ┌──────────────┐   WebSocket    ┌──────────┐
│  AB PLC   │◄───────────────►│  ab-gateway  │◄──────────────►│  SCADA   │
│ ControlLogix/             │  (Node.js)   │                │  browser │
│ CompactLogix              └──────────────┘                └──────────┘
└───────────┘
```

### 1. Run the gateway on the mill network

```bash
cd scada/server
npm install                       # installs ws + ethernet-ip
PLC_IP=192.168.1.10 PLC_SLOT=0 PORT=8080 node ab-gateway.js
```

> If `ethernet-ip` is not installed the gateway starts in **demo/echo mode**
> so you can test the WebSocket path without a controller.

### 2. Point the HMI at the gateway

In the SCADA **Settings → PLC Connection** panel:
- **Driver:** `Live PLC via gateway`
- **Controller IP / CIP Path:** your PLC IP (e.g. `192.168.1.10`)
- **CPU Backplane Slot:** controller slot (usually `0`)
- **Gateway WebSocket URL:** `ws://<gateway-pc>:8080`
- **Tag Scope Prefix:** program scope, e.g. `Program:Mill.`

Click **Apply & Connect**. The pill turns **PLC ONLINE** when subscribed.

### 3. Tag mapping

Every HMI value maps to a symbolic controller tag (see `js/plc.js`). The
prefix is configurable; for example with prefix `Program:Mill.`:

| HMI tag | Controller tag | Type |
|---------|----------------|------|
| `SP_MILL_TPH` | `Program:Mill.MillRateSP` | REAL |
| `PV_MILL_TPH` | `Program:Mill.MillRatePV` | REAL |
| `SP_TEMPER_MOIST` | `Program:Mill.TemperMoistSP` | REAL |
| `M_B1_RUN` | `Program:Mill.M_B1.Run` | BOOL |
| `M_B1_AUTO` | `Program:Mill.M_B1.Auto` | BOOL |
| `M_B1_STARTS` | `Program:Mill.M_B1.StartCount` | DINT |
| `S1_LEVEL` | `Program:Mill.S1.LevelPct` | REAL |
| ... | ... | ... |

Create matching tags (ideally a `Motor` UDT with `.Run/.Auto/.Fault/.StartCmd/
.SpeedFbk/.Current/.StartCount/.RunHours/.WindingTemp`) in Studio 5000 and the
HMI lights up against live data.

---

## Architecture

```
scada/
├── index.html            # single-page HMI shell
├── css/scada.css         # dark control-room theme
├── js/
│   ├── plc.js            # tag database + Sim/Live drivers + process model + alarms
│   ├── components.js     # motor faceplate, silo, gauge, setpoint, trend, donut widgets
│   └── app.js            # router + the six pages + reporting/historian logic
└── server/
    ├── ab-gateway.js     # EtherNet/IP ⇄ WebSocket bridge
    └── package.json
```

**The whole HMI talks only to `PLC.read()` / `PLC.write()`.** Swapping the
simulator for the live PLC is a one-line driver change — no page code changes.

### Notes
- Setpoints, operator and config persist in the browser (`localStorage`); on a
  live deployment these are PLC tags / historian records via the gateway.
- Production logs are seeded with 30 days of demo data and accumulate as recipes
  are run. Export to CSV from Reporting or Settings. In production, point the
  gateway at a SQL historian.
- Alarms (silo high/low level, motor fault/overload, winding temp) evaluate every
  scan and surface in the banner, nav badge and status bar.

Built by **Wyelec — Weiley Electrical** · industrial automation & PLC/SCADA.
