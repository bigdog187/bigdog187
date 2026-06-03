/* Earlyrise Bakery MES — dashboard logic.
 * Vanilla JS, no external libs (runs on the local bakery network).
 * Overview + per-line tabs + settings, with AI insights and a colourful
 * actual-vs-target rate hero. */

const POLL_MS = 3000;
const $ = (sel, el = document) => el.querySelector(sel);
const fmt = (n) => (n == null ? "–" : Number(n).toLocaleString());

let view = "overview";      // "overview" | "line:<key>" | "settings"
let lines = [];             // [{key,name,area,...}]
let breakdownGroup = "recipe";
let dlSeq = 0;              // unique id counter for per-card tag <datalist>s

async function api(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

/* ----------------------------------------------------------- colour helpers */
function attainClass(pct) {
  if (pct >= 98) return "good";
  if (pct >= 85) return "info";
  if (pct >= 70) return "warn";
  return "bad";
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
function setConn(ok) {
  $("#conn-dot").className = "dot " + (ok ? "live" : "down");
  $("#conn-label").textContent = ok ? "LIVE" : "NO SIGNAL";
}
function tickClock() {
  $("#clock").textContent = new Date().toLocaleTimeString("en-AU", { hour12: false });
}

/* ------------------------------------------------------------------ tabs */
async function loadTabs() {
  try { lines = (await api("/api/lines")).lines; } catch (_) { lines = []; }
  const tabs = [`<a href="#" class="nav-link" data-view="overview">OVERVIEW</a>`]
    .concat(lines.map((l) => `<a href="#" class="nav-link" data-view="line:${l.key}">${l.name.toUpperCase()}</a>`))
    .concat([`<a href="#" class="nav-link" data-view="settings">SETTINGS</a>`]);
  $("#nav-tabs").innerHTML = tabs.join("");
  markActiveTab();
}
function markActiveTab() {
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
}

/* ------------------------------------------------------------ view router */
function showView(v) {
  view = v;
  $("#view-overview").hidden = v !== "overview";
  $("#view-line").hidden = !v.startsWith("line:");
  $("#view-settings").hidden = v !== "settings";
  markActiveTab();
  window.scrollTo({ top: 0 });
  if (v === "overview") renderOverview();
  else if (v.startsWith("line:")) renderLine(v.slice(5));
  else if (v === "settings") loadSettings();
}

/* --------------------------------------------------------------- insights */
function insightCard(i) {
  return `<div class="insight ${i.severity}">
      <div class="insight-title">${i.title}</div>
      <div class="insight-text">${i.text}</div>
    </div>`;
}
async function renderInsights(elId, path) {
  try {
    const data = await api(path);
    const tag = `<div class="insights-tag"><span class="ai-dot"></span>AI INSIGHTS · ${data.generated_by.toUpperCase()} · TODAY</div>`;
    $(elId).innerHTML = tag + data.insights.map(insightCard).join("");
  } catch (_) { $(elId).innerHTML = ""; }
}

/* --------------------------------------------------------------- overview */
function rateBar(actual, target, attain) {
  const cls = attainClass(attain * 100);
  const fill = Math.min(attain * 75, 100).toFixed(0);   // target sits at 75% of track
  return `<div class="card-rate">
      <div class="card-rate-vals">
        <span class="card-rate-actual">${Math.round(actual)}<small style="font-size:.6rem;color:var(--text-secondary)"> /hr</small></span>
        <span class="card-attain c-${cls}">${(attain * 100).toFixed(0)}% of target</span>
      </div>
      <div class="card-rate-track">
        <i class="${cls}" style="width:${fill}%"></i>
        <span class="rate-target-mark" style="left:75%"></span>
      </div>
    </div>`;
}

function lineCard(l) {
  const t = l.today || { actual_rate: 0, attainment: 0 };
  const target = l.target_rate || l.ideal_rate_per_hour || 0;
  return `<div class="line-card" data-key="${l.key}">
      <div class="line-card-top">
        <div>
          <div class="line-name">${l.name}</div>
          <div class="line-area">${l.area || ""}</div>
        </div>
        <div class="status-chip ${l.status}"><span class="dot"></span>${l.status}</div>
      </div>
      <div class="line-count">${fmt(l.count)}</div>
      <div class="line-count-label">Product Count · ${l.recipe || "—"}</div>
      ${rateBar(t.actual_rate, target, t.attainment)}
      <div class="line-meta">
        <div><div class="meta-k">Operator</div><div class="meta-v">${l.operator || "—"}</div></div>
        <div><div class="meta-k">Target</div><div class="meta-v">${target ? Math.round(target) + " /hr" : "—"}</div></div>
      </div>
    </div>`;
}

async function renderOverview() {
  renderInsights("#site-insights", "/api/insights");
  try {
    const d = await api("/api/summary");
    setConn(true);
    const attainPct = (d.site_attainment * 100) || 0;
    const av = $("#kpi-attain");
    av.textContent = attainPct.toFixed(0) + "%";
    av.className = "kpi-val c-" + attainClass(attainPct);
    $("#kpi-produced").textContent = fmt(d.produced_today);
    $("#kpi-running").textContent = `${d.lines_running}/${d.lines_total}`;
    const ff = $("#kpi-fault");
    ff.textContent = d.lines_fault;
    ff.className = "kpi-val" + (d.lines_fault ? " c-bad" : "");
    $("#line-grid").innerHTML = d.lines.map(lineCard).join("");
  } catch (_) { setConn(false); }
}

/* ------------------------------------------------------------- line view */
async function renderLine(key) {
  const l = lines.find((x) => x.key === key);
  $("#line-title").textContent = l ? l.name : key;
  $("#line-tag").textContent = `PRODUCTION LINE · ${(l ? l.name : key).toUpperCase()}`;
  renderInsights("#line-insights", `/api/lines/${key}/insights`);
  try {
    const [status, rate, oee] = await Promise.all([
      api(`/api/lines/${key}/status`),
      api(`/api/lines/${key}/rate?hours=24`),
      api(`/api/lines/${key}/oee?hours=24`),
    ]);
    setConn(true);
    const chip = $("#line-status");
    chip.className = "status-chip " + status.status;
    chip.innerHTML = `<span class="dot"></span><span>${status.status.toUpperCase()}</span>`;
    renderRateHero(rate, status);
    renderMetrics(status.metrics || []);
    renderOEE(oee);
    renderRateChart(key, rate.target_rate);
    renderBreakdown(key);
    renderRuns(key);
    renderEvents(key);
  } catch (_) { setConn(false); }
}

function renderRateHero(rate, status) {
  const attain = rate.attainment || 0;
  const cls = attainClass(attain * 100);
  const fill = Math.min(attain * 75, 100).toFixed(0);
  $("#rate-hero").innerHTML = `
    <div class="rate-hero-top">
      <div>
        <div class="rate-actual">${Math.round(rate.actual_rate)}<small>units/hr actual</small></div>
        <div class="rate-sub">today · ${fmt(rate.produced)} units over ${rate.running_hours.toFixed(1)} running hrs · live ${Math.round(status.actual_rate || 0)}/hr</div>
      </div>
      <div class="rate-attain">
        <div class="rate-attain-val c-${cls}">${(attain * 100).toFixed(0)}%</div>
        <div class="rate-sub">of ${Math.round(rate.target_rate)}/hr target</div>
      </div>
    </div>
    <div class="rate-track">
      <i class="${cls}" style="width:${fill}%"></i>
      <span class="rate-target-mark" data-v="${Math.round(rate.target_rate)}" style="left:75%"></span>
    </div>`;
}

function renderMetrics(metrics) {
  const el = $("#metrics-strip");
  if (!metrics.length) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = metrics.map((m) => {
    let v = m.value;
    if (v == null) v = "—";
    else if (m.type === "bool") v = v ? "ON" : "OFF";
    else if (m.type === "number" && typeof v === "number") v = v.toLocaleString();
    return `<div class="metric-tile">
        <div class="meta-k">${m.label}</div>
        <div class="metric-val">${v}${m.unit ? `<small>${m.unit}</small>` : ""}</div>
      </div>`;
  }).join("");
}

function renderOEE(o) {
  const cells = [["OEE", o.oee], ["Availability", o.availability], ["Performance", o.performance], ["Quality", o.quality]];
  $("#oee-row").innerHTML = cells.map(([k, v]) => `
    <div class="oee-cell">
      <div class="meta-k">${k}</div>
      <div class="oee-val">${(v * 100).toFixed(1)}%</div>
      <div class="oee-bar"><i style="width:${Math.min(100, v * 100).toFixed(0)}%"></i></div>
    </div>`).join("");
}

async function renderRuns(key) {
  const body = $("#runs-table tbody");
  try {
    const runs = (await api(`/api/lines/${key}/runs?limit=12`)).runs;
    body.innerHTML = runs.map((r) => `
      <tr>
        <td>${r.recipe || "—"}</td><td>${r.operator || "—"}</td><td>${r.shift || "—"}</td>
        <td>${r.started_at ? new Date(r.started_at).toLocaleTimeString("en-AU", { hour12: false }) : "—"}</td>
        <td class="num">${r.duration_s != null ? mmss(r.duration_s) : "—"}</td>
        <td class="num">${fmt(r.total_produced)}</td>
        <td class="num">${fmt(r.total_reject)}</td>
      </tr>`).join("") || `<tr><td colspan="7" style="color:var(--text-muted)">No runs yet.</td></tr>`;
  } catch (_) {}
}

async function renderEvents(key) {
  try {
    const events = (await api(`/api/lines/${key}/events?limit=40`)).events;
    $("#events-log").innerHTML = events.map((e) => `
      <div class="event">
        <time>${new Date(e.ts).toLocaleTimeString("en-AU", { hour12: false })}</time>
        <span class="kind">${e.kind.replace(/_/g, " ")}</span>
        <span class="ev-detail">${e.detail || ""}</span>
      </div>`).join("") || `<div style="color:var(--text-muted);font-size:.75rem">No events yet.</div>`;
  } catch (_) {}
}

async function renderRateChart(key, target) {
  try {
    const ts = await api(`/api/lines/${key}/timeseries?hours=0.5`);
    const vals = ts.points.map((p) => p.rate || 0);
    const w = 520, h = 160;
    if (!vals.length) { $("#chart-rate").innerHTML = `<div style="color:var(--text-muted);font-size:.75rem">Collecting data…</div>`; return; }
    const max = Math.max(...vals, target || 1) * 1.1;
    const step = w / Math.max(vals.length - 1, 1);
    const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 8) - 4).toFixed(1)}`);
    const ty = (h - ((target || 0) / max) * (h - 8) - 4).toFixed(1);
    $("#chart-rate").innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none">
        ${[0.25, 0.5, 0.75].map((f) => `<line class="grid-line" x1="0" y1="${(h * f).toFixed(0)}" x2="${w}" y2="${(h * f).toFixed(0)}" stroke-width="1"/>`).join("")}
        <polygon class="plot-actual-fill" points="0,${h} ${pts.join(" ")} ${w},${h}"/>
        <polyline class="plot-actual" stroke-width="1.5" points="${pts.join(" ")}"/>
        <line class="plot-target" x1="0" y1="${ty}" x2="${w}" y2="${ty}" stroke-width="1.5"/>
      </svg>`;
  } catch (_) {}
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

