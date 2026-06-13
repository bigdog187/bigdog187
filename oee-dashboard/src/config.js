import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Minimal .env loader (no external dependency).
function loadDotEnv() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const dbPathRaw = process.env.DB_PATH || './data/oee.db';

export const config = {
  rootDir,
  port: Number(process.env.PORT) || 3000,
  dbPath: path.isAbsolute(dbPathRaw) ? dbPathRaw : path.join(rootDir, dbPathRaw),
  sampleRetentionDays: Number(process.env.SAMPLE_RETENTION_DAYS) || 30,
  seedDemo: (process.env.SEED_DEMO ?? 'true').toLowerCase() !== 'false',
};
