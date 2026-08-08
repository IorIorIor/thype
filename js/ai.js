// titles & themes: local WebLLM (WebGPU) when available, heuristics otherwise.

const MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.79';

const STOP = new Set(('the a an and or but of to in on at is are was were be been am i im me my mine we our you your it its ' +
  'this that these those with for so just really very not no yes do does did have has had what when how why there here about like').split(' '));

export const hasWebGPU = 'gpu' in navigator;

let enginePromise = null;
let statusCb = () => {};

export function onStatus(cb) { statusCb = cb; }

function ensureEngine() {
  if (!hasWebGPU) return Promise.reject(new Error('no webgpu'));
  if (!enginePromise) {
    enginePromise = import(WEBLLM_URL).then(webllm =>
      webllm.CreateMLCEngine(MODEL, {
        initProgressCallback: (p) => {
          const pct = Math.round((p.progress || 0) * 100);
          statusCb(pct < 100 ? `✦ ai waking up… ${pct}%` : '');
        },
      })
    ).catch(err => {
      enginePromise = null;
      statusCb('');
      throw err;
    });
  }
  return enginePromise;
}

async function ask(system, text, maxTokens) {
  const engine = await ensureEngine();
  const reply = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text.slice(0, 1500) },
    ],
    temperature: 0.7,
    max_tokens: maxTokens,
  });
  return (reply.choices?.[0]?.message?.content || '').trim();
}

function cleanTitle(raw) {
  const t = raw.replace(/["'“”‘’`*#]/g, '').replace(/\s+/g, ' ').replace(/[.。!?]+$/, '').trim();
  if (!t) return null;
  return t.split(' ').slice(0, 6).join(' ');
}

function cleanTheme(raw) {
  const m = raw.toLowerCase().match(/[\p{L}]{3,20}/u);
  return m ? m[0] : null;
}

export async function generateTitle(text) {
  const raw = await ask(
    'You write short evocative titles for private journal entries. Reply with ONLY the title: 2 to 5 words, no quotes, no ending punctuation.',
    text, 24);
  return cleanTitle(raw) || heuristicTitle(text);
}

export async function generateTheme(text) {
  const raw = await ask(
    'Name the single main theme of this journal entry as ONE lowercase word (examples: love, work, family, anxiety, dreams, gratitude, health, change). Reply with only that one word.',
    text, 8);
  return cleanTheme(raw) || heuristicTheme(text);
}

// ---------- heuristics (fallback + instant placeholder) ----------

export function heuristicTitle(text) {
  const words = text.split(/\s+/).slice(0, 30);
  const picked = [];
  for (const w of words) {
    const clean = w.replace(/[^\p{L}\p{N}'’-]/gu, '');
    if (!clean) continue;
    if (picked.length === 0 && STOP.has(clean.toLowerCase())) continue;
    picked.push(clean);
    if (picked.length >= 4) break;
  }
  if (!picked.length) return 'A quiet thought';
  const s = picked.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function heuristicTheme(text) {
  const freq = new Map();
  for (const w of text.toLowerCase().split(/[^\p{L}'’-]+/u)) {
    if (w.length < 4 || STOP.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [w, c] of freq) if (c > n) { best = w; n = c; }
  return best || 'musings';
}
