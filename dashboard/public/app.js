// ── Helpers ───────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

async function handle(res) {
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Not signed in'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}
const api = {
  async get(url) { return handle(await fetch(url)); },
  async send(url, method, body) {
    return handle(await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }));
  },
};

// Current signed-in user: { user, perms, permissions } from /api/me.
let ME = null;
const canDo = (p) => !!(ME && (ME.perms.admin || ME.perms[p]));

const METRIC_FIELDS = {
  openJobs: 'Open Jobs', overdueJobs: 'Overdue Jobs', unpaidInvoices: 'Unpaid Invoices',
  unpaidTotal: 'Outstanding ($)', hoursThisWeek: 'Hours This Week', activeClients: 'Active Clients',
};
const SOURCE_COLUMNS = {
  jobs: ['id', 'title', 'client', 'status', 'assignedTo', 'due'],
  clients: ['name', 'contact', 'phone', 'openJobs', 'ytdValue'],
  invoices: ['id', 'client', 'amount', 'status', 'due'],
  schedule: ['time', 'staff', 'title', 'client'],
  timesheets: ['staff', 'date', 'job', 'hours'],
};
const CHART_SOURCES = {
  jobsByStatus: 'Jobs by Status',
  revenueByClient: 'Revenue by Client',
  hoursByStaff: 'Hours by Staff',
  invoicesByStatus: 'Invoices by Status',
};
const CHART_PALETTE = ['#ffffff', '#9b9b9b', '#e0a23b', '#4caf72', '#6a6a6a', '#c45b5b', '#5b8fc4', '#b58fd6'];

function fmtMoney(n) { return '$' + Number(n).toLocaleString('en-AU'); }
function fmtCell(key, val) {
  if (val == null) return '';
  if (/amount|value|total/i.test(key) && typeof val === 'number') return fmtMoney(val);
  if (/status/i.test(key)) return `<span class="pill">${val}</span>`;
  return String(val);
}

// ── Status & connections ──────────────────────────────────────
let lastStatus = { claude: 'mock', aroflo: 'mock' };
async function loadStatus() {
  const s = await api.get('/api/status');
  lastStatus = s;
  $('#dot-claude').className = 'dot ' + s.claude;
  $('#dot-aroflo').className = 'dot ' + s.aroflo;
}

const connDialog = $('#conn-dialog');
$('#status').addEventListener('click', () => {
  $('#cd-claude').className = 'dot ' + lastStatus.claude;
  $('#cd-aroflo').className = 'dot ' + lastStatus.aroflo;
  $('#cd-claude-t').textContent = lastStatus.claude === 'live'
    ? `live (${lastStatus.model})` : 'mock — add ANTHROPIC_API_KEY to .env';
  $('#cd-aroflo-t').textContent = lastStatus.aroflo === 'live'
    ? 'live' : 'mock — set AROFLO_ENABLED=true + keys in .env';
  $('#conn-result').hidden = true;
  connDialog.showModal();
});
$('#conn-close').addEventListener('click', () => connDialog.close());
$('#btn-test-aroflo').addEventListener('click', async () => {
  const btn = $('#btn-test-aroflo');
  const out = $('#conn-result');
  btn.disabled = true; btn.textContent = 'Testing…';
  try {
    const r = await api.get('/api/aroflo/test');
    out.hidden = false;
    out.className = r.ok ? 'ok' : 'err';
    out.textContent = `${r.ok ? '✓ ' : '✗ '}${r.message}\n\nmode: ${r.mode}\nbaseUrl: ${r.baseUrl}\ncredentials present: ${JSON.stringify(r.present)}`;
  } catch (e) {
    out.hidden = false; out.className = 'err'; out.textContent = 'Request failed: ' + e.message;
  }
  btn.disabled = false; btn.textContent = 'Test AroFlo connection';
});

// ── Dashboard rendering ───────────────────────────────────────
let layout = { title: 'Dashboard', widgets: [] };
const dataCache = {};

async function getSourceData(source) {
  if (!dataCache[source]) dataCache[source] = api.get(`/api/data/${source}`);
  return dataCache[source];
}

async function loadDashboard() {
  for (const k of Object.keys(dataCache)) delete dataCache[k];
  layout = await api.get('/api/dashboard');
  $('#board-title').textContent = layout.title || 'Dashboard';
  await renderGrid();
}

