import express from 'express';
import path from 'node:path';
import { config, statusSummary, ROOT } from './config.js';
import { aroflo, testConnection } from './aroflo.js';
import { dashboardStore } from './dashboard-store.js';
import { chat } from './claude.js';
import { SOURCES } from './sources.js';
import { routines } from './routines.js';
import { auth, can, permsOf, PERMISSIONS } from './auth.js';

const app = express();
app.set('trust proxy', 1); // behind a tunnel/reverse proxy (Cloudflare etc.)
app.use(express.json({ limit: '1mb' }));

// A new id every time the process starts. The browser polls it and reloads
// when it changes — so a nodemon restart (after you save a file) auto-refreshes
// the page. This is the "fast iteration, no manual reload" loop.
const BUILD_ID = Date.now().toString();

// ── Auth gates ────────────────────────────────────────────────
// Pages: unauthenticated visits to the app get sent to the login page.
app.get(['/', '/index.html'], (req, res, next) => {
  if (!auth.userFromRequest(req)) return res.redirect('/login.html');
  next();
});
app.use(express.static(path.join(ROOT, 'public')));

// APIs open without a session (login flow + the dev-reload poll).
const OPEN_API = new Set(['/api/login', '/api/setup', '/api/setup-needed', '/api/buildid']);

app.use('/api', (req, res, next) => {
  if (OPEN_API.has(req.originalUrl.split('?')[0])) return next();
  const user = auth.userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
});

/** Route guard: require a permission (admins always pass). */
const need = (perm) => (req, res, next) => {
  if (perm === 'admin' ? req.user.role === 'admin' : can(req.user, perm)) return next();
  res.status(403).json({ error: 'Not permitted' });
};

// ── Session / user endpoints ──────────────────────────────────
app.get('/api/buildid', (_req, res) => res.json({ buildId: BUILD_ID }));

app.get('/api/setup-needed', (_req, res) => res.json({ needed: !auth.hasUsers() }));

// First-run only: create the initial administrator account.
app.post('/api/setup', (req, res) => {
  if (auth.hasUsers()) return res.status(403).json({ error: 'Setup already completed' });
  try {
    const user = auth.createUser({ username: req.body?.username, password: req.body?.password, role: 'admin' });
    const { token } = auth.login(req.body.username, req.body.password, req.ip);
    res.setHeader('Set-Cookie', auth.cookieHeader(token));
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const { token, user } = auth.login(req.body?.username, req.body?.password, req.ip);
    res.setHeader('Set-Cookie', auth.cookieHeader(token));
    res.json({ ok: true, user });
  } catch (err) {
    res.status(401).json({ error: String(err.message || err) });
  }
});

app.post('/api/logout', (req, res) => {
  auth.logout(req.sessionToken);
  conversations.delete(req.sessionToken);
  res.setHeader('Set-Cookie', auth.clearCookieHeader());
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.user, perms: permsOf(req.user), permissions: PERMISSIONS });
});

// ── User management (admin only) ──────────────────────────────
app.get('/api/users', need('admin'), (_req, res) => res.json(auth.listUsers()));

app.post('/api/users', need('admin'), (req, res) => {
  try { res.json(auth.createUser(req.body || {})); }
  catch (err) { res.status(400).json({ error: String(err.message || err) }); }
});

app.put('/api/users/:id', need('admin'), (req, res) => {
  try {
    const u = auth.updateUser(req.params.id, req.body || {});
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json(u);
  } catch (err) { res.status(400).json({ error: String(err.message || err) }); }
});

app.post('/api/users/:id/password', need('admin'), (req, res) => {
  try {
    const ok = auth.setPassword(req.params.id, req.body?.password);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: String(err.message || err) }); }
});

app.delete('/api/users/:id', need('admin'), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  try { res.json({ removed: auth.removeUser(req.params.id) }); }
  catch (err) { res.status(400).json({ error: String(err.message || err) }); }
});

// ── Status / diagnostics ──────────────────────────────────────
app.get('/api/status', (_req, res) => res.json(statusSummary()));

// Live AroFlo connection diagnostic (safe: never returns secret values).
app.get('/api/aroflo/test', need('admin'), async (_req, res) => res.json(await testConnection()));

// ── Dashboard layout ──────────────────────────────────────────
app.get('/api/dashboard', need('dashboard'), (_req, res) => res.json(dashboardStore.get()));

