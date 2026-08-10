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

// few-shot pairs matter more than instructions for a model this small —
// they show what "getting the gist" of a messy entry looks like
async function ask({ system, shots = [], text, maxTokens, temperature = 0.3 }) {
  const engine = await ensureEngine();
  const messages = [{ role: 'system', content: system }];
  for (const [u, a] of shots) {
    messages.push({ role: 'user', content: u }, { role: 'assistant', content: a });
  }
  messages.push({ role: 'user', content: text.slice(0, 1500) });
  const reply = await engine.chat.completions.create({ messages, temperature, max_tokens: maxTokens });
  return (reply.choices?.[0]?.message?.content || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')   // some models leak reasoning tags
    .trim();
}

function cleanTitle(raw) {
  const t = raw
    .replace(/^\s*title\s*:\s*/i, '')
    .replace(/["'“”‘’`*#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.。!?]+$/, '')
    .trim();
  if (!t) return null;
  const capped = t.split(' ').slice(0, 6).join(' ');
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

function cleanThemes(raw) {
  const words = raw.toLowerCase().match(/[\p{L}]{3,20}/gu) || [];
  return [...new Set(words)].slice(0, 3);
}

const TITLE_SHOTS = [
  ["ok so I barely slept again, three nights now, and I keep telling myself it's the coffee but honestly my head just won't shut up about the deadline and everything that comes after it",
    'Racing thoughts and lost sleep'],
  ["saw dad today. he looked smaller somehow. we talked about the garden like always and I didn't say any of the things I actually meant to say",
    'Things left unsaid with dad'],
  ["I keep opening the flat listings and closing them again. it's not the money. it's that leaving this city means admitting that chapter is over",
    'Not ready to move on'],
];

export async function generateTitle(text) {
  const raw = await ask({
    system: 'You title private journal entries. Read the whole entry, work out what it is REALLY about — the feeling or question underneath, not a phrase copied from the text — and reply with ONLY a title of 2 to 6 plain words. Sentence case. No quotes, no ending punctuation.',
    shots: TITLE_SHOTS,
    text,
    maxTokens: 24,
    temperature: 0.3,
  });
  return cleanTitle(raw) || heuristicTitle(text);
}

const THEME_SHOTS = [
  [TITLE_SHOTS[0][0], 'work, anxiety, rest'],
  [TITLE_SHOTS[1][0], 'family, regret'],
];

export async function generateThemes(text) {
  const raw = await ask({
    system: 'Name the 1 to 3 main themes of this journal entry. Each theme is ONE lowercase word (examples: love, work, family, friends, anxiety, dreams, gratitude, health, change, loss, hope, memory, nature, travel, money, creativity, loneliness, growth, food, rest, music, faith). Reply with only the words, separated by commas.',
    shots: THEME_SHOTS,
    text,
    maxTokens: 16,
    temperature: 0.4,
  });
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
