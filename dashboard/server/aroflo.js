import crypto from 'node:crypto';
import { config } from './config.js';
import { loadMock } from './mock-data.js';

/**
 * AroFlo API client.
 *
 * Runs in two modes:
 *   - MOCK  (AROFLO_ENABLED=false): returns realistic sample data from
 *           data/mock/*.json so you can build & demo with no credentials.
 *   - LIVE  (AROFLO_ENABLED=true):  signs requests with HMAC and calls the
 *           real AroFlo API (docs: https://apidocs.aroflo.com/).
 *
 * Known facts about the AroFlo API (from AroFlo's docs / help):
 *   - REST; returns XML by default, JSON when requested. Rate limit 2000/day.
 *   - Auth is HMAC (AroFlo documents SHA512). Keys come from AroFlo:
 *     Site Administration → Settings → General → AroFlo API.
 *   - Zones include: clientele (clients), tasks (jobs), quotes, invoices,
 *     sites, timesheets, schedule.
 *
 * ⚠️ The exact string-to-sign and header names below are AroFlo's HMAC model
 * but must be confirmed against AroFlo's official Postman collection
 * (apidocs.aroflo.com → the pre-request script). This function is the ONE
 * place to adjust — every endpoint flows through it. Use GET /api/aroflo/test
 * to try a live call and read back the exact status/response while tuning.
 */

const HMAC_ALGO = (process.env.AROFLO_HMAC_ALGO || 'sha512').toLowerCase();

function signRequest(method, zone, params) {
  const { cuid, orgEncodedKey, userName, uEncodedKey } = config.aroflo;
  const afdate = new Date().toUTCString();

  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const stringToSign = [method.toUpperCase(), zone, sortedParams, afdate].join('\n');

  const sign = (key) => crypto.createHmac(HMAC_ALGO, key || '').update(stringToSign).digest('base64');

  return {
    headers: {
      'afdate': afdate,
      'afkey': cuid,
      'afsig': sign(orgEncodedKey),
      'afusername': userName,
      'afusersig': sign(uEncodedKey),
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
}

async function liveRequest(zone, params = {}) {
  const method = 'GET';
  // Ask AroFlo for JSON (it defaults to XML).
  const withFormat = { format: 'json', ...params };
  const { headers } = signRequest(method, zone, withFormat);
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(withFormat).filter(([, v]) => v != null && v !== '')),
  ).toString();
  const url = `${config.aroflo.baseUrl}/${zone}${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, { method, headers });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`AroFlo ${zone} → HTTP ${res.status}. ${text.slice(0, 400)}`);
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<')) {
    throw new Error(
      `AroFlo ${zone} returned XML, not JSON. Add "&format=json" support or set your ` +
      `AroFlo API output to JSON. First 200 chars: ${trimmed.slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`AroFlo ${zone}: could not parse response as JSON. First 200 chars: ${text.slice(0, 200)}`);
  }
}

/**
 * Try a minimal live call and return a diagnostic (never throws). Used by the
 * "Test connection" button so you can confirm credentials + signing.
 */
export async function testConnection() {
  const { enabled, baseUrl, cuid, orgEncodedKey, userName, uEncodedKey } = config.aroflo;
  const present = {
    AROFLO_CUID: !!cuid,
    AROFLO_ORG_ENCODED_KEY: !!orgEncodedKey,
    AROFLO_USER_NAME: !!userName,
    AROFLO_U_ENCODED_KEY: !!uEncodedKey,
  };
  if (!enabled) {
    return { ok: false, mode: 'mock', baseUrl, present, message: 'AROFLO_ENABLED is false — running on sample data. Set it to true in .env to attempt a live connection.' };
  }
  const missing = Object.entries(present).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    return { ok: false, mode: 'live', baseUrl, present, message: `Missing credentials in .env: ${missing.join(', ')}` };
  }
  try {
    const data = await liveRequest('clientele', { limit: 1 });
    const count = Array.isArray(data) ? data.length : (data && typeof data === 'object' ? Object.keys(data).length : 0);
    return { ok: true, mode: 'live', baseUrl, present, message: `Connected. Sample "clientele" call returned data (${count} field/record${count === 1 ? '' : 's'}).` };
  } catch (err) {
    return { ok: false, mode: 'live', baseUrl, present, message: String(err.message || err) };
  }
}

