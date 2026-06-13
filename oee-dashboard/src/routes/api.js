import express from 'express';
import db from '../db.js';
import { computeOee } from '../oee.js';
import { CONNECTOR_META, CONNECTOR_TYPES } from '../connectors/index.js';

export function createApiRouter(poller) {
  const router = express.Router();

  // ---- Reference data -----------------------------------------------------
  router.get('/connector-types', (req, res) => res.json(CONNECTOR_META));

  // ---- Sites --------------------------------------------------------------
  router.get('/sites', (req, res) => {
    const sites = db.prepare('SELECT * FROM sites ORDER BY name').all();
    for (const s of sites) {
      s.machines = db.prepare('SELECT id, name, connector_type, enabled FROM machines WHERE site_id = ? ORDER BY name').all(s.id);
    }
    res.json(sites);
  });

  router.post('/sites', (req, res) => {
    const { name, location } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const info = db.prepare('INSERT INTO sites (name, location, created_at) VALUES (?, ?, ?)')
      .run(name, location || null, Date.now());
    res.status(201).json(db.prepare('SELECT * FROM sites WHERE id = ?').get(info.lastInsertRowid));
  });

  router.delete('/sites/:id', async (req, res) => {
    const id = Number(req.params.id);
    const machines = db.prepare('SELECT id FROM machines WHERE site_id = ?').all(id);
    for (const m of machines) await poller.stopMachine(m.id);
    db.prepare('DELETE FROM sites WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---- Machines -----------------------------------------------------------
  router.get('/machines', (req, res) => {
    const machines = listMachines();
    res.json(machines.map((m) => ({ ...m, live: poller.liveSnapshot(m.id) })));
  });

  router.get('/machines/:id', (req, res) => {
    const m = getMachine(req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    res.json({ ...m, live: poller.liveSnapshot(m.id) });
  });

  router.post('/machines', async (req, res) => {
    const b = req.body || {};
    if (!b.site_id || !b.name) return res.status(400).json({ error: 'site_id and name are required' });
    if (b.connector_type && !CONNECTOR_TYPES[b.connector_type]) {
      return res.status(400).json({ error: `unknown connector_type ${b.connector_type}` });
    }
    const info = db.prepare(`
      INSERT INTO machines
        (site_id, name, connector_type, connector_config, ideal_feed_rate, feed_rate_unit,
         planned_minutes, target_oee, poll_interval_ms, enabled, created_at)
      VALUES (@site_id, @name, @connector_type, @connector_config, @ideal_feed_rate, @feed_rate_unit,
              @planned_minutes, @target_oee, @poll_interval_ms, @enabled, @created_at)
    `).run({
      site_id: b.site_id,
      name: b.name,
      connector_type: b.connector_type || 'simulator',
      connector_config: JSON.stringify(b.connector_config || {}),
      ideal_feed_rate: num(b.ideal_feed_rate, 100),
      feed_rate_unit: b.feed_rate_unit || 'units/min',
      planned_minutes: num(b.planned_minutes, 480),
      target_oee: num(b.target_oee, 0.85),
      poll_interval_ms: num(b.poll_interval_ms, 2000),
      enabled: b.enabled === false ? 0 : 1,
      created_at: Date.now(),
    });
    const machine = getMachine(info.lastInsertRowid);
    if (machine.enabled) poller.startMachine(machine);
    res.status(201).json(machine);
  });

  router.put('/machines/:id', async (req, res) => {
    const m = getMachine(req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    db.prepare(`
      UPDATE machines SET
        name = @name, connector_type = @connector_type, connector_config = @connector_config,
        ideal_feed_rate = @ideal_feed_rate, feed_rate_unit = @feed_rate_unit,
        planned_minutes = @planned_minutes, target_oee = @target_oee,
        poll_interval_ms = @poll_interval_ms, enabled = @enabled
      WHERE id = @id
    `).run({
      id: m.id,
      name: b.name ?? m.name,
      connector_type: b.connector_type ?? m.connector_type,
      connector_config: b.connector_config != null ? JSON.stringify(b.connector_config) : m.connector_config,
      ideal_feed_rate: num(b.ideal_feed_rate, m.ideal_feed_rate),
      feed_rate_unit: b.feed_rate_unit ?? m.feed_rate_unit,
      planned_minutes: num(b.planned_minutes, m.planned_minutes),
      target_oee: num(b.target_oee, m.target_oee),
      poll_interval_ms: num(b.poll_interval_ms, m.poll_interval_ms),
      enabled: b.enabled === undefined ? m.enabled : (b.enabled ? 1 : 0),
    });
    await poller.restartMachine(m.id);
    res.json(getMachine(m.id));
  });

  router.delete('/machines/:id', async (req, res) => {
    const id = Number(req.params.id);
    await poller.stopMachine(id);
    db.prepare('DELETE FROM machines WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  router.get('/machines/:id/live', (req, res) => {
    const snap = poller.liveSnapshot(Number(req.params.id));
    if (!snap) return res.status(404).json({ error: 'machine not running' });
    res.json(snap);
  });

  router.post('/machines/:id/operator', (req, res) => {
    const { operator } = req.body || {};
    poller.setManualOperator(Number(req.params.id), operator || null);
    res.json({ ok: true });
  });

  // ---- Analytics ----------------------------------------------------------
  router.get('/machines/:id/oee', (req, res) => {
    const m = getMachine(req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    const { from, to } = windowFrom(req.query);
    const samples = samplesInWindow(m.id, from, to);
    res.json(computeOee(m, samples, from, to));
  });

  router.get('/machines/:id/timeseries', (req, res) => {
    const m = getMachine(req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    const { from, to } = windowFrom(req.query);
    const maxPoints = Math.min(Number(req.query.points) || 300, 2000);
    const rows = db.prepare(
      'SELECT ts, feed_rate, state, operator FROM samples WHERE machine_id = ? AND ts BETWEEN ? AND ? ORDER BY ts'
    ).all(m.id, from, to);
    const stride = Math.max(1, Math.ceil(rows.length / maxPoints));
    const points = rows.filter((_, i) => i % stride === 0).map((r) => ({
      t: r.ts, feedRate: r.feed_rate, state: r.state, operator: r.operator,
    }));
    res.json({ from, to, idealFeedRate: m.ideal_feed_rate, unit: m.feed_rate_unit, points });
  });

  router.get('/machines/:id/downtime', (req, res) => {
    const m = getMachine(req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    const { from, to } = windowFrom(req.query);
    const events = db.prepare(`
      SELECT * FROM downtime_events
      WHERE machine_id = ? AND start_ts <= ? AND (end_ts IS NULL OR end_ts >= ?)
      ORDER BY start_ts DESC
    `).all(m.id, to, from);
    const now = Date.now();
    for (const e of events) {
      const eEnd = e.end_ts ?? now;
      e.effective_seconds = (Math.min(eEnd, to) - Math.max(e.start_ts, from)) / 1000;
    }
    const pareto = {};
    for (const e of events) {
      const key = e.reason || e.state;
      pareto[key] = (pareto[key] || 0) + Math.max(0, e.effective_seconds);
    }
    res.json({
      events,
      pareto: Object.entries(pareto).map(([reason, seconds]) => ({ reason, seconds }))
        .sort((a, b) => b.seconds - a.seconds),
    });
  });

  router.get('/machines/:id/operators', (req, res) => {
    const { from, to } = windowFrom(req.query);
    const rows = db.prepare(`
      SELECT * FROM operator_log
      WHERE machine_id = ? AND start_ts <= ? AND (end_ts IS NULL OR end_ts >= ?)
      ORDER BY start_ts DESC
    `).all(Number(req.params.id), to, from);
    res.json(rows);
  });

  router.get('/machines/:id/alarms', (req, res) => {
    const rows = db.prepare(
      'SELECT * FROM alarms WHERE machine_id = ? ORDER BY ts DESC LIMIT ?'
    ).all(Number(req.params.id), Number(req.query.limit) || 100);
    res.json(rows);
  });

  router.post('/alarms/:id/ack', (req, res) => {
    const { by } = req.body || {};
    db.prepare('UPDATE alarms SET acknowledged = 1, ack_by = ?, ack_ts = ? WHERE id = ?')
      .run(by || 'operator', Date.now(), Number(req.params.id));
    res.json({ ok: true });
  });

  router.get('/machines/:id/export.csv', (req, res) => {
    const m = getMachine(req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    const { from, to } = windowFrom(req.query);
    const rows = db.prepare(
      'SELECT ts, state, feed_rate, operator, good_count, reject_count FROM samples WHERE machine_id = ? AND ts BETWEEN ? AND ? ORDER BY ts'
    ).all(m.id, from, to);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${m.name.replace(/\W+/g, '_')}_samples.csv"`);
    res.write('timestamp_iso,state,feed_rate,operator,good_count,reject_count\n');
    for (const r of rows) {
      res.write(`${new Date(r.ts).toISOString()},${r.state},${r.feed_rate ?? ''},${csv(r.operator)},${r.good_count ?? ''},${r.reject_count ?? ''}\n`);
    }
    res.end();
  });

  // Plant-wide overview rollup for the top of the dashboard.
  router.get('/overview', (req, res) => {
    const machines = listMachines();
    const snaps = machines.map((m) => ({ machine: m, live: poller.liveSnapshot(m.id) }));
    const active = snaps.filter((s) => s.live);
    const avg = (sel) => active.length
      ? active.reduce((sum, s) => sum + (s.live.shift[sel] || 0), 0) / active.length : 0;
    res.json({
      machineCount: machines.length,
      running: snaps.filter((s) => s.live?.state === 'running').length,
      stopped: snaps.filter((s) => s.live?.state === 'stopped').length,
      faulted: snaps.filter((s) => s.live?.state === 'fault').length,
      offline: snaps.filter((s) => !s.live?.online).length,
      avgOee: avg('oee'),
      avgAvailability: avg('availability'),
      avgPerformance: avg('performance'),
      avgQuality: avg('quality'),
      openAlarms: db.prepare('SELECT COUNT(*) c FROM alarms WHERE acknowledged = 0').get().c,
    });
  });

  return router;
}

// ---- helpers --------------------------------------------------------------
function listMachines() {
  return db.prepare(`
    SELECT m.*, s.name AS site_name FROM machines m JOIN sites s ON s.id = m.site_id ORDER BY s.name, m.name
  `).all();
}
function getMachine(id) {
  return db.prepare(`
    SELECT m.*, s.name AS site_name FROM machines m JOIN sites s ON s.id = m.site_id WHERE m.id = ?
  `).get(Number(id));
}
function samplesInWindow(machineId, from, to) {
  const pre = db.prepare('SELECT * FROM samples WHERE machine_id = ? AND ts < ? ORDER BY ts DESC LIMIT 1').get(machineId, from);
  const rows = db.prepare('SELECT * FROM samples WHERE machine_id = ? AND ts BETWEEN ? AND ? ORDER BY ts').all(machineId, from, to);
  return pre ? [pre, ...rows] : rows;
}
function windowFrom(query) {
  const to = query.to ? Number(query.to) : Date.now();
  let from;
  if (query.from) from = Number(query.from);
  else if (query.range) from = to - rangeMs(query.range);
  else { const d = new Date(to); d.setHours(0, 0, 0, 0); from = d.getTime(); }
  return { from, to };
}
function rangeMs(range) {
  const map = { '1h': 3600e3, '8h': 8 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3, '30d': 30 * 24 * 3600e3 };
  return map[range] || 8 * 3600e3;
}
function num(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function csv(v) { return v == null ? '' : `"${String(v).replace(/"/g, '""')}"`; }
