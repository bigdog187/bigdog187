/**
 * Base class for all site/machine connectors.
 *
 * A connector is responsible for talking to one physical source (a PLC, a
 * Modbus device, an MQTT topic, a simulator, ...) and returning a normalised
 * reading. Every connector resolves to the same logical reading shape so the
 * rest of the application is independent of the underlying protocol:
 *
 *   {
 *     feedRate:    number | null,   // current product feed/production rate
 *     operator:    string | null,   // logged-in operator name
 *     running:     boolean | null,  // system running
 *     stopped:     boolean | null,  // system stopped
 *     fault:       boolean | null,  // system in fault
 *     goodCount:   number | null,   // cumulative good piece count (optional)
 *     rejectCount: number | null,   // cumulative reject piece count (optional)
 *   }
 *
 * Subclasses must implement connect(), read() and disconnect().
 */
export class BaseConnector {
  constructor(config = {}) {
    this.config = config;
    this.connected = false;
    this.lastError = null;
  }

  // Establish the connection. Should be idempotent.
  async connect() {
    this.connected = true;
  }

  // Return a normalised reading (see shape above). Must throw on failure.
  async read() {
    throw new Error('read() not implemented');
  }

  // Tear down the connection.
  async disconnect() {
    this.connected = false;
  }

  // Coerce arbitrary tag values into a boolean.
  static toBool(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return ['1', 'true', 'on', 'yes', 'run', 'running'].includes(v.toLowerCase());
    return Boolean(v);
  }

  static toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
}