// ── Public API ────────────────────────────────────────────────
// Each method returns a plain JS array/object. In mock mode it reads a
// fixture; in live mode it calls AroFlo. Keep the shapes identical so the
// rest of the app (and Claude's tools) don't care which mode is active.

async function fetchData(name, zone, params) {
  if (!config.aroflo.enabled) return loadMock(name);
  return liveRequest(zone, params);
}

export const aroflo = {
  mode: () => (config.aroflo.enabled ? 'live' : 'mock'),

  async jobs({ status } = {}) {
    const data = await fetchData('jobs', 'tasks', { status });
    if (status && Array.isArray(data)) {
      return data.filter((j) => (j.status || '').toLowerCase() === status.toLowerCase());
    }
    return data;
  },

  async clients() {
    return fetchData('clients', 'clientele');
  },

  async timesheets({ from, to } = {}) {
    const data = await fetchData('timesheets', 'timesheets', { from, to });
    return data;
  },

  async invoices({ status } = {}) {
    const data = await fetchData('invoices', 'invoices', { status });
    if (status && Array.isArray(data)) {
      return data.filter((i) => (i.status || '').toLowerCase() === status.toLowerCase());
    }
    return data;
  },

  async schedule({ date } = {}) {
    return fetchData('schedule', 'schedule', { date });
  },

  /**
   * Aggregate numbers used by the metric widgets. Computed from the data
   * above so it works identically in mock and live mode.
   */
  async metrics() {
    const [jobs, invoices, timesheets] = await Promise.all([
      this.jobs(),
      this.invoices(),
      this.timesheets(),
    ]);

    const open = jobs.filter((j) => (j.status || '').toLowerCase() !== 'completed');
    const overdue = jobs.filter((j) => j.overdue);
    const unpaid = invoices.filter((i) => (i.status || '').toLowerCase() !== 'paid');
    const unpaidTotal = unpaid.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const hoursThisWeek = timesheets.reduce((sum, t) => sum + (Number(t.hours) || 0), 0);

    return {
      openJobs: open.length,
      overdueJobs: overdue.length,
      unpaidInvoices: unpaid.length,
      unpaidTotal: Math.round(unpaidTotal),
      hoursThisWeek: Math.round(hoursThisWeek * 10) / 10,
      activeClients: (await this.clients()).length,
    };
  },

  // ── Aggregations for chart widgets ──────────────────────────
  // Each returns [{ label, value }] so a single chart renderer handles them all.
  async jobsByStatus() {
    const jobs = await this.jobs();
    const counts = {};
    for (const j of jobs) {
      const s = j.status || 'Unknown';
      counts[s] = (counts[s] || 0) + 1;
    }
    return Object.entries(counts).map(([label, value]) => ({ label, value }));
  },

  async revenueByClient() {
    const jobs = await this.jobs();
    const totals = {};
    for (const j of jobs) {
      const c = j.client || 'Unknown';
      totals[c] = (totals[c] || 0) + (Number(j.value) || 0);
    }
    return Object.entries(totals)
      .map(([label, value]) => ({ label, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value);
  },

  async hoursByStaff() {
    const timesheets = await this.timesheets();
    const totals = {};
    for (const t of timesheets) {
      const s = t.staff || 'Unknown';
      totals[s] = (totals[s] || 0) + (Number(t.hours) || 0);
    }
    return Object.entries(totals)
      .map(([label, value]) => ({ label, value: Math.round(value * 10) / 10 }))
      .sort((a, b) => b.value - a.value);
  },

  async invoicesByStatus() {
    const invoices = await this.invoices();
    const totals = {};
    for (const i of invoices) {
      const s = i.status || 'Unknown';
      totals[s] = (totals[s] || 0) + (Number(i.amount) || 0);
    }
    return Object.entries(totals).map(([label, value]) => ({ label, value: Math.round(value) }));
  },
};
