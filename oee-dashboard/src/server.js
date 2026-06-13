import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import db from './db.js';
import { Poller } from './poller.js';
import { createApiRouter } from './routes/api.js';
import { maybeSeed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

maybeSeed();

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

const poller = new Poller({
  onUpdate: (machineId, snapshot) => broadcast({ type: 'machine-update', machineId, snapshot }),
});

app.use('/api', createApiRouter(poller));
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback (Express 5 / path-to-regexp v8 safe pattern).
app.get(/^(?!\/api|\/ws).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

wss.on('connection', (ws) => {
  // Send the current snapshot of every machine on connect.
  const machines = db.prepare('SELECT id FROM machines').all();
  for (const m of machines) {
    const snapshot = poller.liveSnapshot(m.id);
    if (snapshot) ws.send(JSON.stringify({ type: 'machine-update', machineId: m.id, snapshot }));
  }
});

// Prune old raw samples hourly to keep the DB bounded.
setInterval(() => {
  const cutoff = Date.now() - config.sampleRetentionDays * 24 * 3600 * 1000;
  db.prepare('DELETE FROM samples WHERE ts < ?').run(cutoff);
}, 3600 * 1000).unref();

server.listen(config.port, () => {
  console.log(`OEE dashboard listening on http://localhost:${config.port}`);
  poller.start();
});

function shutdown() {
  console.log('\nShutting down...');
  poller.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
