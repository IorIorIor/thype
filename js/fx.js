// galaxy background: static nebula + breathing fog + stars (depth parallax),
// constellations, meteors, foreground dust motes — and the
// typing particle effects, with the sky brightening softly while you write.

const starsCanvas = document.getElementById('stars');
const partCanvas = document.getElementById('particles');
const sctx = starsCanvas.getContext('2d');
const pctx = partCanvas.getContext('2d');
const nebula = document.createElement('canvas');
const fogA = document.createElement('canvas');
const fogB = document.createElement('canvas');

// the milky way's stars live on several sheets, each at its own depth,
// so the band itself is subtly three-dimensional under parallax
const STAR_LAYER_PAR = [0.34, 0.43, 0.53, 0.64];
const starLayers = STAR_LAYER_PAR.map(() => document.createElement('canvas'));

let W = 0, H = 0, DPR = 1;
let stars = [];
let motes = [];
const particles = [];

// parallax: the nebula sits deepest, stars at varying depths, meteors and
// motes nearest. painted with PAD of bleed so tilting never shows an edge.
const PAD = 90;

let ptx = 0, pty = 0;    // target offset (from tilt or mouse)
let px = 0, py = 0;      // smoothed offset
let gyroSeen = false;
let baseBeta = null, baseGamma = null;

window.addEventListener('deviceorientation', (e) => {
  if (e.beta == null || e.gamma == null) return;
  gyroSeen = true;
  if (baseBeta === null) { baseBeta = e.beta; baseGamma = e.gamma; }
  baseBeta += (e.beta - baseBeta) * 0.002;     // drift toward the new resting
  baseGamma += (e.gamma - baseGamma) * 0.002;  // posture so it re-centers
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  ptx = clamp((e.gamma - baseGamma) / 28) * PAD * 0.55;
  pty = clamp((e.beta - baseBeta) / 28) * PAD * 0.55;
});

window.addEventListener('mousemove', (e) => {
  if (gyroSeen) return;
  ptx = (e.clientX / W - 0.5) * PAD * 0.45;
  pty = (e.clientY / H - 0.5) * PAD * 0.45;
});

// iOS gates motion sensors behind a permission that must be requested
// inside a user gesture; everywhere else this is a silent no-op.
// never re-ask when tilt data is already flowing.
export async function enableMotion() {
  if (gyroSeen) return;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') localStorage.setItem('thype-motion', '1');
    }
  } catch { /* declined — the sky stays still */ }
}

// the sky glows a touch brighter while thoughts are being typed
let lastTypeAt = -10;
let typingGlow = 0;
export function notifyTyping() { lastTypeAt = t; }

// gaussian-ish random in [-1, 1]
const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  for (const c of [starsCanvas, partCanvas]) {
    c.width = W * DPR;
    c.height = H * DPR;
  }
  for (const c of [nebula, fogA, fogB, ...starLayers]) {
    c.width = (W + PAD * 2) * DPR;
    c.height = (H + PAD * 2) * DPR;
  }
  paintNebula();
  paintFog(fogA, ['130,85,200', '170,70,150', '110,80,190']);
  paintFog(fogB, ['55,95,190', '60,140,160', '80,100,200']);
  paintStarLayers();
  seedStars();
  seedMotes();
}

// band geometry shared by the nebula painting and the star sheets
function bandGeometry() {
  const NW = W + PAD * 2, NH = H + PAD * 2;
  const diag = Math.hypot(NW, NH);
  const ang = -Math.PI / 4.6;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  return {
    NW, NH, diag,
    bandAt: (t, spread) => ({
      x: NW * 0.5 + cos * t * diag * 0.5 + -sin * gauss() * spread,
      y: NH * 0.42 + sin * t * diag * 0.5 + cos * gauss() * spread,
    }),
  };
}

// ---------- static layer: gas clouds, milky way band, dust ----------

