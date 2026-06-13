import net from 'node:net';
import { BaseConnector } from './base.js';

/**
 * Generic Modbus TCP connector — lets you onboard non-Allen-Bradley sites
 * (any PLC/RTU/gateway speaking Modbus TCP) without extra dependencies. It
 * implements just enough of the Modbus TCP spec to read holding registers
 * (FC 03) and coils (FC 01).
 *
 * config:
 *   ip, port (default 502), unitId (default 1)
 *   tags: {
 *     feedRate:    { type: 'holding', address: 0, scale: 0.1 },
 *     running:     { type: 'coil',    address: 0 },
 *     stopped:     { type: 'coil',    address: 1 },
 *     fault:       { type: 'coil',    address: 2 },
 *     goodCount:   { type: 'holding', address: 10, words: 2 },  // 32-bit
 *     rejectCount: { type: 'holding', address: 12, words: 2 }
 *   }
 * (operator name is rarely a Modbus value; supply it via the API if needed.)
 */
export class ModbusConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.ip = config.ip;
    this.port = config.port ?? 502;
    this.unitId = config.unitId ?? 1;
    this.tagMap = config.tags ?? {};
    this.socket = null;
    this.txId = 0;
    this.pending = null;
  }

  connect() {
    if (!this.ip) throw new Error('Modbus connector requires an "ip" address');
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.ip, port: this.port }, () => {
        this.connected = true;
        resolve();
      });
      this.socket.setNoDelay(true);
      this.socket.on('error', (err) => {
        this.lastError = err.message;
        if (this.pending) this.pending.reject(err);
        reject(err);
      });
      this.socket.on('close', () => {
        this.connected = false;
      });
      this.socket.on('data', (buf) => {
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          p.resolve(buf);
        }
      });
    });
  }

  #request(funcCode, address, quantity) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) return reject(new Error('Modbus not connected'));
      if (this.pending) return reject(new Error('Modbus request already in flight'));

      this.txId = (this.txId + 1) & 0xffff;
      const pdu = Buffer.alloc(12);
      pdu.writeUInt16BE(this.txId, 0); // transaction id
      pdu.writeUInt16BE(0, 2); // protocol id
      pdu.writeUInt16BE(6, 4); // length
      pdu.writeUInt8(this.unitId, 6);
      pdu.writeUInt8(funcCode, 7);
      pdu.writeUInt16BE(address, 8);
      pdu.writeUInt16BE(quantity, 10);

      const timer = setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          reject(new Error('Modbus request timed out'));
        }
      }, 3000);

      this.pending = {
        resolve: (buf) => {
          clearTimeout(timer);
          const fc = buf.readUInt8(7);
          if (fc & 0x80) return reject(new Error(`Modbus exception ${buf.readUInt8(8)}`));
          resolve(buf.slice(9)); // payload after byte-count byte
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      this.socket.write(pdu);
    });
  }

  async #readHolding(address, words = 1) {
    const data = await this.#request(0x03, address, words);
    return data; // raw bytes, 2 per register
  }

  async #readCoil(address) {
    const data = await this.#request(0x01, address, 1);
    return (data.readUInt8(0) & 0x01) === 1;
  }

  async read() {
    const reading = {
      feedRate: null, operator: null, running: null,
      stopped: null, fault: null, goodCount: null, rejectCount: null,
    };

    for (const [field, spec] of Object.entries(this.tagMap)) {
      if (!spec) continue;
      if (spec.type === 'coil') {
        const v = await this.#readCoil(spec.address);
        reading[field] = field === 'operator' ? String(v) : v;
      } else {
        const words = spec.words ?? 1;
        const bytes = await this.#readHolding(spec.address, words);
        let value = words >= 2 ? bytes.readUInt32BE(0) : bytes.readUInt16BE(0);
        if (spec.scale) value *= spec.scale;
        if (field === 'running' || field === 'stopped' || field === 'fault') {
          reading[field] = value !== 0;
        } else {
          reading[field] = value;
        }
      }
    }
    return reading;
  }

  async disconnect() {
    if (this.socket) this.socket.destroy();
    this.socket = null;
    this.connected = false;
  }
}
