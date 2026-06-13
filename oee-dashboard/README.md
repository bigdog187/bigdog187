# OEE Dashboard

A generic, multi-site **OEE (Overall Equipment Effectiveness)** and production
monitoring dashboard. Connect any production line through a pluggable connector
architecture — ships with an **Allen Bradley EtherNet/IP** driver as the
baseline, plus generic **Modbus TCP** and a built-in **simulator** so the whole
system runs end-to-end with no hardware.

![stack](https://img.shields.io/badge/node-22%2B-green) ![db](https://img.shields.io/badge/db-sqlite-blue)

## What it does

You feed each machine these signals (from a PLC or any source):

| Signal | Purpose |
| --- | --- |
| **Product feed rate** | drives the Performance factor and the live trend chart |
| **Operator name** | operator/shift attribution and logging |
| **System running** | Availability + status timeline |
| **System stopped** | downtime tracking (planned stops) |
| **System in fault** | fault alarms + downtime tracking |
| Good count *(optional)* | Quality factor |
| Reject count *(optional)* | Quality factor |

From those it computes and visualises:

- **OEE = Availability × Performance × Quality**, live per shift and over any range
- Live radial **OEE gauge** with target marker, plus A / P / Q breakdown bars
- **Feed-rate trend** chart with the ideal-rate reference line
- **Status timeline** (running / stopped / fault / idle colour bands)
- **Automatic downtime logging** with a **Pareto** chart by reason
- **Fault & event alarms** (fault rising edge, prolonged downtime) with acknowledge
- **Operator log** — who was running the line and when
- Production counts (good / reject / total) and run/stop/fault time
- Plant-wide overview KPIs across all sites and machines
- **CSV export** of raw samples for any time range
- Real-time updates pushed over WebSockets; history persisted in SQLite

## Architecture

```
Browser (vanilla JS + canvas charts)
   │  REST + WebSocket
Express server  ──  Poller  ──  Connector (per machine)
   │                 │              ├─ allen-bradley  (EtherNet/IP)
SQLite (better-      │              ├─ modbus         (Modbus TCP)
sqlite3)            OEE engine      └─ simulator      (demo)
```

Adding a new protocol is just a new class extending `BaseConnector` that returns
the normalised reading shape — see `src/connectors/`.

## Quick start

```bash
cd oee-dashboard
npm install
npm start
# open http://localhost:3000
```

On first run it seeds a **Demo Plant** with two simulated machines so the
dashboard is immediately populated. Set `SEED_DEMO=false` to disable.

## Connecting an Allen Bradley PLC

1. Click **+ Machine**, choose connector type **Allen Bradley (EtherNet/IP)**.
2. Enter the controller **IP** and **CPU slot** (0 for most CompactLogix).
3. Map your tag names (controller-scoped `Feed_Rate` or program-scoped
   `Program:Main.Feed_Rate`):
   - Feed Rate → e.g. `Feed_Rate` (REAL/DINT)
   - Operator Name → e.g. `Operator_Name` (STRING)
   - System Running / Stopped / Fault → BOOL tags
   - Good / Reject Count → DINT tags (optional, for Quality)
4. Save. The poller connects over EtherNet/IP and starts reading immediately.

The Allen Bradley driver uses [`st-ethernet-ip`](https://www.npmjs.com/package/st-ethernet-ip)
(an optional dependency, loaded lazily). If a PLC is unreachable the machine is
shown **offline** and the poller retries with exponential backoff.

## Connecting other sites

- **Modbus TCP** — choose the Modbus connector, set IP/port/unit and a JSON tag
  map of holding registers / coils.
- **Anything else** — implement a connector in `src/connectors/` returning the
  reading shape documented in `base.js`, and register it in `index.js`.

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | 3000 | HTTP/WebSocket port |
| `DB_PATH` | ./data/oee.db | SQLite database file |
| `SAMPLE_RETENTION_DAYS` | 30 | raw sample retention (pruned hourly) |
| `SEED_DEMO` | true | seed the demo plant on an empty DB |

## API

REST under `/api` (machines, sites, `/oee`, `/timeseries`, `/downtime`,
`/alarms`, `/operators`, `/overview`, `/export.csv`) and a `/ws` WebSocket that
pushes `machine-update` snapshots in real time.

## How OEE is calculated

- **Availability** = Run Time ÷ Planned Production Time (the selected window)
- **Performance** = average feed rate ÷ ideal feed rate (or Total Count ÷
  ideal-count-over-runtime when piece counts are provided)
- **Quality** = Good ÷ (Good + Reject); defaults to 100% if no counts are fed
- Each factor is capped at 100% for the OEE product; raw values are reported too.
