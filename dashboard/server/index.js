import express from 'express';
import path from 'node:path';
import { config, statusSummary, ROOT } from './config.js';
import { aroflo, testConnection } from './aroflo.js';
import { dashboardStore } from './dashboard-store.js';
import { chat } from './claude.js';
import { SOURCES } from './sources.js';
import { routines } from './routines.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

// A new id every time the process starts. The browser polls it and reloads
// when it changes — so a nodemon restart (after you save a file) auto-refreshes
// the page. This is the "fast iteration, no manual reload" loop.
const BUILD_ID = Date.now().toString();

// One in-memory conversation (single-user ops dashboard). Reset via /api/chat/reset.
let conversation = [];

app.get('/api/buildid', (_req, res) => res.json({ buildId: BUILD_ID }));

app.get('/api/status', (_req, res) => res.json(statusSummary()));

// Live AroFlo connection diagnostic (safe: never returns secret values).
app.get('/api/aroflo/test', async (_req, res) => res.json(await testConnection()));

// ── Dashboard layout ──────────────────────────────────────────
app.get('/api/dashboard', (_req, res) => res.json(dashboardStore.get()));

app.put('/api/dashboard', (req, res) => {
  res.json(dashboardStore.save(req.body));
});

app.post('/api/dashboard/widgets', (req, res) => {
  res.json(dashboardStore.addWidget(req.body));
});

app.delete('/api/dashboard/widgets/:id', (req, res) => {
  res.json({ removed: dashboardStore.removeWidget(req.params.id) });
});

app.post('/api/dashboard/reset', (_req, res) => res.json(dashboardStore.reset()));

// ── AroFlo data (used by widgets) ─────────────────────────────
app.get('/api/data/:source', async (req, res) => {
  const fn = SOURCES[req.params.source];
  if (!fn) return res.status(404).json({ error: 'Unknown source' });
  try {
    res.json(await fn());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Chat (streamed NDJSON) ────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Empty message' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const emit = (event) => res.write(JSON.stringify(event) + '\n');

  try {
    const result = await chat({ message, history: conversation, emit });
    conversation = result.history || conversation;
  } catch (err) {
    emit({ type: 'error', message: String(err.message || err) });
  }
  res.end();
});

app.post('/api/chat/reset', (_req, res) => {
  conversation = [];
  res.json({ ok: true });
});

// ── Routines (scheduled scripts) ──────────────────────────────
app.get('/api/routines', (_req, res) => res.json(routines.list()));
app.post('/api/routines', (req, res) => res.json(routines.create(req.body)));
app.put('/api/routines/:id', (req, res) => {
  const r = routines.update(req.params.id, req.body);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});
app.delete('/api/routines/:id', (req, res) => res.json({ removed: routines.remove(req.params.id) }));
app.post('/api/routines/:id/toggle', (req, res) => {
  const r = routines.toggle(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});
app.post('/api/routines/:id/run', async (req, res) => {
  const record = await routines.runNow(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  res.json(record);
});
app.get('/api/routines/:id/runs', (req, res) => res.json(routines.runs(req.params.id)));
app.get('/api/runs', (_req, res) => res.json(routines.runs()));

app.listen(config.port, () => {
  const s = statusSummary();
  console.log(`\n  Weiley AroFlo Dashboard`);
  console.log(`  ▸ http://localhost:${config.port}`);
  console.log(`  ▸ Claude: ${s.claude.toUpperCase()}   AroFlo: ${s.aroflo.toUpperCase()}   Model: ${s.model}`);
  routines.start();
  console.log(`  ▸ Routine scheduler started (${routines.list().length} routines)\n`);
});
