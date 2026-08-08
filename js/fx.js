// starfield background + typing particle effects

const starsCanvas = document.getElementById('stars');
const partCanvas = document.getElementById('particles');
const sctx = starsCanvas.getContext('2d');
const pctx = partCanvas.getContext('2d');

let W = 0, H = 0, DPR = 1;
let stars = [];
const particles = [];

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  for (const c of [starsCanvas, partCanvas]) {
    c.width = W * DPR;
    c.height = H * DPR;
  }
  seedStars();
}

function seedStars() {
  const count = Math.round((W * H) / 6500);
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() < 0.85 ? Math.random() * 0.9 + 0.3 : Math.random() * 1.6 + 0.9,
    tw: Math.random() * Math.PI * 2,          // twinkle phase
    ts: 0.4 + Math.random() * 1.4,            // twinkle speed
    vy: 0.004 + Math.random() * 0.014,        // slow drift
    hue: Math.random() < 0.12 ? 'rgba(200,180,255,' : 'rgba(255,255,255,',
  }));
}

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
      vy: Math.sin(a) * sp - 0.35,            // gentle upward bias
      r: 0.6 + Math.random() * 1.5,
      life: 1,
      decay: 0.012 + Math.random() * 0.02,
      c: PALETTE[(Math.random() * PALETTE.length) | 0],
    });
  }
}

let t = 0;
function frame() {
  t += 0.016;

  sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  sctx.clearRect(0, 0, W, H);
  for (const s of stars) {
    s.y -= s.vy;
    if (s.y < -2) { s.y = H + 2; s.x = Math.random() * W; }
    const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(s.tw + t * s.ts));
    sctx.fillStyle = s.hue + (a * 0.9).toFixed(3) + ')';
    sctx.beginPath();
    sctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    sctx.fill();
  }

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
