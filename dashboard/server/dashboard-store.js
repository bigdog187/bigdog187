import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'dashboard.json');
const DEFAULTS = path.join(DATA_DIR, 'dashboard.default.json');

function read() {
  const src = fs.existsSync(FILE) ? FILE : DEFAULTS;
  return JSON.parse(fs.readFileSync(src, 'utf8'));
}

function write(layout) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(layout, null, 2));
  return layout;
}

function newId() {
  return 'w-' + Math.random().toString(36).slice(2, 8);
}

export const dashboardStore = {
  get() {
    return read();
  },

  // Replace the whole layout (used when the UI saves a drag/reorder).
  save(layout) {
    return write(layout);
  },

  addWidget(widget) {
    const layout = read();
    const w = { id: newId(), ...widget };
    layout.widgets.push(w);
    write(layout);
    return w;
  },

  removeWidget(id) {
    const layout = read();
    const before = layout.widgets.length;
    layout.widgets = layout.widgets.filter((w) => w.id !== id);
    write(layout);
    return before !== layout.widgets.length;
  },

  reset() {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
    return read();
  },
};
