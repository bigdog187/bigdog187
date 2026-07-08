import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

/**
 * Local username/password auth with per-user permissions.
 *
 * - Users live in data/users.json (passwords hashed with scrypt + per-user salt;
 *   never stored or logged in plain text).
 * - Sessions live in data/sessions.json (random tokens, httpOnly cookie),
 *   surviving server restarts.
 * - First run: no users exist → the login page offers "create administrator".
 *
 * Roles: 'admin' (everything, including deletes, financial data and user
 * management) and 'user' (only what their permission flags allow — never
 * deletes, never user management).
 */

const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days
const COOKIE = 'sid';

export const PERMISSIONS = [
  { key: 'dashboard',     label: 'View dashboard' },
  { key: 'editDashboard', label: 'Add & rearrange widgets' },
  { key: 'chat',          label: 'Use the assistant (chat)' },
  { key: 'routines',      label: 'View & run routines' },
  { key: 'financial',     label: 'Financial data ($ values, invoices)' },
];

// Full-access permission object used for internal work (scheduled routines).
export const SYSTEM_PERMS = Object.freeze({
  admin: true, dashboard: true, editDashboard: true, chat: true, routines: true, financial: true,
});

// ── File stores ───────────────────────────────────────────────
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
const readUsers = () => readJson(USERS_FILE, []);
const writeUsers = (u) => writeJson(USERS_FILE, u);

function readSessions() {
  const all = readJson(SESSIONS_FILE, {});
  // Drop expired sessions on read.
  const now = Date.now();
  let changed = false;
  for (const [token, s] of Object.entries(all)) {
    if (!s || s.expires < now) { delete all[token]; changed = true; }
  }
  if (changed) writeJson(SESSIONS_FILE, all);
  return all;
}
const writeSessions = (s) => writeJson(SESSIONS_FILE, s);

// ── Password hashing ──────────────────────────────────────────
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function verifyPassword(password, salt, expectedHex) {
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ── Login rate limiting (per ip+username) ─────────────────────
const attempts = new Map(); // key → { count, resetAt }
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
function tooManyAttempts(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.resetAt < now) return false;
  return a.count >= MAX_ATTEMPTS;
}
function recordAttempt(key, success) {
  const now = Date.now();
  if (success) { attempts.delete(key); return; }
  const a = attempts.get(key);
  if (!a || a.resetAt < now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else a.count += 1;
}

// ── Helpers ───────────────────────────────────────────────────
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function publicUser(u) {
  if (!u) return null;
  const { id, username, role, perms, created } = u;
  return { id, username, role, perms: perms || {}, created };
}

/** Effective permission check: admins can do everything. */
export function can(user, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!(user.perms && user.perms[perm]);
}

/** Permission snapshot passed into tools/chat for output filtering. */
export function permsOf(user) {
  const p = { admin: user?.role === 'admin' };
  for (const { key } of PERMISSIONS) p[key] = can(user, key);
  return p;
}

// ── Public API ────────────────────────────────────────────────
export const auth = {
  COOKIE,

  hasUsers() { return readUsers().length > 0; },

  listUsers() { return readUsers().map(publicUser); },

  createUser({ username, password, role = 'user', perms = {} }) {
    username = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,32}$/.test(username)) throw new Error('Username must be 2-32 chars: letters, numbers, . _ -');
    if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters');
    const users = readUsers();
    if (users.some((u) => u.username === username)) throw new Error('Username already exists');
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: 'u-' + crypto.randomBytes(4).toString('hex'),
      username,
      role: role === 'admin' ? 'admin' : 'user',
      perms: sanitizePerms(perms),
      salt,
      hash: hashPassword(password, salt),
      created: new Date().toISOString(),
    };
    users.push(user);
    writeUsers(users);
    return publicUser(user);
  },

  updateUser(id, { role, perms }) {
    const users = readUsers();
    const u = users.find((x) => x.id === id);
    if (!u) return null;
    if (role) {
      const nextRole = role === 'admin' ? 'admin' : 'user';
      if (u.role === 'admin' && nextRole !== 'admin' && countAdmins(users) <= 1) {
        throw new Error('Cannot demote the last administrator');
      }
      u.role = nextRole;
    }
    if (perms) u.perms = sanitizePerms(perms);
    writeUsers(users);
    return publicUser(u);
  },

  setPassword(id, password) {
    if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters');
    const users = readUsers();
    const u = users.find((x) => x.id === id);
    if (!u) return null;
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPassword(password, u.salt);
    writeUsers(users);
    // Invalidate that user's sessions so a password reset logs them out.
    const sessions = readSessions();
    for (const [token, s] of Object.entries(sessions)) if (s.userId === u.id) delete sessions[token];
    writeSessions(sessions);
    return true;
  },

  removeUser(id) {
    const users = readUsers();
    const u = users.find((x) => x.id === id);
    if (!u) return false;
    if (u.role === 'admin' && countAdmins(users) <= 1) throw new Error('Cannot delete the last administrator');
    writeUsers(users.filter((x) => x.id !== id));
    const sessions = readSessions();
    for (const [token, s] of Object.entries(sessions)) if (s.userId === id) delete sessions[token];
    writeSessions(sessions);
    return true;
  },

  login(username, password, ip = '') {
    username = String(username || '').trim().toLowerCase();
    const key = `${ip}|${username}`;
    if (tooManyAttempts(key)) throw new Error('Too many failed attempts — try again in 15 minutes');
    const u = readUsers().find((x) => x.username === username);
    const ok = !!u && verifyPassword(password, u.salt, u.hash);
    recordAttempt(key, ok);
    if (!ok) throw new Error('Invalid username or password');
    const token = crypto.randomBytes(32).toString('hex');
    const sessions = readSessions();
    sessions[token] = { userId: u.id, created: Date.now(), expires: Date.now() + SESSION_TTL_MS };
    writeSessions(sessions);
    return { token, user: publicUser(u) };
  },

  logout(token) {
    if (!token) return;
    const sessions = readSessions();
    if (sessions[token]) { delete sessions[token]; writeSessions(sessions); }
  },

  /** Resolve the user for a request, or null. Also sets req.sessionToken. */
  userFromRequest(req) {
    const token = parseCookies(req)[COOKIE];
    if (!token) return null;
    const s = readSessions()[token];
    if (!s) return null;
    const u = readUsers().find((x) => x.id === s.userId);
    if (!u) return null;
    req.sessionToken = token;
    return publicUser(u);
  },

  cookieHeader(token) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
  },
  clearCookieHeader() {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  },
};

function sanitizePerms(perms) {
  const out = {};
  for (const { key } of PERMISSIONS) out[key] = !!perms[key];
  return out;
}
function countAdmins(users) {
  return users.filter((x) => x.role === 'admin').length;
}
