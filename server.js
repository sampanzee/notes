'use strict';
/*
 * Notes – schlichte Listen-App für die Familie.
 * Läuft ohne externe Pakete: Node.js + eingebaute SQLite-Datenbank.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE = 'notes_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 Jahr angemeldet bleiben
const COLORS = ['tomato', 'orange', 'green', 'teal', 'blue', 'violet', 'pink', 'slate'];

// ---------------------------------------------------------------- Datenbank
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'notes.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📝',
  color TEXT NOT NULL DEFAULT 'blue',
  deleted INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rev INTEGER NOT NULL,
  PRIMARY KEY (list_id, user_id)
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER,
  note TEXT NOT NULL DEFAULT '',
  due TEXT,
  position REAL NOT NULL DEFAULT 0,
  created_by INTEGER,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id, rev);
CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
`);

const q = {
  getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  userByName: db.prepare('SELECT * FROM users WHERE name = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  allUsers: db.prepare('SELECT id, name, is_admin FROM users ORDER BY name COLLATE NOCASE'),
  insertUser: db.prepare('INSERT INTO users(name, pw, is_admin, created) VALUES(?, ?, ?, ?)'),
  setPw: db.prepare('UPDATE users SET pw = ? WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions(token, user_id, created, last_seen) VALUES(?, ?, ?, ?)'),
  sessionUser: db.prepare(`SELECT u.id, u.name, u.is_admin, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`),
  touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),

  getList: db.prepare('SELECT * FROM lists WHERE id = ?'),
  insertList: db.prepare('INSERT INTO lists(id, owner_id, name, emoji, color, created, updated, rev) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'),
  updateList: db.prepare('UPDATE lists SET name = ?, emoji = ?, color = ?, updated = ?, rev = ? WHERE id = ?'),
  deleteList: db.prepare('UPDATE lists SET deleted = 1, updated = ?, rev = ? WHERE id = ?'),
  bumpList: db.prepare('UPDATE lists SET rev = ? WHERE id = ?'),
  hasShare: db.prepare('SELECT 1 AS ok FROM shares WHERE list_id = ? AND user_id = ?'),
  sharesOf: db.prepare('SELECT user_id FROM shares WHERE list_id = ? ORDER BY user_id'),
  insertShare: db.prepare('INSERT OR IGNORE INTO shares(list_id, user_id, rev) VALUES(?, ?, ?)'),
  deleteShare: db.prepare('DELETE FROM shares WHERE list_id = ? AND user_id = ?'),
  accessibleLists: db.prepare(`
    SELECT l.*, (SELECT s.rev FROM shares s WHERE s.list_id = l.id AND s.user_id = ?) AS share_rev
    FROM lists l
    WHERE l.deleted = 0 AND (l.owner_id = ? OR EXISTS (SELECT 1 FROM shares s WHERE s.list_id = l.id AND s.user_id = ?))
    ORDER BY l.created`),

  getItem: db.prepare('SELECT * FROM items WHERE id = ?'),
  insertItem: db.prepare(`INSERT INTO items(id, list_id, title, done, done_at, note, due, position, created_by, created, updated, rev)
                          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateItem: db.prepare(`UPDATE items SET list_id = ?, title = ?, done = ?, done_at = ?, note = ?, due = ?, position = ?, updated = ?, rev = ?
                          WHERE id = ?`),
  deleteItem: db.prepare('UPDATE items SET deleted = 1, updated = ?, rev = ? WHERE id = ?'),
  clearDone: db.prepare('UPDATE items SET deleted = 1, updated = ?, rev = ? WHERE list_id = ? AND done = 1 AND deleted = 0'),
  itemsSince: db.prepare('SELECT * FROM items WHERE list_id = ? AND rev > ?'),
  itemsAlive: db.prepare('SELECT * FROM items WHERE list_id = ? AND deleted = 0'),
};

let rev = Number(q.getMeta.get('rev')?.value || 0);
function bumpRev() {
  rev += 1;
  q.setMeta.run('rev', String(rev));
  return rev;
}

// ---------------------------------------------------------------- Hilfsfunktionen
const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `s1$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function checkPw(pw, stored) {
  const [v, salt, hash] = String(stored).split('$');
  if (v !== 's1') return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length);
  return crypto.timingSafeEqual(want, got);
}

function text(v, max, trim = true) {
  if (v === undefined || v === null) return '';
  let s = String(v);
  if (trim) s = s.trim();
  return s.slice(0, max);
}
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
const dueOrNull = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const color = (v, fallback = 'blue') => (COLORS.includes(v) ? v : fallback);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function canAccess(userId, listId) {
  if (!isId(listId)) return false;
  const l = q.getList.get(listId);
  if (!l || l.deleted) return false;
  return l.owner_id === userId || !!q.hasShare.get(listId, userId);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function sessionCookie(req, token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const hashed = sha(token);
  const u = q.sessionUser.get(hashed);
  if (!u) return null;
  if (now() - u.last_seen > 60 * 60 * 1000) q.touchSession.run(now(), hashed);
  return { id: u.id, name: u.name, isAdmin: !!u.is_admin, token: hashed };
}
function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.insertSession.run(sha(token), userId, now(), now());
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_MAX_AGE));
}
const publicUser = (u) => ({ id: u.id, name: u.name, isAdmin: !!(u.isAdmin ?? u.is_admin) });

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.startsWith('application/json')) return reject(new HttpError(415, 'JSON erwartet'));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new HttpError(413, 'Zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, 'Ungültiges JSON')); }
    });
    req.on('error', reject);
  });
}

function transaction(fn) {
  const before = rev;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    rev = before;
    throw e;
  }
}

// ---------------------------------------------------------------- Live-Updates (Server-Sent Events)
const clients = new Set();
function broadcast() {
  const msg = `event: rev\ndata: ${rev}\n\n`;
  for (const c of clients) {
    try { c.write(msg); } catch { /* Verbindung wird beim Schließen aufgeräumt */ }
  }
}
setInterval(() => {
  for (const c of clients) {
    try { c.write(': ping\n\n'); } catch { /* ignorieren */ }
  }
}, 25000).unref();

