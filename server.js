// zero-dependency server: static files + tiny JSON API for accounts & thoughts
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const SESSION_DAYS = 180;

// ---------- storage: one JSON file, written atomically ----------

fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { users: {}, sessions: {}, entries: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) }; } catch { /* fresh start */ }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_PATH + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), (err) => {
      if (!err) fs.rename(tmp, DB_PATH, () => {});
    });
  }, 150);
}
process.on('SIGTERM', () => {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db)); } catch { /* best effort */ }
  process.exit(0);
});

for (const [token, s] of Object.entries(db.sessions)) {
  if (Date.now() - s.created > SESSION_DAYS * 86400e3) delete db.sessions[token];
}

// ---------- push reminders (daily 20:00 local, if no thought yet) ----------

let webpush = null;
try { webpush = require('web-push'); } catch { console.warn('web-push not installed — reminders disabled'); }

if (webpush) {
  db.vapid ||= webpush.generateVAPIDKeys();
  db.push ||= {};
  db.push.subs ||= {};          // username -> [{ subscription, tz }]
  db.push.lastReminder ||= {};  // username -> 'YYYY-MM-DD' (local) last handled
  persist();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:reminders@thype.app',
    db.vapid.publicKey, db.vapid.privateKey);
  setInterval(() => remindTick().catch(() => {}), Number(process.env.REMIND_TICK_MS) || 60e3);
}

function localStamp(ts, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    }).formatToParts(new Date(ts));
    const get = (t) => parts.find(p => p.type === t)?.value;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: +get('hour') % 24 };
  } catch { return null; }
}

async function remindTick() {
  const now = Date.now();
  for (const [user, subs] of Object.entries(db.push.subs)) {
    if (!subs?.length) continue;
    for (const sub of subs) {
      const loc = localStamp(now, sub.tz || 'UTC');
      if (!loc || loc.hour !== 20) continue;
      if (db.push.lastReminder[user] === loc.date) continue;
      db.push.lastReminder[user] = loc.date;   // handled for today, sent or not
      persist();
      const wrote = Object.values(db.entries[user] || {})
        .some(e => localStamp(e.created, sub.tz || 'UTC')?.date === loc.date);
      if (wrote) break;
      for (const target of [...subs]) {
        try {
          await webpush.sendNotification(target.subscription, JSON.stringify({
            title: 'thype',
            body: 'the stars are out — no thought written today',
          }));
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            db.push.subs[user] = db.push.subs[user].filter(x => x !== target);
            persist();
          }
        }
      }
      break;
    }
  }
}

