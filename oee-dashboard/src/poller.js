import db from './db.js';
import { createConnector } from './connectors/index.js';
import { deriveState } from './oee.js';

const PROLONGED_DOWNTIME_MS = 5 * 60 * 1000; // raise an alarm after 5 min down

// Prepared statements.
const stmt = {
  insertSample: db.prepare(`
    INSERT INTO samples (machine_id, ts, state, feed_rate, operator, running, stopped, fault, good_count, reject_count)
    VALUES (@machine_id, @ts, @state, @feed_rate, @operator, @running, @stopped, @fault, @good_count, @reject_count)
  `),
  openDowntime: db.prepare(`
    INSERT INTO downtime_events (machine_id, start_ts, state, operator) VALUES (?, ?, ?, ?)
  `),
  closeDowntime: db.prepare(`
    UPDATE downtime_events SET end_ts = ?, duration_s = (? - start_ts) / 1000.0 WHERE id = ?
  `),
  openOperator: db.prepare(`INSERT INTO operator_log (machine_id, operator, start_ts) VALUES (?, ?, ?)`),
  closeOperator: db.prepare(`UPDATE operator_log SET end_ts = ? WHERE id = ?`),
  insertAlarm: db.prepare(`
    INSERT INTO alarms (machine_id, ts, type, severity, message) VALUES (?, ?, ?, ?, ?)
  `),
  openDowntimeRow: db.prepare(`
    SELECT id, start_ts, state FROM downtime_events WHERE machine_id = ? AND end_ts IS NULL ORDER BY start_ts DESC LIMIT 1
  `),
  openOperatorRow: db.prepare(`
    SELECT id, operator FROM operator_log WHERE machine_id = ? AND end_ts IS NULL ORDER BY start_ts DESC LIMIT 1
  `),
};

function startOfDay(ms = Date.now()) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function freshAccumulator(now) {
  return {
    shiftStart: startOfDay(now),
    runMs: 0, stopMs: 0, faultMs: 0, idleMs: 0,
    feedRateWeighted: 0,
    goodStart: null, goodLast: null,
    rejectStart: null, rejectLast: null,
    lastTickTs: now,
    lastState: null,
  };
}

export class Poller {
  constructor({ onUpdate } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.runtime = new Map(); // machineId -> runtime object
  }

  start() {
    const machines = db.prepare('SELECT * FROM machines WHERE enabled = 1').all();
    for (const m of machines) this.startMachine(m);
  }

  stop() {
    for (const [, rt] of this.runtime) {
      clearTimeout(rt.timer);
      if (rt.connector) rt.connector.disconnect().catch(() => {});
    }
    this.runtime.clear();
  }

  async restartMachine(machineId) {
    await this.stopMachine(machineId);
    const m = db.prepare('SELECT * FROM machines WHERE id = ?').get(machineId);
    if (m && m.enabled) this.startMachine(m);
  }

  async stopMachine(machineId) {
    const rt = this.runtime.get(machineId);
    if (!rt) return;
    clearTimeout(rt.timer);
    if (rt.connector) await rt.connector.disconnect().catch(() => {});
    this.runtime.delete(machineId);
  }

  startMachine(machine) {
    let config = {};
    try {
      config = JSON.parse(machine.connector_config || '{}');
    } catch { /* ignore */ }
    config.pollSeconds = machine.poll_interval_ms / 1000;

    const rt = {
      machine,
      connector: null,
      timer: null,
      online: false,
      lastReading: null,
      lastError: null,
      acc: freshAccumulator(Date.now()),
      backoff: 1000,
      manualOperator: null,
    };
    this.runtime.set(machine.id, rt);

    try {
      rt.connector = createConnector(machine.connector_type, config);
    } catch (err) {
      rt.lastError = err.message;
      this.emit(machine.id);
      return;
    }

    this.connectAndPoll(machine.id);
  }

  async connectAndPoll(machineId) {
    const rt = this.runtime.get(machineId);
    if (!rt) return;
    try {
      await rt.connector.connect();
      rt.online = true;
      rt.lastError = null;
      rt.backoff = 1000;
      this.tick(machineId);
    } catch (err) {
      rt.online = false;
      rt.lastError = err.message;
      this.emit(machineId);
      // Retry with capped exponential backoff.
      rt.timer = setTimeout(() => this.connectAndPoll(machineId), rt.backoff);
      rt.backoff = Math.min(rt.backoff * 2, 30000);
    }
  }

  async tick(machineId) {
    const rt = this.runtime.get(machineId);
    if (!rt) return;
    const machine = rt.machine;

    try {
      const reading = await rt.connector.read();
      if (rt.manualOperator && !reading.operator) reading.operator = rt.manualOperator;
      const now = Date.now();
      const state = deriveState(reading);

      this.accumulate(rt, state, reading, now);
      this.persist(machine, reading, state, now);
      this.handleTransitions(rt, reading, state, now);

      rt.online = true;
      rt.lastError = null;
      rt.lastReading = { ...reading, state, ts: now };
      this.emit(machineId);
    } catch (err) {
      rt.online = false;
      rt.lastError = err.message;
      this.emit(machineId);
    }

    rt.timer = setTimeout(() => this.tick(machineId), machine.poll_interval_ms);
  }

