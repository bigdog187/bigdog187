import { BaseConnector } from './base.js';

/**
 * Simulated production line. Generates realistic running / stopped / fault
 * behaviour plus a fluctuating feed rate and incrementing piece counts so the
 * whole dashboard works end-to-end without any physical hardware.
 *
 * config:
 *   idealFeedRate  - target rate the sim oscillates around (default 100)
 *   operators      - list of operator names to rotate through
 *   faultChance    - probability per read of entering a fault (default 0.004)
 *   stopChance     - probability per read of a planned stop (default 0.01)
 */
export class SimulatorConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.ideal = config.idealFeedRate ?? 100;
    this.operators = config.operators ?? ['A. Nguyen', 'B. Smith', 'C. Patel'];
    this.faultChance = config.faultChance ?? 0.004;
    this.stopChance = config.stopChance ?? 0.01;
    this.state = 'running';
    this.stateUntil = 0;
    this.operator = this.operators[0];
    this.good = 0;
    this.reject = 0;
  }

  async connect() {
    this.connected = true;
    this.operator = this.operators[Math.floor(Math.random() * this.operators.length)];
  }

  async read() {
    const now = Date.now();

    // Resolve any timed state (fault / stop) back to running when it expires.
    if (this.state !== 'running' && now >= this.stateUntil) {
      this.state = 'running';
    }

    if (this.state === 'running') {
      if (Math.random() < this.faultChance) {
        this.state = 'fault';
        this.stateUntil = now + (15000 + Math.random() * 90000); // 15s–105s
      } else if (Math.random() < this.stopChance) {
        this.state = 'stopped';
        this.stateUntil = now + (10000 + Math.random() * 40000); // 10s–50s
        // Operators sometimes change at a stop.
        if (Math.random() < 0.3) {
          this.operator = this.operators[Math.floor(Math.random() * this.operators.length)];
        }
      }
    }

    const running = this.state === 'running';
    let feedRate = 0;
    if (running) {
      // Oscillate around ~92% of ideal with noise; occasional minor slowdowns.
      const base = this.ideal * 0.92;
      const wave = Math.sin(now / 60000) * this.ideal * 0.05;
      const noise = (Math.random() - 0.5) * this.ideal * 0.06;
      feedRate = Math.max(0, base + wave + noise);
      // Accumulate counts (rate is per minute, reads are sub-second to seconds).
      const producedSinceReady = feedRate / 60 * (this.config.pollSeconds ?? 2);
      this.good += producedSinceReady * (0.97 + Math.random() * 0.025);
      this.reject += producedSinceReady * (Math.random() * 0.03);
    }

    return {
      feedRate: running ? Number(feedRate.toFixed(1)) : 0,
      operator: this.operator,
      running,
      stopped: this.state === 'stopped',
      fault: this.state === 'fault',
      goodCount: Math.round(this.good),
      rejectCount: Math.round(this.reject),
    };
  }

  async disconnect() {
    this.connected = false;
  }
}
