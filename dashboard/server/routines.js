import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './config.js';
import { aroflo } from './aroflo.js';
import { SOURCES } from './sources.js';
import { runPrompt } from './claude.js';
import { SYSTEM_PERMS } from './auth.js';

const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'routines.json');
const DEFAULTS = path.join(DATA_DIR, 'routines.default.json');
const RUNS_FILE = path.join(DATA_DIR, 'routine-runs.json');
const MAX_RUNS = 100;
const SCRIPT_TIMEOUT_MS = 15000;

// ── Persistence ───────────────────────────────────────────────
function readRoutines() {
  const src = fs.existsSync(FILE) ? FILE : (fs.existsSync(DEFAULTS) ? DEFAULTS : null);
  if (!src) return [];
  try { return JSON.parse(fs.readFileSync(src, 'utf8')); } catch { return []; }
}
function writeRoutines(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
  return list;
}
function readRuns() {
  if (!fs.existsSync(RUNS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8')); } catch { return []; }
}
function writeRuns(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RUNS_FILE, JSON.stringify(list.slice(0, MAX_RUNS), null, 2));
}
function newId(p = 'r') { return p + '-' + Math.random().toString(36).slice(2, 8); }

// ── Schedule maths ────────────────────────────────────────────
// schedule: { type:'interval', minutes }
//         | { type:'daily',    time:'HH:MM' }
//         | { type:'weekly',   day:0-6, time:'HH:MM' }   (0=Sunday)
export function computeNextRun(schedule, from = Date.now()) {
  const base = new Date(from);
  if (!schedule || schedule.type === 'manual') return null;

  if (schedule.type === 'interval') {
    const mins = Math.max(1, Number(schedule.minutes) || 60);
    return from + mins * 60000;
  }

  const [h, m] = String(schedule.time || '08:00').split(':').map(Number);
  const next = new Date(base);
  next.setHours(h || 0, m || 0, 0, 0);

  if (schedule.type === 'daily') {
    if (next.getTime() <= from) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  if (schedule.type === 'weekly') {
    const target = Number(schedule.day);
    let delta = (target - next.getDay() + 7) % 7;
    if (delta === 0 && next.getTime() <= from) delta = 7;
    next.setDate(next.getDate() + delta);
    return next.getTime();
  }
  return null;
}

export function describeSchedule(s) {
  if (!s || s.type === 'manual') return 'Manual only';
  if (s.type === 'interval') return `Every ${s.minutes} min`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (s.type === 'daily') return `Daily at ${s.time}`;
  if (s.type === 'weekly') return `${days[s.day] || '?'} at ${s.time}`;
  return 'Custom';
}

// ── Action execution ──────────────────────────────────────────
async function runScript(code) {
  const logs = [];
  let resultVal;
  const sandbox = {
    aroflo,
    sources: SOURCES,
    console: { log: (...a) => logs.push(fmtArgs(a)) },
    log: (...a) => logs.push(fmtArgs(a)),
    result: (v) => { resultVal = v; },
    JSON, Date, Math, Number, String, Object, Array,
  };
  const wrapped = `(async () => {\n${code}\n})()`;
  const ctx = vm.createContext(sandbox);
  const promise = vm.runInContext(wrapped, ctx, { timeout: 5000 });
  await Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Script timed out')), SCRIPT_TIMEOUT_MS)),
  ]);
  let out = logs.join('\n');
  if (resultVal !== undefined) {
    out += (out ? '\n' : '') + '→ ' + (typeof resultVal === 'object' ? JSON.stringify(resultVal, null, 2) : String(resultVal));
  }
  return out || '(no output)';
}
function fmtArgs(a) {
  return a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
}

async function executeAction(action) {
  if (action.type === 'claude') {
    // Routines are admin-configured → run with full permissions.
    const { text, toolsUsed } = await runPrompt(action.prompt || '', SYSTEM_PERMS);
    const tools = toolsUsed.length ? `\n\n[tools: ${toolsUsed.join(', ')}]` : '';
    return (text || '(no answer)') + tools;
  }
  if (action.type === 'snapshot') {
    const fn = SOURCES[action.source];
    if (!fn) throw new Error(`Unknown source: ${action.source}`);
    const data = await fn();
    return JSON.stringify(data, null, 2);
  }
  if (action.type === 'script') {
    return runScript(action.code || '');
  }
  throw new Error(`Unknown action type: ${action.type}`);
}

