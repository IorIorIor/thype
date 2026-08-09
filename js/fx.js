// galaxy background (static nebula layer + animated stars) + typing particles

const starsCanvas = document.getElementById('stars');
const partCanvas = document.getElementById('particles');
const sctx = starsCanvas.getContext('2d');
const pctx = partCanvas.getContext('2d');
const nebula = document.createElement('canvas');

let W = 0, H = 0, DPR = 1;
let stars = [];
const particles = [];

// gaussian-ish random in [-1, 1]
const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  for (const c of [starsCanvas, partCanvas, nebula]) {
    c.width = W * DPR;
    c.height = H * DPR;
  }
  paintNebula();
  seedStars();
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
  const n = nebula.getContext('2d');
  n.setTransform(DPR, 0, 0, DPR, 0, 0);
  n.clearRect(0, 0, W, H);
  const diag = Math.hypot(W, H);

  // the milky way runs on a diagonal through the screen
  const ang = -Math.PI / 4.6;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const bandAt = (t, spread) => ({
    x: W * 0.5 + cos * t * diag * 0.5 + -sin * gauss() * spread,
    y: H * 0.42 + sin * t * diag * 0.5 + cos * gauss() * spread,
  });

  n.globalCompositeOperation = 'lighter';

  // large ambient gas clouds
  cloud(n, W * 0.78, H * 0.06, diag * 0.42, '96,54,150', 0.16);
  cloud(n, W * 0.10, H * 0.95, diag * 0.38, '40,70,150', 0.15);
  cloud(n, W * 0.30, H * 0.30, diag * 0.30, '150,60,120', 0.07);
  cloud(n, W * 0.85, H * 0.65, diag * 0.26, '50,120,150', 0.06);

  // glowing puffs hugging the band
  for (let i = 0; i < 26; i++) {
    const p = bandAt(gauss() * 0.9, diag * 0.05);
    const colors = ['120,90,200', '80,90,190', '160,80,160', '90,130,190'];
    cloud(n, p.x, p.y, diag * (0.05 + Math.random() * 0.09), colors[i % colors.length], 0.05 + Math.random() * 0.05);
  }
  // bright galactic core
  const core = bandAt(0.05, 0);
  cloud(n, core.x, core.y, diag * 0.16, '210,190,230', 0.10);
  cloud(n, core.x, core.y, diag * 0.07, '235,220,235', 0.10);

  // thousands of faint band stars
  for (let i = 0; i < Math.min(2600, (W * H) / 220); i++) {
    const p = bandAt(gauss() * 1.1, diag * (0.035 + Math.random() * 0.06));
    const r = Math.random() * 0.7 + 0.15;
    const a = 0.08 + Math.random() * 0.5;
    const tint = Math.random();
    n.fillStyle = tint < 0.75 ? `rgba(255,255,255,${a})`
      : tint < 0.88 ? `rgba(200,215,255,${a})`
      : `rgba(255,225,190,${a})`;
    n.beginPath();
    n.arc(p.x, p.y, r, 0, Math.PI * 2);
    n.fill();
  }

  // scattered field stars outside the band
  for (let i = 0; i < (W * H) / 2600; i++) {
    const a = 0.05 + Math.random() * 0.35;
    n.fillStyle = `rgba(255,255,255,${a})`;
    n.beginPath();
    n.arc(Math.random() * W, Math.random() * H, Math.random() * 0.6 + 0.15, 0, Math.PI * 2);
    n.fill();
  }

  // dark dust lanes across the band
  n.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 9; i++) {
    const p = bandAt(gauss() * 0.8, diag * 0.02);
    const g = n.createRadialGradient(p.x, p.y, 0, p.x, p.y, diag * (0.03 + Math.random() * 0.05));
    g.addColorStop(0, 'rgba(5,3,15,0.32)');
    g.addColorStop(1, 'rgba(5,3,15,0)');
    n.fillStyle = g;
    n.fillRect(0, 0, W, H);
  }
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
  const count = Math.round((W * H) / 3800);
  stars = Array.from({ length: count }, () => {
    const bright = Math.random() < 0.06;
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: bright ? 1.1 + Math.random() * 1.3 : 0.25 + Math.random() * 0.85,
      bright,
      tw: Math.random() * Math.PI * 2,
      ts: 0.4 + Math.random() * 1.6,
      vy: 0.003 + Math.random() * 0.012,
      c: pickTint(),
    };
  });
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
    const sp = 0.15 + Math.random() * 0.55;
    particles.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 0.35,
      r: 0.6 + Math.random() * 1.5,
      life: 1,
      decay: 0.012 + Math.random() * 0.02,
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

  sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  sctx.clearRect(0, 0, W, H);
  sctx.drawImage(nebula, 0, 0, W, H);

  for (const s of stars) {
    s.y -= s.vy;
    if (s.y < -2) { s.y = H + 2; s.x = Math.random() * W; }
    const a = 0.22 + 0.78 * (0.5 + 0.5 * Math.sin(s.tw + t * s.ts));
    sctx.fillStyle = s.c + (a * 0.95).toFixed(3) + ')';
    sctx.beginPath();
    sctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    sctx.fill();
    if (s.bright && a > 0.55) {
      const f = s.r * (2.6 + a * 2);
      sctx.strokeStyle = s.c + (a * 0.28).toFixed(3) + ')';
      sctx.lineWidth = 0.7;
      sctx.beginPath();
      sctx.moveTo(s.x - f, s.y); sctx.lineTo(s.x + f, s.y);
      sctx.moveTo(s.x, s.y - f); sctx.lineTo(s.x, s.y + f);
      sctx.stroke();
    }
  }

  updateMeteor(dt);

  pctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  pctx.clearRect(0, 0, W, H);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy -= 0.002;
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
