# Earlyrise Bakery — Site-Wide MES & Reporting

A modular Manufacturing Execution System that connects to Allen Bradley PLCs,
logs production data to SQL Server, and presents it live on a web dashboard on
the bakery's local network.

It ships with three lines configured — **Bread Line**, **WP Dough Line**,
**Cheersonic Line** — and is built so new lines are added by editing one config
file, no code changes required.

```
  Allen Bradley PLCs            Collector              Database            Web
 ┌──────────────────┐      ┌───────────────┐      ┌────────────┐    ┌────────────┐
 │ Bread Line  (CL) │─┐    │  poll loop    │      │            │    │  FastAPI   │
 │ WP Dough    (CL) │─┼──▶ │  run state    │ ───▶ │ SQL Server │ ◀─ │  REST API  │
 │ Cheersonic  (CL) │─┘    │  machine      │      │ (or SQLite)│    │  Dashboard │
 └──────────────────┘      └───────────────┘      └────────────┘    └────────────┘
   EtherNet/IP (pycomm3)                                              LAN browsers
```

Each line tracks the **operator's name**, **current recipe**, and **product
count**, and the system rolls those up into MES-style analytics: production
totals by recipe / operator / shift, throughput, an event/audit trail, and
**OEE** (Availability × Performance × Quality).

The headline metric throughout is **actual rate/hr vs target rate/hr** (rate
attainment) — shown per line and aggregated for the whole site, and colour-coded
(green at/above target, amber below, red well below).

## Dashboard pages

- **Overview** — site-wide KPIs (rate-vs-target attainment, produced today,
  lines running, faults), AI insights for the day, and a card per line showing
  its live actual-vs-target rate. Click a card (or tab) to drill in.
- **Per-line tabs** — one tab per line, each with its own AI insights, a large
  actual-vs-target rate hero, OEE, an actual-vs-target rate chart, production
  breakdowns, recent runs, and the event log.
- **Settings** — configure PLC connections (see below).
- **Light & dark mode** — nav toggle (◐), remembered per browser.

## AI insights

The Overview and each line page lead with **AI-generated insights** for the
day's data. Two providers, selected by `MES_INSIGHTS_PROVIDER`:

- **`local`** (default) — a deterministic insight engine that runs entirely
  on-prem (no internet needed), turning rate attainment, downtime/faults,
  quality, and top recipe/operator into plain-English findings.
- **`claude`** — set `MES_INSIGHTS_PROVIDER=claude` with an `ANTHROPIC_API_KEY`
  (and `pip install anthropic`) to have Claude phrase the same computed metrics
  into richer prose. The numbers are always computed from the database first, so
  insights stay grounded in real data; it falls back to `local` if the API is
  unavailable.

---

## Quick start (demo — no PLCs, no SQL Server)

Everything runs against a local SQLite file with a built-in PLC **simulator**,
so you can see it working immediately:

```bash
cd earlyrise-mes
pip install -r requirements.txt

# Run the web server with the simulated collector in-process:
MES_SIMULATE=1 MES_RUN_COLLECTOR=1 python scripts/run_web.py
```

Open **http://localhost:8000/** — the three lines come alive with live
operators, recipes, counts, runs and OEE.

Run the test suite:

```bash
PYTHONPATH=. python -m pytest tests/ -q
```

## Live development (no redeploy)

For an edit-and-see-it-live loop, use the dev launcher — simulated PLCs, the
collector in-process, and **backend auto-reload**:

```bash
./scripts/dev.sh         # macOS / Linux
scripts\dev.bat          # Windows (or double-click it)
```

Leave it running and open http://localhost:8000. Then:

- **Frontend** (`web/*.html`, `*.css`, `*.js`) — there is no build step. Save the
  file and **refresh the browser** (Ctrl/Cmd-Shift-R for a hard refresh). Done.
- **Backend** (`mes/**/*.py`) — the server **auto-restarts** on save; just
  refresh. Live data keeps flowing from the simulator into SQLite.

So the loop with an AI editor (e.g. Antigravity) is: keep `dev.sh` running in one
terminal, prompt the agent to change a file, then refresh the browser. Nothing
to rebuild or redeploy. (Equivalent manual command:
`MES_SIMULATE=1 MES_RUN_COLLECTOR=1 MES_RELOAD=1 python scripts/run_web.py`.)

---

## On-site deployment

### 1. Database — Microsoft SQL Server

Install the [Microsoft ODBC Driver 17/18](https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server)
and `pip install pyodbc`. Create a database (e.g. `EarlyriseMES`) and a login,
then set:

```bash
export MES_DB_BACKEND=sqlserver
export MES_SQLSERVER_HOST='BAKERY-SQL\SQLEXPRESS'    # or 10.0.0.5,1433
export MES_SQLSERVER_DB=EarlyriseMES
export MES_SQLSERVER_USER=mes_writer
export MES_SQLSERVER_PASSWORD=********
python scripts/init_db.py        # creates the tables
```

