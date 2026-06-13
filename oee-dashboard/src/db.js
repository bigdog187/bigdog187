import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  location    TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS machines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  connector_type  TEXT NOT NULL DEFAULT 'simulator',
  connector_config TEXT NOT NULL DEFAULT '{}',
  ideal_feed_rate REAL NOT NULL DEFAULT 100,
  feed_rate_unit  TEXT NOT NULL DEFAULT 'units/min',
  planned_minutes REAL NOT NULL DEFAULT 480,
  target_oee      REAL NOT NULL DEFAULT 0.85,
  poll_interval_ms INTEGER NOT NULL DEFAULT 2000,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS samples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id  INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL,
  state       TEXT NOT NULL,
  feed_rate   REAL,
  operator    TEXT,
  running     INTEGER,
  stopped     INTEGER,
  fault       INTEGER,
  good_count  REAL,
  reject_count REAL
);
CREATE INDEX IF NOT EXISTS idx_samples_machine_ts ON samples(machine_id, ts);

CREATE TABLE IF NOT EXISTS downtime_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id  INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  start_ts    INTEGER NOT NULL,
  end_ts      INTEGER,
  duration_s  REAL,
  state       TEXT NOT NULL,
  reason      TEXT,
  operator    TEXT
);
CREATE INDEX IF NOT EXISTS idx_downtime_machine ON downtime_events(machine_id, start_ts);

CREATE TABLE IF NOT EXISTS operator_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id  INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  operator    TEXT NOT NULL,
  start_ts    INTEGER NOT NULL,
  end_ts      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_operator_machine ON operator_log(machine_id, start_ts);

CREATE TABLE IF NOT EXISTS alarms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id  INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'warning',
  message     TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  ack_by      TEXT,
  ack_ts      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alarms_machine ON alarms(machine_id, ts);
`);

export default db;