function mmss(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  if (m >= 60) { const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; }
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
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
  // one shared <datalist> of scanned tags per card, wired to every tag input
  const dl = document.createElement("datalist");
  dl.id = "tags-" + (++dlSeq);
  node.appendChild(dl);
  node.dataset.dl = dl.id;
  TAG_FIELDS.forEach((t) => {
    const el = node.querySelector(`[data-t="${t}"]`);
    if (el) { el.value = tags[t] || ""; el.setAttribute("list", dl.id); }
  });
  (line.metrics || []).forEach((m) => addMetricRow(node, m));
  if (line.key && !line.__new) node.querySelector('[data-f="key"]').setAttribute("readonly", "true");
  node.addEventListener("input", () => node.classList.add("dirty"));
  return node;
}

function addMetricRow(card, m = {}) {
  const row = $("#metric-row-tpl").content.firstElementChild.cloneNode(true);
  row.querySelector('[data-m="label"]').value = m.label || "";
  const tagEl = row.querySelector('[data-m="tag"]');
  tagEl.value = m.tag || "";
  tagEl.setAttribute("list", card.dataset.dl);          // same scanned-tag dropdown
  row.querySelector('[data-m="type"]').value = m.type || "number";
  row.querySelector('[data-m="unit"]').value = m.unit || "";
  card.querySelector(".metrics-list").appendChild(row);
  card.classList.add("dirty");
}

