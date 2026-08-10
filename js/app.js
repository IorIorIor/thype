import { addEntry, updateEntry, deleteEntry, getEntries, syncLocal, auth, push } from './store.js';
import { burst, enableMotion, notifyTyping } from './fx.js';
import * as ai from './ai.js';

const $ = (id) => document.getElementById(id);
const views = { auth: $('view-auth'), write: $('view-write'), timeline: $('view-timeline'), themes: $('view-themes') };
let authed = false;
const editor = $('editor');
const saveBtn = $('btn-save');
const timelineEl = $('timeline');
const themesEl = $('themes');
const aiStatusEl = $('ai-status');
const timelineTitle = $('timeline-title');

let themeFilter = null;

// entries saved before multi-themes carry a single `theme` string
const themesOf = (e) => (Array.isArray(e.themes) && e.themes.length ? e.themes : e.theme ? [e.theme] : []);

// ---------- routing & transitions ----------

// depth decides the transition: deeper = flying into a thought,
// shallower = flying back out, same level = a plain fade
const DEPTH = { auth: 1, timeline: 1, themes: 1, write: 2 };
const ANIM_CLASSES = ['anim-fade-in', 'anim-zoom-arrive', 'anim-zoom-return', 'anim-zoom-away', 'anim-zoom-shrink'];
let currentView = null;
let navTarget = null;   // claimed before any await so a hashchange re-entry
                        // can't restart (and downgrade) an in-flight transition
let clearEditorOnExit = false;   // the text must stay visible while the
                                 // write view flies out, then be cleared

function clearEditor() {
  clearEditorOnExit = false;
  editor.textContent = '';
  saveBtn.hidden = true;
  deleteBtn.hidden = true;
}

function finishHide(el) {
  if (el === views[currentView]) {
    // the user flew back in mid-transition — don't hide it, and only
    // clear if no thought was reopened in the meantime
    if (el === views.write && clearEditorOnExit && !editingEntry) clearEditor();
    clearEditorOnExit = false;
    return;
  }
  el.hidden = true;
  if (el === views.write && clearEditorOnExit) clearEditor();
}

async function show(name) {
  if (!authed && name !== 'auth') name = 'auth';
  if (name === currentView || name === navTarget) return;
  navTarget = name;

  // render content while still hidden so nothing flickers in
  if (name === 'timeline') await renderTimeline().catch(() => {});
  if (name === 'themes') { await renderThemes().catch(() => {}); refreshRemindState(); }

  if (navTarget !== name) return;   // superseded by a newer navigation
  navTarget = null;
  const fromEl = currentView ? views[currentView] : null;
  const toEl = views[name];
  let outClass = null;
  let inClass = 'anim-fade-in';
  if (fromEl && DEPTH[name] !== DEPTH[currentView]) {
    const diving = DEPTH[name] > DEPTH[currentView];
    outClass = diving ? 'anim-zoom-away' : 'anim-zoom-shrink';
    inClass = diving ? 'anim-zoom-arrive' : 'anim-zoom-return';
  }
  currentView = name;

  for (const [k, el] of Object.entries(views)) {
    if (k !== name && el !== fromEl) el.hidden = true;
  }
  if (fromEl && fromEl !== toEl) {
    fromEl.classList.remove(...ANIM_CLASSES);
    if (outClass) {
      fromEl.classList.add(outClass);
      setTimeout(() => { finishHide(fromEl); fromEl.classList.remove(outClass); }, 340);
    } else {
      finishHide(fromEl);
    }
  }
  toEl.classList.remove(...ANIM_CLASSES);
  toEl.hidden = false;
  void toEl.offsetWidth;              // restart the css animation
  toEl.classList.add(inClass);
  setTimeout(() => toEl.classList.remove(inClass), 500);

  if (name === 'auth') requestAnimationFrame(() => $('auth-user').focus());
  if (name === 'write') requestAnimationFrame(() => editor.focus());
}

