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
    // first ever load is the real model download; later loads just lift the
    // cached weights into GPU memory — show only a quiet shimmer for those
    const downloaded = localStorage.getItem('thype-model-ready');
    enginePromise = import(WEBLLM_URL).then(webllm =>
      webllm.CreateMLCEngine(MODEL, {
        initProgressCallback: (p) => {
          const pct = Math.round((p.progress || 0) * 100);
          if (pct >= 100) statusCb('');
          else statusCb(downloaded ? '✦' : `✦ downloading ai… ${pct}%`);
        },
      }).then(engine => {
        localStorage.setItem('thype-model-ready', '1');
        statusCb('');
        return engine;
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

function cleanThemes(raw) {
  const words = raw.toLowerCase().match(/[\p{L}]{3,20}/gu) || [];
  return [...new Set(words)].slice(0, 3);
}

export async function generateTitle(text) {
  const raw = await ask(
    'You label private journal entries. Reply with ONLY a label: a plain, factual summary of what the entry is about in 2 to 5 simple words. No poetry, no metaphors, no quotes, no ending punctuation.',
    text, 24);
  return cleanTitle(raw) || heuristicTitle(text);
}

export async function generateThemes(text) {
  const raw = await ask(
    'List the 1 to 3 main themes of this journal entry. Each theme is ONE lowercase word (examples: love, work, family, friends, anxiety, dreams, gratitude, health, change, loss, hope, memory, nature, travel, money, creativity, loneliness, growth, food, rest, music, faith). Reply with only the words, separated by commas.',
    text, 16);
  const themes = cleanThemes(raw);
  return themes.length ? themes : heuristicThemes(text);
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

export function heuristicThemes(text) {
  const freq = new Map();
  for (const w of text.toLowerCase().split(/[^\p{L}'’-]+/u)) {
    if (w.length < 4 || STOP.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const themes = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, count], i) => i === 0 || count >= 2)   // extras only if they recur
    .slice(0, 3)
    .map(([word]) => word);
  return themes.length ? themes : ['musings'];
}
