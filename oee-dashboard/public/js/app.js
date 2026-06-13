import { drawGauge, drawLineChart, drawTimeline, drawBarChart, COLORS } from './charts.js';

const state = {
  machines: [],
  connectorTypes: [],
  selectedId: null,
  range: 'today',
  live: new Map(), // machineId -> snapshot
};

const $ = (sel) => document.querySelector(sel);
const fmtPct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const fmtDur = (ms) => {
  if (!ms || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};
const fmtNum = (n) => (n == null ? '—' : Math.round(n).toLocaleString());

async function api(path, opts) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// ---- Bootstrap ------------------------------------------------------------
async function init() {
  state.connectorTypes = await api('/connector-types');
  await refreshMachines();
  await refreshOverview();
  connectWs();
  wireUi();
  setInterval(refreshOverview, 10000);
  setInterval(() => { if (state.selectedId) loadCharts(state.selectedId); }, 15000);
}

async function refreshMachines() {
  state.machines = await api('/machines');
  for (const m of state.machines) if (m.live) state.live.set(m.id, m.live);
  renderSidebar();
}

async function refreshOverview() {
  try {
    const o = await api('/overview');
    $('#overview').innerHTML = [
      chip(fmtPct(o.avgOee), 'Plant OEE'),
      chip(o.running, 'Running'),
      chip(o.stopped + o.faulted, 'Down'),
      chip(o.offline, 'Offline'),
      chip(o.openAlarms, 'Alarms', o.openAlarms > 0 ? 'alarm' : ''),
    ].join('');
  } catch { /* ignore */ }
}
const chip = (val, label, cls = '') =>
  `<div class="chip ${cls}"><div class="chip-val">${val}</div><div class="chip-label">${label}</div></div>`;

// ---- Sidebar --------------------------------------------------------------
function renderSidebar() {
  const bySite = new Map();
  for (const m of state.machines) {
    if (!bySite.has(m.site_name)) bySite.set(m.site_name, []);
    bySite.get(m.site_name).push(m);
  }
  const html = [...bySite.entries()].map(([site, machines]) => `
    <div class="site-group">
      <div class="site-name">${esc(site)}</div>
      ${machines.map(machineRow).join('')}
    </div>
  `).join('');
  $('#machine-list').innerHTML = html || '<div class="empty-row">No machines yet</div>';

  document.querySelectorAll('.machine-item').forEach((el) => {
    el.addEventListener('click', () => selectMachine(Number(el.dataset.id)));
  });
}

function machineRow(m) {
  const live = state.live.get(m.id);
  const st = live?.state || (m.enabled ? 'offline' : 'offline');
  const oee = live ? fmtPct(live.shift.oee) : '—';
  const active = m.id === state.selectedId ? 'active' : '';
  return `
    <div class="machine-item ${active}" data-id="${m.id}">
      <span class="status-dot ${st}"></span>
      <span class="m-name">${esc(m.name)}</span>
      <span class="m-oee" style="color:${oeeColor(live?.shift.oee)}">${oee}</span>
    </div>`;
}
function oeeColor(v) {
  if (v == null) return 'var(--muted)';
  if (v >= 0.85) return 'var(--green)';
  if (v >= 0.6) return 'var(--amber)';
  return 'var(--red)';
}

// ---- Machine detail -------------------------------------------------------
async function selectMachine(id) {
  state.selectedId = id;
  $('#empty-state').hidden = true;
  $('#detail').hidden = false;
  renderSidebar();
  const m = state.machines.find((x) => x.id === id);
  if (!m) return;
  $('#d-name').textContent = m.name;
  $('#d-site').textContent = m.site_name;
  $('#feed-unit').textContent = m.feed_rate_unit;
  $('#oee-target').textContent = `target ${fmtPct(m.target_oee)}`;
  $('#k-feed-ideal').textContent = `ideal ${m.ideal_feed_rate} ${m.feed_rate_unit}`;
  renderLive(state.live.get(id));
  await loadCharts(id);
}

function renderLive(live) {
  if (!live || live.machineId !== state.selectedId) return;
  const m = state.machines.find((x) => x.id === state.selectedId);
  const s = live.shift;
  drawGauge($('#gauge-oee'), s.oee, { label: 'OEE (shift)', target: live.targetOee });
  setMini('avail', s.availability);
  setMini('perf', s.performance);
  setMini('qual', s.quality);

  const fr = live.reading?.feedRate;
  $('#k-feed').textContent = fr == null ? '—' : `${Math.round(fr)}`;
  $('#k-operator').textContent = live.reading?.operator || '—';

  const badge = $('#d-state');
  badge.textContent = live.online ? live.state : 'offline';
  badge.className = `state-badge ${live.online ? live.state : 'offline'}`;
}
function setMini(key, v) {
  $(`#k-${key}`).textContent = fmtPct(v);
  const bar = $(`#bar-${key}`);
  bar.style.width = `${Math.min(100, (v || 0) * 100)}%`;
  bar.style.background = oeeColor(v);
}

async function loadCharts(id) {
  const q = state.range === 'today' ? '?range=today' : `?range=${state.range}`;
  try {
    const [ts, downtime, alarms, operators] = await Promise.all([
      api(`/machines/${id}/timeseries${q}`),
      api(`/machines/${id}/downtime${q}`),
      api(`/machines/${id}/alarms?limit=50`),
      api(`/machines/${id}/operators${q}`),
    ]);
    if (state.selectedId !== id) return;
    drawLineChart($('#chart-feed'), ts.points, { ideal: ts.idealFeedRate, unit: ts.unit });
    drawTimeline($('#chart-timeline'), ts.points);
    drawBarChart($('#chart-pareto'), downtime.pareto.map((p) => ({
      label: p.reason, value: p.seconds, display: fmtDur(p.seconds * 1000),
    })), { colorFor: (i) => COLORS[i.label] || COLORS.accent });
    renderProduction();
    renderAlarms(alarms);
    renderOperators(operators);
  } catch (e) {
    console.error('loadCharts', e);
  }
}

function renderProduction() {
  const live = state.live.get(state.selectedId);
  const s = live?.shift;
  if (!s) { $('#prod-stats').innerHTML = ''; return; }
  $('#prod-stats').innerHTML = `
    <div class="ps"><div class="v" style="color:var(--green)">${fmtNum(s.goodCount)}</div><div class="l">Good (shift)</div></div>
    <div class="ps"><div class="v" style="color:var(--red)">${fmtNum(s.rejectCount)}</div><div class="l">Reject (shift)</div></div>
    <div class="ps"><div class="v">${fmtNum(s.totalCount)}</div><div class="l">Total produced</div></div>
    <div class="ps"><div class="v">${fmtDur(s.runMs)}</div><div class="l">Run time</div></div>
    <div class="ps"><div class="v" style="color:var(--amber)">${fmtDur(s.stopMs)}</div><div class="l">Stopped</div></div>
    <div class="ps"><div class="v" style="color:var(--red)">${fmtDur(s.faultMs)}</div><div class="l">Fault</div></div>`;
}

function renderAlarms(alarms) {
  $('#alarm-count').textContent = alarms.length ? `${alarms.filter((a) => !a.acknowledged).length} open` : '';
  if (!alarms.length) { $('#alarm-list').innerHTML = '<div class="empty-row">No alarms</div>'; return; }
  $('#alarm-list').innerHTML = alarms.map((a) => `
    <div class="alarm-row ${a.severity} ${a.acknowledged ? 'acked' : ''}">
      <span class="a-msg">${esc(a.message)}</span>
      <span class="a-time">${new Date(a.ts).toLocaleString()}</span>
      ${a.acknowledged ? '<span class="a-time">ack</span>'
        : `<button class="btn ack-btn" data-ack="${a.id}">Ack</button>`}
    </div>`).join('');
  document.querySelectorAll('[data-ack]').forEach((el) => el.addEventListener('click', async () => {
    await api(`/alarms/${el.dataset.ack}/ack`, { method: 'POST', body: JSON.stringify({ by: 'operator' }) });
    loadCharts(state.selectedId);
  }));
}

function renderOperators(ops) {
  if (!ops.length) { $('#operator-list').innerHTML = '<div class="empty-row">No operator history</div>'; return; }
  $('#operator-list').innerHTML = ops.map((o) => {
    const end = o.end_ts ? new Date(o.end_ts).toLocaleTimeString() : '<span style="color:var(--green)">active</span>';
    return `<div class="operator-row"><span>${esc(o.operator)}</span>
      <span class="muted sm">${new Date(o.start_ts).toLocaleTimeString()} → ${end}</span></div>`;
  }).join('');
}

// ---- WebSocket ------------------------------------------------------------
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { $('#conn-status').textContent = '● live'; $('#conn-status').className = 'conn'; };
  ws.onclose = () => {
    $('#conn-status').textContent = '● offline'; $('#conn-status').className = 'conn down';
    setTimeout(connectWs, 3000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'machine-update') {
      state.live.set(msg.machineId, msg.snapshot);
      updateSidebarRow(msg.machineId);
      if (msg.machineId === state.selectedId) { renderLive(msg.snapshot); renderProduction(); }
    }
  };
}
function updateSidebarRow(id) {
  const el = document.querySelector(`.machine-item[data-id="${id}"]`);
  if (!el) return;
  const live = state.live.get(id);
  el.querySelector('.status-dot').className = `status-dot ${live?.state || 'offline'}`;
  const oeeEl = el.querySelector('.m-oee');
  oeeEl.textContent = live ? fmtPct(live.shift.oee) : '—';
  oeeEl.style.color = oeeColor(live?.shift.oee);
}

