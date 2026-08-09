// server-backed store with a local (IndexedDB) offline queue.
// thoughts save to the account; if the network is away they queue locally
// and syncLocal() lifts them up on the next connected, signed-in visit.

// ---------- api ----------

async function req(method, path, body) {
  let res;
  try {
    res = await fetch('./api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw { offline: true };
  }
  const authRoute = path === '/login' || path === '/register' || path === '/me';
  if (res.status === 401 && !authRoute) {
    window.dispatchEvent(new Event('thype:unauth'));
    throw { unauth: true };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, message: data.error };
  return data;
}

export const push = {
  key: () => req('GET', '/push/key'),
  subscribe: (subscription, tz) => req('POST', '/push/subscribe', { subscription, tz }),
  unsubscribe: (endpoint) => req('POST', '/push/unsubscribe', { endpoint }),
};

export const auth = {
  // resolves to {username}, null (not signed in) or 'offline'
  me: async () => {
    try { return await req('GET', '/me'); }
    catch (e) { return e.offline ? 'offline' : null; }
  },
  login: (username, password) => req('POST', '/login', { username, password }),
  register: (username, password) => req('POST', '/register', { username, password }),
  logout: () => req('POST', '/logout'),
};

// ---------- local queue (IndexedDB) ----------

const DB_NAME = 'thype';
const STORE = 'entries';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(idb => new Promise((resolve, reject) => {
    const t = idb.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result.result ?? result);
    t.onerror = () => reject(t.error);
  }));
}

const localAll = () => tx('readonly', s => s.getAll()).then(r => (Array.isArray(r) ? r : []));
const localPut = (e) => tx('readwrite', s => s.put(e));
const localDelete = (id) => tx('readwrite', s => s.delete(id));

// ---------- unified store ----------

let serverCache = [];

function merged(locals) {
  const seen = new Set(locals.map(e => e.id));
  return [...locals, ...serverCache.filter(e => !seen.has(e.id))]
    .sort((a, b) => b.created - a.created);
}

export async function getEntries() {
  try {
    serverCache = await req('GET', '/entries');
  } catch (e) {
    if (e.unauth) throw e;   // offline: fall through to cache + queue
  }
  return merged(await localAll());
}

async function upsert(entry) {
  try {
    await req('PUT', `/entries/${entry.id}`, entry);
    await localDelete(entry.id);
  } catch (e) {
    if (e.unauth) throw e;
    await localPut(entry);   // queue for later sync
  }
  return entry;
}

export const addEntry = upsert;
export const updateEntry = upsert;

export async function deleteEntry(id) {
  await localDelete(id).catch(() => {});
  serverCache = serverCache.filter(e => e.id !== id);
  try { await req('DELETE', `/entries/${id}`); }
  catch (e) { if (e.unauth) throw e; }
}

// lift queued/legacy local thoughts into the account
export async function syncLocal() {
  for (const entry of await localAll()) {
    await req('PUT', `/entries/${entry.id}`, entry);
    await localDelete(entry.id);
  }
}
