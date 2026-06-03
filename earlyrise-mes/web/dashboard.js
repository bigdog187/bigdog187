/* Earlyrise Bakery MES — dashboard logic.
 * Vanilla JS, no external libs (it runs on the local bakery network).
 * Polls the REST API and renders live line cards + a detail drawer. */

const POLL_MS = 3000;
const $ = (sel, el = document) => el.querySelector(sel);
const fmt = (n) => (n == null ? "–" : Number(n).toLocaleString());

let selected = null;        // currently opened line key
let breakdownGroup = "recipe";

async function api(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

/* ----------------------------------------------------------------- header */
function setConn(ok) {
  $("#conn-dot").className = "dot " + (ok ? "live" : "down");
  $("#conn-label").textContent = ok ? "LIVE" : "NO SIGNAL";
}
function tickClock() {
  $("#clock").textContent = new Date().toLocaleTimeString("en-AU", { hour12: false });
}

/* ------------------------------------------------------------- line cards */
function statusClass(s) {
  return { running: "s-running", idle: "s-idle", fault: "s-fault", offline: "s-offline" }[s] || "s-idle";
}

function lineCard(line) {
  const run = line.run || {};
  return `
    <div class="line-card ${selected === line.key ? "sel" : ""}" data-key="${line.key}">
      <div class="line-card-top">
        <div>
          <div class="line-name">${line.name}</div>
          <div class="line-area">${line.area || ""}</div>
        </div>
        <div class="status-chip ${statusClass(line.status)}"><span class="dot"></span>${line.status}</div>
      </div>
      <div class="line-count">${fmt(line.count)}</div>
      <div class="line-count-label">Product Count · ${run.recipe || "—"}</div>
      <div class="line-meta">
        <div><div class="meta-k">Operator</div><div class="meta-v">${line.operator || "—"}</div></div>
        <div><div class="meta-k">Rate</div><div class="meta-v">${line.rate != null ? Math.round(line.rate) + " /hr" : "—"}</div></div>
        <div><div class="meta-k">Recipe</div><div class="meta-v">${line.recipe || "—"}</div></div>
        <div><div class="meta-k">Run Total</div><div class="meta-v">${fmt(run.total_produced)}</div></div>
      </div>
      <svg class="spark" data-spark="${line.key}" preserveAspectRatio="none"></svg>
    </div>`;
}

async function refreshSummary() {
  try {
    const data = await api("/api/summary");
    setConn(true);
    $("#kpi-running").textContent = data.lines_running;
    $("#kpi-fault").textContent = data.lines_fault;
    $("#kpi-offline").textContent = data.lines_offline;
    $("#kpi-produced").textContent = fmt(data.produced_today);
    $("#line-grid").innerHTML = data.lines.map(lineCard).join("");
    data.lines.forEach((l) => drawSpark(l.key));
    if (selected) refreshDetail(selected, false);
  } catch (e) {
    setConn(false);
  }
}

/* ------------------------------------------------------------ mini sparks */
async function drawSpark(key) {
  const svg = document.querySelector(`[data-spark="${key}"]`);
  if (!svg) return;
  try {
    const ts = await api(`/api/lines/${key}/timeseries?hours=0.5`);
    const pts = ts.points.filter((p) => p.rate != null);
    svg.innerHTML = sparkPath(pts.map((p) => p.rate), 360, 34);
  } catch (_) {}
}

function sparkPath(values, w, h) {
  if (!values.length) return "";
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = w / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`);
  return `<polyline fill="none" stroke="#fff" stroke-width="1" opacity="0.55" points="${pts.join(" ")}"/>`;
}

/* --------------------------------------------------------------- detail */
async function openDetail(key) {
  selected = key;
  $("#detail").hidden = false;
  document.querySelectorAll(".line-card").forEach((c) => c.classList.toggle("sel", c.dataset.key === key));
  await refreshDetail(key, true);
  $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeDetail() {
  selected = null;
  $("#detail").hidden = true;
  document.querySelectorAll(".line-card").forEach((c) => c.classList.remove("sel"));
}

async function refreshDetail(key, full) {
  try {
    const [status, oee, runs, events] = await Promise.all([
      api(`/api/lines/${key}/status`),
      api(`/api/lines/${key}/oee?hours=24`),
      api(`/api/lines/${key}/runs?limit=12`),
      api(`/api/lines/${key}/events?limit=40`),
    ]);
    $("#detail-name").textContent = status.name;
    $("#detail-tag").textContent = `LINE DETAIL · ${status.status.toUpperCase()}`;
    renderOEE(oee);
    renderRuns(runs.runs);
    renderEvents(events.events);
    renderRateChart(key);
    renderBreakdown(key);
  } catch (e) { /* line may not exist yet */ }
}

function renderOEE(o) {
  const cells = [
    ["OEE", o.oee], ["Availability", o.availability],
    ["Performance", o.performance], ["Quality", o.quality],
  ];
  $("#oee-row").innerHTML = cells.map(([k, v]) => `
    <div class="oee-cell">
      <div class="meta-k">${k}</div>
      <div class="oee-val">${(v * 100).toFixed(1)}%</div>
      <div class="oee-bar"><i style="width:${Math.min(100, v * 100).toFixed(0)}%"></i></div>
    </div>`).join("");
}

function renderRuns(runs) {
  const body = $("#runs-table tbody");
  body.innerHTML = runs.map((r) => `
    <tr>
      <td>${r.recipe || "—"}</td><td>${r.operator || "—"}</td><td>${r.shift || "—"}</td>
      <td>${r.started_at ? new Date(r.started_at).toLocaleTimeString("en-AU", { hour12: false }) : "—"}</td>
      <td class="num">${r.duration_s != null ? mmss(r.duration_s) : "—"}</td>
      <td class="num">${fmt(r.total_produced)}</td>
      <td class="num">${fmt(r.total_reject)}</td>
    </tr>`).join("") || `<tr><td colspan="7" style="color:var(--text-muted)">No runs yet.</td></tr>`;
}

function renderEvents(events) {
  $("#events-log").innerHTML = events.map((e) => `
    <div class="event">
      <time>${new Date(e.ts).toLocaleTimeString("en-AU", { hour12: false })}</time>
      <span class="kind">${e.kind.replace(/_/g, " ")}</span>
      <span class="detail">${e.detail || ""}</span>
    </div>`).join("") || `<div style="color:var(--text-muted);font-size:.75rem">No events yet.</div>`;
}

async function renderRateChart(key) {
  try {
    const ts = await api(`/api/lines/${key}/timeseries?hours=0.5`);
    const vals = ts.points.map((p) => p.rate || 0);
    const w = 520, h = 160;
    $("#chart-rate").innerHTML = vals.length
      ? `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none">
           ${gridLines(w, h)}
           ${areaPath(vals, w, h)}
         </svg>`
      : `<div style="color:var(--text-muted);font-size:.75rem">Collecting data…</div>`;
  } catch (_) {}
}

function gridLines(w, h) {
  return [0.25, 0.5, 0.75].map((f) =>
    `<line x1="0" y1="${(h * f).toFixed(0)}" x2="${w}" y2="${(h * f).toFixed(0)}" stroke="#1c1c1c" stroke-width="1"/>`).join("");
}
function areaPath(values, w, h) {
  const max = Math.max(...values, 1);
  const step = w / Math.max(values.length - 1, 1);
  const line = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 8) - 4).toFixed(1)}`);
  return `<polyline fill="none" stroke="#fff" stroke-width="1.5" points="${line.join(" ")}"/>` +
    `<polygon fill="rgba(255,255,255,0.05)" points="0,${h} ${line.join(" ")} ${w},${h}"/>`;
}

