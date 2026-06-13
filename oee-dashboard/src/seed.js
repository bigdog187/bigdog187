import db from './db.js';
import { config } from './config.js';

/**
 * Seeds one demo site with two simulated machines the first time the app runs
 * against an empty database, so the dashboard is populated out-of-the-box.
 * Controlled by SEED_DEMO (default true).
 */
export function maybeSeed() {
  if (!config.seedDemo) return;
  const count = db.prepare('SELECT COUNT(*) AS c FROM sites').get().c;
  if (count > 0) return;

  const now = Date.now();
  const site = db.prepare('INSERT INTO sites (name, location, created_at) VALUES (?, ?, ?)')
    .run('Demo Plant', 'Sydney, AU', now);

  const insert = db.prepare(`
    INSERT INTO machines
      (site_id, name, connector_type, connector_config, ideal_feed_rate, feed_rate_unit,
       planned_minutes, target_oee, poll_interval_ms, enabled, created_at)
    VALUES (?, ?, 'simulator', ?, ?, ?, 480, 0.85, 2000, 1, ?)
  `);

  insert.run(site.lastInsertRowid, 'Extrusion Line 1',
    JSON.stringify({ idealFeedRate: 120, operators: ['A. Nguyen', 'B. Smith', 'C. Patel'] }),
    120, 'kg/h', now);

  insert.run(site.lastInsertRowid, 'Packaging Line 2',
    JSON.stringify({ idealFeedRate: 220, operators: ['D. Brown', 'E. Wilson'] }),
    220, 'units/min', now);

  console.log('Seeded demo plant with two simulated machines.');
}

// Allow `npm run seed` to force-create the demo data.
if (import.meta.url === `file://${process.argv[1]}`) {
  maybeSeed();
  console.log('Seed complete.');
  process.exit(0);
}