function go(name) {
  if (name !== 'timeline') themeFilter = null;
  location.hash = name === 'write' ? '' : name;
  show(name);
}

window.addEventListener('hashchange', () => {
  const name = location.hash.replace('#', '') || 'write';
  if (views[name] && name !== 'auth') show(name);
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
  notifyTyping();
  if (!e.isComposing && e.inputType === 'insertText' && e.data) fadeLastTyped(e.data.length);
  if (!e.inputType || !e.inputType.startsWith('delete')) {
    const pt = caretPoint();
    if (pt) burst(pt.x, pt.y, 4 + ((Math.random() * 3) | 0));
  }
  centerCaret();
});

// wherever the caret lands — a tap, a selection, arrow keys — drift to it
document.addEventListener('selectionchange', () => {
  if (views.write.hidden || document.activeElement !== editor) return;
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
// iOS only grants motion (parallax) access inside a first real gesture
document.addEventListener('touchend', () => enableMotion(), { once: true, passive: true });

// the keyboard shrinking the viewport re-centers the current line
if (vv) vv.addEventListener('resize', centerCaret);

let editingEntry = null;
const deleteBtn = $('btn-delete');

function disarmDelete() {
  deleteBtn.classList.remove('armed');
  deleteBtn.textContent = 'delete';
}

function startEdit(entry) {
  editingEntry = entry;
  editor.textContent = entry.text;
  saveBtn.hidden = false;
  deleteBtn.hidden = false;
  disarmDelete();
  go('write');
  // open reading from the top: first line under the icons row, caret at start
  requestAnimationFrame(() => {
    editor.scrollTop = 0;
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
}

saveBtn.addEventListener('click', async () => {
  const text = editor.innerText.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return;
  if (editingEntry && text === editingEntry.text) {
    // nothing changed — keep the title, just fly back out
    editingEntry = null;
    clearEditorOnExit = true;
    go('timeline');
    return;
  }
  const meta = {
    text,
    title: ai.heuristicTitle(text),
    themes: ai.heuristicThemes(text),
    aiPending: ai.hasWebGPU,
  };
  try {
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
  } catch {
    return;   // signed out mid-save — auth screen is up, the text stays put
  }
  clearEditorOnExit = true;
  go('timeline');
  if (ai.hasWebGPU) enrichPending();
});

// top-right delete on the writing screen: first tap arms, second lets go
let disarmTimer = null;
deleteBtn.addEventListener('click', async () => {
  if (!editingEntry) return;
  if (!deleteBtn.classList.contains('armed')) {
    deleteBtn.classList.add('armed');
    deleteBtn.textContent = 'sure?';
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(disarmDelete, 2500);
    return;
  }
  clearTimeout(disarmTimer);
  await deleteEntry(editingEntry.id).catch(() => {});
  editingEntry = null;
  disarmDelete();
  clearEditorOnExit = true;
  go('timeline');
});

$('btn-overview').addEventListener('click', () => {
  if (editingEntry) {           // leaving mid-edit abandons the edit
    editingEntry = null;
    clearEditorOnExit = true;
  } else {
    deleteBtn.hidden = true;
  }
  go('timeline');
});
$('btn-new').addEventListener('click', () => go('write'));
$('btn-themes').addEventListener('click', () => go('themes'));
$('btn-back').addEventListener('click', () => go('timeline'));

// ---------- account ----------

const authForm = $('auth-form');
const authError = $('auth-error');
let creatingAccount = false;

$('auth-toggle').addEventListener('click', () => {
  creatingAccount = !creatingAccount;
  $('auth-submit').textContent = creatingAccount ? 'begin' : 'enter';
  $('auth-toggle').textContent = creatingAccount
    ? 'already have an account? enter'
    : 'new here? create an account';
  $('auth-pass').autocomplete = creatingAccount ? 'new-password' : 'current-password';
  authError.hidden = true;
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.hidden = true;
  const username = $('auth-user').value.trim();
  const password = $('auth-pass').value;
  try {
    await (creatingAccount ? auth.register : auth.login)(username, password);
    authed = true;
    $('auth-pass').value = '';
    syncLocal().catch(() => {});   // lift any thoughts saved before the account
    show('write');
    summonKeyboard();
    enrichPending();
  } catch (err) {
    authError.textContent = err.offline
      ? 'the stars are unreachable — no connection'
      : (err.message || "that didn't work");
    authError.hidden = false;
  }
});

// ---------- evening reminder (daily 20:00 push if no thought yet) ----------

const remindBtn = $('btn-remind');
const remindNote = $('remind-note');

function noteRemind(msg) {
  remindNote.textContent = msg;
  remindNote.hidden = !msg;
  if (msg) setTimeout(() => { remindNote.hidden = true; }, 4500);
}

const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function currentPushSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function refreshRemindState() {
  remindBtn.classList.toggle('on', !!(await currentPushSub().catch(() => null)));
}

function b64ToUint8(b64) {
  const raw = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

remindBtn.addEventListener('click', async () => {
  if (!pushSupported()) {
    noteRemind('reminders need the app installed on your home screen');
    return;
  }
  try {
    const existing = await currentPushSub();
    if (existing) {
      await push.unsubscribe(existing.endpoint).catch(() => {});
      await existing.unsubscribe();
      remindBtn.classList.remove('on');
      noteRemind('evening reminder off');
      return;
    }
    if (await Notification.requestPermission() !== 'granted') {
      noteRemind('notifications are blocked for thype');
      return;
    }
    const { key } = await push.key();
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8(key),
    });
    await push.subscribe(sub.toJSON(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    remindBtn.classList.add('on');
    noteRemind('a nudge at 20:00 on quiet days');
  } catch {
    noteRemind("reminders didn't take — try again");
  }
});

$('btn-logout').addEventListener('click', () => {
  $('logout-modal').hidden = false;
});
$('logout-no').addEventListener('click', () => {
  $('logout-modal').hidden = true;
});
$('logout-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});
$('logout-yes').addEventListener('click', async () => {
  await auth.logout().catch(() => {});
  location.href = location.pathname;   // clean reload → auth screen
});

window.addEventListener('thype:unauth', () => {
  if (!authed) return;
  authed = false;
  show('auth');
});

// ---------- ai enrichment (background) ----------

ai.onStatus((msg) => {
  aiStatusEl.textContent = msg;
  aiStatusEl.hidden = !msg;
  aiStatusEl.classList.toggle('quiet', msg === '✦');
});

let enriching = false;
async function enrichPending() {
  if (enriching || !ai.hasWebGPU || !authed) return;
  enriching = true;
  try {
    let pending = (await getEntries()).filter(e => e.aiPending);
    while (pending.length) {
      const entry = pending.shift();
      try {
        entry.title = await ai.generateTitle(entry.text);
        entry.themes = await ai.generateThemes(entry.text);
        delete entry.theme;
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
  } catch { /* signed out or offline mid-run — resume next boot */ }
  finally {
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
  const entries = themeFilter ? all.filter(e => themesOf(e).includes(themeFilter)) : all;
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

  entries.forEach((entry) => {
    const b = document.createElement('article');
    b.className = 'bubble';

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
    for (const key of themesOf(e).length ? themesOf(e) : ['musings']) {
      groups.set(key, (groups.get(key) || 0) + 1);
    }
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
    orb.append(label);
    orb.addEventListener('click', () => {
      themeFilter = theme;
      go('timeline');
    });
    themesEl.append(orb);
  }
}

// ---------- boot ----------

// PWA always opens on the write screen (after sign-in)
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
(async () => {
  const me = await auth.me();
  if (me === null) {
    show('auth');
  } else {                       // signed in, or offline (thoughts queue locally)
    authed = true;
    if (me !== 'offline') syncLocal().catch(() => {});
    show('write');
    summonKeyboard();
    enrichPending();
  }
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