// Save layout (reorder / add). Non-admins may not remove widgets this way:
// the incoming layout must keep every existing widget id.
app.put('/api/dashboard', need('editDashboard'), (req, res) => {
  if (req.user.role !== 'admin') {
    const existing = new Set(dashboardStore.get().widgets.map((w) => w.id));
    const incoming = new Set((req.body?.widgets || []).map((w) => w.id));
    for (const id of existing) {
      if (!incoming.has(id)) return res.status(403).json({ error: 'Only administrators can remove widgets' });
    }
  }
  res.json(dashboardStore.save(req.body));
});

app.post('/api/dashboard/widgets', need('editDashboard'), (req, res) => {
  res.json(dashboardStore.addWidget(req.body));
});

app.delete('/api/dashboard/widgets/:id', need('admin'), (req, res) => {
  res.json({ removed: dashboardStore.removeWidget(req.params.id) });
});

app.post('/api/dashboard/reset', need('admin'), (_req, res) => res.json(dashboardStore.reset()));

// ── AroFlo data (used by widgets) ─────────────────────────────
const FINANCIAL_SOURCES = new Set(['invoices', 'invoicesByStatus', 'revenueByClient']);

function sanitizeSourceData(source, data, user) {
  if (can(user, 'financial')) return data;
  if (source === 'metrics') {
    const { unpaidInvoices, unpaidTotal, ...rest } = data || {};
    return rest;
  }
  if (source === 'jobs' && Array.isArray(data)) return data.map(({ value, ...j }) => j);
  if (source === 'clients' && Array.isArray(data)) return data.map(({ ytdValue, ...c }) => c);
  return data;
}

app.get('/api/data/:source', need('dashboard'), async (req, res) => {
  const source = req.params.source;
  const fn = SOURCES[source];
  if (!fn) return res.status(404).json({ error: 'Unknown source' });
  if (FINANCIAL_SOURCES.has(source) && !can(req.user, 'financial')) {
    return res.status(403).json({ error: 'Financial data is restricted' });
  }
  try {
    res.json(sanitizeSourceData(source, await fn(), req.user));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ── Chat (streamed NDJSON, one conversation per signed-in session) ──
const conversations = new Map(); // sessionToken → message history
const MAX_CONVERSATIONS = 100;
const MAX_HISTORY = 40;

app.post('/api/chat', need('chat'), async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Empty message' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const emit = (event) => res.write(JSON.stringify(event) + '\n');

  const key = req.sessionToken;
  try {
    const history = conversations.get(key) || [];
    const result = await chat({ message, history, emit, perms: permsOf(req.user) });
    let next = result.history || history;
    if (next.length > MAX_HISTORY) next = next.slice(next.length - MAX_HISTORY);
    conversations.set(key, next);
    if (conversations.size > MAX_CONVERSATIONS) {
      conversations.delete(conversations.keys().next().value);
    }
  } catch (err) {
    emit({ type: 'error', message: String(err.message || err) });
  }
  res.end();
});

app.post('/api/chat/reset', need('chat'), (req, res) => {
  conversations.delete(req.sessionToken);
  res.json({ ok: true });
});

// ── Routines (scheduled scripts) ──────────────────────────────
// Viewing and running is a permission; creating/editing/deleting is admin-only
// (script routines execute code on the server).
app.get('/api/routines', need('routines'), (_req, res) => res.json(routines.list()));
app.post('/api/routines', need('admin'), (req, res) => res.json(routines.create(req.body)));
app.put('/api/routines/:id', need('admin'), (req, res) => {
  const r = routines.update(req.params.id, req.body);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});
app.delete('/api/routines/:id', need('admin'), (req, res) => res.json({ removed: routines.remove(req.params.id) }));
app.post('/api/routines/:id/toggle', need('admin'), (req, res) => {
  const r = routines.toggle(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});
app.post('/api/routines/:id/run', need('routines'), async (req, res) => {
  const record = await routines.runNow(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  res.json(record);
});
app.get('/api/routines/:id/runs', need('routines'), (req, res) => res.json(routines.runs(req.params.id)));
app.get('/api/runs', need('routines'), (_req, res) => res.json(routines.runs()));

app.listen(config.port, () => {
  const s = statusSummary();
  console.log(`\n  Weiley AroFlo Dashboard`);
  console.log(`  ▸ http://localhost:${config.port}`);
  console.log(`  ▸ Claude: ${s.claude.toUpperCase()}   AroFlo: ${s.aroflo.toUpperCase()}   Model: ${s.model}`);
  console.log(`  ▸ Users: ${auth.hasUsers() ? 'configured' : 'none yet — first visit creates the administrator'}`);
  routines.start();
  console.log(`  ▸ Routine scheduler started (${routines.list().length} routines)\n`);
});