  accumulate(rt, state, reading, now) {
    const acc = rt.acc;
    // New day → reset the live shift accumulators.
    if (startOfDay(now) !== acc.shiftStart) {
      rt.acc = freshAccumulator(now);
      return this.accumulate(rt, state, reading, now);
    }
    const dur = Math.max(0, now - acc.lastTickTs);
    switch (acc.lastState) {
      case 'running':
        acc.runMs += dur;
        if (rt.lastReading?.feedRate != null) acc.feedRateWeighted += rt.lastReading.feedRate * dur;
        break;
      case 'stopped': acc.stopMs += dur; break;
      case 'fault': acc.faultMs += dur; break;
      case 'idle': acc.idleMs += dur; break;
      default: break;
    }
    acc.lastState = state;
    acc.lastTickTs = now;

    if (reading.goodCount != null) {
      if (acc.goodStart == null) acc.goodStart = reading.goodCount;
      acc.goodLast = reading.goodCount;
    }
    if (reading.rejectCount != null) {
      if (acc.rejectStart == null) acc.rejectStart = reading.rejectCount;
      acc.rejectLast = reading.rejectCount;
    }
  }

  persist(machine, reading, state, now) {
    stmt.insertSample.run({
      machine_id: machine.id,
      ts: now,
      state,
      feed_rate: reading.feedRate,
      operator: reading.operator,
      running: reading.running == null ? null : reading.running ? 1 : 0,
      stopped: reading.stopped == null ? null : reading.stopped ? 1 : 0,
      fault: reading.fault == null ? null : reading.fault ? 1 : 0,
      good_count: reading.goodCount,
      reject_count: reading.rejectCount,
    });
  }

  handleTransitions(rt, reading, state, now) {
    const machine = rt.machine;
    const prevState = rt.lastReading?.state ?? null;
    const isDown = state === 'stopped' || state === 'fault';
    const wasDown = prevState === 'stopped' || prevState === 'fault';

    // Downtime event open/close.
    if (isDown && (!wasDown || prevState !== state)) {
      if (wasDown) {
        const open = stmt.openDowntimeRow.get(machine.id);
        if (open) stmt.closeDowntime.run(now, now, open.id);
      }
      stmt.openDowntime.run(machine.id, now, state, reading.operator);
    } else if (!isDown && wasDown) {
      const open = stmt.openDowntimeRow.get(machine.id);
      if (open) stmt.closeDowntime.run(now, now, open.id);
    }

    // Fault rising edge → alarm.
    if (state === 'fault' && prevState !== 'fault') {
      stmt.insertAlarm.run(machine.id, now, 'fault', 'critical',
        `Fault on ${machine.name}${reading.operator ? ` (operator ${reading.operator})` : ''}`);
    }

    // Prolonged downtime alarm (once per event).
    if (isDown) {
      const open = stmt.openDowntimeRow.get(machine.id);
      if (open && now - open.start_ts >= PROLONGED_DOWNTIME_MS && !rt.prolongedAlarmed) {
        stmt.insertAlarm.run(machine.id, now, 'prolonged-downtime', 'warning',
          `${machine.name} ${state} for over ${Math.round((now - open.start_ts) / 60000)} min`);
        rt.prolongedAlarmed = true;
      }
    } else {
      rt.prolongedAlarmed = false;
    }

    // Operator change → operator log.
    const op = reading.operator || null;
    const prevOp = rt.lastReading?.operator ?? null;
    if (op !== prevOp) {
      const open = stmt.openOperatorRow.get(machine.id);
      if (open) stmt.closeOperator.run(now, open.id);
      if (op) stmt.openOperator.run(machine.id, op, now);
    }
  }

  liveSnapshot(machineId) {
    const rt = this.runtime.get(machineId);
    if (!rt) return null;
    const acc = rt.acc;
    const machine = rt.machine;

    const plannedMs = acc.runMs + acc.stopMs + acc.faultMs + acc.idleMs || 1;
    const availability = acc.runMs / plannedMs;
    const avgFeedRate = acc.runMs > 0 ? acc.feedRateWeighted / acc.runMs : 0;

    const goodDelta = acc.goodStart != null && acc.goodLast >= acc.goodStart ? acc.goodLast - acc.goodStart : 0;
    const rejectDelta = acc.rejectStart != null && acc.rejectLast >= acc.rejectStart ? acc.rejectLast - acc.rejectStart : 0;
    const totalCount = goodDelta + rejectDelta;
    const hasCounts = acc.goodStart != null || acc.rejectStart != null;

    const performance = machine.ideal_feed_rate > 0 ? avgFeedRate / machine.ideal_feed_rate : 0;
    const quality = hasCounts && totalCount > 0 ? goodDelta / totalCount : 1;

    const aC = clamp01(availability), pC = clamp01(performance), qC = clamp01(quality);

    return {
      machineId,
      online: rt.online,
      lastError: rt.lastError,
      reading: rt.lastReading,
      state: rt.lastReading?.state ?? 'offline',
      shift: {
        availability, performance, quality,
        oee: aC * pC * qC,
        avgFeedRate,
        idealFeedRate: machine.ideal_feed_rate,
        runMs: acc.runMs, stopMs: acc.stopMs, faultMs: acc.faultMs, idleMs: acc.idleMs,
        goodCount: goodDelta, rejectCount: rejectDelta, totalCount, hasCounts,
        shiftStart: acc.shiftStart,
      },
      targetOee: machine.target_oee,
    };
  }

  setManualOperator(machineId, operator) {
    const rt = this.runtime.get(machineId);
    if (rt) rt.manualOperator = operator;
  }

  emit(machineId) {
    const snap = this.liveSnapshot(machineId);
    if (snap) this.onUpdate(machineId, snap);
  }
}

function clamp01(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v > 1 ? 1 : v;
}
