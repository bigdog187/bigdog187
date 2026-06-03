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
  return `<polyline class="spark-line" stroke-width="1" points="${pts.join(" ")}"/>`;
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
      <span class="ev-detail">${e.detail || ""}</span>
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
    `<line class="grid-line" x1="0" y1="${(h * f).toFixed(0)}" x2="${w}" y2="${(h * f).toFixed(0)}" stroke-width="1"/>`).join("");
}
function areaPath(values, w, h) {
  const max = Math.max(...values, 1);
  const step = w / Math.max(values.length - 1, 1);
  const line = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 8) - 4).toFixed(1)}`);
  return `<polyline class="plot-line" stroke-width="1.5" points="${line.join(" ")}"/>` +
    `<polygon class="plot-area" points="0,${h} ${line.join(" ")} ${w},${h}"/>`;
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

/* --------------------------------------------------------------- theming */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $("#theme-icon").textContent = t === "dark" ? "◐" : "◑";
  localStorage.setItem("mes-theme", t);
}
function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

/* --------------------------------------------------------- view switching */
function showView(view) {
  $("#view-dashboard").hidden = view !== "dashboard";
  $("#view-settings").hidden = view !== "settings";
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  if (view === "settings") loadSettings();
  window.scrollTo({ top: 0 });
}

/* ============================== SETTINGS ============================== */
const TAG_FIELDS = ["operator", "recipe", "count", "running", "fault", "reject", "rate"];

async function loadSettings() {
  let data;
  try { data = await api("/api/config/lines"); } catch (_) { return; }
  const host = $("#settings-lines");
  host.innerHTML = "";
  data.lines.forEach((line) => host.appendChild(buildLineCard(line)));
}

function buildLineCard(line) {
  const node = $("#line-card-tpl").content.firstElementChild.cloneNode(true);
  node.dataset.key = line.key || "";
  node.dataset.isNew = line.__new ? "1" : "";
  const set = (sel, val) => { const el = node.querySelector(sel); if (el) el.value = val ?? ""; };
  set('[data-f="name"]', line.name);
  set('[data-f="key"]', line.key);
  set('[data-f="area"]', line.area || "Production");
  set('[data-f="driver"]', line.driver || "logix");
  set('[data-f="host"]', line.host);
  set('[data-f="slot"]', line.slot ?? 0);
  set('[data-f="ideal_rate_per_hour"]', line.ideal_rate_per_hour ?? 0);
  node.querySelector('[data-f="enabled"]').checked = line.enabled !== false;
  const tags = line.tags || {};
  TAG_FIELDS.forEach((t) => { const el = node.querySelector(`[data-t="${t}"]`); if (el) el.value = tags[t] || ""; });
  // existing keys are locked (used as the DB id); new lines can set one
  if (line.key && !line.__new) node.querySelector('[data-f="key"]').setAttribute("readonly", "true");
  node.addEventListener("input", () => node.classList.add("dirty"));
  return node;
}

function readCard(node) {
  const get = (sel) => node.querySelector(sel)?.value.trim() || "";
  const tags = {};
  TAG_FIELDS.forEach((t) => { const v = node.querySelector(`[data-t="${t}"]`).value.trim(); if (v) tags[t] = v; });
  return {
    key: get('[data-f="key"]') || null,
    name: get('[data-f="name"]'),
    area: get('[data-f="area"]') || "Production",
    driver: get('[data-f="driver"]'),
    host: get('[data-f="host"]') || null,
    slot: parseInt(get('[data-f="slot"]') || "0", 10),
    ideal_rate_per_hour: parseFloat(get('[data-f="ideal_rate_per_hour"]') || "0"),
    enabled: node.querySelector('[data-f="enabled"]').checked,
    tags,
  };
}

function msg(node, text, cls) {
  const m = node.querySelector(".cfg-msg");
  m.textContent = text;
  m.className = "cfg-msg" + (cls ? " " + cls : "");
}

async function saveCard(node) {
  const payload = readCard(node);
  if (!payload.name) return msg(node, "Name is required.", "err");
  const isNew = node.dataset.isNew === "1";
  msg(node, "Saving…");
  try {
    const res = await fetch(isNew ? "/api/config/lines" : `/api/config/lines/${node.dataset.key}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || res.status); }
    const saved = await res.json();
    node.dataset.key = saved.key; node.dataset.isNew = "";
    node.querySelector('[data-f="key"]').setAttribute("readonly", "true");
    node.classList.remove("dirty");
    msg(node, `Saved · ${saved.key} · live within one poll cycle`, "ok");
  } catch (e) { msg(node, "Save failed: " + e.message, "err"); }
}

async function testCard(node) {
  msg(node, "Testing connection…");
  try {
    const res = await fetch("/api/config/test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readCard(node)),
    });
    const r = await res.json();
    if (r.ok) {
      const s = r.sample || {};
      msg(node, `✓ Connected · operator=${s.operator ?? "—"} recipe=${s.recipe ?? "—"} count=${s.count ?? "—"}`, "ok");
    } else {
      msg(node, "✕ " + (r.error || "no response"), "err");
    }
  } catch (e) { msg(node, "✕ " + e.message, "err"); }
}

async function deleteCard(node) {
  if (node.dataset.isNew === "1") { node.remove(); return; }
  if (!confirm(`Disable line "${node.dataset.key}"? History is kept; it stops polling.`)) return;
  try {
    await fetch(`/api/config/lines/${node.dataset.key}`, { method: "DELETE" });
    node.querySelector('[data-f="enabled"]').checked = false;
    msg(node, "Disabled · history retained", "ok");
  } catch (e) { msg(node, "Failed: " + e.message, "err"); }
}

function addBlankLine() {
  const node = buildLineCard({ __new: true, driver: "logix", enabled: true, area: "Production", slot: 0,
    tags: { operator: "Operator_Name", recipe: "Current_Recipe", count: "Product_Count" } });
  $("#settings-lines").prepend(node);
  node.querySelector('[data-f="name"]').focus();
}

/* ------------------------------------------------------------------ init */
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-view]");
  if (nav) { e.preventDefault(); showView(nav.dataset.view); return; }
  if (e.target.closest("#theme-btn")) return toggleTheme();
  if (e.target.closest("#add-line-btn")) return addBlankLine();

  const card = e.target.closest(".line-card");
  if (card) openDetail(card.dataset.key);
  if (e.target.id === "detail-close") closeDetail();
  const seg = e.target.closest("#breakdown-toggle button");
  if (seg) {
    breakdownGroup = seg.dataset.g;
    document.querySelectorAll("#breakdown-toggle button").forEach((b) => b.classList.toggle("active", b === seg));
    if (selected) renderBreakdown(selected);
  }
  const cfg = e.target.closest(".cfg-card");
  if (cfg && e.target.dataset.act) {
    if (e.target.dataset.act === "save") saveCard(cfg);
    if (e.target.dataset.act === "test") testCard(cfg);
    if (e.target.dataset.act === "delete") deleteCard(cfg);
  }
});

async function boot() {
  applyTheme(localStorage.getItem("mes-theme") || "dark");
  try {
    const h = await api("/api/health");
    $("#footer-meta").textContent = `v${h.version} · ${h.database.toUpperCase()}`;
  } catch (_) {}
  tickClock();
  setInterval(tickClock, 1000);
  await refreshSummary();
  setInterval(() => { if (!$("#view-dashboard").hidden) refreshSummary(); }, POLL_MS);
}
boot();
