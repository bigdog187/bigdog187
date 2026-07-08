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

## Users, logins & permissions

The dashboard is protected by a local username/password system — no external
service, everything stays on your server.

- **First run:** visiting the app shows a **Create administrator** screen.
  That account manages everything else. (No default password ships with the
  app.)
- **Add users:** Settings tab (admins only) → *Add a user*. Set a role and
  tick the permissions each person should have:
  - **View dashboard** · **Add & rearrange widgets** · **Use the assistant
    (chat)** · **View & run routines** · **Financial data ($ values, invoices)**
- **Roles:**
  - **General user** — only what their permissions allow. They can **never
    delete anything** (widgets, routines, users) and **never see financial
    data** unless you grant it. Financial figures are stripped **server-side**
    — including from Claude's chat answers, where the invoice tool and $
    fields are removed before the model ever sees them.
  - **Administrator** — everything: deletes, financial data, user management,
    routine editing, connection settings. You can't delete or demote the last
    administrator (or your own account), so you can't lock yourself out.
- **Passwords** are hashed (scrypt + per-user salt) in `data/users.json`;
  sessions are httpOnly cookies lasting 7 days. Both files are gitignored.
  Resetting a user's password signs out their existing sessions. Failed
  logins are rate-limited (10 tries / 15 min).

> Note: routine **outputs** are visible to anyone with routine access. If
> general users can run routines, don't put financial summaries in routine
> prompts — or don't grant those users routine access.

---

## Access it from your phone (over the internet)

The app is mobile-responsive — the missing piece is reaching your PC from
outside. **Recommended: Cloudflare Tunnel** (free, gives you HTTPS, no router
port-forwarding, hides your home IP):

1. Install `cloudflared`:
   - **Windows:** `winget install Cloudflare.cloudflared`
   - **macOS:** `brew install cloudflared`
2. Start the dashboard (`npm start`), then in another terminal:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. It prints a public `https://….trycloudflare.com` URL — open that on your
   phone and log in. Add it to your home screen for an app-like feel.

That quick tunnel gets a **new random URL each time** — great for trying it
out. For a permanent address, either:
- **Named Cloudflare Tunnel** (free, needs a domain on Cloudflare): follow
  Cloudflare's "Create a tunnel" guide and point it at
  `http://localhost:3000`, or
- **Tailscale** (free for personal use): install on the PC and your phone,
  and the dashboard is reachable privately at `http://<pc-name>:3000` from
  anywhere, with no public exposure at all. Most private option.

**Security notes, honestly stated:**
- Only expose the app **with the login system in place** (it is — every page
  and API call requires a signed-in session).
- Prefer Cloudflare Tunnel or Tailscale over router port-forwarding: both
  give you encryption (HTTPS/WireGuard) without opening ports; raw
  port-forwarding of HTTP sends your passwords unencrypted.
- Use strong passwords — anything internet-facing gets probed by bots.
- The server must be running for phone access; on Windows, Task Scheduler
  (or `pm2`) can keep `npm start` running in the background.

---

## Connect to your live AroFlo

This app runs on **your** machine and talks to **your** AroFlo account with
**your** API credentials — the credentials never leave your computer (they live
in `.env`, which is gitignored). Steps:

1. **Turn on the AroFlo API add-on.** In AroFlo go to **Site Administration →
   Settings → General → AroFlo API**. (The API is a paid add-on on most plans —
   if you don't see it, contact AroFlo support to enable it. Rate limit is
   ~2,000 calls/day.)
2. **Copy your credentials** from that screen into `.env`:
   `AROFLO_CUID`, `AROFLO_ORG_ENCODED_KEY`, `AROFLO_USER_NAME`,
   `AROFLO_U_ENCODED_KEY`, and set `AROFLO_ENABLED=true`.
3. **Restart** (`npm run dev`) and click the **Claude / AroFlo** indicator in
   the top-right → **Test AroFlo connection**. It makes one live call and shows
   the result (or the exact error) without ever printing your secrets.
4. Once it says **Connected**, the widgets and Claude answers use your real
   data automatically — nothing else to change.

> **One thing to confirm on the first live test:** AroFlo signs requests with
> HMAC, and the exact signing recipe (string-to-sign + header names) is defined
> in [AroFlo's API docs / Postman collection](https://apidocs.aroflo.com/). The
> client (`server/aroflo.js` → `signRequest()`) implements AroFlo's documented
> SHA512 model, but if the test returns an auth error, that one function is the
> only thing to adjust — the **Test connection** button shows the raw status so
> it's a quick fix. If you paste the exact fields from your AroFlo API screen (or
> the Postman pre-request script), I can finalise the signing to match.

There is **no way for me (or anyone else) to connect to your AroFlo remotely** —
AroFlo auth is per-account and the keys stay with you. This local app is the
connection.

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

## Routines (scheduled scripts)

The **Routines** tab lets you run tasks on a recurring schedule. The scheduler
runs inside the server (poll every 30s) — so routines fire while `npm run dev`
or `npm start` is running.

**Routine types**
- **Ask Claude** — runs a saved instruction through Claude + the AroFlo tools
  and stores the answer (e.g. *"summarise today's schedule and flag overdue
  jobs"*). Works with canned output in mock mode.
- **Data snapshot** — captures a data source (metrics, jobs, …) to the run log,
  useful for point-in-time records.
- **Script** — your own JavaScript, run server-side. The script is `async` and
  gets: `aroflo` (the data client, e.g. `await aroflo.jobs()`), `sources` (the
  named feeds), `log(...)` (append to output), and `result(value)` (set a
  return value). Example:
  ```js
  const jobs = await aroflo.jobs();
  const overdue = jobs.filter(j => j.overdue);
  log(`${overdue.length} overdue`);
  result(overdue.map(j => j.id));
  ```

**Schedules:** every N minutes, daily at a time, weekly on a day, or manual
(run on demand). Each routine has an enable switch, **Run now**, **Output**
(last result), Edit and Delete. Run history is kept in `data/routine-runs.json`.

> **Trust note on Script routines:** scripts execute on the server with access
> to your AroFlo data. There is no network/`require`/`process` access from a
> script, but only add scripts you trust — same as you would a cron job.
> Definitions live in `data/routines.json` (created on first edit; the shipped
> `routines.default.json` seeds a few **disabled** examples).

---

## Deploying (when ready)

It's a standard Node app — run `npm start` on any host that runs Node 18+
(your own PC, a small VPS, or Render/Railway/Fly). Set the same environment
variables there. Because it's one process serving both the UI and the API,
there's nothing else to wire up.