// ---------------------------------------------------------------- Änderungen anwenden
function applyOp(user, op, r) {
  const t = now();
  switch (op.kind) {
    case 'list.put': {
      if (!isId(op.id)) return;
      const l = q.getList.get(op.id);
      if (!l) {
        q.insertList.run(op.id, user.id, text(op.name, 100) || 'Neue Liste', text(op.emoji, 16) || '📝', color(op.color), t, t, r);
      } else if (l.owner_id === user.id && !l.deleted) {
        q.updateList.run(
          op.name !== undefined ? (text(op.name, 100) || l.name) : l.name,
          op.emoji !== undefined ? (text(op.emoji, 16) || l.emoji) : l.emoji,
          op.color !== undefined ? color(op.color, l.color) : l.color,
          t, r, op.id,
        );
      }
      return;
    }
    case 'list.delete': {
      const l = isId(op.id) && q.getList.get(op.id);
      if (!l || l.deleted) return;
      if (l.owner_id === user.id) q.deleteList.run(t, r, op.id);
      else if (q.hasShare.get(op.id, user.id)) { q.deleteShare.run(op.id, user.id); q.bumpList.run(r, op.id); }
      return;
    }
    case 'list.share': {
      const l = isId(op.id) && q.getList.get(op.id);
      if (!l || l.deleted || l.owner_id !== user.id || !Array.isArray(op.userIds)) return;
      const want = new Set(op.userIds.map(Number).filter((id) => id !== user.id && q.userById.get(id)));
      for (const { user_id } of q.sharesOf.all(op.id)) if (!want.has(user_id)) q.deleteShare.run(op.id, user_id);
      for (const id of want) q.insertShare.run(op.id, id, r);
      q.bumpList.run(r, op.id);
      return;
    }
    case 'list.clearDone': {
      if (!canAccess(user.id, op.id)) return;
      q.clearDone.run(t, r, op.id);
      return;
    }
    case 'item.put': {
      if (!isId(op.id)) return;
      const f = op.fields && typeof op.fields === 'object' ? op.fields : {};
      const it = q.getItem.get(op.id);
      if (!it) {
        if (!canAccess(user.id, f.listId)) return;
        q.insertItem.run(op.id, f.listId, text(f.title, 500), f.done ? 1 : 0, f.done ? t : null,
          text(f.note, 20000, false), dueOrNull(f.due), num(f.position), user.id, t, t, r);
        return;
      }
      if (it.deleted || !canAccess(user.id, it.list_id)) return;
      let listId = it.list_id;
      if (f.listId !== undefined && f.listId !== it.list_id && canAccess(user.id, f.listId)) listId = f.listId;
      const title = f.title !== undefined ? (text(f.title, 500) || it.title) : it.title;
      let done = it.done;
      let doneAt = it.done_at;
      if (f.done !== undefined) {
        done = f.done ? 1 : 0;
        doneAt = done ? (it.done ? it.done_at : t) : null;
      }
      const note = f.note !== undefined ? text(f.note, 20000, false) : it.note;
      const due = f.due !== undefined ? dueOrNull(f.due) : it.due;
      const position = f.position !== undefined ? num(f.position, it.position) : it.position;
      q.updateItem.run(listId, title, done, doneAt, note, due, position, t, r, op.id);
      return;
    }
    case 'item.delete': {
      const it = isId(op.id) && q.getItem.get(op.id);
      if (!it || it.deleted || !canAccess(user.id, it.list_id)) return;
      q.deleteItem.run(t, r, op.id);
      return;
    }
    default:
      return;
  }
}

