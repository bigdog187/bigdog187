/* ====================================================================
   ab-gateway.js — Allen-Bradley EtherNet/IP  ⇄  WebSocket bridge
   --------------------------------------------------------------------
   Browsers cannot speak EtherNet/IP (CIP) directly, so this small Node
   process sits on the mill network, polls the ControlLogix / Compact-
   Logix PLC, and streams tag values to the SCADA HMI over a WebSocket.
   Writes from the HMI (setpoints, motor commands) are pushed back to
   the controller.

   Protocol (JSON over WebSocket):
     HMI → gateway:
       { type:"subscribe", tags:[...addr], plc:{path,slot}, rate:500 }
       { type:"write", tag:"Program:Mill.MillRateSP", value:12 }
     gateway → HMI:
       { type:"data", values:{ "addr": value, ... } }
       { type:"status", connected:true, message:"" }

   Dependencies (install on the gateway PC / IPC):
       npm install ws ethernet-ip
   (ethernet-ip = the 'st-one-io/node-ethernet-ip' library.)

   Run:
       node ab-gateway.js            # defaults: ws :8080, PLC 192.168.1.10
       PLC_IP=10.0.0.5 PORT=8080 node ab-gateway.js
   ==================================================================== */

'use strict';

const PORT    = process.env.PORT    || 8080;
const PLC_IP  = process.env.PLC_IP  || '192.168.1.10';
const PLC_SLOT= Number(process.env.PLC_SLOT || 0);

let WebSocketServer, Controller, Tag;
try {
  ({ Server: WebSocketServer } = require('ws'));
} catch {
  console.error('Missing dependency: npm install ws ethernet-ip');
  process.exit(1);
}
try {
  ({ Controller, Tag } = require('ethernet-ip'));
} catch {
  console.warn('[gateway] "ethernet-ip" not installed — running in ECHO/DEMO mode (no real PLC I/O).');
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[gateway] WebSocket listening on ws://0.0.0.0:${PORT}`);
console.log(`[gateway] Target PLC ${PLC_IP} slot ${PLC_SLOT}`);

/* one shared PLC connection, reference-counted across HMI clients */
let plc = null;
let plcConnected = false;
const subscribedTags = new Map(); // addr -> Tag instance
let pollTimer = null;
let pollRate = 500;

async function ensurePlc(path, slot) {
  if (!Controller) return;          // demo mode
  if (plc) return;
  plc = new Controller();
  try {
    await plc.connect(path || PLC_IP, slot ?? PLC_SLOT);
    plcConnected = true;
    console.log(`[gateway] Connected to ${plc.properties.name || path}`);
    broadcast({ type: 'status', connected: true, message: plc.properties.name || '' });
  } catch (err) {
    plcConnected = false;
    console.error('[gateway] PLC connect failed:', err.message);
    broadcast({ type: 'status', connected: false, message: err.message });
    plc = null;
  }
}

function addSubscription(addr) {
  if (subscribedTags.has(addr)) return;
  if (Controller && plc) {
    const tag = new Tag(addr);          // symbolic controller/program tag
    plc.subscribe(tag);
    subscribedTags.set(addr, tag);
  } else {
    subscribedTags.set(addr, { name: addr, value: demoValue(addr) }); // demo
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const values = {};
    if (Controller && plc && plcConnected) {
      try {
        await plc.readTagGroup ? null : null; // node-ethernet-ip auto-scans subscribed tags
        for (const [addr, tag] of subscribedTags) values[addr] = tag.value;
      } catch (err) {
        console.error('[gateway] read error:', err.message);
        plcConnected = false;
        broadcast({ type: 'status', connected: false, message: err.message });
      }
    } else {
      // DEMO mode: nudge values so the HMI shows life without a PLC
      for (const [addr, t] of subscribedTags) { t.value = demoStep(addr, t.value); values[addr] = t.value; }
    }
    broadcast({ type: 'data', values });
  }, pollRate);
}

async function writeTag(addr, value) {
  if (Controller && plc && plcConnected) {
    try {
      const tag = subscribedTags.get(addr) || new Tag(addr);
      tag.value = value;
      await plc.writeTag(tag);
      console.log(`[gateway] write ${addr} = ${value}`);
    } catch (err) {
      console.error('[gateway] write error:', err.message);
    }
  } else {
    const t = subscribedTags.get(addr); if (t) t.value = value;   // demo echo
    console.log(`[gateway:demo] write ${addr} = ${value}`);
  }
}

/* ---- WebSocket clients ---------------------------------------- */
const clients = new Set();
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of clients) if (c.readyState === 1) c.send(msg);
}

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[gateway] HMI client connected (${clients.size} total)`);
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'subscribe') {
      pollRate = msg.rate || pollRate;
      await ensurePlc(msg.plc && msg.plc.path, msg.plc && msg.plc.slot);
      (msg.tags || []).forEach(addSubscription);
      startPolling();
      ws.send(JSON.stringify({ type: 'status', connected: plcConnected, message: Controller ? '' : 'demo mode' }));
    } else if (msg.type === 'write') {
      await writeTag(msg.tag, msg.value);
    }
  });
  ws.on('close', () => { clients.delete(ws); console.log(`[gateway] HMI client left (${clients.size} total)`); });
});

/* ---- demo helpers (only used when ethernet-ip is absent) ------ */
function demoValue(addr) {
  if (/Run|Auto|Fault|Cmd|SeqRun/.test(addr)) return false;
  if (/Recipe|GrainId|TargetSilo|Count/.test(addr)) return 0;
  return 0;
}
function demoStep(addr, v) {
  if (typeof v === 'boolean') return v;
  if (/Level|Moist/.test(addr)) return Math.max(0, Math.min(100, v + (Math.random() - 0.5)));
  if (/Rate|Current|Speed|Flow/.test(addr)) return Math.max(0, v + (Math.random() - 0.5) * 2);
  return v;
}

process.on('SIGINT', () => { console.log('\n[gateway] shutting down'); if (plc) plc.disconnect(); process.exit(0); });
