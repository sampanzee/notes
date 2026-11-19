'use strict';
/* Notes – App-Logik. Alles läuft lokal zuerst (offline), Änderungen gehen über eine Warteschlange zum Server. */

// ---------------------------------------------------------------- Grundlagen
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

const COLORS = {
  tomato: '#e0533d', orange: '#e8862a', green: '#2e9a6a', teal: '#18929e',
  blue: '#3d6fd6', violet: '#7b5bd6', pink: '#d24f7d', slate: '#5d6877',
};
const EMOJIS = ['🛒', '✅', '📝', '🎁', '🏝️', '🏠', '🧺', '💊', '🎄', '🎂', '📚', '🧸',
  '🔧', '🌱', '🍳', '✈️', '🚗', '💡', '🎉', '🐾', '💼', '🏃', '🎨', '❤️'];
const SUGGESTIONS = [
  { name: 'Einkaufsliste', emoji: '🛒', color: 'green' },
  { name: 'Meine Aufgaben', emoji: '✅', color: 'blue' },
  { name: 'Geschenkideen', emoji: '🎁', color: 'pink' },
  { name: 'Urlaubsziele', emoji: '🏝️', color: 'teal' },
];

const I = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="19" cy="12" r="1.9" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3.3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M15.5 5.6a3.2 3.2 0 010 5.8M18 14.4c1.6.7 2.7 2.2 3 4.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 11h14M5 16h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2c.1 1 .9 1.8 1.9 1.8h5.4c1 0 1.8-.8 1.9-1.8L17.5 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  cloudOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 18.5h9.8a3.7 3.7 0 00.6-7.4A5.6 5.6 0 007.4 9.5 4.5 4.5 0 007.5 18.5z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ---------------------------------------------------------------- Zustand
let me = null;           // { id, name, isAdmin }
let S = null;            // { rev, users, lists: {id: list}, items: {id: item} }
let outbox = [];         // noch nicht übertragene Änderungen
const inflight = new Set();
let online = navigator.onLine;
let authed = false;      // Server hat Anmeldung bestätigt (oder offline mit gespeicherten Daten)
let es = null;           // EventSource
const recentlyDone = new Map(); // id -> Zeitpunkt, damit abgehakte Punkte kurz sichtbar bleiben
let prefs = loadJSON('notes.prefs', { showDone: {} });

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Speicher voll oder gesperrt */ }
}
const stateKey = () => `notes.state.${me.id}`;
const outboxKey = () => `notes.outbox.${me.id}`;
function saveState() { saveJSON(stateKey(), S); }
function saveOutbox() { saveJSON(outboxKey(), outbox); }
function savePrefs() { saveJSON('notes.prefs', prefs); }
function loadUserData() {
  S = loadJSON(stateKey(), null) || { rev: 0, users: [], lists: {}, items: {} };
  outbox = loadJSON(outboxKey(), []);
}

// ---------------------------------------------------------------- Server
async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    const err = new Error('Keine Verbindung');
    err.offline = true;
    throw err;
  }
  let data = {};
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.status = res.status;
    if (res.status >= 502 && res.status <= 504) err.offline = true; // Proxy erreicht Server nicht
    throw err;
  }
  return data;
}

function setOnline(v) {
  if (online === v) return;
  online = v;
  renderStatus();
}

function handleError(e) {
  if (e.offline) { setOnline(false); return; }
  if (e.status === 401) { authed = false; showAuth('login'); return; }
  toast(e.message || 'Etwas ist schiefgelaufen');
}

// ---------------------------------------------------------------- Änderungen (lokal zuerst)
function applyLocal(op) {
  const t = op.ts || Date.now();
  switch (op.kind) {
    case 'list.put': {
      const l = S.lists[op.id];
      if (!l) {
        S.lists[op.id] = {
          id: op.id, ownerId: me.id, name: op.name || 'Neue Liste', emoji: op.emoji || '📝',
          color: op.color || 'blue', created: t, sharedWith: [],
        };
      } else if (l.ownerId === me.id) {
        if (op.name !== undefined && op.name.trim()) l.name = op.name.trim();
        if (op.emoji !== undefined && op.emoji) l.emoji = op.emoji;
        if (op.color !== undefined && COLORS[op.color]) l.color = op.color;
      }
      break;
    }
    case 'list.delete': {
      delete S.lists[op.id];
      for (const id in S.items) if (S.items[id].listId === op.id) delete S.items[id];
      break;
    }
    case 'list.share': {
      const l = S.lists[op.id];
      if (l && l.ownerId === me.id) l.sharedWith = op.userIds.slice();
      break;
    }
    case 'list.clearDone': {
      for (const id in S.items) if (S.items[id].listId === op.id && S.items[id].done) delete S.items[id];
      break;
    }
    case 'item.put': {
      const f = op.fields || {};
      const it = S.items[op.id];
      if (!it) {
        if (!S.lists[f.listId]) break;
        S.items[op.id] = {
          id: op.id, listId: f.listId, title: f.title || '', done: !!f.done, doneAt: f.done ? t : null,
          note: f.note || '', due: f.due || null, position: f.position || 0, createdBy: me.id, created: t, updated: t,
        };
      } else {
        if (f.title !== undefined && f.title.trim()) it.title = f.title.trim();
        if (f.note !== undefined) it.note = f.note;
        if (f.due !== undefined) it.due = f.due || null;
        if (f.position !== undefined) it.position = f.position;
        if (f.listId !== undefined && S.lists[f.listId]) it.listId = f.listId;
        if (f.done !== undefined) {
          if (f.done && !it.done) it.doneAt = t;
          if (!f.done) it.doneAt = null;
          it.done = !!f.done;
        }
        it.updated = t;
      }
      break;
    }
    case 'item.delete': {
      delete S.items[op.id];
      break;
    }
    default:
  }
}