function cloud(n, x, y, r, rgb, alpha) {
  const g = n.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(0.55, `rgba(${rgb},${alpha * 0.4})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  n.fillStyle = g;
  n.fillRect(x - r, y - r, r * 2, r * 2);
}

function paintNebula() {
  const NW = W + PAD * 2, NH = H + PAD * 2;
  const n = nebula.getContext('2d');
  n.setTransform(DPR, 0, 0, DPR, 0, 0);
  n.clearRect(0, 0, NW, NH);
  const diag = Math.hypot(NW, NH);

  // the milky way runs on a diagonal through the screen
  const ang = -Math.PI / 4.6;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const bandAt = (t, spread) => ({
    x: NW * 0.5 + cos * t * diag * 0.5 + -sin * gauss() * spread,
    y: NH * 0.42 + sin * t * diag * 0.5 + cos * gauss() * spread,
  });

  n.globalCompositeOperation = 'lighter';

  // barely-there ambient wash — the sky itself stays black
  cloud(n, NW * 0.78, NH * 0.06, diag * 0.42, '96,54,150', 0.045);
  cloud(n, NW * 0.10, NH * 0.95, diag * 0.38, '40,70,150', 0.04);

  // the nebulae proper: compact, structured puffs hugging the band so
  // they read as clouds against black instead of a broad haze
  for (let i = 0; i < 34; i++) {
    const p = bandAt(gauss() * 0.9, diag * 0.045);
    const colors = ['120,90,200', '80,90,190', '160,80,160', '90,130,190'];
    cloud(n, p.x, p.y, diag * (0.03 + Math.random() * 0.07), colors[i % colors.length], 0.055 + Math.random() * 0.05);
  }
  // bright galactic core
  const core = bandAt(0.05, 0);
  cloud(n, core.x, core.y, diag * 0.14, '210,190,230', 0.08);
  cloud(n, core.x, core.y, diag * 0.06, '235,220,235', 0.09);

  // dark dust lanes across the band
  n.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 9; i++) {
    const p = bandAt(gauss() * 0.8, diag * 0.02);
    const g = n.createRadialGradient(p.x, p.y, 0, p.x, p.y, diag * (0.03 + Math.random() * 0.05));
    g.addColorStop(0, 'rgba(5,3,15,0.32)');
    g.addColorStop(1, 'rgba(5,3,15,0)');
    n.fillStyle = g;
    n.fillRect(0, 0, NW, NH);
  }
}

// ---------- the milky way's stars, sheeted across four depths ----------

function paintStarLayers() {
  const { NW, NH, diag, bandAt } = bandGeometry();
  starLayers.forEach((canvas, li) => {
    const n = canvas.getContext('2d');
    n.setTransform(DPR, 0, 0, DPR, 0, 0);
    n.clearRect(0, 0, NW, NH);
    const near = li / (starLayers.length - 1);        // 0 deepest → 1 nearest
    const sizeLift = 0.8 + near * 0.5;
    const alphaLift = 0.7 + near * 0.4;

    // dense band stars
    for (let i = 0; i < Math.min(4500, (NW * NH) / 75); i++) {
      const p = bandAt(gauss() * 1.1, diag * (0.035 + Math.random() * 0.06));
      const r = (Math.random() * 0.32 + 0.07) * sizeLift;
      const a = (0.07 + Math.random() * 0.42) * alphaLift;
      const tint = Math.random();
      n.fillStyle = tint < 0.75 ? `rgba(255,255,255,${a})`
        : tint < 0.88 ? `rgba(200,215,255,${a})`
        : `rgba(255,225,190,${a})`;
      n.beginPath();
      n.arc(p.x, p.y, r, 0, Math.PI * 2);
      n.fill();
    }

    // scattered field stars outside the band
    for (let i = 0; i < (NW * NH) / 1400; i++) {
      const a = (0.05 + Math.random() * 0.3) * alphaLift;
      n.fillStyle = `rgba(255,255,255,${a})`;
      n.beginPath();
      n.arc(Math.random() * NW, Math.random() * NH, (Math.random() * 0.28 + 0.07) * sizeLift, 0, Math.PI * 2);
      n.fill();
    }
  });
}

// ---------- living nebula: two fog layers that drift, swell and breathe ----------

function paintFog(canvas, colors) {
  const NW = W + PAD * 2, NH = H + PAD * 2;
  const n = canvas.getContext('2d');
  n.setTransform(DPR, 0, 0, DPR, 0, 0);
  n.clearRect(0, 0, NW, NH);
  n.globalCompositeOperation = 'lighter';
  const diag = Math.hypot(NW, NH);
  for (let i = 0; i < 6; i++) {
    cloud(n, Math.random() * NW, Math.random() * NH,
      diag * (0.07 + Math.random() * 0.11), colors[i % colors.length], 0.04 + Math.random() * 0.035);
  }
}

function drawFog(ox, oy) {
  const NW = W + PAD * 2, NH = H + PAD * 2;
  sctx.save();
  sctx.globalCompositeOperation = 'lighter';

  const s1 = 1 + 0.03 * Math.sin(t * 0.041);
  sctx.globalAlpha = 0.38 + 0.22 * Math.sin(t * 0.053 + 1.2);
  sctx.drawImage(fogA,
    -PAD + ox * 0.22 + Math.sin(t * 0.047) * 16 - (NW * (s1 - 1)) / 2,
    -PAD + oy * 0.22 + Math.cos(t * 0.034) * 12 - (NH * (s1 - 1)) / 2,
    NW * s1, NH * s1);

  const s2 = 1 + 0.035 * Math.sin(t * 0.029 + 3);
  sctx.globalAlpha = 0.34 + 0.24 * Math.sin(t * 0.038 + 4.1);
  sctx.drawImage(fogB,
    -PAD + ox * 0.32 - Math.sin(t * 0.036 + 1) * 14 - (NW * (s2 - 1)) / 2,
    -PAD + oy * 0.32 + Math.sin(t * 0.051 + 2) * 10 - (NH * (s2 - 1)) / 2,
    NW * s2, NH * s2);

  sctx.restore();
}

// ---------- animated stars ----------

const STAR_TINTS = [
  ['rgba(255,255,255,', 0.62],
  ['rgba(205,220,255,', 0.16],   // blue-white
  ['rgba(255,228,195,', 0.12],   // warm
  ['rgba(210,190,255,', 0.10],   // lavender
];

function pickTint() {
  let r = Math.random();
  for (const [c, w] of STAR_TINTS) { r -= w; if (r <= 0) return c; }
  return STAR_TINTS[0][0];
}

function seedStars() {
  const count = Math.round(((W + PAD * 2) * (H + PAD * 2)) / 1900);
  stars = Array.from({ length: count }, () => {
    const bright = Math.random() < 0.06;
    return {
      x: -PAD + Math.random() * (W + PAD * 2),
      y: -PAD + Math.random() * (H + PAD * 2),
      r: bright ? 0.55 + Math.random() * 0.65 : 0.12 + Math.random() * 0.42,
      bright,
      depth: bright ? 0.6 + Math.random() * 0.3 : 0.25 + Math.random() * 0.55,
      tw: Math.random() * Math.PI * 2,
      ts: 0.8 + Math.random() * 2.4,
      vy: 0.003 + Math.random() * 0.012,
      c: pickTint(),
    };
  });
}

// ---------- constellations: bright stars briefly join, hold, let go ----------

let constel = null;
let nextConstel = 10 + Math.random() * 15;

function spawnConstellation() {
  const brights = stars.filter(s => s.bright && s.y > 60 && s.y < H - 20);
  if (brights.length < 4) return;
  const chain = [brights[(Math.random() * brights.length) | 0]];
  const used = new Set(chain);
  for (let i = 0; i < 3 + ((Math.random() * 3) | 0); i++) {
    const cur = chain[chain.length - 1];
    let best = null, bd = Infinity;
    for (const s of brights) {
      if (used.has(s)) continue;
      const d = (s.x - cur.x) ** 2 + (s.y - cur.y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    if (!best || bd > (W * 0.5) ** 2) break;
    chain.push(best);
    used.add(best);
  }
  if (chain.length >= 3) constel = { pts: chain, t: 0, dur: 9 + Math.random() * 5 };
}

function drawConstellation(dt, ox, oy) {
  if (!constel) {
    nextConstel -= dt;
    if (nextConstel <= 0) { spawnConstellation(); nextConstel = 20 + Math.random() * 25; }
    return;
  }
  constel.t += dt;
  const k = constel.t / constel.dur;
  if (k >= 1) { constel = null; return; }
  const a = k < 0.18 ? k / 0.18 : k > 0.72 ? (1 - k) / 0.28 : 1;
  const pos = (s) => [s.x + ox * s.depth, s.y + oy * s.depth];
  const reveal = Math.min(1, k / 0.3) * (constel.pts.length - 1);

  sctx.strokeStyle = `rgba(205,195,255,${(a * 0.32).toFixed(3)})`;
  sctx.lineWidth = 0.6;
  sctx.beginPath();
  let [lx, ly] = pos(constel.pts[0]);
  sctx.moveTo(lx, ly);
  for (let i = 1; i <= reveal; i++) {
    [lx, ly] = pos(constel.pts[i]);
    sctx.lineTo(lx, ly);
  }
  const frac = reveal - Math.floor(reveal);
  if (frac > 0 && Math.floor(reveal) + 1 < constel.pts.length) {
    const [nx, ny] = pos(constel.pts[Math.floor(reveal) + 1]);
    sctx.lineTo(lx + (nx - lx) * frac, ly + (ny - ly) * frac);
  }
  sctx.stroke();

  for (const s of constel.pts) {
    const [x, y] = pos(s);
    sctx.fillStyle = `rgba(225,215,255,${(a * 0.5).toFixed(3)})`;
    sctx.beginPath();
    sctx.arc(x, y, s.r * 1.5, 0, Math.PI * 2);
    sctx.fill();
  }
}

// ---------- shooting stars ----------

let meteor = null;
let nextMeteor = 8 + Math.random() * 20;

function updateMeteor(dt) {
  if (!meteor) {
    nextMeteor -= dt;
    if (nextMeteor <= 0) {
      const a = Math.PI * (0.15 + Math.random() * 0.2) + (Math.random() < 0.5 ? 0 : Math.PI / 2);
      meteor = {
        x: W * (0.1 + Math.random() * 0.8),
        y: H * (0.05 + Math.random() * 0.3),
        vx: Math.cos(a) * (W * 0.9),
        vy: Math.sin(a) * (W * 0.9),
        life: 1,
      };
      nextMeteor = 14 + Math.random() * 26;
    }
    return;
  }
  meteor.x += meteor.vx * dt;
  meteor.y += meteor.vy * dt;
  meteor.life -= dt * 1.6;
  if (meteor.life <= 0) { meteor = null; return; }
  const a = Math.sin(Math.min(1, meteor.life) * Math.PI) * 0.7;
  const tx = meteor.x - meteor.vx * 0.09;
  const ty = meteor.y - meteor.vy * 0.09;
  const g = sctx.createLinearGradient(meteor.x, meteor.y, tx, ty);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  sctx.strokeStyle = g;
  sctx.lineWidth = 1.2;
  sctx.beginPath();
  sctx.moveTo(meteor.x, meteor.y);
  sctx.lineTo(tx, ty);
  sctx.stroke();
}

// ---------- foreground dust motes (nearest layer, sells the depth) ----------

function seedMotes() {
  motes = Array.from({ length: 12 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 1.8 + Math.random() * 4.2,
    a: 0.045 + Math.random() * 0.055,
    vx: (Math.random() - 0.5) * 0.12,
    vy: -0.03 - Math.random() * 0.09,
    ph: Math.random() * Math.PI * 2,
    depth: 1.5 + Math.random() * 0.5,   // in front of the ui layer
  }));
}

function drawMotes(ox, oy) {
  for (const m of motes) {
    m.x += m.vx;
    m.y += m.vy;
    if (m.y < -60) { m.y = H + 60; m.x = Math.random() * W; }
    if (m.x < -60) m.x = W + 60;
    if (m.x > W + 60) m.x = -60;
    const mx = m.x + ox * m.depth + Math.sin(t * 0.3 + m.ph) * 2.5;
    const my = m.y + oy * m.depth + Math.cos(t * 0.22 + m.ph) * 2;
    const g = pctx.createRadialGradient(mx, my, 0, mx, my, m.r);
    g.addColorStop(0, `rgba(222,212,255,${m.a})`);
    g.addColorStop(1, 'rgba(222,212,255,0)');
    pctx.fillStyle = g;
    pctx.beginPath();
    pctx.arc(mx, my, m.r, 0, Math.PI * 2);
    pctx.fill();
  }
}

// ---------- typing particles ----------

const PALETTE = [
  'rgba(255,255,255,',
  'rgba(216,200,255,',
  'rgba(185,165,255,',
  'rgba(255,226,180,',
];

export function burst(x, y, n = 5) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 0.12 + Math.random() * 0.45;
    particles.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 0.28,
      r: 0.6 + Math.random() * 1.5,
      life: 1,
      decay: 0.005 + Math.random() * 0.009,   // lingers ~2-3s
      c: PALETTE[(Math.random() * PALETTE.length) | 0],
    });
  }
}

// ---------- frame loop ----------

let t = 0, last = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  t += dt;

  // smoothed parallax plus a faint ambient sway so the sky always breathes
  px += (ptx - px) * 0.055;
  py += (pty - py) * 0.055;
  const ox = px + Math.sin(t * 0.12) * 5;
  const oy = py + Math.cos(t * 0.09) * 4;

  // the ui barely sways — just enough to feel suspended, never enough to chase
  document.documentElement.style.setProperty('--parx', (ox * 0.12).toFixed(1) + 'px');
  document.documentElement.style.setProperty('--pary', (oy * 0.12).toFixed(1) + 'px');

  // the sky brightens a touch while thoughts are flowing
  const glowTarget = (t - lastTypeAt) < 2.5 ? 1 : 0;
  typingGlow += (glowTarget - typingGlow) * (glowTarget ? 0.05 : 0.015);

  sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  sctx.clearRect(0, 0, W, H);
  sctx.drawImage(nebula, -PAD + ox * 0.26, -PAD + oy * 0.26, W + PAD * 2, H + PAD * 2);
  if (typingGlow > 0.01) {
    sctx.save();
    sctx.globalCompositeOperation = 'lighter';
    sctx.globalAlpha = typingGlow * 0.12;
    sctx.drawImage(nebula, -PAD + ox * 0.26, -PAD + oy * 0.26, W + PAD * 2, H + PAD * 2);
    sctx.restore();
  }
  starLayers.forEach((c, i) => {
    sctx.drawImage(c, -PAD + ox * STAR_LAYER_PAR[i], -PAD + oy * STAR_LAYER_PAR[i], W + PAD * 2, H + PAD * 2);
  });
  drawFog(ox, oy);

  const twinkleLift = 1 + typingGlow * 0.16;
  for (const s of stars) {
    s.y -= s.vy;
    if (s.y < -PAD) { s.y = H + PAD; s.x = -PAD + Math.random() * (W + PAD * 2); }
    const sx = s.x + ox * s.depth;
    const sy = s.y + oy * s.depth;
    const a = (0.22 + 0.78 * (0.5 + 0.5 * Math.sin(s.tw + t * s.ts))) * twinkleLift;
    sctx.fillStyle = s.c + Math.min(1, a * 0.95).toFixed(3) + ')';
    sctx.beginPath();
    sctx.arc(sx, sy, s.r, 0, Math.PI * 2);
    sctx.fill();
    if (s.bright && a > 0.55) {
      const f = s.r * (2.6 + a * 2);
      sctx.strokeStyle = s.c + (Math.min(1, a) * 0.28).toFixed(3) + ')';
      sctx.lineWidth = 0.7;
      sctx.beginPath();
      sctx.moveTo(sx - f, sy); sctx.lineTo(sx + f, sy);
      sctx.moveTo(sx, sy - f); sctx.lineTo(sx, sy + f);
      sctx.stroke();
    }
  }

  drawConstellation(dt, ox, oy);

  sctx.save();
  sctx.translate(ox * 0.95, oy * 0.95);   // meteors streak just behind the ui
  updateMeteor(dt);
  sctx.restore();

  pctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  pctx.clearRect(0, 0, W, H);
  drawMotes(ox, oy);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy -= 0.0012;
    p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    const a = p.life * p.life * 0.85;
    pctx.fillStyle = p.c + a.toFixed(3) + ')';
    pctx.shadowColor = p.c + '0.6)';
    pctx.shadowBlur = 6;
    pctx.beginPath();
    pctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    pctx.fill();
  }
  pctx.shadowBlur = 0;

  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
