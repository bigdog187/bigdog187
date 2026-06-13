// Lightweight, dependency-free canvas charts tuned for the OEE dashboard.
// Every function is self-contained so the dashboard works fully offline.

const COLORS = {
  running: '#22c55e',
  stopped: '#f59e0b',
  fault: '#ef4444',
  idle: '#64748b',
  offline: '#334155',
  accent: '#38bdf8',
  grid: 'rgba(148,163,184,0.15)',
  text: '#94a3b8',
};

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.clientWidth || 300;
  const h = rect.height || canvas.clientHeight || 150;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function oeeColor(v) {
  if (v >= 0.85) return COLORS.running;
  if (v >= 0.6) return COLORS.stopped;
  return COLORS.fault;
}

// Radial gauge for a 0..1 value.
export function drawGauge(canvas, value, { label = 'OEE', target = null } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  const cx = w / 2;
  const cy = h * 0.62;
  const r = Math.min(w / 2, h * 0.62) - 12;
  const start = Math.PI * 0.8;
  const end = Math.PI * 2.2;
  const v = Math.max(0, Math.min(1, value || 0));

  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(8, r * 0.18);

  ctx.strokeStyle = 'rgba(148,163,184,0.15)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end);
  ctx.stroke();

  ctx.strokeStyle = oeeColor(v);
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + (end - start) * v);
  ctx.stroke();

  if (target != null) {
    const ang = start + (end - start) * Math.max(0, Math.min(1, target));
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * (r - r * 0.18), cy + Math.sin(ang) * (r - r * 0.18));
    ctx.lineTo(cx + Math.cos(ang) * (r + r * 0.12), cy + Math.sin(ang) * (r + r * 0.12));
    ctx.stroke();
  }

  ctx.fillStyle = '#f1f5f9';
  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round(r * 0.5)}px system-ui, sans-serif`;
  ctx.fillText(`${Math.round(v * 100)}%`, cx, cy + r * 0.12);
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 ${Math.round(r * 0.2)}px system-ui, sans-serif`;
  ctx.fillText(label, cx, cy + r * 0.45);
}

// Feed rate line chart with an "ideal" reference line.
export function drawLineChart(canvas, points, { ideal = null, unit = '' } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  const padL = 44, padR = 12, padT = 14, padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  if (!points.length) {
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('No data in range', w / 2, h / 2);
    return;
  }

  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.feedRate ?? 0);
  const tMin = Math.min(...xs), tMax = Math.max(...xs);
  let yMax = Math.max(ideal || 0, ...ys, 1) * 1.1;
  const yMin = 0;
  const xOf = (t) => padL + ((t - tMin) / (tMax - tMin || 1)) * plotW;
  const yOf = (y) => padT + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

  // Grid + y labels.
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.text;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(Math.round(yMax - (yMax / 4) * i), padL - 6, y + 3);
  }

  // Ideal line.
  if (ideal) {
    ctx.strokeStyle = 'rgba(56,189,248,0.6)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, yOf(ideal)); ctx.lineTo(w - padR, yOf(ideal));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Area + line.
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, 'rgba(34,197,94,0.35)');
  grad.addColorStop(1, 'rgba(34,197,94,0.02)');
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xOf(p.t), y = yOf(p.feedRate ?? 0);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(xOf(xs[xs.length - 1]), yOf(0));
  ctx.lineTo(xOf(xs[0]), yOf(0));
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xOf(p.t), y = yOf(p.feedRate ?? 0);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = COLORS.running;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // X labels (start/mid/end).
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  [tMin, (tMin + tMax) / 2, tMax].forEach((t, i) => {
    const d = new Date(t);
    const lbl = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.textAlign = i === 0 ? 'left' : i === 2 ? 'right' : 'center';
    ctx.fillText(lbl, xOf(t), h - 6);
  });
}

// Horizontal status timeline from time-ordered state points.
export function drawTimeline(canvas, points) {
  const { ctx, w, h } = setupCanvas(canvas);
  if (points.length < 2) {
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('No data in range', w / 2, h / 2);
    return;
  }
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const span = tMax - tMin || 1;
  const barY = 8, barH = h - 34;

  for (let i = 0; i < points.length - 1; i++) {
    const x0 = ((points[i].t - tMin) / span) * w;
    const x1 = ((points[i + 1].t - tMin) / span) * w;
    ctx.fillStyle = COLORS[points[i].state] || COLORS.idle;
    ctx.fillRect(x0, barY, Math.max(1, x1 - x0), barH);
  }

  ctx.fillStyle = COLORS.text;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(new Date(tMin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 2, h - 8);
  ctx.textAlign = 'right';
  ctx.fillText(new Date(tMax).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), w - 2, h - 8);
}

// Horizontal bar chart for the downtime Pareto.
export function drawBarChart(canvas, items, { colorFor } = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  if (!items.length) {
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('No downtime in range', w / 2, h / 2);
    return;
  }
  const max = Math.max(...items.map((i) => i.value), 1);
  const rowH = Math.min(34, (h - 8) / items.length);
  const labelW = 96;
  items.forEach((item, i) => {
    const y = 6 + i * rowH;
    const bw = ((w - labelW - 50) * item.value) / max;
    ctx.fillStyle = colorFor ? colorFor(item) : COLORS.accent;
    ctx.fillRect(labelW, y, Math.max(2, bw), rowH * 0.6);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, 2, y + rowH * 0.42);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(item.display, labelW + bw + 6, y + rowH * 0.42);
  });
}

export { COLORS };