function enqueue(op) {
  const last = outbox[outbox.length - 1];
  if (op.kind === 'item.put' && last && last.kind === 'item.put' && last.id === op.id && !inflight.has(last.opId)) {
    Object.assign(last.fields, op.fields); // Tippen zusammenfassen
  } else {
    outbox.push(op);
  }
  saveOutbox();
}

function change(op) {
  op.opId = newId();
  op.ts = Date.now();
  applyLocal(op);
  enqueue(op);
  saveState();
  renderAll();
  flushSoon();
}

let flushTimer = null;
function flushSoon() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flush(), 60);
}

let flushing = null;
function flush() {
  if (flushing) return flushing;
  if (!outbox.length || !authed) return Promise.resolve();
  flushing = (async () => {
    while (outbox.length) {
      const batch = outbox.slice(0, 200);
      batch.forEach((o) => inflight.add(o.opId));
      try {
        await api('POST', '/api/ops', { ops: batch.map(({ ts, ...rest }) => rest) });
        const sent = new Set(batch.map((o) => o.opId));
        outbox = outbox.filter((o) => !sent.has(o.opId));
        saveOutbox();
        setOnline(true);
      } catch (e) {
        handleError(e);
        break;
      } finally {
        batch.forEach((o) => inflight.delete(o.opId));
      }
    }
  })();
  return flushing.finally(() => { flushing = null; renderStatus(); });
}

let syncing = false;
let syncAgain = false;
async function sync() {
  if (!authed) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  try {
    await flush();
    const d = await api('GET', `/api/sync?since=${S.rev || 0}`);
    mergeSync(d);
    setOnline(true);
  } catch (e) {
    handleError(e);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; sync(); }
  }
}

function mergeSync(d) {
  me = d.me;
  saveJSON('notes.me', me);
  S.users = d.users;
  const lists = {};
  for (const l of d.lists) lists[l.id] = l;
  S.lists = lists;
  if (d.full) S.items = {};
  for (const it of d.items) {
    if (it.deleted) delete S.items[it.id];
    else S.items[it.id] = it;
  }
  S.rev = d.rev;
  for (const op of outbox) applyLocal(op); // eigene, noch offene Änderungen bleiben sichtbar
  for (const id in S.items) if (!S.lists[S.items[id].listId]) delete S.items[id];
  saveState();
  renderAll();
}

function connectEvents() {
  if (es) { es.close(); es = null; }
  if (!authed) return;
  es = new EventSource('/api/events');
  es.addEventListener('rev', (ev) => {
    setOnline(true);
    if (Number(ev.data) !== S.rev || outbox.length) sync();
  });
  es.onerror = () => {
    // Der Browser verbindet sich selbst neu. Kurz prüfen, ob wir wirklich offline sind.
    if (es.readyState === EventSource.CLOSED) setTimeout(connectEvents, 5000);
    api('GET', '/api/status').then((s) => {
      setOnline(true);
      if (!s.user) { authed = false; showAuth('login'); }
    }).catch(handleError);
  };
}

window.addEventListener('online', () => { setOnline(true); sync(); });
window.addEventListener('offline', () => setOnline(false));
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
setInterval(() => { if (outbox.length || !online) sync(); }, 15000);

// ---------------------------------------------------------------- Hilfen für Anzeige
const listColor = (l) => COLORS[l?.color] || COLORS.blue;
const userName = (id) => (S.users.find((u) => u.id === id)?.name) || 'Unbekannt';
const initials = (name) => esc(String(name || '?').trim().slice(0, 1).toUpperCase());
const sortedLists = () => Object.values(S.lists).sort((a, b) => (a.created - b.created) || a.id.localeCompare(b.id));
const itemsOf = (listId) => Object.values(S.items).filter((i) => i.listId === listId);
const openCount = (listId) => itemsOf(listId).filter((i) => !i.done).length;

function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDay(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function dayDiff(s) { return Math.round((parseDay(s) - parseDay(todayStr())) / 86400000); }
function dueLabel(s) {
  const diff = dayDiff(s);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  const d = parseDay(s);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('de-DE', opts);
}
function dueClass(s) { const d = dayDiff(s); return d < 0 ? 'overdue' : d === 0 ? 'today' : ''; }
function shortDate(ts) { return new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }); }

function avatars(ids, max = 4) {
  return `<span class="avatars">${ids.slice(0, max).map((id) => `<span class="avatar" title="${esc(userName(id))}">${initials(userName(id))}</span>`).join('')}</span>`;
}

// ---------------------------------------------------------------- Navigation
const navStack = [location.hash || '#/'];
function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const p = h.split('/').filter(Boolean);
  if (p[0] === 'l' && p[1]) return { view: 'list', listId: p[1], itemId: p[2] === 'i' ? p[3] : null };
  if (p[0] === 'geplant') return { view: 'planned', itemId: p[1] === 'i' ? p[2] : null };
  if (p[0] === 'einstellungen') return { view: 'settings' };
  return { view: 'home' };
}
function go(hash) { if (location.hash !== hash) location.hash = hash; }
function goBack(fallback) {
  if (navStack.length > 1) history.back();
  else location.replace(fallback);
}
window.addEventListener('hashchange', () => {
  const h = location.hash || '#/';
  if (navStack.length > 1 && navStack[navStack.length - 2] === h) navStack.pop();
  else navStack.push(h);
  if (navStack.length > 50) navStack.splice(0, navStack.length - 50);
  closeSheet();
  renderAll(true);
});

