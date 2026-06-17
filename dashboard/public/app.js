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
  const wide = w.type === 'table' || (w.type === 'chart' && w.chartType !== 'donut');
  el.className = 'widget' + (wide ? ' span2' : '');
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
    } else if (w.type === 'chart') {
      const rows = await getSourceData(w.source);
      el.innerHTML = head + '<div class="chart-wrap"></div>';
      wireDrag(el);
      el.querySelector('[data-x]').addEventListener('click', () => removeWidget(w.id));
      // Defer canvas draw until the element is in the DOM and sized.
      requestAnimationFrame(() => drawChart(el.querySelector('.chart-wrap'), w, rows));
      return el;
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

// ── Init ──────────────────────────────────────────────────────
setupAddForm();
loadStatus();
loadDashboard();
pollBuild();
