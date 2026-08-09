import { addEntry, updateEntry, deleteEntry, getEntries } from './store.js';
import { burst } from './fx.js';
import * as ai from './ai.js';

const $ = (id) => document.getElementById(id);
const views = { write: $('view-write'), timeline: $('view-timeline'), themes: $('view-themes') };
const editor = $('editor');
const saveBtn = $('btn-save');
const timelineEl = $('timeline');
const themesEl = $('themes');
const aiStatusEl = $('ai-status');
const timelineTitle = $('timeline-title');

let themeFilter = null;

// ---------- routing ----------

function show(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  if (name === 'write') requestAnimationFrame(() => editor.focus());
  if (name === 'timeline') renderTimeline();
  if (name === 'themes') renderThemes();
}

function go(name) {
  if (name !== 'timeline') themeFilter = null;
  location.hash = name === 'write' ? '' : name;
  show(name);
}

window.addEventListener('hashchange', () => {
  const name = location.hash.replace('#', '') || 'write';
  if (views[name]) show(name);
});

// ---------- write view ----------

if (!(() => { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; })()) {
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
} else {
  editor.setAttribute('contenteditable', 'plaintext-only');
}

function caretPoint() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  let rect = range.getClientRects()[0];
  if (rect && (rect.width || rect.height || rect.x || rect.y)) {
    return { x: rect.left + 2, y: rect.top + (rect.height || 24) / 2 };
  }
  // collapsed range at an element boundary (e.g. right after a fade span)
  // has no rects — measure the node just before the caret instead
  const node = range.startContainer;
  if (node.nodeType === 1 && range.startOffset > 0) {
    const child = node.childNodes[range.startOffset - 1];
    if (child) {
      if (child.nodeType === 1) rect = child.getBoundingClientRect();
      else {
        const rr = document.createRange();
        rr.selectNodeContents(child);
        rect = rr.getBoundingClientRect();
      }
      if (rect && (rect.width || rect.height)) {
        return { x: rect.right, y: rect.top + rect.height / 2 };
      }
    }
  }
  return null;
}

// wrap the just-typed character(s) in a span that fades in over 200ms
function fadeLastTyped(len) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return;
  const node = r.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || r.startOffset === 0) return;
  const range = document.createRange();
  range.setStart(node, Math.max(0, r.startOffset - len));
  range.setEnd(node, r.startOffset);
  const span = document.createElement('span');
  span.className = 'char-in';
  try { range.surroundContents(span); } catch { return; }
  const after = document.createRange();
  after.setStartAfter(span);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
}

// keep the line being typed vertically centered in the visible area
const vv = window.visualViewport;
let glideRaf = null;
function glideScroll(target) {
  cancelAnimationFrame(glideRaf);
  const start = editor.scrollTop;
  const dist = target - start;
  if (Math.abs(dist) < 1) return;
  const t0 = performance.now();
  const dur = 220;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    editor.scrollTop = start + dist * (1 - Math.pow(1 - k, 3));
    if (k < 1) glideRaf = requestAnimationFrame(step);
  };
  glideRaf = requestAnimationFrame(step);
}

function centerCaret() {
  if (!editor.innerText.trim()) return;
  const pt = caretPoint();
  if (!pt) return;
  const top = vv ? vv.offsetTop : 0;
  const height = vv ? vv.height : window.innerHeight;
  const delta = pt.y - (top + height * 0.45);
  if (Math.abs(delta) > 14) glideScroll(editor.scrollTop + delta);
}

editor.addEventListener('input', (e) => {
  saveBtn.hidden = editor.innerText.trim().length === 0;
  if (!e.isComposing && e.inputType === 'insertText' && e.data) fadeLastTyped(e.data.length);
  if (!e.inputType || !e.inputType.startsWith('delete')) {
    const pt = caretPoint();
    if (pt) burst(pt.x, pt.y, 4 + ((Math.random() * 3) | 0));
  }
  centerCaret();
});

// bring up the on-screen keyboard as eagerly as the platform allows.
// iOS only opens it from a real tap; everywhere else focus + show() works.
function summonKeyboard() {
  if (views.write.hidden) return;
  editor.focus({ preventScroll: true });
  try { navigator.virtualKeyboard?.show(); } catch { /* not supported */ }
}
window.addEventListener('pageshow', () => {
  summonKeyboard();
  setTimeout(summonKeyboard, 150);   // some mobile browsers ignore focus
  setTimeout(summonKeyboard, 450);   // before first paint / SW activation
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') summonKeyboard();
});
// guarantee the first touch anywhere on the sky opens the keyboard,
// inside the gesture so iOS honors it
document.addEventListener('touchend', (e) => {
  if (views.write.hidden || e.target.closest('button')) return;
  summonKeyboard();
}, { passive: true });

