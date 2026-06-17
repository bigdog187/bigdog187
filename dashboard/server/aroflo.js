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
 *           real AroFlo API.
 *
 * The HMAC signing below is a scaffold based on AroFlo's API auth model
 * (an org-level key + a user-level key, HMAC-SHA512). Confirm the exact
 * header/parameter names against your AroFlo API documentation
 * (Site Admin → API) and adjust `signRequest()` once — every endpoint
 * method flows through it, so it's a single place to get right.
 */

function signRequest(method, zone, params) {
  const { cuid, orgEncodedKey, userName, uEncodedKey } = config.aroflo;
  const afdate = new Date().toUTCString();

  // String-to-sign: method + zone + sorted params + date. Adjust to match
  // your AroFlo API spec exactly.
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const stringToSign = [method.toUpperCase(), zone, sortedParams, afdate].join('\n');

  const orgSig = crypto
    .createHmac('sha512', orgEncodedKey)
    .update(stringToSign)
    .digest('base64');
  const userSig = crypto
    .createHmac('sha512', uEncodedKey)
    .update(stringToSign)
    .digest('base64');

  return {
    headers: {
      'afdate': afdate,
      'afkey': cuid,
      'afsig': orgSig,
      'afusername': userName,
      'afusersig': userSig,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
}

async function liveRequest(zone, params = {}) {
  const method = 'GET';
  const { headers } = signRequest(method, zone, params);
  const qs = new URLSearchParams(params).toString();
  const url = `${config.aroflo.baseUrl}/${zone}${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, { method, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AroFlo ${zone} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  // AroFlo can return JSON or XML depending on config; assume JSON here.
  return res.json();
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