// ---- UI wiring ------------------------------------------------------------
function wireUi() {
  $('#range-select').addEventListener('change', (e) => {
    state.range = e.target.value;
    if (state.selectedId) loadCharts(state.selectedId);
  });
  $('#btn-add-site').addEventListener('click', openSiteModal);
  $('#btn-add-machine').addEventListener('click', () => openMachineModal());
  $('#btn-edit').addEventListener('click', () => {
    const m = state.machines.find((x) => x.id === state.selectedId);
    if (m) openMachineModal(m);
  });
  $('#btn-export').addEventListener('click', () => {
    const q = state.range === 'today' ? '?range=today' : `?range=${state.range}`;
    window.open(`/api/machines/${state.selectedId}/export.csv${q}`, '_blank');
  });
  $('#set-operator').addEventListener('click', async (e) => {
    e.preventDefault();
    const name = prompt('Operator name (overrides PLC tag until next change):');
    if (name !== null) {
      await api(`/machines/${state.selectedId}/operator`, { method: 'POST', body: JSON.stringify({ operator: name }) });
    }
  });
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);
  window.addEventListener('resize', () => { if (state.selectedId) { renderLive(state.live.get(state.selectedId)); loadCharts(state.selectedId); } });
}

// ---- Modals ---------------------------------------------------------------
function openModal(title, bodyHtml, onSave) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-backdrop').hidden = false;
  const saveBtn = $('#modal-save');
  const handler = async () => {
    try { await onSave(); closeModal(); }
    catch (e) { alert(`Error: ${e.message}`); }
  };
  saveBtn.onclick = handler;
}
function closeModal() { $('#modal-backdrop').hidden = true; }