// keep the save pill above the on-screen keyboard
if (vv) {
  const place = () => {
    const covered = window.innerHeight - vv.height - vv.offsetTop;
    saveBtn.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + 26px + ${Math.max(0, covered)}px)`;
  };
  vv.addEventListener('resize', () => { place(); centerCaret(); });
  vv.addEventListener('scroll', place);
}

let editingEntry = null;
const deleteBtn = $('btn-delete');

function disarmDelete() {
  deleteBtn.classList.remove('armed');
}

function startEdit(entry) {
  editingEntry = entry;
  editor.textContent = entry.text;
  saveBtn.hidden = false;
  deleteBtn.hidden = false;
  disarmDelete();
  go('write');
  requestAnimationFrame(() => {
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    centerCaret();
  });
}

saveBtn.addEventListener('click', async () => {
  const text = editor.innerText.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return;
  const meta = {
    text,
    title: ai.heuristicTitle(text),
    theme: ai.heuristicTheme(text),
    aiPending: ai.hasWebGPU,
  };
  if (editingEntry) {
    await updateEntry({ ...editingEntry, ...meta });
    editingEntry = null;
  } else {
    await addEntry({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      created: Date.now(),
      ...meta,
    });
  }
  editor.textContent = '';
  saveBtn.hidden = true;
  deleteBtn.hidden = true;
  go('timeline');
  if (ai.hasWebGPU) enrichPending();
});

// top-right delete on the writing screen: first tap arms, second lets go
let disarmTimer = null;
deleteBtn.addEventListener('click', async () => {
  if (!editingEntry) return;
  if (!deleteBtn.classList.contains('armed')) {
    deleteBtn.classList.add('armed');
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(disarmDelete, 2500);
    return;
  }
  clearTimeout(disarmTimer);
  await deleteEntry(editingEntry.id);
  editingEntry = null;
  editor.textContent = '';
  saveBtn.hidden = true;
  deleteBtn.hidden = true;
  disarmDelete();
  go('timeline');
});

$('btn-overview').addEventListener('click', () => {
  if (editingEntry) {           // leaving mid-edit abandons the edit
    editingEntry = null;
    editor.textContent = '';
    saveBtn.hidden = true;
  }
  deleteBtn.hidden = true;
  go('timeline');
});
$('btn-write').addEventListener('click', () => go('write'));
$('btn-themes').addEventListener('click', () => go('themes'));
$('btn-back').addEventListener('click', () => go('timeline'));

// ---------- ai enrichment (background) ----------

ai.onStatus((msg) => {
  aiStatusEl.textContent = msg;
  aiStatusEl.hidden = !msg;
  aiStatusEl.classList.toggle('quiet', msg === '✦');
});

let enriching = false;
async function enrichPending() {
  if (enriching || !ai.hasWebGPU) return;
  enriching = true;
  try {
    let pending = (await getEntries()).filter(e => e.aiPending);
    while (pending.length) {
      const entry = pending.shift();
      try {
        entry.title = await ai.generateTitle(entry.text);
        entry.theme = await ai.generateTheme(entry.text);
        entry.aiPending = false;
        await updateEntry(entry);
        if (!views.timeline.hidden) renderTimeline();
        if (!views.themes.hidden) renderThemes();
      } catch (err) {
        console.warn('thype: ai unavailable, keeping heuristic titles', err);
        break;
      }
      if (!pending.length) pending = (await getEntries()).filter(e => e.aiPending);
    }
  } finally {
    enriching = false;
  }
}

// ---------- timeline view ----------

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days === 0) return `today · ${time}`;
  if (days === 1) return `yesterday · ${time}`;
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString([], opts)} · ${time}`;
}

async function renderTimeline() {
  const all = await getEntries();
  const entries = themeFilter ? all.filter(e => e.theme === themeFilter) : all;
  timelineTitle.textContent = themeFilter || 'thoughts';
  timelineEl.textContent = '';

  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = themeFilter ? 'nothing here anymore' : 'no thoughts yet —\nthe space is waiting';
    p.style.whiteSpace = 'pre-line';
    timelineEl.append(p);
    return;
  }

  entries.forEach((entry, i) => {
    const b = document.createElement('article');
    b.className = 'bubble';
    b.style.animationDelay = `${Math.min(i * 60, 500)}ms`;

    const h = document.createElement('h2');
    h.textContent = entry.title;
    if (entry.aiPending) h.classList.add('pending');

    const t = document.createElement('time');
    t.textContent = fmtDate(entry.created);

    b.append(h, t);
    b.addEventListener('click', () => startEdit(entry));
    timelineEl.append(b);
  });
}

// ---------- themes view ----------

async function renderThemes() {
  const entries = await getEntries();
  const groups = new Map();
  for (const e of entries) {
    const key = e.theme || 'musings';
    if (!groups.has(key)) groups.set(key, 0);
    groups.set(key, groups.get(key) + 1);
  }
  themesEl.textContent = '';

  if (!groups.size) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'themes will gather here\nonce you have thoughts';
    p.style.whiteSpace = 'pre-line';
    themesEl.append(p);
    return;
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  for (const [theme, count] of sorted) {
    const orb = document.createElement('button');
    orb.className = 'theme-orb';
    const size = Math.min(150, 78 + count * 14);
    orb.style.width = orb.style.height = `${size}px`;
    const label = document.createElement('b');
    label.textContent = theme;
    const n = document.createElement('small');
    n.textContent = count === 1 ? '1 thought' : `${count} thoughts`;
    orb.append(label, n);
    orb.addEventListener('click', () => {
      themeFilter = theme;
      go('timeline');
    });
    themesEl.append(orb);
  }
}

// ---------- boot ----------

// PWA always opens on the write screen
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
show('write');
summonKeyboard();
enrichPending();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