const itemOut = (i) => ({
  id: i.id, listId: i.list_id, title: i.title, done: !!i.done, doneAt: i.done_at, note: i.note,
  due: i.due, position: i.position, createdBy: i.created_by, created: i.created, updated: i.updated,
  deleted: !!i.deleted,
});

function syncFor(user, since) {
  let full = false;
  if (!Number.isFinite(since) || since <= 0 || since > rev) { since = 0; full = true; }
  const lists = [];
  const items = [];
  for (const l of q.accessibleLists.all(user.id, user.id, user.id)) {
    lists.push({
      id: l.id, ownerId: l.owner_id, name: l.name, emoji: l.emoji, color: l.color, created: l.created,
      sharedWith: q.sharesOf.all(l.id).map((s) => s.user_id),
    });
    const newlyShared = l.owner_id !== user.id && l.share_rev > since;
    if (full || newlyShared) {
      for (const i of q.itemsAlive.all(l.id)) items.push(itemOut(i));
    } else {
      for (const i of q.itemsSince.all(l.id, since)) items.push(itemOut(i));
    }
  }
  return {
    rev, full, me: publicUser(user),
    users: q.allUsers.all().map((u) => ({ id: u.id, name: u.name })),
    lists, items,
  };
}

// ---------------------------------------------------------------- API
const loginDelay = () => new Promise((r) => setTimeout(r, 700));