// ---------------------------------------------------------------- Rendern
function renderAll(routeChanged = false) {
  if (!me || !S || !authed) return;
  const r = route();
  if (r.view === 'list' && !S.lists[r.listId]) { location.replace('#/'); return; }
  document.body.classList.toggle('r-home', r.view === 'home');
  const color = r.view === 'list' ? listColor(S.lists[r.listId]) : COLORS.blue;
  document.documentElement.style.setProperty('--c', color);
  renderSide(r);
  renderMain(r);
  renderPanel(r, routeChanged);
}

function keepFocus(fn) {
  const a = document.activeElement;
  const id = a && a.id;
  const val = a && 'value' in a ? a.value : null;
  const s = a && a.selectionStart;
  const e = a && a.selectionEnd;
  fn();
  if (id) {
    const el = document.getElementById(id);
    if (el && el !== a) {
      if (val !== null) el.value = val;
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(s, e); } catch { /* nicht jedes Feld */ }
    }
  }
}

function statusHtml() {
  if (!online) return `<span class="status off">${I.cloudOff}Offline${outbox.length ? ' · wird später übertragen' : ''}</span>`;
  if (outbox.length) return '<span class="status sync"><span class="dot"></span>Wird übertragen …</span>';
  return '';
}
function renderStatus() { document.querySelectorAll('[data-status]').forEach((el) => { el.innerHTML = statusHtml(); }); }

function renderSide(r) {
  const lists = sortedLists();
  const plannedCount = Object.values(S.items).filter((i) => !i.done && i.due).length;
  const html = `
    <header class="side-head">
      <div class="brand"><span class="logo">${I.check}</span>Notes</div>
      <a class="icon-btn" href="#/einstellungen" aria-label="Einstellungen"><span class="avatar me">${initials(me.name)}</span></a>
    </header>
    <div data-status class="status-wrap">${statusHtml()}</div>
    <nav class="lists">
      <a class="list-row smart ${r.view === 'planned' ? 'active' : ''}" href="#/geplant" style="--lc:${COLORS.tomato}">
        <span class="tile">${I.cal}</span><span class="name">Geplant</span>
        <span class="count">${plannedCount || ''}</span>
      </a>
      <div class="section-label">Listen</div>
      ${lists.map((l) => {
        const shared = l.ownerId !== me.id || l.sharedWith.length;
        return `<a class="list-row ${r.listId === l.id ? 'active' : ''}" href="#/l/${l.id}" style="--lc:${listColor(l)}">
          <span class="tile">${esc(l.emoji)}</span>
          <span class="name">${esc(l.name)}${shared ? `<span class="shared-ico" title="Geteilt">${I.users}</span>` : ''}</span>
          <span class="count">${openCount(l.id) || ''}</span>
        </a>`;
      }).join('')}
      ${lists.length ? '' : `<div class="empty-side">
        <p>Noch keine Listen. Leg mit einem Tipp los:</p>
        <div class="suggestions">${SUGGESTIONS.map((s, i) => `<button class="chip" data-action="suggest" data-i="${i}" style="--lc:${COLORS[s.color]}">${s.emoji} ${esc(s.name)}</button>`).join('')}</div>
      </div>`}
    </nav>
    <button class="new-list" data-action="new-list">${I.plus}<span>Neue Liste</span></button>`;
  $('#side').innerHTML = html;
}

function itemRow(it, opts = {}) {
  const l = S.lists[it.listId];
  const lingering = recentlyDone.has(it.id);
  const href = opts.planned ? `#/geplant/i/${it.id}` : `#/l/${it.listId}/i/${it.id}`;
  const meta = [];
  if (opts.planned && l) meta.push(`<span class="meta-list" style="--lc:${listColor(l)}">${esc(l.emoji)} ${esc(l.name)}</span>`);
  if (it.due) meta.push(`<span class="due ${it.done ? '' : dueClass(it.due)}">${I.cal}${esc(dueLabel(it.due))}</span>`);
  if (it.note && it.note.trim()) meta.push(`<span class="has-note">${I.note}</span>`);
  if (l && (l.ownerId !== me.id || l.sharedWith.length) && it.createdBy && it.createdBy !== me.id) {
    meta.push(`<span class="by">${esc(userName(it.createdBy))}</span>`);
  }
  return `<div class="item ${it.done ? 'done' : ''} ${lingering ? 'lingering' : ''}" data-id="${it.id}" style="--lc:${listColor(l)}">
    <button class="check" data-action="toggle" data-id="${it.id}" aria-label="${it.done ? 'Wieder öffnen' : 'Abhaken'}">${I.check}</button>
    <a class="item-body" href="${href}">
      <span class="title">${esc(it.title)}</span>
      ${meta.length ? `<span class="meta">${meta.join('')}</span>` : ''}
    </a>
  </div>`;
}

function renderMain(r) {
  keepFocus(() => {
    if (r.view === 'list') $('#main').innerHTML = listView(S.lists[r.listId]);
    else if (r.view === 'planned') $('#main').innerHTML = plannedView();
    else if (r.view === 'settings') $('#main').innerHTML = settingsView();
    else $('#main').innerHTML = welcomeView();
  });
}