// ── Run a routine + record result ─────────────────────────────
const running = new Set();

async function runRoutine(routine, trigger = 'schedule') {
  if (running.has(routine.id)) return null;
  running.add(routine.id);
  const started = Date.now();
  const record = {
    id: newId('run'),
    routineId: routine.id,
    name: routine.name,
    at: new Date(started).toISOString(),
    trigger,
    ok: false,
    durationMs: 0,
    output: '',
    error: null,
  };
  try {
    record.output = await executeAction(routine.action);
    record.ok = true;
  } catch (err) {
    record.error = String(err.message || err);
  } finally {
    record.durationMs = Date.now() - started;
    running.delete(routine.id);
  }

  // Persist run history (newest first).
  const runs = readRuns();
  runs.unshift(record);
  writeRuns(runs);

  // Update routine's last/next-run metadata.
  const list = readRoutines();
  const r = list.find((x) => x.id === routine.id);
  if (r) {
    r.lastRun = record.at;
    r.lastStatus = record.ok ? 'ok' : 'error';
    r.lastOutput = (record.ok ? record.output : record.error).slice(0, 4000);
    if (trigger === 'schedule' || !r.nextRun) r.nextRun = computeNextRun(r.schedule, started);
    writeRoutines(list);
  }
  return record;
}

// ── Scheduler ─────────────────────────────────────────────────
let timer = null;

async function tick() {
  const now = Date.now();
  const list = readRoutines();
  let changed = false;
  for (const r of list) {
    if (!r.enabled || !r.schedule || r.schedule.type === 'manual') continue;
    if (!r.nextRun) { r.nextRun = computeNextRun(r.schedule, now); changed = true; continue; }
    if (now >= r.nextRun) {
      // runRoutine reads/writes the file itself; fire and forget.
      runRoutine(r, 'schedule');
    }
  }
  if (changed) writeRoutines(list);
}

export const routines = {
  start() {
    // Initialise nextRun for any schedules missing it, then poll every 30s.
    tick();
    timer = setInterval(tick, 30000);
    return this;
  },
  stop() { if (timer) clearInterval(timer); },

  list() { return readRoutines(); },

  create(data) {
    const list = readRoutines();
    const r = {
      id: newId(),
      name: data.name || 'Untitled routine',
      enabled: data.enabled !== false,
      action: data.action || { type: 'snapshot', source: 'metrics' },
      schedule: data.schedule || { type: 'manual' },
      lastRun: null,
      lastStatus: null,
      lastOutput: null,
      nextRun: null,
    };
    r.nextRun = computeNextRun(r.schedule);
    list.push(r);
    writeRoutines(list);
    return r;
  },

  update(id, data) {
    const list = readRoutines();
    const r = list.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, {
      name: data.name ?? r.name,
      enabled: data.enabled ?? r.enabled,
      action: data.action ?? r.action,
      schedule: data.schedule ?? r.schedule,
    });
    r.nextRun = r.enabled ? computeNextRun(r.schedule) : null;
    writeRoutines(list);
    return r;
  },

  remove(id) {
    const list = readRoutines();
    const next = list.filter((x) => x.id !== id);
    writeRoutines(next);
    return next.length !== list.length;
  },

  toggle(id) {
    const list = readRoutines();
    const r = list.find((x) => x.id === id);
    if (!r) return null;
    r.enabled = !r.enabled;
    r.nextRun = r.enabled ? computeNextRun(r.schedule) : null;
    writeRoutines(list);
    return r;
  },

  runNow(id) {
    const r = readRoutines().find((x) => x.id === id);
    if (!r) return Promise.resolve(null);
    return runRoutine(r, 'manual');
  },

  runs(routineId) {
    const all = readRuns();
    return routineId ? all.filter((x) => x.routineId === routineId) : all;
  },
};