(Use `MES_SQLSERVER_TRUSTED=1` for Windows integrated auth instead of a login.)

### 2. PLC comms — ControlLogix / CompactLogix

`pip install pycomm3` on the collection PC. Then edit
[`config/lines.yaml`](config/lines.yaml): set each line's `plc.host` (IP) and
map the **tag names** to your PLC program:

```yaml
  - key: bread_line
    name: Bread Line
    driver: logix
    plc: { host: 192.168.1.10, slot: 0 }
    tags:
      operator: "Operator_Name"      # STRING tag
      recipe:   "Current_Recipe"     # STRING tag
      count:    "Product_Count"      # DINT — running good-product total
      running:  "Line_Running"       # BOOL  (optional)
      fault:    "Line_Fault"         # BOOL  (optional)
      reject:   "Reject_Count"       # DINT  (optional — enables Quality/OEE)
    ideal_rate_per_hour: 1200        # target rate for OEE Performance
```

### 3. Run the services

```bash
python scripts/run_collector.py     # polls PLCs -> SQL Server (run as a service)
python scripts/run_web.py           # dashboard + API on http://<pc-ip>:8000/
```

Run them as a Windows Service (e.g. NSSM) or systemd units so they start on
boot. For a single-box install you can instead run just `run_web.py` with
`MES_RUN_COLLECTOR=1` to do both in one process.

---

## Adding / configuring lines

There are two ways to add a line, and **no restart is needed** either way — the
collector reconciles its drivers against the database every poll cycle, so a new
or re-pointed line starts being polled within a couple of seconds.

**1. From the Settings page (recommended)** — open the dashboard, click
**SETTINGS**, and either edit an existing line or hit **+ ADD LINE**. You can set
the PLC **IP address**, slot, driver, ideal rate, and the full tag mapping, then
**TEST CONNECTION** to confirm the PLC answers before you **SAVE**. Disabling a
line stops polling but keeps all its history.

**2. From `config/lines.yaml`** — used to *seed* the database on first run. After
that the database is the source of truth (so settings-page edits aren't
overwritten). Delete the data / line rows to re-seed from YAML.

`config/lines.yaml` remains handy for version-controlling a known-good baseline
and for bulk/initial provisioning.

To support a different controller family, add a driver class in `mes/plc/`
implementing `PLCDriver`; nothing else changes.

## Light & dark mode

The dashboard has a theme toggle (◐ in the nav). Your choice is remembered in
the browser (`localStorage`), so each operator/station can pick light or dark.

---

## How the data is modelled

| Table             | Purpose                                                            |
|-------------------|-------------------------------------------------------------------|
| `lines`           | Registry of production lines (synced from config).                |
| `samples`         | One telemetry snapshot per poll per line (time-series for charts).|
| `production_runs` | The MES core: a continuous run of one recipe by one operator.     |
| `line_events`     | Audit trail: operator/recipe changes, start/stop, faults, resets. |

The **collector state machine** reads each line on a fixed interval, computes
reset-aware "produced" deltas from the product counter, and opens/closes a
production run whenever the operator or recipe changes — so totals are always
attributed to the right operator, recipe and shift.

---

## REST API

| Endpoint                                   | Description                              |
|--------------------------------------------|------------------------------------------|
| `GET /api/health`                          | Service status & DB backend.             |
| `GET /api/summary`                         | Site rollup + attainment + each line's status. |
| `GET /api/insights`                        | AI insights for the whole site's day.    |
| `GET /api/lines/{key}/insights`            | AI insights for one line's day.          |
| `GET /api/lines/{key}/rate`                | Actual rate/hr vs target rate/hr.        |
| `GET /api/lines`                           | Configured lines.                        |
| `GET /api/lines/{key}/status`              | Live status for one line.                |
| `GET /api/lines/{key}/production?group_by=`| Totals by `recipe`/`operator`/`shift`.   |
| `GET /api/lines/{key}/oee`                 | Availability × Performance × Quality.    |
| `GET /api/lines/{key}/runs`                | Recent production runs.                  |
| `GET /api/lines/{key}/events`              | Recent line events.                      |
| `GET /api/lines/{key}/timeseries`          | Count/rate samples over a window.        |
| `GET /api/config/lines`                    | Full editable line config (settings page).|
| `POST /api/config/lines`                   | Add a line on the fly.                   |
| `PUT /api/config/lines/{key}`              | Update a line's connection / tags.       |
| `DELETE /api/config/lines/{key}`           | Disable a line (history retained).       |
| `POST /api/config/test`                    | Test a PLC connection without saving.    |

Windows accept either `?hours=N` or `?from=<ISO>&to=<ISO>`.

---

## Configuration reference

All runtime config is environment variables (see [`.env.example`](.env.example))
plus [`config/lines.yaml`](config/lines.yaml). Secrets (DB password) stay in the
environment; line definitions stay in YAML.
