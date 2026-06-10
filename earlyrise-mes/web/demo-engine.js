/* =====================================================================
 * Earlyrise MES — standalone demo engine.
 * Replaces the Python backend with an in-browser production simulator +
 * analytics, and routes the dashboard's /api/* calls to it by overriding
 * window.fetch. No server, no network needed.
 * ===================================================================== */
(function () {
  const RECIPES = {
    bread_line: ["White Tin 680g", "Wholemeal 750g", "Sourdough Batch", "Multigrain 700g"],
    wp_dough_line: ["Pizza Base 12in", "Focaccia Sheet", "Ciabatta Dough", "Flatbread"],
    cheersonic_line: ["Cheese Slice 200g", "Cheese Block 1kg", "Halloumi Pack"],
  };
  const OPERATORS = ["Sarah Chen", "Mark Taylor", "Priya Nair", "Tom Walsh",
    "Aisha Khan", "Dave Roberts", "Mia Lombardi", "Jack Nguyen"];
  const SKILL = { "Aisha Khan": 1.07, "Sarah Chen": 1.04, "Priya Nair": 1.01, "Mia Lombardi": 0.99,
    "Mark Taylor": 0.97, "Dave Roberts": 0.95, "Tom Walsh": 0.92, "Jack Nguyen": 0.89 };
  const CATALOG = [
    ["Operator_Name", "STRING"], ["Current_Recipe", "STRING"], ["Recipe_Number", "DINT"],
    ["Product_Count", "DINT"], ["Reject_Count", "DINT"], ["Line_Running", "BOOL"],
    ["Line_Fault", "BOOL"], ["Line_Rate", "REAL"], ["Oven_Temp_PV", "REAL"],
    ["Oven_Temp_SP", "REAL"], ["Line_Speed", "REAL"], ["Batch_Number", "DINT"],
    ["Dough_Weight", "REAL"], ["Humidity_Pct", "REAL"], ["Downtime_Reason", "STRING"],
    ["Shift_Number", "DINT"], ["Conveyor_Amps", "REAL"], ["EStop_OK", "BOOL"],
    ["Proof_Time_Min", "REAL"], ["Waste_Kg", "REAL"],
  ];
  const DEFAULT_TAGS = {
    operator: "Operator_Name", recipe: "Current_Recipe", count: "Product_Count",
    running: "Line_Running", fault: "Line_Fault", reject: "Reject_Count", rate: "Line_Rate",
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "line";

  let SIM_NOW = new Date(Date.now() - 30 * 60000);   // virtual clock, starts ~30 min ago
  let ELAPSED = 0;                                    // total simulated seconds

  function mkLine(key, name, target, host, metrics) {
    return {
      key, name, area: "Production", enabled: true, driver: "logix", host, slot: 0,
      target, tags: Object.assign({}, DEFAULT_TAGS), metrics: metrics || [],
      recipes: RECIPES[key] || ["Recipe A", "Recipe B", "Recipe C"],
      count: 0, reject: 0, operator: pick(OPERATORS), recipe: null,
      running: true, fault: false, rate: 0, metricVals: {},
      producedToday: 0, rejectToday: 0, runningSec: 0,
      runs: [], curRun: null, events: [], hist: [],
      tState: rnd(40, 120), tRecipe: rnd(120, 300), tOperator: rnd(300, 600),
    };
  }

  let LINES = [
    mkLine("bread_line", "Bread Line", 1200, "192.168.1.10", [
      { key: "recipe_number", label: "Recipe No.", tag: "Recipe_Number", type: "int", unit: "" },
      { key: "oven_temp", label: "Oven Temp", tag: "Oven_Temp_PV", type: "number", unit: "°C" },
    ]),
    mkLine("wp_dough_line", "WP Dough Line", 900, "192.168.1.11", [
      { key: "dough_weight", label: "Dough Weight", tag: "Dough_Weight", type: "number", unit: "g" },
    ]),
    mkLine("cheersonic_line", "Cheersonic Line", 600, "192.168.1.12", []),
  ];
  LINES.forEach((L) => { L.recipe = pick(L.recipes); });

  const byKey = (k) => LINES.find((l) => l.key === k);
  const shiftOf = (d) => { const h = d.getHours(); return h >= 6 && h < 14 ? "Day" : h >= 14 && h < 22 ? "Afternoon" : "Night"; };
  const addEvent = (L, kind, detail) => { L.events.push({ ts: new Date(SIM_NOW), kind, detail: detail || null }); if (L.events.length > 90) L.events.shift(); };

  function openRun(L) {
    if (L.curRun) { L.curRun.status = "closed"; L.curRun.ended_at = new Date(SIM_NOW); }
    L.curRun = { id: L.runs.length + 1, operator: L.operator, recipe: L.recipe, shift: shiftOf(SIM_NOW),
      started_at: new Date(SIM_NOW), ended_at: new Date(SIM_NOW), start_count: L.count, end_count: L.count,
      total_produced: 0, total_reject: 0, running_seconds: 0, status: "open" };
    L.runs.push(L.curRun);
    if (L.runs.length > 40) L.runs.shift();
  }

  function tickLine(L, dt) {
    if (!L.enabled) return;
    L.tState -= dt; L.tRecipe -= dt; L.tOperator -= dt;
    if (L.tState <= 0) {
      const r = Math.random();
      if (L.running && r < 0.5) { L.running = false; L.fault = r < 0.15; L.tState = rnd(15, 60); addEvent(L, "line_stop"); if (L.fault) addEvent(L, "fault"); }
      else { if (L.fault) addEvent(L, "fault_clear"); if (!L.running) addEvent(L, "line_start"); L.running = true; L.fault = false; L.tState = rnd(60, 180); }
    }
    if (L.tRecipe <= 0) {
      const old = L.recipe; L.recipe = pick(L.recipes);
      addEvent(L, "recipe_change", old + " -> " + L.recipe);
      addEvent(L, "counter_reset", L.count + " -> 0");
      L.count = 0; L.reject = 0; L.running = false;
      L.tRecipe = rnd(180, 420); L.tState = rnd(10, 30);
      openRun(L);
    }
    if (L.tOperator <= 0) { const old = L.operator; L.operator = pick(OPERATORS); addEvent(L, "operator_change", old + " -> " + L.operator); L.tOperator = rnd(300, 700); }
    if (!L.curRun || L.curRun.operator !== L.operator || L.curRun.recipe !== L.recipe) openRun(L);

    const skill = SKILL[L.operator] || 1.0;
    let produced = 0;
    if (L.running) {
      const per = (L.target / 3600) * dt * rnd(0.85, 1.05) * skill;
      produced = Math.floor(per) + (Math.random() < (per % 1) ? 1 : 0);
      L.count += produced; L.producedToday += produced; L.runningSec += dt;
      if (produced && Math.random() < 0.03) { L.reject++; L.rejectToday++; }
    }
    L.rate = L.running ? Math.round(L.target * skill * rnd(0.85, 1.05) * 10) / 10 : 0;
    L.curRun.total_produced += produced; L.curRun.end_count = L.count;
    L.curRun.total_reject = Math.max(L.curRun.total_reject, L.reject);
    L.curRun.ended_at = new Date(SIM_NOW);
    if (L.running) L.curRun.running_seconds += dt;

    L.metricVals = {};
    L.metrics.forEach((m) => {
      if (m.type === "bool") L.metricVals[m.key] = Math.random() > 0.1;
      else if (m.type === "string") L.metricVals[m.key] = pick(["OK", "Run", "Changeover", "Cleaning"]);
      else if (m.type === "int") L.metricVals[m.key] = Math.floor(rnd(1, 999));
      else L.metricVals[m.key] = Math.round(rnd(20, 220) * 10) / 10;
    });

    L.hist.push({ ts: new Date(SIM_NOW), rate: L.rate, count: L.count, running: L.running });
    if (L.hist.length > 240) L.hist.shift();
  }

  function tickAll(dt) { SIM_NOW = new Date(SIM_NOW.getTime() + dt * 1000); ELAPSED += dt; LINES.forEach((L) => tickLine(L, dt)); }

  // -------- analytics (mirror the server's JSON shapes) --------
  const attain = (L) => { const rh = L.runningSec / 3600; const a = rh > 0 ? L.producedToday / rh : 0; return { actual: a, attainment: L.target ? a / L.target : 0, running_hours: rh }; };

  function lineStatus(L) {
    const st = L.fault ? "fault" : L.running ? "running" : "idle";
    return {
      key: L.key, name: L.name, area: L.area, status: st, online: true,
      operator: L.operator, recipe: L.recipe, count: L.count, rate: L.rate,
      running: L.running, fault: L.fault, last_seen: SIM_NOW.toISOString(),
      run: runDict(L.curRun), ideal_rate_per_hour: L.target, target_rate: L.target,
      actual_rate: L.rate, attainment: L.target ? L.rate / L.target : 0,
      metrics: L.metrics.map((m) => ({ key: m.key, label: m.label || m.key, unit: m.unit || "", type: m.type, value: L.metricVals[m.key] })),
    };
  }
  function rateStats(L) { const a = attain(L); return { key: L.key, target_rate: L.target, actual_rate: Math.round(a.actual * 10) / 10, attainment: round4(a.attainment), produced: L.producedToday, running_hours: round3(a.running_hours) }; }
  function oeeOf(L) {
    const a = attain(L); const availability = ELAPSED > 0 ? Math.min(1, L.runningSec / ELAPSED) : 0;
    const theo = L.target * a.running_hours; const perf = theo > 0 ? Math.min(1, L.producedToday / theo) : 0;
    const good = Math.max(0, L.producedToday - L.rejectToday); const qual = L.producedToday ? good / L.producedToday : 1;
    return { key: L.key, availability: round4(availability), performance: round4(perf), quality: round4(qual), oee: round4(availability * perf * qual), produced: L.producedToday, reject: L.rejectToday, running_hours: round3(a.running_hours), ideal_rate_per_hour: L.target };
  }
  function runDict(r) { if (!r) return null; const dur = (r.ended_at - r.started_at) / 1000; return { id: r.id, operator: r.operator, recipe: r.recipe, shift: r.shift, started_at: r.started_at.toISOString(), ended_at: r.status === "closed" ? r.ended_at.toISOString() : null, duration_s: Math.round(dur * 10) / 10, total_produced: r.total_produced, total_reject: r.total_reject, running_seconds: Math.round(r.running_seconds * 10) / 10, status: r.status }; }
  function runsOf(L, n) { return L.runs.slice().reverse().slice(0, n).map(runDict); }
  function eventsOf(L, n) { return L.events.slice().reverse().slice(0, n).map((e) => ({ ts: e.ts.toISOString(), kind: e.kind, detail: e.detail })); }
  function timeseries(L) { const step = Math.max(1, Math.floor(L.hist.length / 200)); return { key: L.key, points: L.hist.filter((_, i) => i % step === 0).map((p) => ({ ts: p.ts.toISOString(), count: p.count, rate: p.rate, running: p.running })) }; }
  function production(L, group) {
    const valid = ["recipe", "operator", "shift"].includes(group);
    const tp = L.runs.reduce((a, r) => a + r.total_produced, 0), tr = L.runs.reduce((a, r) => a + r.total_reject, 0);
    const out = { key: L.key, total_produced: tp, total_reject: tr, runs: L.runs.length };
    if (valid) {
      const b = {}; L.runs.forEach((r) => { const k = r[group] || "(unspecified)"; (b[k] = b[k] || { produced: 0, reject: 0, runs: 0 }); b[k].produced += r.total_produced; b[k].reject += r.total_reject; b[k].runs++; });
      out.group_by = group; out.groups = Object.entries(b).map(([k, v]) => Object.assign({ [group]: k }, v)).sort((x, y) => y.produced - x.produced);
    }
    return out;
  }
  function operatorPerf(L) {
    const agg = {};
    L.runs.forEach((r) => { const op = r.operator || "(unassigned)"; const a = (agg[op] = agg[op] || { produced: 0, reject: 0, rs: 0, runs: 0 }); a.produced += r.total_produced; a.reject += r.total_reject; a.rs += r.running_seconds; a.runs++; });
    const ops = Object.entries(agg).map(([op, a]) => { const rh = a.rs / 3600, actual = rh > 0 ? a.produced / rh : 0, good = Math.max(0, a.produced - a.reject); return { operator: op, produced: a.produced, reject: a.reject, running_hours: round3(rh), actual_rate: Math.round(actual * 10) / 10, attainment: round4(L.target ? actual / L.target : 0), quality: round4(a.produced ? good / a.produced : 1), runs: a.runs }; });
    ops.sort((x, y) => (y.attainment - x.attainment) || (y.produced - x.produced));
    ops.forEach((o, i) => o.rank = i + 1);
    return { key: L.key, name: L.name, target_rate: L.target, operators: ops };
  }
  function operatorsAll() { return { generated_at: SIM_NOW.toISOString(), lines: LINES.filter((l) => l.enabled).map(operatorPerf) }; }

  function summary() {
    const sts = LINES.filter((l) => l.enabled).map((L) => { const s = lineStatus(L); s.today = rateStats(L); return s; });
    let prod = 0, theo = 0; LINES.filter((l) => l.enabled).forEach((L) => { const a = attain(L); prod += L.producedToday; theo += L.target * a.running_hours; });
    return { site: "Earlyrise Bakery", generated_at: SIM_NOW.toISOString(), lines_total: sts.length,
      lines_running: sts.filter((x) => x.status === "running").length, lines_fault: sts.filter((x) => x.status === "fault").length,
      lines_offline: 0, produced_today: prod, site_attainment: round4(theo ? prod / theo : 0), lines: sts };
  }

  // -------- insights (local heuristics) --------
  const sev = (p) => p >= 98 ? "good" : p >= 85 ? "info" : p >= 70 ? "warn" : "bad";
  function lineFacts(L) { const r = rateStats(L), o = oeeOf(L); const ev = {}; L.events.forEach((e) => ev[e.kind] = (ev[e.kind] || 0) + 1); const pr = production(L, "recipe").groups || [], po = production(L, "operator").groups || []; return { line: L.name, attain: Math.round(r.attainment * 1000) / 10, actual: r.actual_rate, target: L.target, produced: r.produced, rh: r.running_hours, quality: Math.round(o.quality * 1000) / 10, reject: o.reject, avail: Math.round(o.availability * 1000) / 10, stops: ev.line_stop || 0, faults: ev.fault || 0, changeovers: ev.recipe_change || 0, topR: pr[0], topO: po[0] }; }
  function lineInsights(L) {
    const f = lineFacts(L), out = []; const s = sev(f.attain);
    const verb = { good: "at or above", info: "tracking near", warn: "below", bad: "well below" }[s];
    out.push({ severity: s, title: "Rate " + Math.round(f.attain) + "% of target", text: f.line + " is running " + verb + " target — " + Math.round(f.actual) + " vs " + Math.round(f.target) + " units/hr. " + f.produced.toLocaleString() + " units over " + f.rh.toFixed(1) + " running hrs today." });
    if (f.faults || f.stops) out.push({ severity: f.faults >= 3 ? "bad" : "warn", title: f.stops + " stop(s), " + f.faults + " fault(s)", text: "Downtime today: " + f.stops + " stop(s) and " + f.faults + " fault(s)" + (f.avail < 90 ? ", pulling availability to " + Math.round(f.avail) + "%." : ".") });
    if (f.quality < 99 && f.reject) out.push({ severity: f.quality >= 95 ? "warn" : "bad", title: "Quality " + f.quality.toFixed(1) + "%", text: f.reject.toLocaleString() + " unit(s) rejected today on " + f.line + "." });
    if (f.topR) out.push({ severity: "info", title: "Top product: " + f.topR.recipe, text: f.topR.recipe + " leads output at " + f.topR.produced.toLocaleString() + " units" + (f.changeovers ? ", with " + f.changeovers + " changeover(s) today." : ".") });
    if (f.topO && f.topO.operator) out.push({ severity: "good", title: "Most output: " + f.topO.operator, text: f.topO.operator + " produced the most today on " + f.line + " — " + f.topO.produced.toLocaleString() + " units." });
    return { scope: L.key, generated_by: "demo", generated_at: SIM_NOW.toISOString(), insights: out };
  }
  function siteInsights() {
    const s = summary(); const facts = LINES.filter((l) => l.enabled).map(lineFacts).filter((f) => f.rh > 0.01);
    const best = facts.reduce((a, b) => (!a || b.attain > a.attain ? b : a), null);
    const worst = facts.reduce((a, b) => (!a || b.attain < a.attain ? b : a), null);
    const sa = Math.round(s.site_attainment * 1000) / 10, out = [];
    out.push({ severity: sev(sa), title: "Site at " + Math.round(sa) + "% of target rate", text: s.produced_today.toLocaleString() + " units produced site-wide today across " + s.lines_running + "/" + s.lines_total + " running lines, averaging " + Math.round(sa) + "% of combined target rate." });
    if (best) out.push({ severity: "good", title: "Top performer: " + best.line, text: best.line + " leads at " + Math.round(best.attain) + "% of target (" + Math.round(best.actual) + " units/hr)." });
    if (worst && (!best || worst.line !== best.line)) out.push({ severity: sev(worst.attain), title: "Main constraint: " + worst.line, text: worst.line + " is slowest against target at " + Math.round(worst.attain) + "% (" + Math.round(worst.actual) + " vs " + Math.round(worst.target) + " units/hr)" + (worst.faults ? ", with " + worst.faults + " fault(s) today." : ".") });
    const tf = facts.reduce((a, f) => a + f.faults, 0), tstp = facts.reduce((a, f) => a + f.stops, 0);
    if (s.lines_fault || tf) out.push({ severity: s.lines_fault ? "bad" : "warn", title: tf + " fault event(s) today", text: s.lines_fault + " line(s) in fault now; " + tstp + " stop(s) and " + tf + " fault(s) logged across the site today." });
    return { scope: "site", generated_by: "demo", generated_at: SIM_NOW.toISOString(), insights: out };
  }

  // -------- config (settings page) --------
  const cfgDict = (L) => ({ key: L.key, name: L.name, area: L.area, enabled: L.enabled, driver: L.driver, host: L.host, slot: L.slot, ideal_rate_per_hour: L.target, tags: L.tags, metrics: L.metrics, updated_at: SIM_NOW.toISOString() });
  function cleanMetrics(ms) { const out = [], seen = new Set(); (ms || []).forEach((m) => { const tag = (m.tag || "").trim(); if (!tag) return; let k = slug(m.key || m.label || tag), base = k, n = 2; while (seen.has(k)) k = base + "_" + (n++); seen.add(k); out.push({ key: k, label: (m.label || k).trim(), tag, type: ["number", "int", "bool", "string"].includes(m.type) ? m.type : "number", unit: (m.unit || "").trim() }); }); return out; }
  function createLine(b) { const key = slug(b.key || b.name); const L = mkLine(key, b.name || key, b.ideal_rate_per_hour || 600, b.host || "", cleanMetrics(b.metrics)); L.area = b.area || "Production"; L.driver = b.driver || "logix"; L.slot = b.slot || 0; if (b.tags) L.tags = b.tags; L.recipe = pick(L.recipes); for (let i = 0; i < 30; i++) tickLine(L, 20); LINES.push(L); return cfgDict(L); }
  function updateLine(key, b) { const L = byKey(key); if (!L) return { __404: true }; L.name = b.name; L.area = b.area; L.enabled = b.enabled; L.driver = b.driver; L.host = b.host; L.slot = b.slot; L.target = b.ideal_rate_per_hour; if (b.tags) L.tags = b.tags; L.metrics = cleanMetrics(b.metrics); return cfgDict(L); }
  function deleteLine(key) { const L = byKey(key); if (L) L.enabled = false; return { key, enabled: false }; }

  const round4 = (x) => Math.round(x * 1e4) / 1e4, round3 = (x) => Math.round(x * 1e3) / 1e3;

  // -------- mock fetch router --------
  function route(rawUrl, opts) {
    const u = new URL(rawUrl, location.href), p = u.pathname.replace(/\/+$/, "") || "/";
    const m = ((opts && opts.method) || "GET").toUpperCase();
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    if (p === "/api/health") return { status: "ok", version: "demo", database: "in-browser", collector_running: true };
    if (p === "/api/lines") return { lines: LINES.filter((l) => l.enabled).map((l) => ({ key: l.key, name: l.name, area: l.area, driver: l.driver, ideal_rate_per_hour: l.target })) };
    if (p === "/api/summary") return summary();
    if (p === "/api/operators") return operatorsAll();
    if (p === "/api/insights") return siteInsights();
    if (p === "/api/config/lines") return m === "POST" ? createLine(body) : { lines: LINES.map(cfgDict) };
    if (p === "/api/config/scan") return { ok: true, count: CATALOG.length, tags: CATALOG.map(([n, t]) => ({ name: n, type: t })) };
    if (p === "/api/config/test") { const L = byKey(body && body.key); return { ok: true, error: null, sample: { operator: L ? L.operator : "Sarah Chen", recipe: L ? L.recipe : "White Tin 680g", count: L ? L.count : 0, running: true } }; }
    let mm = p.match(/^\/api\/config\/lines\/([^/]+)$/);
    if (mm) { if (m === "PUT") return updateLine(mm[1], body); if (m === "DELETE") return deleteLine(mm[1]); }
    mm = p.match(/^\/api\/lines\/([^/]+)\/(\w+)$/);
    if (mm) { const L = byKey(mm[1]); if (!L) return { __404: true }; const s = mm[2];
      if (s === "status") return lineStatus(L);
      if (s === "rate") return rateStats(L);
      if (s === "oee") return oeeOf(L);
      if (s === "insights") return lineInsights(L);
      if (s === "runs") return { key: L.key, runs: runsOf(L, 12) };
      if (s === "events") return { key: L.key, events: eventsOf(L, 40) };
      if (s === "timeseries") return timeseries(L);
      if (s === "production") return production(L, u.searchParams.get("group_by"));
    }
    return { __404: true };
  }
  window.fetch = function (url, opts) {
    const data = route(typeof url === "string" ? url : url.url, opts);
    const ok = !(data && data.__404);
    return Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(data) });
  };

  // seed ~30 min of history, then advance the simulation in real time
  for (let i = 0; i < 95; i++) tickAll(20);
  setInterval(() => tickAll(8), 1000);
})();
