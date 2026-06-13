import { BaseConnector } from './base.js';

/**
 * Allen Bradley connector using EtherNet/IP (CIP) — works with ControlLogix,
 * CompactLogix and Micro800 family controllers via the `st-ethernet-ip`
 * library, which is loaded lazily so the rest of the app runs even if the
 * optional dependency or a live PLC is unavailable.
 *
 * config:
 *   ip        - controller IP address (required)
 *   slot      - backplane slot of the CPU (default 0)
 *   tags: {                       <- map logical fields to controller tag names
 *     feedRate:    'Feed_Rate',
 *     operator:    'Operator_Name',
 *     running:     'Sys_Running',
 *     stopped:     'Sys_Stopped',
 *     fault:       'Sys_Fault',
 *     goodCount:   'Good_Count',    (optional, for Quality)
 *     rejectCount: 'Reject_Count'   (optional, for Quality)
 *   }
 *
 * Tag names may be controller-scoped ('Feed_Rate') or program-scoped
 * ('Program:Main.Feed_Rate').
 */
export class AllenBradleyConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.ip = config.ip;
    this.slot = config.slot ?? 0;
    this.tagMap = config.tags ?? {};
    this.controller = null;
    this.tagObjects = new Map();
  }

  async connect() {
    if (!this.ip) throw new Error('Allen Bradley connector requires an "ip" address');

    let lib;
    try {
      lib = await import('st-ethernet-ip');
    } catch {
      throw new Error(
        'st-ethernet-ip is not installed. Run `npm install st-ethernet-ip` to enable the Allen Bradley connector.'
      );
    }

    const { Controller, Tag } = lib.default ?? lib;
    this.controller = new Controller();
    await this.controller.connect(this.ip, this.slot);

    // Pre-build Tag objects for every mapped, non-empty tag name.
    for (const [field, tagName] of Object.entries(this.tagMap)) {
      if (tagName) this.tagObjects.set(field, new Tag(tagName));
    }

    this.connected = true;
    this.lastError = null;
  }

  async read() {
    if (!this.controller) throw new Error('Allen Bradley connector not connected');

    const reading = {
      feedRate: null,
      operator: null,
      running: null,
      stopped: null,
      fault: null,
      goodCount: null,
      rejectCount: null,
    };

    for (const [field, tag] of this.tagObjects) {
      await this.controller.readTag(tag);
      const raw = tag.value;
      switch (field) {
        case 'running':
        case 'stopped':
        case 'fault':
          reading[field] = BaseConnector.toBool(raw);
          break;
        case 'operator':
          reading.operator = AllenBradleyConnector.extractString(raw);
          break;
        default:
          reading[field] = BaseConnector.toNum(raw);
      }
    }

    return reading;
  }

  // Logix STRING tags decode to an object { LEN, DATA: [...] }; plain reads
  // may already be strings. Normalise both.
  static extractString(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && Array.isArray(raw.DATA)) {
      const len = raw.LEN ?? raw.DATA.length;
      return Buffer.from(raw.DATA.slice(0, len)).toString('ascii').replace(/\0+$/, '');
    }
    return String(raw);
  }

  async disconnect() {
    try {
      if (this.controller) await this.controller.disconnect();
    } catch {
      /* ignore */
    }
    this.controller = null;
    this.tagObjects.clear();
    this.connected = false;
  }
}