async function renderGrid() {
  const grid = $('#grid');
  grid.innerHTML = '';
  if (!layout.widgets.length) {
    grid.innerHTML = '<div class="empty">No widgets yet. Click “+ Add widget” or ask the assistant to add one.</div>';
    return;
  }
  for (const w of layout.widgets) {
    grid.appendChild(await renderWidget(w));
  }
}

async function renderWidget(w) {
  const el = document.createElement('div');
  const wide = w.type === 'table' || (w.type === 'chart' && w.chartType !== 'donut');
  el.className = 'widget' + (wide ? ' span2' : '');
  el.dataset.id = w.id;
  el.draggable = canDo('editDashboard');

  // Only administrators can delete widgets.
  const removeBtn = canDo('admin') ? `<button class="widget-x" title="Remove" data-x="${w.id}">×</button>` : '';
  const head = `
    <div class="widget-head">
      <span class="widget-title"><span class="drag-handle">⠿</span>${w.title}</span>
      ${removeBtn}
    </div>`;

  const finish = () => {
    wireDrag(el);
    el.querySelector('[data-x]')?.addEventListener('click', () => removeWidget(w.id));
    return el;
  };

  let body = '';
  try {
    if (w.type === 'metric') {
      const data = await getSourceData(w.source);
      let val = data[w.field];
      if (w.format === 'money') val = fmtMoney(val);
      body = `<div class="metric-value ${w.tone === 'warn' ? 'warn' : ''}">${val ?? '—'}</div>`;
    } else if (w.type === 'chart') {
      const rows = await getSourceData(w.source);
      el.innerHTML = head + '<div class="chart-wrap"></div>';
      // Defer canvas draw until the element is in the DOM and sized.
      requestAnimationFrame(() => drawChart(el.querySelector('.chart-wrap'), w, rows));
      return finish();
    } else {
      const rows = await getSourceData(w.source);
      const cols = w.columns || SOURCE_COLUMNS[w.source] || Object.keys(rows[0] || {});
      const thead = cols.map((c) => `<th>${c}</th>`).join('');
      const tbody = (rows || []).map((r) =>
        `<tr>${cols.map((c) => `<td>${fmtCell(c, r[c])}</td>`).join('')}</tr>`).join('');
      body = `<div class="table-scroll"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
    }
  } catch (err) {
    body = err?.status === 403
      ? '<div class="metric-value" style="font-size:1rem;color:var(--gray2)">🔒 Restricted</div>'
      : '<div class="metric-value">—</div>';
  }

  el.innerHTML = head + body;
  return finish();
}

async function removeWidget(id) {
  await api.send(`/api/dashboard/widgets/${id}`, 'DELETE');
  await loadDashboard();
}

// ── Chart rendering (canvas, no libraries) ────────────────────
function drawChart(container, w, rows) {
  rows = (rows || []).filter((r) => r && r.label != null);
  const isMoney = /revenue|invoices/i.test(w.source);
  const dpr = window.devicePixelRatio || 1;
  const cw = container.clientWidth || 300;
  const ch = w.chartType === 'donut' ? 180 : Math.max(120, rows.length * 30 + 20);
  const cv = document.createElement('canvas');
  cv.width = cw * dpr; cv.height = ch * dpr;
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  container.innerHTML = '';
  container.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = '11px Barlow, sans-serif';
  if (!rows.length) { ctx.fillStyle = '#6a6a6a'; ctx.fillText('No data', 8, 20); return; }
  const fmt = (v) => (isMoney ? fmtMoney(v) : String(v));

  if (w.chartType === 'donut') {
    const total = rows.reduce((s, r) => s + r.value, 0) || 1;
    const cx = ch / 2 + 4, cy = ch / 2, r = ch / 2 - 14, inner = r * 0.6;
    let a0 = -Math.PI / 2;
    rows.forEach((row, i) => {
      const a1 = a0 + (row.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
      ctx.fill();
      a0 = a1;
    });
    ctx.fillStyle = '#0b0b0b';
    ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2); ctx.fill();
    // Legend
    let ly = 18;
    const lx = ch + 14;
    rows.forEach((row, i) => {
      ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
      ctx.fillRect(lx, ly - 8, 9, 9);
      ctx.fillStyle = '#ddd';
      ctx.fillText(`${row.label} — ${fmt(row.value)}`, lx + 14, ly);
      ly += 18;
    });
    return;
  }

  // Horizontal bar chart
  const max = Math.max(...rows.map((r) => r.value)) || 1;
  const labelW = 110, padR = 60, gap = 8;
  const barW = cw - labelW - padR;
  const barH = (ch - 16 - gap * rows.length) / rows.length;
  rows.forEach((row, i) => {
    const y = 8 + i * (barH + gap);
    ctx.fillStyle = '#9b9b9b';
    ctx.fillText(String(row.label).slice(0, 16), 4, y + barH / 2 + 4);
    ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
    const len = Math.max(2, (row.value / max) * barW);
    ctx.fillRect(labelW, y, len, barH);
    ctx.fillStyle = '#ddd';
    ctx.fillText(fmt(row.value), labelW + len + 6, y + barH / 2 + 4);
  });
}

// ── Drag to reorder ───────────────────────────────────────────
let dragId = null;
function wireDrag(el) {
  el.addEventListener('dragstart', () => { dragId = el.dataset.id; el.classList.add('dragging'); });
  el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragId = null; });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dragover'); });
  el.addEventListener('dragleave', () => el.classList.remove('dragover'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('dragover');
    const targetId = el.dataset.id;
    if (!dragId || dragId === targetId) return;
    const ids = layout.widgets.map((w) => w.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    const [moved] = layout.widgets.splice(from, 1);
    layout.widgets.splice(to, 0, moved);
    await api.send('/api/dashboard', 'PUT', layout);
    await renderGrid();
  });
}

// ── Add-widget dialog ─────────────────────────────────────────
const dialog = $('#add-dialog');
function setupAddForm() {
  const sourceSel = $('#add-source');
  const fieldSel = $('#add-field');
  fieldSel.innerHTML = Object.entries(METRIC_FIELDS)
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  const tableSources = ['jobs', 'clients', 'invoices', 'schedule', 'timesheets'];
  const fillSources = (opts) =>
    (sourceSel.innerHTML = opts.map(([k, v]) => `<option value="${k}">${v}</option>`).join(''));

  const typeSel = $('#add-type');
  const toggle = () => {
    const type = typeSel.value;
    $('#field-row').style.display = type === 'metric' ? '' : 'none';
    $('#charttype-row').style.display = type === 'chart' ? '' : 'none';
    if (type === 'metric') fillSources([['metrics', 'metrics']]);
    else if (type === 'chart') fillSources(Object.entries(CHART_SOURCES));
    else fillSources(tableSources.map((s) => [s, s]));
  };
  typeSel.addEventListener('change', toggle);
  toggle();
}

$('#btn-add').addEventListener('click', () => dialog.showModal());
$('#add-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  const f = new FormData(e.target);
  const type = f.get('type');
  const widget = {
    type, title: f.get('title'),
    source: type === 'metric' ? 'metrics' : f.get('source'),
  };
  if (type === 'metric') {
    widget.field = f.get('field');
    if (widget.field === 'unpaidTotal') widget.format = 'money';
  } else if (type === 'chart') {
    widget.chartType = f.get('chartType');
  }
  await api.send('/api/dashboard/widgets', 'POST', widget);
  e.target.reset();
  await loadDashboard();
});

// ── Chat ──────────────────────────────────────────────────────
const messages = $('#messages');
function addMsg(role, html) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = html;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}
function mdLite(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMsg('user', mdLite(text));

  const thinking = addMsg('assistant', '<span class="spinner"></span>');
  let answered = false;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'tool') {
          thinking.innerHTML = `<span class="tool-note">↳ checking ${ev.name.replace(/_/g, ' ')}…</span>`;
        } else if (ev.type === 'text') {
          thinking.innerHTML = mdLite(ev.text);
          answered = true;
        } else if (ev.type === 'reload') {
          await loadDashboard();
        } else if (ev.type === 'error') {
          thinking.innerHTML = `<span class="tool-note">Error: ${ev.message}</span>`;
          answered = true;
        }
      }
    }
  } catch (err) {
    thinking.innerHTML = `<span class="tool-note">Connection error: ${err.message}</span>`;
    answered = true;
  }
  if (!answered) thinking.innerHTML = '<span class="tool-note">(no response)</span>';
  messages.scrollTop = messages.scrollHeight;
});

$('#chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $('#chat-input').value = chip.textContent;
  $('#chat-form').requestSubmit();
});

$('#btn-clear').addEventListener('click', async () => {
  await api.send('/api/chat/reset', 'POST');
  messages.innerHTML = '';
  addMsg('assistant', '<p>Cleared. Ask me anything about your jobs, clients or invoices.</p>');
});

// ── Buttons ───────────────────────────────────────────────────
$('#btn-refresh').addEventListener('click', loadDashboard);
$('#btn-reset').addEventListener('click', async () => {
  await api.send('/api/dashboard/reset', 'POST');
  await loadDashboard();
});

// ── Dev auto-reload: poll build id, reload when the server restarts ──
let buildId = null;
async function pollBuild() {
  try {
    const { buildId: id } = await api.get('/api/buildid');
    if (buildId && id !== buildId) location.reload();
    buildId = id;
  } catch { /* server restarting — ignore */ }
}
setInterval(pollBuild, 1500);

// ── View switching (Dashboard / Routines / Settings) ──────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const view = tab.dataset.view;
    $('#dashboard-view').hidden = view !== 'dashboard';
    $('#routines-view').hidden = view !== 'routines';
    $('#settings-view').hidden = view !== 'settings';
    if (view === 'routines') loadRoutines();
    if (view === 'settings') loadUsers();
  });
});

// ── Routines ──────────────────────────────────────────────────
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ACTION_LABEL = { claude: 'Claude', snapshot: 'Snapshot', script: 'Script' };

function describeSchedule(s) {
  if (!s || s.type === 'manual') return 'Manual only';
  if (s.type === 'interval') return `Every ${s.minutes} min`;
  if (s.type === 'daily') return `Daily at ${s.time}`;
  if (s.type === 'weekly') return `${DAY_NAMES[s.day] ?? '?'} at ${s.time}`;
  return 'Custom';
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function loadRoutines() {
  const list = await api.get('/api/routines');
  const wrap = $('#routines-list');
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.innerHTML = '<div class="empty">No routines yet. Click “+ New routine” to create one.</div>';
    return;
  }
  for (const r of list) wrap.appendChild(routineCard(r));
}

function routineCard(r) {
  const el = document.createElement('div');
  el.className = 'routine' + (r.enabled ? '' : ' disabled');
  const status = r.lastStatus
    ? `<span class="routine-status ${r.lastStatus}">${r.lastStatus === 'ok' ? 'OK' : 'Error'}</span>`
    : '';
  el.innerHTML = `
    <div class="routine-main">
      <div class="routine-name">${r.name} ${status}</div>
      <div class="routine-meta">
        <span class="tag">${ACTION_LABEL[r.action?.type] || r.action?.type || '?'}</span>
        <span>⏱ ${describeSchedule(r.schedule)}</span>
        <span>Next: ${r.enabled ? fmtTime(r.nextRun) : 'paused'}</span>
        <span>Last: ${fmtTime(r.lastRun)}</span>
      </div>
    </div>
    <div class="routine-actions">
      ${canDo('admin') ? `<label class="switch"><input type="checkbox" ${r.enabled ? 'checked' : ''} data-toggle="${r.id}"><span class="slider"></span></label>` : ''}
      <button class="btn small" data-run="${r.id}">Run now</button>
      <button class="btn ghost small" data-output="${r.id}">Output</button>
      ${canDo('admin') ? `<button class="btn ghost small" data-edit="${r.id}">Edit</button>
      <button class="btn ghost small" data-del="${r.id}">Delete</button>` : ''}
    </div>`;

  el.querySelector('[data-toggle]')?.addEventListener('change', async () => {
    await api.send(`/api/routines/${r.id}/toggle`, 'POST');
    loadRoutines();
  });
  el.querySelector('[data-run]').addEventListener('click', async (e) => {
    e.target.textContent = '…'; e.target.disabled = true;
    try {
      const rec = await api.send(`/api/routines/${r.id}/run`, 'POST');
      showOutput(r.name, rec.ok ? rec.output : 'ERROR: ' + rec.error);
    } catch (err) {
      showOutput(r.name, 'ERROR: ' + err.message);
    }
    loadRoutines();
  });
  el.querySelector('[data-output]').addEventListener('click', () =>
    showOutput(r.name, r.lastOutput || '(this routine has not run yet)'));
  el.querySelector('[data-edit]')?.addEventListener('click', () => openRoutineDialog(r));
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm(`Delete routine "${r.name}"?`)) return;
    await api.send(`/api/routines/${r.id}`, 'DELETE');
    loadRoutines();
  });
  return el;
}

function showOutput(title, text) {
  $('#output-title').textContent = `Output — ${title}`;
  $('#output-body').textContent = text;
  $('#output-panel').hidden = false;
  $('#output-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('#output-close').addEventListener('click', () => ($('#output-panel').hidden = true));

// Routine editor dialog
const routineDialog = $('#routine-dialog');
let editingId = null;

function syncRoutineForm() {
  const at = $('#r-action-type').value;
  $('#r-prompt-row').hidden = at !== 'claude';
  $('#r-source-row').hidden = at !== 'snapshot';
  $('#r-code-row').hidden = at !== 'script';
  const st = $('#r-sched-type').value;
  $('#r-minutes-row').hidden = st !== 'interval';
  $('#r-day-row').hidden = st !== 'weekly';
  $('#r-time-row').hidden = st !== 'daily' && st !== 'weekly';
}

function setupRoutineForm() {
  const src = $('#r-source');
  src.innerHTML = Object.keys({ metrics: 1, jobs: 1, clients: 1, invoices: 1, schedule: 1, timesheets: 1,
    jobsByStatus: 1, revenueByClient: 1, hoursByStaff: 1, invoicesByStatus: 1 })
    .map((s) => `<option value="${s}">${s}</option>`).join('');
  $('#r-action-type').addEventListener('change', syncRoutineForm);
  $('#r-sched-type').addEventListener('change', syncRoutineForm);
}

function openRoutineDialog(r) {
  editingId = r?.id || null;
  $('#routine-form-title').textContent = r ? 'Edit routine' : 'New routine';
  const f = $('#routine-form');
  f.name.value = r?.name || '';
  f.actionType.value = r?.action?.type || 'claude';
  f.prompt.value = r?.action?.prompt || '';
  f.code.value = r?.action?.code || '';
  if (r?.action?.source) f.source.value = r.action.source;
  const s = r?.schedule || { type: 'interval', minutes: 60 };
  f.scheduleType.value = s.type || 'interval';
  f.minutes.value = s.minutes || 60;
  if (s.time) f.time.value = s.time;
  if (s.day != null) f.day.value = String(s.day);
  f.enabled.checked = r ? !!r.enabled : true;
  syncRoutineForm();
  routineDialog.showModal();
}

$('#btn-new-routine').addEventListener('click', () => openRoutineDialog(null));

$('#routine-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  const f = new FormData(e.target);
  const actionType = f.get('actionType');
  const action = { type: actionType };
  if (actionType === 'claude') action.prompt = f.get('prompt');
  else if (actionType === 'snapshot') action.source = f.get('source');
  else action.code = f.get('code');

  const st = f.get('scheduleType');
  const schedule = { type: st };
  if (st === 'interval') schedule.minutes = Number(f.get('minutes')) || 60;
  if (st === 'daily') schedule.time = f.get('time');
  if (st === 'weekly') { schedule.day = Number(f.get('day')); schedule.time = f.get('time'); }

  const body = { name: f.get('name'), action, schedule, enabled: f.get('enabled') === 'on' };
  if (editingId) await api.send(`/api/routines/${editingId}`, 'PUT', body);
  else await api.send('/api/routines', 'POST', body);
  loadRoutines();
});

// ── Users admin (Settings view) ───────────────────────────────
function permChecks(container, perms, { disabled = false, onChange } = {}) {
  container.innerHTML = '';
  for (const p of ME.permissions) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!perms[p.key];
    cb.disabled = disabled;
    cb.dataset.perm = p.key;
    if (onChange) cb.addEventListener('change', () => onChange(p.key, cb.checked));
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + p.label));
    container.appendChild(label);
  }
}

async function loadUsers() {
  if (!canDo('admin')) return;
  const users = await api.get('/api/users');
  const wrap = $('#users-list');
  wrap.innerHTML = '';
  for (const u of users) wrap.appendChild(userRow(u));
}

function userRow(u) {
  const el = document.createElement('div');
  el.className = 'user-row';
  const isSelf = u.id === ME.user.id;
  el.innerHTML = `
    <div class="user-row-top">
      <span class="user-name">${u.username}
        <span class="role-badge ${u.role}">${u.role === 'admin' ? 'Administrator' : 'General user'}</span>
        ${isSelf ? '<span class="role-badge">you</span>' : ''}
      </span>
      <span class="user-actions">
        <select class="btn ghost small" data-role>
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>General user</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option>
        </select>
        <button class="btn ghost small" data-pw>Reset password</button>
        ${isSelf ? '' : '<button class="btn ghost small" data-del>Delete</button>'}
      </span>
    </div>
    <div class="user-perms ${u.role === 'admin' ? 'locked' : ''}" data-perms></div>`;

  const permsWrap = el.querySelector('[data-perms]');
  const renderPerms = () => permChecks(permsWrap, u.role === 'admin'
    ? Object.fromEntries(ME.permissions.map((p) => [p.key, true]))
    : (u.perms || {}), {
    disabled: u.role === 'admin',
    onChange: async (key, checked) => {
      const perms = { ...(u.perms || {}), [key]: checked };
      try { const upd = await api.send(`/api/users/${u.id}`, 'PUT', { perms }); u.perms = upd.perms; }
      catch (err) { alert(err.message); loadUsers(); }
    },
  });
  renderPerms();

  el.querySelector('[data-role]').addEventListener('change', async (e) => {
    try { await api.send(`/api/users/${u.id}`, 'PUT', { role: e.target.value }); }
    catch (err) { alert(err.message); }
    loadUsers();
  });
  el.querySelector('[data-pw]').addEventListener('click', async () => {
    const pw = prompt(`New password for "${u.username}" (min 8 characters):`);
    if (!pw) return;
    try { await api.send(`/api/users/${u.id}/password`, 'POST', { password: pw }); alert('Password updated. Their existing sessions were signed out.'); }
    catch (err) { alert(err.message); }
  });
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try { await api.send(`/api/users/${u.id}`, 'DELETE'); } catch (err) { alert(err.message); }
    loadUsers();
  });
  return el;
}

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const perms = {};
  $('#uf-perms').querySelectorAll('input[data-perm]').forEach((cb) => { perms[cb.dataset.perm] = cb.checked; });
  const errEl = $('#uf-error');
  errEl.hidden = true;
  try {
    await api.send('/api/users', 'POST', {
      username: f.get('username'), password: f.get('password'), role: f.get('role'), perms,
    });
    e.target.reset();
    setupNewUserPerms();
    loadUsers();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

function setupNewUserPerms() {
  // Sensible defaults for a general user: can view and chat; no financial.
  permChecks($('#uf-perms'), { dashboard: true, chat: true, routines: true });
}

// ── Auth boot ─────────────────────────────────────────────────
$('#btn-logout').addEventListener('click', async () => {
  try { await api.send('/api/logout', 'POST'); } catch { /* session already gone */ }
  location.href = '/login.html';
});

function applyPermissions() {
  const { user } = ME;
  $('#user-chip').innerHTML = `${user.username} <span class="role">${user.role === 'admin' ? '· admin' : ''}</span>`;

  // Tabs
  $('#tab-routines').hidden = !canDo('routines');
  $('#tab-settings').hidden = !canDo('admin');

  // Dashboard controls
  $('#btn-add').hidden = !canDo('editDashboard');
  $('#btn-reset').hidden = !canDo('admin');

  // Chat panel
  if (!canDo('chat')) {
    document.querySelector('.chat').style.display = 'none';
    document.querySelector('.layout').style.gridTemplateColumns = '1fr';
  }

  // Routines: creating is admin-only
  $('#btn-new-routine').hidden = !canDo('admin');

  // Connection diagnostics are admin-only
  $('#btn-test-aroflo').hidden = !canDo('admin');
}

// ── Init ──────────────────────────────────────────────────────
(async function init() {
  try {
    ME = await api.get('/api/me'); // 401 → handle() redirects to /login.html
  } catch { return; }
  applyPermissions();
  setupAddForm();
  setupRoutineForm();
  setupNewUserPerms();
  loadStatus();
  loadDashboard();
  pollBuild();
})();