function openSiteModal() {
  openModal('Add Site', `
    <div class="field"><label>Site name</label><input id="f-site-name" placeholder="e.g. Sydney Plant" /></div>
    <div class="field"><label>Location (optional)</label><input id="f-site-loc" placeholder="City, Country" /></div>
  `, async () => {
    const name = $('#f-site-name').value.trim();
    if (!name) throw new Error('Site name required');
    await api('/sites', { method: 'POST', body: JSON.stringify({ name, location: $('#f-site-loc').value.trim() }) });
    await refreshMachines();
  });
}

async function openMachineModal(machine = null) {
  const sites = await api('/sites');
  if (!sites.length) { alert('Add a site first.'); return openSiteModal(); }
  const cfg = machine ? safeParse(machine.connector_config) : {};
  const type = machine?.connector_type || 'simulator';

  const body = `
    <div class="field-row">
      <div class="field"><label>Machine name</label><input id="f-name" value="${machine ? esc(machine.name) : ''}" placeholder="e.g. Extrusion Line 1" /></div>
      <div class="field"><label>Site</label><select id="f-site">${
        sites.map((s) => `<option value="${s.id}" ${machine?.site_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
      }</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Ideal feed rate</label><input id="f-ideal" type="number" value="${machine?.ideal_feed_rate ?? 100}" /></div>
      <div class="field"><label>Unit</label><input id="f-unit" value="${machine?.feed_rate_unit ?? 'units/min'}" /></div>
      <div class="field"><label>Target OEE %</label><input id="f-target" type="number" value="${Math.round((machine?.target_oee ?? 0.85) * 100)}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Poll interval (ms)</label><input id="f-poll" type="number" value="${machine?.poll_interval_ms ?? 2000}" /></div>
      <div class="field"><label>Connector type</label><select id="f-type">${
        state.connectorTypes.map((c) => `<option value="${c.type}" ${type === c.type ? 'selected' : ''}>${c.label}</option>`).join('')
      }</select></div>
    </div>
    <div id="connector-fields"></div>
  `;

  openModal(machine ? 'Edit Machine' : 'Add Machine', body, async () => {
    const payload = collectMachineForm();
    if (machine) await api(`/machines/${machine.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/machines', { method: 'POST', body: JSON.stringify(payload) });
    await refreshMachines();
    if (machine) selectMachine(machine.id);
  });

  const typeSel = $('#f-type');
  const renderConnector = () => { $('#connector-fields').innerHTML = connectorFields(typeSel.value, cfg); };
  typeSel.addEventListener('change', renderConnector);
  renderConnector();
}