async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/health') return send(res, 200, { ok: true });

  if (p === '/api/status' && m === 'GET') {
    const u = currentUser(req);
    return send(res, 200, { setup: q.countUsers.get().n === 0, user: u ? publicUser(u) : null });
  }

  if (p === '/api/setup' && m === 'POST') {
    const body = await readJson(req);
    if (q.countUsers.get().n > 0) throw new HttpError(403, 'Bereits eingerichtet');
    const name = text(body.name, 40);
    const pw = String(body.password || '');
    if (!name) throw new HttpError(400, 'Bitte einen Namen eingeben');
    if (pw.length < 6) throw new HttpError(400, 'Das Passwort braucht mindestens 6 Zeichen');
    const info = q.insertUser.run(name, hashPw(pw), 1, now());
    startSession(req, res, Number(info.lastInsertRowid));
    return send(res, 200, { user: publicUser(q.userById.get(Number(info.lastInsertRowid))) });
  }

  if (p === '/api/login' && m === 'POST') {
    const body = await readJson(req);
    const u = q.userByName.get(text(body.name, 40));
    if (!u || !checkPw(String(body.password || ''), u.pw)) {
      await loginDelay();
      throw new HttpError(401, 'Name oder Passwort stimmt nicht');
    }
    startSession(req, res, u.id);
    return send(res, 200, { user: publicUser(u) });
  }

  if (p === '/api/logout' && m === 'POST') {
    const u = currentUser(req);
    if (u) q.deleteSession.run(u.token);
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return send(res, 200, { ok: true });
  }

  // Ab hier nur angemeldet
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Nicht angemeldet');

  if (p === '/api/events' && m === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\nevent: rev\ndata: ${rev}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (p === '/api/sync' && m === 'GET') {
    return send(res, 200, syncFor(user, Number(url.searchParams.get('since'))));
  }

  if (p === '/api/ops' && m === 'POST') {
    const body = await readJson(req);
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 500) : [];
    if (!ops.length) return send(res, 200, { rev });
    transaction(() => {
      const r = bumpRev();
      for (const op of ops) {
        try { applyOp(user, op || {}, r); }
        catch (e) { console.error('Änderung übersprungen:', e.message); }
      }
    });
    broadcast();
    return send(res, 200, { rev });
  }

  if (p === '/api/password' && m === 'POST') {
    const body = await readJson(req);
    const full = q.userById.get(user.id);
    if (!checkPw(String(body.old || ''), full.pw)) { await loginDelay(); throw new HttpError(400, 'Das bisherige Passwort stimmt nicht'); }
    const pw = String(body.password || '');
    if (pw.length < 6) throw new HttpError(400, 'Das neue Passwort braucht mindestens 6 Zeichen');
    q.setPw.run(hashPw(pw), user.id);
    q.deleteOtherSessions.run(user.id, user.token);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/users' && m === 'POST') {
    if (!user.isAdmin) throw new HttpError(403, 'Nur für Verwalter');
    const body = await readJson(req);
    const name = text(body.name, 40);
    const pw = String(body.password || '');
    if (!name) throw new HttpError(400, 'Bitte einen Namen eingeben');
    if (pw.length < 6) throw new HttpError(400, 'Das Passwort braucht mindestens 6 Zeichen');
    if (q.userByName.get(name)) throw new HttpError(400, 'Diesen Namen gibt es schon');
    q.insertUser.run(name, hashPw(pw), body.isAdmin ? 1 : 0, now());
    transaction(() => bumpRev());
    broadcast();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/users/password' && m === 'POST') {
    if (!user.isAdmin) throw new HttpError(403, 'Nur für Verwalter');
    const body = await readJson(req);
    const target = q.userById.get(Number(body.id));
    if (!target) throw new HttpError(404, 'Unbekannter Nutzer');
    const pw = String(body.password || '');
    if (pw.length < 6) throw new HttpError(400, 'Das Passwort braucht mindestens 6 Zeichen');
    q.setPw.run(hashPw(pw), target.id);
    if (target.id !== user.id) q.deleteUserSessions.run(target.id);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Nicht gefunden');
}

// ---------------------------------------------------------------- Statische Dateien
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(404); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Nicht gefunden'); }
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    };
    if (path.basename(file) === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------- Start
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { res.writeHead(400); return res.end(); }
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Serverfehler' });
      else res.end();
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, url.pathname);
});
server.keepAliveTimeout = 65000;
server.listen(PORT, () => console.log(`Notes läuft auf Port ${PORT} (Daten: ${DATA_DIR})`));

function shutdown() {
  for (const c of clients) { try { c.end(); } catch { /* egal */ } }
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