function listView(l) {
  const items = itemsOf(l.id);
  const open = items.filter((i) => !i.done || recentlyDone.has(i.id)).sort((a, b) => (a.position - b.position) || (a.created - b.created));
  const done = items.filter((i) => i.done && !recentlyDone.has(i.id)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const showDone = !!prefs.showDone[l.id];
  const isOwner = l.ownerId === me.id;
  const people = isOwner ? l.sharedWith : [l.ownerId, ...l.sharedWith.filter((id) => id !== me.id)];
  return `
    <header class="list-head">
      <button class="icon-btn back" data-action="back" aria-label="Zurück">${I.back}</button>
      <div class="list-title"><span class="big-emoji">${esc(l.emoji)}</span><h1>${esc(l.name)}</h1></div>
      ${people.length ? `<button class="people" data-action="${isOwner ? 'share' : 'list-menu'}" aria-label="Geteilt mit">${avatars(people)}</button>` : ''}
      <button class="icon-btn" data-action="list-menu" aria-label="Listenmenü">${I.more}</button>
    </header>
    <div data-status class="status-wrap inline">${statusHtml()}</div>
    <section class="items">
      ${open.map((i) => itemRow(i)).join('')}
      ${!open.length && !done.length ? `<div class="empty"><span class="empty-emoji">${esc(l.emoji)}</span><p>Noch leer. Schreib unten den ersten Punkt hinein.</p></div>` : ''}
      ${!open.length && done.length ? '<div class="empty small"><p>Alles erledigt. 🎉</p></div>' : ''}
    </section>
    ${done.length ? `
      <button class="done-toggle ${showDone ? 'open' : ''}" data-action="toggle-done" data-id="${l.id}">${I.chevron}Erledigt <span class="n">${done.length}</span></button>
      ${showDone ? `<section class="items done-list">${done.map((i) => itemRow(i)).join('')}</section>` : ''}` : ''}
    <div class="spacer"></div>
    <form class="addbar" data-form="add" data-list="${l.id}" autocomplete="off">
      <span class="add-plus">${I.plus}</span>
      <input id="add-input" name="title" placeholder="Punkt hinzufügen" enterkeyhint="enter" autocomplete="off" autocapitalize="sentences" maxlength="500">
      <button class="add-btn" type="submit" aria-label="Hinzufügen">${I.plus}</button>
    </form>`;
}

function plannedView() {
  const items = Object.values(S.items).filter((i) => i.due && (!i.done || recentlyDone.has(i.id)))
    .sort((a, b) => a.due.localeCompare(b.due) || (a.created - b.created));
  const groups = [
    { label: 'Überfällig', test: (d) => d < 0 },
    { label: 'Heute', test: (d) => d === 0 },
    { label: 'Morgen', test: (d) => d === 1 },
    { label: 'Diese Woche', test: (d) => d > 1 && d <= 7 },
    { label: 'Später', test: (d) => d > 7 },
  ];
  const body = groups.map((g) => {
    const list = items.filter((i) => g.test(dayDiff(i.due)));
    if (!list.length) return '';
    return `<div class="group-label ${g.label === 'Überfällig' ? 'overdue' : ''}">${g.label}</div>
      <section class="items">${list.map((i) => itemRow(i, { planned: true })).join('')}</section>`;
  }).join('');
  return `
    <header class="list-head" style="--c:${COLORS.tomato}">
      <button class="icon-btn back" data-action="back" aria-label="Zurück">${I.back}</button>
      <div class="list-title"><span class="big-emoji">📅</span><h1>Geplant</h1></div>
    </header>
    <div data-status class="status-wrap inline">${statusHtml()}</div>
    ${body || '<div class="empty"><span class="empty-emoji">📅</span><p>Nichts geplant. Punkte mit Fälligkeitsdatum erscheinen hier – aus allen Listen.</p></div>'}`;
}

function welcomeView() {
  return `<div class="welcome"><span class="logo big">${I.check}</span><p>Wähle links eine Liste.</p></div>`;
}

function settingsView() {
  const others = S.users.filter((u) => u.id !== me.id);
  return `
    <header class="list-head">
      <button class="icon-btn back" data-action="back" aria-label="Zurück">${I.back}</button>
      <div class="list-title"><h1>Einstellungen</h1></div>
    </header>
    <div class="settings">
      <section class="card">
        <div class="me-row"><span class="avatar me big">${initials(me.name)}</span>
          <div><strong>${esc(me.name)}</strong><div class="muted">${me.isAdmin ? 'Verwalter' : 'Familienmitglied'}</div></div></div>
      </section>

      <section class="card">
        <h2>Passwort ändern</h2>
        <form data-form="password" class="stack">
          <input type="password" name="old" placeholder="Bisheriges Passwort" autocomplete="current-password" required>
          <input type="password" name="password" placeholder="Neues Passwort (mind. 6 Zeichen)" autocomplete="new-password" minlength="6" required>
          <button class="btn primary" type="submit">Speichern</button>
        </form>
      </section>

      ${me.isAdmin ? `
      <section class="card">
        <h2>Familie</h2>
        <p class="muted">Jede Person hat eigene Listen und kann sie mit anderen teilen.</p>
        <ul class="people-list">
          <li><span class="avatar">${initials(me.name)}</span><span>${esc(me.name)} <span class="muted">(du)</span></span></li>
          ${others.map((u) => `<li><span class="avatar">${initials(u.name)}</span><span>${esc(u.name)}</span>
            <button class="btn small" data-action="reset-pw" data-id="${u.id}">Passwort setzen</button></li>`).join('')}
        </ul>
        <form data-form="add-user" class="stack">
          <input name="name" placeholder="Name" autocomplete="off" maxlength="40" required>
          <input type="password" name="password" placeholder="Passwort (mind. 6 Zeichen)" autocomplete="new-password" minlength="6" required>
          <button class="btn primary" type="submit">Person hinzufügen</button>
        </form>
      </section>` : ''}

      <section class="card">
        <h2>Auf dem Handy installieren</h2>
        <p class="muted">Im Browser-Menü <strong>„Zum Startbildschirm hinzufügen“</strong> bzw. <strong>„App installieren“</strong> wählen. Dann startet Notes wie eine eigene App und funktioniert auch ohne Netz.</p>
      </section>

      <button class="btn danger wide" data-action="logout">Abmelden</button>
    </div>`;
}

// ---------------------------------------------------------------- Detailansicht eines Punkts
let panelItemId = null;
function renderPanel(r, routeChanged) {
  const panel = $('#panel');
  const id = r.itemId;
  const it = id && S.items[id];
  if (!it) {
    if (!panel.hidden) { panel.hidden = true; panel.innerHTML = ''; document.body.classList.remove('panel-open'); }
    panelItemId = null;
    if (id) { // Punkt wurde gelöscht (z. B. von jemand anderem)
      const base = r.view === 'planned' ? '#/geplant' : `#/l/${r.listId}`;
      location.replace(base);
    }
    return;
  }
  const focused = panel.contains(document.activeElement) && document.activeElement !== document.body;
  if (!routeChanged && panelItemId === id && focused) {
    // Während getippt wird nur die Abhaken-Schaltfläche aktualisieren
    const c = panel.querySelector('.detail-check');
    if (c) c.closest('.detail').classList.toggle('done', it.done);
    return;
  }
  panelItemId = id;
  const l = S.lists[it.listId];
  const lists = sortedLists();
  panel.style.setProperty('--lc', listColor(l));
  panel.innerHTML = `
    <div class="panel-backdrop" data-action="close-panel"></div>
    <div class="panel-card detail ${it.done ? 'done' : ''}" role="dialog" aria-label="Details">
      <header class="panel-head">
        <button class="icon-btn" data-action="close-panel" aria-label="Schließen">${I.close}</button>
        <span class="panel-list">${esc(l.emoji)} ${esc(l.name)}</span>
        <button class="icon-btn danger" data-action="delete-item" data-id="${it.id}" aria-label="Löschen">${I.trash}</button>
      </header>
      <div class="detail-title">
        <button class="check detail-check" data-action="toggle" data-id="${it.id}" aria-label="Abhaken">${I.check}</button>
        <textarea id="d-title" rows="1" maxlength="500" placeholder="Titel">${esc(it.title)}</textarea>
      </div>

      <div class="field">
        <div class="field-label">${I.cal}Fällig</div>
        <div class="due-row">
          <input type="date" id="d-due" value="${esc(it.due || '')}">
          ${it.due ? `<button class="btn small ghost" data-action="set-due" data-due="">Entfernen</button>` : ''}
        </div>
        <div class="quick">
          <button class="chip" data-action="set-due" data-due="${todayStr()}">Heute</button>
          <button class="chip" data-action="set-due" data-due="${todayStr(1)}">Morgen</button>
          <button class="chip" data-action="set-due" data-due="${todayStr(7)}">In einer Woche</button>
        </div>
      </div>

      <div class="field">
        <div class="field-label">${I.note}Notiz</div>
        <textarea id="d-note" rows="4" placeholder="Notiz, Link, Menge …">${esc(it.note || '')}</textarea>
      </div>

      ${lists.length > 1 ? `<div class="field">
        <div class="field-label">Liste</div>
        <select id="d-list">${lists.map((x) => `<option value="${x.id}" ${x.id === it.listId ? 'selected' : ''}>${esc(x.emoji)} ${esc(x.name)}</option>`).join('')}</select>
      </div>` : ''}

      <p class="muted small">Hinzugefügt von ${esc(it.createdBy === me.id ? 'dir' : userName(it.createdBy))} am ${shortDate(it.created)}</p>
    </div>`;
  panel.hidden = false;
  document.body.classList.add('panel-open');
  autosize($('#d-title'));
  autosize($('#d-note'));
}

function autosize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

const typingTimers = {};
function debounced(key, fn, ms = 400) {
  clearTimeout(typingTimers[key]);
  typingTimers[key] = setTimeout(fn, ms);
}
function flushTyping() {
  for (const k in typingTimers) { clearTimeout(typingTimers[k]); }
  const t = $('#d-title');
  const n = $('#d-note');
  if (panelItemId && S.items[panelItemId]) {
    const it = S.items[panelItemId];
    const f = {};
    if (t && t.value.trim() && t.value.trim() !== it.title) f.title = t.value.trim();
    if (n && n.value !== it.note) f.note = n.value;
    if (Object.keys(f).length) change({ kind: 'item.put', id: panelItemId, fields: f });
  }
}

function closePanel() {
  flushTyping();
  const r = route();
  goBack(r.view === 'planned' ? '#/geplant' : `#/l/${r.listId}`);
}

// ---------------------------------------------------------------- Aktionen
function toggleItem(id) {
  const it = S.items[id];
  if (!it) return;
  const done = !it.done;
  if (done) {
    recentlyDone.set(id, Date.now());
    setTimeout(() => { recentlyDone.delete(id); renderAll(); }, 900);
    if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* egal */ }
  } else {
    recentlyDone.delete(id);
  }
  const fields = { done };
  if (!done) fields.position = nextPosition(it.listId);
  change({ kind: 'item.put', id, fields });
}

