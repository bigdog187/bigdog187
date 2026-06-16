import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const MOCK_DIR = path.join(ROOT, 'data', 'mock');

export function loadMock(name) {
  const file = path.join(MOCK_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
