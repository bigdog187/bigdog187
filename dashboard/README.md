# Weiley Electrical — AroFlo + Claude Dashboard

A work dashboard for Weiley Electrical that connects **AroFlo** (job management)
and **Claude** (AI). Ask questions in plain English and get answers from live
AroFlo data, and reshape the dashboard on the fly — by dragging widgets, adding
them from a menu, or just asking the assistant.

It runs **today with no credentials** (mock mode), so you can build and demo
before AroFlo/Claude keys are in place.

---

## Quick start

```bash
cd dashboard
npm install
cp .env.example .env      # optional — runs in mock mode without it
npm run dev               # http://localhost:3000
```

`npm run dev` watches your files and **auto-reloads the browser** every time you
save — that's the fast iteration loop you asked for. No manual restart, no
redeploy. (`npm start` runs it without the watcher, for "production".)

---

## How the fast iteration loop works

- The server hands the browser a `buildId`. Save any file → `nodemon` restarts
  the server → new `buildId` → the page reloads itself within ~1.5s.
- The dashboard is **config-driven**: widgets live in `data/dashboard.json`
  (falling back to `data/dashboard.default.json`). Adding, removing, or
  rearranging widgets is *data*, not code — so most changes don't touch the
  server at all.
- That same design is why **Claude can reshape the dashboard**: the assistant
  has `add_widget` / `remove_widget` tools. Ask *"add a widget for overdue
  jobs"* and it appears live.

### Growing it with Claude (this tool)
Because the structure is small and consistent, you can keep asking Claude Code
to extend it — e.g. "add a chart widget", "add a tool for purchase orders",
"pull supplier data from AroFlo". The two places almost every change lands:
- **`server/tools.js`** — give Claude a new capability (one entry = schema + a
  `run` function).
- **`public/app.js`** — how a widget type renders.

---

## Going live (add real keys)

Edit `.env`:

1. **Claude** — set `ANTHROPIC_API_KEY` (from
   <https://console.anthropic.com>). The chat immediately switches from canned
   demo replies to real, reasoned answers that call the AroFlo tools.
2. **AroFlo** — set `AROFLO_ENABLED=true` and fill in your API credentials
   (AroFlo → *Site Admin → API Access*). The widgets and tools then read your
   live account instead of the mock fixtures.

The status dots in the top bar show **LIVE** (green) or **MOCK** (amber) for
each connection.

> **AroFlo signing:** `server/aroflo.js` contains an HMAC-SHA512 signing
> scaffold based on AroFlo's auth model. Confirm the exact header/parameter
> names against your AroFlo API docs and adjust `signRequest()` **once** — every
> endpoint flows through it. Until `AROFLO_ENABLED=true`, none of this runs.

**Never commit `.env`** — it's gitignored.

---

## Project layout

```
dashboard/
  server/
    index.js          Express app: static files, API, dev auto-reload
    config.js         Loads .env, reports live/mock status
    aroflo.js         AroFlo client (HMAC scaffold + mock mode)
    claude.js         Claude chat with a manual tool-use loop (+ mock chat)
    tools.js          Tools Claude can call (read AroFlo, reshape dashboard)
    dashboard-store.js  Read/write the widget layout
    mock-data.js      Loads the sample fixtures
  public/
    index.html  styles.css  app.js     The dashboard UI + chat
  data/
    dashboard.default.json   Starting layout
    dashboard.json           Your saved layout (created on first edit)
    mock/*.json              Sample AroFlo data (jobs, clients, invoices, …)
```

---

## Widget types

- **metric** — a single number from `source: "metrics"` (`field` = `openJobs`,
  `overdueJobs`, `unpaidInvoices`, `unpaidTotal`, `hoursThisWeek`,
  `activeClients`). Optional `format: "money"` and `tone: "warn"`.
- **table** — a list from `source`: `jobs | clients | invoices | schedule |
  timesheets`, with a chosen set of `columns`.
- **chart** — a bar or donut (`chartType: "bar" | "donut"`) from an aggregated
  `source`: `jobsByStatus | revenueByClient | hoursByStaff | invoicesByStatus`.
  Rendered on a plain canvas — no charting library.

All three can be added from the UI (**+ Add widget**) or by asking the
assistant (e.g. *"add a donut chart of jobs by status"*).

---

## Deploying (when ready)

It's a standard Node app — run `npm start` on any host that runs Node 18+
(your own PC, a small VPS, or Render/Railway/Fly). Set the same environment
variables there. Because it's one process serving both the UI and the API,
there's nothing else to wire up.
