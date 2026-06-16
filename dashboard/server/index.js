import express from 'express';
import path from 'node:path';
import { config, statusSummary, ROOT } from './config.js';
import { aroflo } from './aroflo.js';
import { dashboardStore } from './dashboard-store.js';
import { chat } from './claude.js';

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
const SOURCES = {
  metrics: () => aroflo.metrics(),
  jobs: () => aroflo.jobs(),
  clients: () => aroflo.clients(),
  invoices: () => aroflo.invoices(),
  schedule: () => aroflo.schedule(),
  timesheets: () => aroflo.timesheets(),
};

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

app.listen(config.port, () => {
  const s = statusSummary();
  console.log(`\n  Weiley AroFlo Dashboard`);
  console.log(`  ▸ http://localhost:${config.port}`);
  console.log(`  ▸ Claude: ${s.claude.toUpperCase()}   AroFlo: ${s.aroflo.toUpperCase()}   Model: ${s.model}\n`);
});
