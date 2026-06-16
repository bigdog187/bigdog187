// ── Helpers ───────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const api = {
  async get(url) { return (await fetch(url)).json(); },
  async send(url, method, body) {
    return (await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })).json();
  },
};

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

function fmtMoney(n) { return '$' + Number(n).toLocaleString('en-AU'); }
function fmtCell(key, val) {
  if (val == null) return '';
  if (/amount|value|total/i.test(key) && typeof val === 'number') return fmtMoney(val);
  if (/status/i.test(key)) return `<span class="pill">${val}</span>`;
  return String(val);
}

// ── Status ────────────────────────────────────────────────────
async function loadStatus() {
  const s = await api.get('/api/status');
  $('#dot-claude').className = 'dot ' + s.claude;
  $('#dot-aroflo').className = 'dot ' + s.aroflo;
}

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
  el.className = 'widget' + (w.type === 'table' ? ' span2' : '');
  el.dataset.id = w.id;
  el.draggable = true;

  const head = `
    <div class="widget-head">
      <span class="widget-title"><span class="drag-handle">⠿</span>${w.title}</span>
      <button class="widget-x" title="Remove" data-x="${w.id}">×</button>
    </div>`;

  let body = '';
  try {
    if (w.type === 'metric') {
      const data = await getSourceData(w.source);
      let val = data[w.field];
      if (w.format === 'money') val = fmtMoney(val);
      body = `<div class="metric-value ${w.tone === 'warn' ? 'warn' : ''}">${val ?? '—'}</div>`;
    } else {
      const rows = await getSourceData(w.source);
      const cols = w.columns || SOURCE_COLUMNS[w.source] || Object.keys(rows[0] || {});
      const thead = cols.map((c) => `<th>${c}</th>`).join('');
      const tbody = (rows || []).map((r) =>
        `<tr>${cols.map((c) => `<td>${fmtCell(c, r[c])}</td>`).join('')}</tr>`).join('');
      body = `<div class="table-scroll"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
    }
  } catch {
    body = '<div class="metric-value">—</div>';
  }

  el.innerHTML = head + body;
  wireDrag(el);
  el.querySelector('[data-x]').addEventListener('click', () => removeWidget(w.id));
  return el;
}

async function removeWidget(id) {
  await api.send(`/api/dashboard/widgets/${id}`, 'DELETE');
  await loadDashboard();
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
  sourceSel.innerHTML = ['metrics', 'jobs', 'clients', 'invoices', 'schedule', 'timesheets']
    .map((s) => `<option value="${s}">${s}</option>`).join('');
  const fieldSel = $('#add-field');
  fieldSel.innerHTML = Object.entries(METRIC_FIELDS)
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  const typeSel = $('#add-type');
  const toggle = () => {
    const isMetric = typeSel.value === 'metric';
    $('#field-row').style.display = isMetric ? '' : 'none';
    sourceSel.value = isMetric ? 'metrics' : 'jobs';
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

// ── Init ──────────────────────────────────────────────────────
setupAddForm();
loadStatus();
loadDashboard();
pollBuild();