async function scanCard(card) {
  const info = card.querySelector(".scan-info");
  info.textContent = "Scanning…"; info.className = "scan-info";
  const cfg = readCard(card);
  try {
    const res = await fetch("/api/config/scan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driver: cfg.driver, host: cfg.host, slot: cfg.slot }),
    });
    const r = await res.json();
    if (!r.ok) { info.textContent = "✕ " + (r.error || "scan failed"); info.className = "scan-info err"; return; }
    const dl = document.getElementById(card.dataset.dl);
    dl.innerHTML = r.tags.map((t) => `<option value="${t.name}">${t.type}</option>`).join("");
    info.textContent = `✓ ${r.count} tags — pick from any field's dropdown`;
    info.className = "scan-info ok";
  } catch (e) { info.textContent = "✕ " + e.message; info.className = "scan-info err"; }
}

function readCard(node) {
  const get = (sel) => node.querySelector(sel)?.value.trim() || "";
  const tags = {};
  TAG_FIELDS.forEach((t) => { const v = node.querySelector(`[data-t="${t}"]`).value.trim(); if (v) tags[t] = v; });
  const metrics = Array.from(node.querySelectorAll(".metric-row")).map((r) => ({
    label: r.querySelector('[data-m="label"]').value.trim(),
    tag: r.querySelector('[data-m="tag"]').value.trim(),
    type: r.querySelector('[data-m="type"]').value,
    unit: r.querySelector('[data-m="unit"]').value.trim(),
  })).filter((m) => m.tag);
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
    metrics,
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
    loadTabs();
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
    } else { msg(node, "✕ " + (r.error || "no response"), "err"); }
  } catch (e) { msg(node, "✕ " + e.message, "err"); }
}