function nextPosition(listId) {
  const items = itemsOf(listId);
  return items.length ? Math.max(...items.map((i) => i.position || 0)) + 1 : 1;
}

function addItems(listId, raw) {
  const titles = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const title of titles) {
    // Gibt es den Punkt schon als erledigt? Dann einfach wieder öffnen (z. B. „Milch“ auf der Einkaufsliste)
    const existing = itemsOf(listId).find((i) => i.done && i.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      change({ kind: 'item.put', id: existing.id, fields: { done: false, position: nextPosition(listId) } });
      continue;
    }
    const already = itemsOf(listId).find((i) => !i.done && i.title.toLowerCase() === title.toLowerCase());
    if (already) { toast(`„${title}“ steht schon drauf`); continue; }
    change({ kind: 'item.put', id: newId(), fields: { listId, title, position: nextPosition(listId) } });
  }
  const box = $('.items');
  if (box) requestAnimationFrame(() => { const last = box.querySelector('.item:last-of-type'); if (last) last.scrollIntoView({ block: 'nearest' }); });
}

function createList({ name, emoji, color }) {
  const id = newId();
  change({ kind: 'list.put', id, name, emoji, color });
  go(`#/l/${id}`);
}

// ---------------------------------------------------------------- Dialoge (Sheets)
function openSheet(html, onMount) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div><div class="sheet-card" role="dialog">${html}</div>`;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('show'));
  if (onMount) onMount(sheet);
}
function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.classList.remove('show');
  sheet.hidden = true;
  sheet.innerHTML = '';
}

function confirmSheet(text, okLabel, danger = true) {
  return new Promise((resolve) => {
    openSheet(`<p class="sheet-text">${text}</p>
      <div class="sheet-actions">
        <button class="btn" data-x="no">Abbrechen</button>
        <button class="btn ${danger ? 'danger-fill' : 'primary'}" data-x="yes">${esc(okLabel)}</button>
      </div>`, (sheet) => {
      sheet.querySelector('[data-x="no"]').onclick = () => { closeSheet(); resolve(false); };
      sheet.querySelector('[data-x="yes"]').onclick = () => { closeSheet(); resolve(true); };
      sheet.querySelector('.sheet-backdrop').onclick = () => { closeSheet(); resolve(false); };
    });
  });
}

function listEditSheet(list) {
  const cur = list ? { ...list } : { name: '', emoji: '📝', color: 'blue' };
  const html = `
    <h2>${list ? 'Liste bearbeiten' : 'Neue Liste'}</h2>
    <form data-form="list" class="stack">
      <div class="name-row"><span class="tile big" id="le-preview" style="--lc:${COLORS[cur.color]}">${esc(cur.emoji)}</span>
        <input name="name" id="le-name" value="${esc(cur.name)}" placeholder="Name der Liste" maxlength="100" required autocomplete="off"></div>
      <div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" class="emoji-btn ${e === cur.emoji ? 'sel' : ''}" data-emoji="${e}">${e}</button>`).join('')}</div>
      <div class="color-row">${Object.entries(COLORS).map(([k, v]) => `<button type="button" class="swatch ${k === cur.color ? 'sel' : ''}" data-color="${k}" style="--sw:${v}" aria-label="${k}"></button>`).join('')}</div>
      <div class="sheet-actions">
        <button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
        <button type="submit" class="btn primary">${list ? 'Speichern' : 'Erstellen'}</button>
      </div>
    </form>`;
  openSheet(html, (sheet) => {
    const form = sheet.querySelector('form');
    const preview = sheet.querySelector('#le-preview');
    sheet.querySelectorAll('[data-emoji]').forEach((b) => b.addEventListener('click', () => {
      cur.emoji = b.dataset.emoji;
      sheet.querySelectorAll('[data-emoji]').forEach((x) => x.classList.toggle('sel', x === b));
      preview.textContent = cur.emoji;
    }));
    sheet.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
      cur.color = b.dataset.color;
      sheet.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('sel', x === b));
      preview.style.setProperty('--lc', COLORS[cur.color]);
    }));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = form.name.value.trim();
      if (!name) return;
      closeSheet();
      if (list) change({ kind: 'list.put', id: list.id, name, emoji: cur.emoji, color: cur.color });
      else createList({ name, emoji: cur.emoji, color: cur.color });
    });
    if (!list) setTimeout(() => sheet.querySelector('#le-name').focus(), 50);
  });
}

function shareSheet(list) {
  const others = S.users.filter((u) => u.id !== me.id);
  const sel = new Set(list.sharedWith);
  const html = `
    <h2>„${esc(list.name)}“ teilen</h2>
    ${others.length ? `<p class="muted">Wer soll die Liste sehen und bearbeiten können?</p>
    <div class="share-list">${others.map((u) => `
      <label class="share-row"><span class="avatar">${initials(u.name)}</span><span class="grow">${esc(u.name)}</span>
        <input type="checkbox" value="${u.id}" ${sel.has(u.id) ? 'checked' : ''}><span class="switch"></span></label>`).join('')}</div>
    <div class="sheet-actions">
      <button class="btn" data-action="close-sheet">Abbrechen</button>
      <button class="btn primary" data-x="save">Speichern</button>
    </div>` : `<p class="muted">Es gibt noch keine weiteren Personen. ${me.isAdmin ? 'In den Einstellungen kannst du Familienmitglieder hinzufügen.' : 'Bitte den Verwalter, Personen hinzuzufügen.'}</p>
    <div class="sheet-actions">${me.isAdmin ? '<a class="btn primary" href="#/einstellungen">Zu den Einstellungen</a>' : '<button class="btn" data-action="close-sheet">OK</button>'}</div>`}`;
  openSheet(html, (sheet) => {
    const save = sheet.querySelector('[data-x="save"]');
    if (save) save.onclick = () => {
      const ids = [...sheet.querySelectorAll('input[type=checkbox]:checked')].map((c) => Number(c.value));
      closeSheet();
      change({ kind: 'list.share', id: list.id, userIds: ids });
      toast(ids.length ? 'Geteilt' : 'Nicht mehr geteilt');
    };
  });
}

function listMenu(list) {
  const isOwner = list.ownerId === me.id;
  const doneCount = itemsOf(list.id).filter((i) => i.done).length;
  const html = `
    <div class="menu-head"><span class="tile" style="--lc:${listColor(list)}">${esc(list.emoji)}</span><strong>${esc(list.name)}</strong></div>
    ${isOwner ? '' : `<p class="muted small">Geteilt von ${esc(userName(list.ownerId))}</p>`}
    <div class="menu">
      ${isOwner ? `<button data-m="edit">✏️ Name, Symbol & Farbe</button>
      <button data-m="share">👥 Teilen${list.sharedWith.length ? ` <span class="muted">(${list.sharedWith.length})</span>` : ''}</button>` : ''}
      ${doneCount ? `<button data-m="clear">🧹 Erledigte löschen <span class="muted">(${doneCount})</span></button>` : ''}
      ${isOwner ? '<button data-m="delete" class="danger">🗑️ Liste löschen</button>' : '<button data-m="leave" class="danger">🚪 Liste verlassen</button>'}
    </div>`;
  openSheet(html, (sheet) => {
    sheet.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', async () => {
      const m = b.dataset.m;
      closeSheet();
      if (m === 'edit') listEditSheet(list);
      if (m === 'share') shareSheet(list);
      if (m === 'clear') {
        if (await confirmSheet(`${doneCount} erledigte ${doneCount === 1 ? 'Punkt' : 'Punkte'} endgültig löschen?`, 'Löschen')) {
          change({ kind: 'list.clearDone', id: list.id });
        }
      }
      if (m === 'delete') {
        if (await confirmSheet(`„${esc(list.name)}“ mit allen Punkten löschen?${list.sharedWith.length ? ' Sie verschwindet auch bei allen, mit denen sie geteilt ist.' : ''}`, 'Liste löschen')) {
          location.replace('#/');
          change({ kind: 'list.delete', id: list.id });
        }
      }
      if (m === 'leave') {
        if (await confirmSheet(`„${esc(list.name)}“ verlassen? Die Liste bleibt bei ${esc(userName(list.ownerId))} erhalten.`, 'Verlassen')) {
          location.replace('#/');
          change({ kind: 'list.delete', id: list.id });
        }
      }
    }));
  });
}

function resetPwSheet(user) {
  openSheet(`<h2>Passwort für ${esc(user.name)}</h2>
    <form class="stack" data-x="form">
      <input type="password" name="password" placeholder="Neues Passwort (mind. 6 Zeichen)" minlength="6" required autocomplete="new-password">
      <div class="sheet-actions"><button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
      <button class="btn primary" type="submit">Speichern</button></div>
    </form>`, (sheet) => {
    const form = sheet.querySelector('form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api('POST', '/api/users/password', { id: user.id, password: form.password.value });
        closeSheet();
        toast('Passwort gesetzt');
      } catch (e) { toast(e.offline ? 'Dafür brauchst du eine Verbindung' : e.message); }
    });
  });
}

// ---------------------------------------------------------------- Ereignisse
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const r = route();
  const list = r.view === 'list' ? S.lists[r.listId] : null;
  switch (a) {
    case 'toggle': ev.preventDefault(); toggleItem(el.dataset.id); break;
    case 'back': goBack('#/'); break;
    case 'new-list': listEditSheet(null); break;
    case 'suggest': createList(SUGGESTIONS[Number(el.dataset.i)]); break;
    case 'list-menu': if (list) listMenu(list); break;
    case 'share': if (list) shareSheet(list); break;
    case 'toggle-done':
      prefs.showDone[el.dataset.id] = !prefs.showDone[el.dataset.id];
      savePrefs();
      renderAll();
      break;
    case 'close-panel': closePanel(); break;
    case 'close-sheet': closeSheet(); break;
    case 'delete-item': {
      const id = el.dataset.id;
      const it = S.items[id];
      if (!it) break;
      for (const k in typingTimers) clearTimeout(typingTimers[k]);
      panelItemId = null;
      closePanel();
      change({ kind: 'item.delete', id });
      toastUndo(`„${it.title}“ gelöscht`, () => {
        change({ kind: 'item.put', id: newId(), fields: { listId: it.listId, title: it.title, note: it.note, due: it.due, position: it.position, done: it.done } });
      });
      break;
    }
    case 'set-due': {
      if (!panelItemId) break;
      change({ kind: 'item.put', id: panelItemId, fields: { due: el.dataset.due || null } });
      renderAll(true);
      break;
    }
    case 'reset-pw': {
      const u = S.users.find((x) => x.id === Number(el.dataset.id));
      if (u) resetPwSheet(u);
      break;
    }
    case 'logout': logout(); break;
    default:
  }
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  const kind = form.dataset.form;
  if (kind === 'list') return; // eigener Handler im Sheet
  ev.preventDefault();
  if (kind === 'add') {
    const input = form.querySelector('input');
    const v = input.value;
    if (!v.trim()) return;
    input.value = '';
    addItems(form.dataset.list, v);
    input.focus();
  }
  if (kind === 'password') {
    try {
      await api('POST', '/api/password', { old: form.old.value, password: form.password.value });
      form.reset();
      toast('Passwort geändert');
    } catch (e) { toast(e.offline ? 'Dafür brauchst du eine Verbindung' : e.message); }
  }
  if (kind === 'add-user') {
    try {
      await api('POST', '/api/users', { name: form.name.value, password: form.password.value });
      toast(`${form.name.value.trim()} hinzugefügt`);
      form.reset();
      sync();
    } catch (e) { toast(e.offline ? 'Dafür brauchst du eine Verbindung' : e.message); }
  }
});

document.addEventListener('paste', (ev) => {
  // Mehrere Zeilen einfügen = mehrere Punkte
  const input = ev.target;
  if (input.id !== 'add-input') return;
  const t = (ev.clipboardData || window.clipboardData).getData('text');
  if (t && /\n/.test(t.trim())) {
    ev.preventDefault();
    addItems(input.form.dataset.list, t);
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!panelItemId) return;
  if (el.id === 'd-title') {
    autosize(el);
    debounced('title', () => {
      const v = el.value.replace(/\n/g, ' ').trim();
      if (v && S.items[panelItemId] && v !== S.items[panelItemId].title) change({ kind: 'item.put', id: panelItemId, fields: { title: v } });
    });
  }
  if (el.id === 'd-note') {
    autosize(el);
    debounced('note', () => {
      if (S.items[panelItemId] && el.value !== S.items[panelItemId].note) change({ kind: 'item.put', id: panelItemId, fields: { note: el.value } });
    }, 600);
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.target.id === 'd-title' && ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); }
  if (ev.key === 'Escape') {
    if (!$('#sheet').hidden) closeSheet();
    else if (panelItemId) closePanel();
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (!panelItemId) return;
  if (el.id === 'd-due') {
    change({ kind: 'item.put', id: panelItemId, fields: { due: el.value || null } });
    renderAll(true);
  }
  if (el.id === 'd-list') {
    const id = panelItemId;
    change({ kind: 'item.put', id, fields: { listId: el.value, position: nextPosition(el.value) } });
    const r = route();
    if (r.view === 'list') location.replace(`#/l/${el.value}/i/${id}`);
    toast(`Verschoben nach „${S.lists[el.value].name}“`);
  }
});

