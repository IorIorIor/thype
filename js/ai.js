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

// techniques that matter for a 0.5B model: few-shot pairs that mirror the
// task exactly, the instruction repeated AFTER the entry (small models weight
// the end of context most), greedy decoding, and identical scaffolding on
// every example so the pattern is unmissable
async function ask({ system, shots = [], prompt, maxTokens, temperature = 0 }) {
  const engine = await ensureEngine();
  const messages = [{ role: 'system', content: system }];
  for (const [u, a] of shots) {
    messages.push({ role: 'user', content: u }, { role: 'assistant', content: a });
  }
  messages.push({ role: 'user', content: prompt });
  const reply = await engine.chat.completions.create({ messages, temperature, max_tokens: maxTokens });
  return (reply.choices?.[0]?.message?.content || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')   // some models leak reasoning tags
    .trim();
}

// long entries drown a tiny model in the middle; the point of a journal
// entry usually lives at its start and end
function condense(text, max = 1200) {
  if (text.length <= max) return text;
  return text.slice(0, 700) + ' … ' + text.slice(-450);
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
  const chatter = new Set(['the', 'themes', 'theme', 'are', 'and', 'entry', 'answer', 'this', 'about', 'main']);
  const words = (raw.toLowerCase().match(/[\p{L}]{3,20}/gu) || []).filter(w => !chatter.has(w));
  return [...new Set(words)].slice(0, 3);
}

const TITLE_ASK = 'What is this entry really about? Answer with only a title: 2 to 6 plain words, sentence case, not a phrase copied from the entry.';
const titlePrompt = (entry) => `Entry: ${entry}\n\n${TITLE_ASK}`;

// every example uses the exact scaffold of the real request, and several
// mirror the trap: a rambling entry with an easy-to-pluck noun phrase,
// titled by its undercurrent instead
const TITLE_SHOTS = [
  [titlePrompt("ok so I barely slept again, three nights now, and I keep telling myself it's the coffee but honestly my head just won't shut up about the deadline and everything that comes after it"),
    'Racing thoughts and lost sleep'],
  [titlePrompt("right, new plan, again. gym five times a week, no beer, actually answer emails. who am I kidding, I wrote the same list in January. but something has to give, I'm 38 and still living like a student. maybe start small. maybe just the sleep thing first."),
    'Trying to change my life again'],
  [titlePrompt("saw dad today. he looked smaller somehow. we talked about the garden like always and I didn't say any of the things I actually meant to say"),
    'Things left unsaid with dad'],
  [titlePrompt("do I even want the promotion? more money sure, but I'd never see daylight. and I'd be managing Karl, which, no. but if I say no do I just stay here forever?"),
    'Doubts about the promotion'],
  [titlePrompt("coffee with Marta today. we laughed so hard about the old office days that my cheeks hurt. I forget how easy it is with her. why do I let months go by?"),
    'Remembering how easy friendship is'],
];

export async function generateTitle(text) {
  const raw = await ask({
    system: 'You are a journal titling assistant. You always answer with only a short plain title in sentence case, no quotes and no ending punctuation, that captures what the entry is really about underneath — never a phrase copied from the entry.',
    shots: TITLE_SHOTS,
    prompt: titlePrompt(condense(text)),
    maxTokens: 24,
    temperature: 0,
  });
  return cleanTitle(raw) || heuristicTitle(text);
}

const THEME_ASK = 'Name the 1 to 3 main themes of this entry. Each theme is ONE lowercase word (examples: love, work, family, friends, anxiety, dreams, gratitude, health, change, loss, hope, memory, nature, travel, money, creativity, loneliness, growth, food, rest, music, faith). Answer with only the words, comma separated.';
const themePrompt = (entry) => `Entry: ${entry}\n\n${THEME_ASK}`;

const THEME_SHOTS = [
  [themePrompt("ok so I barely slept again, three nights now, and I keep telling myself it's the coffee but honestly my head just won't shut up about the deadline and everything that comes after it"),
    'work, anxiety, rest'],
  [themePrompt("saw dad today. he looked smaller somehow. we talked about the garden like always and I didn't say any of the things I actually meant to say"),
    'family, regret'],
];

export async function generateThemes(text) {
  const raw = await ask({
    system: 'You are a journal theme assistant. You always answer with only 1 to 3 lowercase single-word themes, comma separated.',
    shots: THEME_SHOTS,
    prompt: themePrompt(condense(text)),
    maxTokens: 16,
    temperature: 0,
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