async function deleteCard(node) {
  if (node.dataset.isNew === "1") { node.remove(); return; }
  if (!confirm(`Disable line "${node.dataset.key}"? History is kept; it stops polling.`)) return;
  try {
    await fetch(`/api/config/lines/${node.dataset.key}`, { method: "DELETE" });
    node.querySelector('[data-f="enabled"]').checked = false;
    msg(node, "Disabled · history retained", "ok");
    loadTabs();
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
  if (card) return showView("line:" + card.dataset.key);

  const seg = e.target.closest("#breakdown-toggle button");
  if (seg) {
    breakdownGroup = seg.dataset.g;
    document.querySelectorAll("#breakdown-toggle button").forEach((b) => b.classList.toggle("active", b === seg));
    if (view.startsWith("line:")) renderBreakdown(view.slice(5));
  }
  const cfg = e.target.closest(".cfg-card");
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (cfg && act) {
    if (act === "save") saveCard(cfg);
    else if (act === "test") testCard(cfg);
    else if (act === "delete") deleteCard(cfg);
    else if (act === "scan") scanCard(cfg);
    else if (act === "add-metric") addMetricRow(cfg);
    else if (act === "del-metric") { e.target.closest(".metric-row").remove(); cfg.classList.add("dirty"); }
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
  await loadTabs();
  showView("overview");
  setInterval(() => {
    if (view === "overview") renderOverview();
    else if (view.startsWith("line:")) renderLine(view.slice(5));
  }, POLL_MS);
}
boot();