function connectorFields(type, cfg) {
  if (type === 'allen-bradley') {
    const t = cfg.tags || {};
    const tagInput = (k, ph) => `<div class="field"><label>${ph}</label><input data-tag="${k}" value="${esc(t[k] || '')}" placeholder="${ph}" /></div>`;
    return `
      <div class="section-title">Allen Bradley (EtherNet/IP)</div>
      <div class="field-row">
        <div class="field"><label>Controller IP</label><input id="ab-ip" value="${esc(cfg.ip || '')}" placeholder="192.168.1.10" /></div>
        <div class="field"><label>CPU slot</label><input id="ab-slot" type="number" value="${cfg.slot ?? 0}" /></div>
      </div>
      <div class="tag-section">
        <h4>Tag mapping (controller or program-scoped tag names)</h4>
        <div class="field-row">${tagInput('feedRate', 'Feed Rate tag')}${tagInput('operator', 'Operator Name tag')}</div>
        <div class="field-row">${tagInput('running', 'System Running tag')}${tagInput('stopped', 'System Stopped tag')}${tagInput('fault', 'System Fault tag')}</div>
        <div class="field-row">${tagInput('goodCount', 'Good Count tag (optional)')}${tagInput('rejectCount', 'Reject Count tag (optional)')}</div>
        <div class="field-hint">Good/Reject counts enable the Quality factor. Leave blank if unavailable (Quality defaults to 100%).</div>
      </div>`;
  }
  if (type === 'modbus') {
    return `
      <div class="section-title">Modbus TCP</div>
      <div class="field-row">
        <div class="field"><label>IP</label><input id="mb-ip" value="${esc(cfg.ip || '')}" placeholder="192.168.1.20" /></div>
        <div class="field"><label>Port</label><input id="mb-port" type="number" value="${cfg.port ?? 502}" /></div>
        <div class="field"><label>Unit ID</label><input id="mb-unit" type="number" value="${cfg.unitId ?? 1}" /></div>
      </div>
      <div class="field"><label>Tag map (JSON)</label>
        <textarea id="mb-tags" rows="8">${esc(JSON.stringify(cfg.tags || {
          feedRate: { type: 'holding', address: 0, scale: 1 },
          running: { type: 'coil', address: 0 },
          stopped: { type: 'coil', address: 1 },
          fault: { type: 'coil', address: 2 },
        }, null, 2))}</textarea>
        <div class="field-hint">type: "holding" or "coil"; holding registers support scale and words (2 = 32-bit).</div>
      </div>`;
  }
  // simulator
  return `
    <div class="section-title">Simulator</div>
    <div class="field"><label>Operators (comma-separated)</label>
      <input id="sim-ops" value="${esc((cfg.operators || ['A. Operator']).join(', '))}" /></div>
    <div class="field-hint">Generates realistic running/stopped/fault behaviour and feed rate around the ideal rate above.</div>`;
}

function collectMachineForm() {
  const type = $('#f-type').value;
  let connector_config = {};
  if (type === 'allen-bradley') {
    const tags = {};
    document.querySelectorAll('[data-tag]').forEach((el) => { if (el.value.trim()) tags[el.dataset.tag] = el.value.trim(); });
    connector_config = { ip: $('#ab-ip').value.trim(), slot: Number($('#ab-slot').value) || 0, tags };
  } else if (type === 'modbus') {
    connector_config = {
      ip: $('#mb-ip').value.trim(), port: Number($('#mb-port').value) || 502,
      unitId: Number($('#mb-unit').value) || 1, tags: safeParse($('#mb-tags').value),
    };
  } else {
    connector_config = {
      idealFeedRate: Number($('#f-ideal').value) || 100,
      operators: $('#sim-ops').value.split(',').map((s) => s.trim()).filter(Boolean),
    };
  }
  return {
    site_id: Number($('#f-site').value),
    name: $('#f-name').value.trim(),
    connector_type: type,
    connector_config,
    ideal_feed_rate: Number($('#f-ideal').value) || 100,
    feed_rate_unit: $('#f-unit').value.trim() || 'units/min',
    target_oee: (Number($('#f-target').value) || 85) / 100,
    poll_interval_ms: Number($('#f-poll').value) || 2000,
  };
}

// ---- utils ----------------------------------------------------------------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function safeParse(s) { try { return typeof s === 'string' ? JSON.parse(s) : (s || {}); } catch { return {}; } }

init();