window.addEventListener('pagehide', flushTyping);

// ---------------------------------------------------------------- Hinweise
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function toastUndo(msg, undo) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span><button>Rückgängig</button>`;
  t.classList.add('show');
  t.querySelector('button').onclick = () => { undo(); t.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
}

// ---------------------------------------------------------------- Anmeldung
function showAuth(mode, offlineNote = false) {
  if (es) { es.close(); es = null; }
  document.body.className = 'auth';
  $('#panel').hidden = true;
  const setup = mode === 'setup';
  $('#side').innerHTML = '';
  $('#main').innerHTML = `
    <div class="auth-box">
      <span class="logo big">${I.check}</span>
      <h1>${setup ? 'Willkommen bei Notes' : 'Notes'}</h1>
      <p class="muted">${setup ? 'Lege dein Konto an. Du wirst Verwalter und kannst danach die Familie hinzufügen.' : 'Bitte anmelden.'}</p>
      ${offlineNote ? '<p class="note">Keine Verbindung zum Server. Bitte später erneut versuchen.</p>' : ''}
      <form id="auth-form" class="stack">
        <input name="name" placeholder="Name" autocomplete="username" autocapitalize="words" maxlength="40" required>
        <input type="password" name="password" placeholder="Passwort${setup ? ' (mind. 6 Zeichen)' : ''}" autocomplete="${setup ? 'new-password' : 'current-password'}" required>
        ${setup ? '<input type="password" name="password2" placeholder="Passwort wiederholen" autocomplete="new-password" required>' : ''}
        <button class="btn primary wide" type="submit">${setup ? 'Konto anlegen' : 'Anmelden'}</button>
        <p class="auth-error" id="auth-error"></p>
      </form>
    </div>`;
  const form = $('#auth-form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#auth-error');
    err.textContent = '';
    if (setup && form.password.value !== form.password2.value) { err.textContent = 'Die Passwörter stimmen nicht überein.'; return; }
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const d = await api('POST', setup ? '/api/setup' : '/api/login', { name: form.name.value, password: form.password.value });
      startApp(d.user);
    } catch (e) {
      err.textContent = e.offline ? 'Keine Verbindung zum Server.' : e.message;
    } finally { btn.disabled = false; }
  });
}

function startApp(user) {
  me = user;
  saveJSON('notes.me', me);
  loadUserData();
  authed = true;
  document.body.className = '';
  renderAll(true);
  connectEvents();
  sync();
}

async function logout() {
  if (outbox.length && !(await confirmSheet('Es gibt noch nicht übertragene Änderungen. Trotzdem abmelden? Sie gehen dann verloren.', 'Abmelden'))) return;
  try { await api('POST', '/api/logout'); } catch { /* auch offline lokal abmelden */ }
  try {
    localStorage.removeItem(stateKey());
    localStorage.removeItem(outboxKey());
    localStorage.removeItem('notes.me');
  } catch { /* egal */ }
  me = null; S = null; outbox = []; authed = false;
  location.replace('#/');
  showAuth('login');
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const saved = loadJSON('notes.me', null);
  if (saved) {
    // Sofort mit den gespeicherten Daten starten – auch ohne Netz
    me = saved;
    loadUserData();
    authed = true;
    renderAll(true);
    try {
      const s = await api('GET', '/api/status');
      if (!s.user) { authed = false; showAuth(s.setup ? 'setup' : 'login'); return; }
      if (s.user.id !== me.id) { startApp(s.user); return; }
      me = s.user;
      setOnline(true);
    } catch (e) {
      setOnline(false);
    }
    connectEvents();
    sync();
    return;
  }
  try {
    const s = await api('GET', '/api/status');
    if (s.user) startApp(s.user);
    else showAuth(s.setup ? 'setup' : 'login');
  } catch {
    showAuth('login', true);
  }
}

boot();