// ---------- auth helpers ----------

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, rec) {
  try {
    return crypto.timingSafeEqual(crypto.scryptSync(password, rec.salt, 64), Buffer.from(rec.hash, 'hex'));
  } catch {
    return false;
  }
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function sessionUser(req) {
  const token = cookies(req).thype_session;
  return (token && db.sessions[token]?.user) || null;
}

function startSession(req, res, username) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { user: username, created: Date.now() };
  persist();
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `thype_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

// naive per-IP throttle on credential endpoints
const attempts = new Map();
function throttled(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '?';
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.t > 600e3) { attempts.set(ip, { n: 1, t: now }); return false; }
  a.n += 1;
  return a.n > 30;
}

// ---------- http helpers ----------

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 256 * 1024) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function cleanEntry(id, b) {
  if (typeof b !== 'object' || b === null) return null;
  const text = String(b.text ?? '').slice(0, 20000);
  if (!text.trim()) return null;
  const rawThemes = Array.isArray(b.themes) ? b.themes : b.theme ? [b.theme] : [];
  const themes = [...new Set(rawThemes.map(t => String(t).toLowerCase().trim().slice(0, 40)).filter(Boolean))].slice(0, 5);
  return {
    id,
    text,
    created: Number(b.created) || Date.now(),
    title: String(b.title ?? '').slice(0, 200),
    themes,
    aiPending: !!b.aiPending,
  };
}

// ---------- api ----------

async function handleApi(req, res, url) {
  const route = url.pathname.slice(4); // strip "/api"
  const method = req.method;

  if (method !== 'GET' && req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'forbidden' });
    } catch { return json(res, 403, { error: 'forbidden' }); }
  }

  if (method === 'POST' && (route === '/register' || route === '/login')) {
    if (throttled(req)) return json(res, 429, { error: 'too many tries — rest a while' });
    const body = await readBody(req);
    const username = String(body.username ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!/^[a-z0-9_.-]{2,32}$/.test(username)) return json(res, 400, { error: 'name: 2–32 letters, numbers, _ . -' });
    if (password.length < 6 || password.length > 200) return json(res, 400, { error: 'secret must be at least 6 characters' });

    if (route === '/register') {
      if (db.users[username]) return json(res, 409, { error: 'that name is already among the stars' });
      db.users[username] = { pass: hashPassword(password), created: Date.now() };
      db.entries[username] = {};
    } else if (!db.users[username] || !verifyPassword(password, db.users[username].pass)) {
      return json(res, 401, { error: 'wrong name or secret' });
    }
    startSession(req, res, username);
    return json(res, 200, { username });
  }

  if (method === 'POST' && route === '/logout') {
    const token = cookies(req).thype_session;
    if (token) { delete db.sessions[token]; persist(); }
    res.setHeader('Set-Cookie', 'thype_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return json(res, 200, {});
  }

  const user = sessionUser(req);
  if (route === '/me' && method === 'GET') {
    return user ? json(res, 200, { username: user }) : json(res, 401, { error: 'sign in first' });
  }
  if (!user) return json(res, 401, { error: 'sign in first' });

  if (route === '/entries' && method === 'GET') {
    const list = Object.values(db.entries[user] || {}).sort((a, b) => b.created - a.created);
    return json(res, 200, list);
  }

  if (route === '/push/key' && method === 'GET') {
    return webpush ? json(res, 200, { key: db.vapid.publicKey })
      : json(res, 503, { error: 'reminders unavailable' });
  }
  if (route === '/push/subscribe' && method === 'POST' && webpush) {
    const b = await readBody(req);
    if (!b.subscription?.endpoint) return json(res, 400, { error: 'bad subscription' });
    const tz = String(b.tz || 'UTC').slice(0, 64);
    db.push.subs[user] = (db.push.subs[user] || [])
      .filter(s => s.subscription.endpoint !== b.subscription.endpoint);
    db.push.subs[user].push({ subscription: b.subscription, tz });
    persist();
    return json(res, 200, {});
  }
  if (route === '/push/unsubscribe' && method === 'POST' && webpush) {
    const b = await readBody(req);
    db.push.subs[user] = (db.push.subs[user] || [])
      .filter(s => s.subscription.endpoint !== b.endpoint);
    persist();
    return json(res, 200, {});
  }

  const m = route.match(/^\/entries\/([A-Za-z0-9_-]{1,64})$/);
  if (m && method === 'PUT') {
    const entry = cleanEntry(m[1], await readBody(req));
    if (!entry) return json(res, 400, { error: 'empty thought' });
    (db.entries[user] ||= {})[entry.id] = entry;
    persist();
    return json(res, 200, entry);
  }
  if (m && method === 'DELETE') {
    delete (db.entries[user] || {})[m[1]];
    persist();
    return json(res, 200, {});
  }

  return json(res, 404, { error: 'not found' });
}

// ---------- static files ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, urlPath) {
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.join(ROOT, path.normalize(urlPath));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const noCache = ext === '.html' || file.endsWith('sw.js');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=600',
    });
    res.end(data);
  });
}

http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://x');
    decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      json(res, e.message === 'bad json' || e.message === 'too large' ? 400 : 500, { error: e.message || 'something broke' });
    });
    return;
  }
  serveStatic(req, res, decodeURIComponent(url.pathname));
}).listen(PORT, () => console.log(`thype serving on :${PORT} (data: ${DATA_DIR})`));