async function renderBreakdown(key) {
  $("#breakdown-title").textContent = `PRODUCTION BY ${breakdownGroup.toUpperCase()} — 24H`;
  try {
    const data = await api(`/api/lines/${key}/production?hours=24&group_by=${breakdownGroup}`);
    const groups = data.groups || [];
    const max = Math.max(...groups.map((g) => g.produced), 1);
    $("#breakdown").innerHTML = groups.map((g) => `
      <div class="bar-row">
        <div class="bar-label">${g[breakdownGroup]}</div>
        <div class="bar-track"><i style="width:${((g.produced / max) * 100).toFixed(0)}%"></i></div>
        <div class="bar-val">${fmt(g.produced)}</div>
      </div>`).join("") || `<div style="color:var(--text-muted);font-size:.75rem">No production yet.</div>`;
  } catch (_) {}
}

/* ----------------------------------------------------------------- utils */
function mmss(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  if (m >= 60) { const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; }
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}

/* ------------------------------------------------------------------ init */
document.addEventListener("click", (e) => {
  const card = e.target.closest(".line-card");
  if (card) openDetail(card.dataset.key);
  if (e.target.id === "detail-close") closeDetail();
  const seg = e.target.closest("#breakdown-toggle button");
  if (seg) {
    breakdownGroup = seg.dataset.g;
    document.querySelectorAll("#breakdown-toggle button").forEach((b) => b.classList.toggle("active", b === seg));
    if (selected) renderBreakdown(selected);
  }
});

async function boot() {
  try {
    const h = await api("/api/health");
    $("#footer-meta").textContent = `v${h.version} · ${h.database.toUpperCase()}`;
  } catch (_) {}
  tickClock();
  setInterval(tickClock, 1000);
  await refreshSummary();
  setInterval(refreshSummary, POLL_MS);
}
boot();
