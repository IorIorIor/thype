// IndexedDB wrapper — entries: { id, text, created, title, theme, aiPending }

const DB_NAME = 'thype';
const STORE = 'entries';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result.result ?? result);
    t.onerror = () => reject(t.error);
  }));
}

export function addEntry(entry) {
  return tx('readwrite', s => s.add(entry)).then(() => entry);
}

export function updateEntry(entry) {
  return tx('readwrite', s => s.put(entry)).then(() => entry);
}

export function deleteEntry(id) {
  return tx('readwrite', s => s.delete(id));
}

export async function getEntries() {
  const req = await tx('readonly', s => s.getAll());
  const list = Array.isArray(req) ? req : [];
  return list.sort((a, b) => b.created - a.created);
}
