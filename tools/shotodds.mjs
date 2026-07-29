// SHOT ODDS — how often can a given shot actually be made?
//
// This replaces the question makerate.mjs was being asked to answer.
// makerate sweeps 25 strike points once and reports "total makes"; that
// number turned out to have sd 5.3 on identical geometry (runs of 10, 15,
// 23, 10), so it cannot resolve the differences it was being used to judge.
// Adding a free-ball guard did not help — the next pair of runs still came
// out 16 and 9 — so the variance is intrinsic, not a harness artefact:
// summing 50 chaotic one-shot trials into a single score throws away which
// shot moved and inherits every trial's noise at once.
//
// The right measurement is narrower and repeated: pick ONE shot, hammer the
// strike point that suits it T times, and report the make fraction with a
// binomial confidence interval. Then a change to that shot is judged on its
// own odds, with an error bar that shrinks as T grows — instead of a whole-
// board score that never settles.
//
//   node tools/shotodds.mjs                 # every shot, 12 trials each
//   SHOT=ramp:R T=40 node tools/shotodds.mjs
import { chromium } from 'playwright';

const T = Number(process.env.T || 12);
const ONLY = process.env.SHOT || '';

// The strike point along the bat that best suits each shot, and which
// flipper takes it. Sourced from the sweeps: these are where makes cluster.
const SHOTS = [
  { key: 'ramp:R', side: 'left', frac: 0.85 },
  { key: 'ramp:L', side: 'right', frac: 0.9 },
  { key: 'loop:L', side: 'right', frac: 0.9 },
  { key: 'loop:R', side: 'left', frac: 0.9 },
  { key: 'scoop', side: 'left', frac: 0.42 },
  { key: 'lake-bonus', side: 'right', frac: 0.86 },
  { key: 'bean', side: 'right', frac: 0.5 },
  { key: 'captive', side: 'left', frac: 0.9 },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
let st = '';
for (let i = 0; i < 5 && st !== 'PLAYING'; i++) {
  await page.keyboard.down('Space');
  await page.waitForTimeout(1300 + i * 400);
  await page.keyboard.up('Space');
  await page.waitForTimeout(3000);
  st = await page.evaluate(() => window.__pinball.state);
}
if (st !== 'PLAYING') throw new Error('no PLAYING');
await page.evaluate(() => {
  const g = window.__pinball;
  g.ballSaveMs = 1e9;
  g.handleDrain = () => {};
});

/** Wilson score interval — behaves sanely at 0/T and T/T, unlike the
 *  textbook normal approximation, which is exactly the regime here. */
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

async function trial(shot) {
  const key = shot.side === 'left' ? 'z' : '/';
  const ok = await page.evaluate(
    async ({ side, frac }) => {
      const g = window.__pinball;
      const pf = g.playfield;
      const f = side === 'left' ? pf.leftFlipper : pf.rightFlipper;
      const free = () => {
        const b = pf.balls[0];
        if (!b || b.body.$transit || b.body.isStatic) return null;
        for (const sc of [pf.lakeMichiganScoop, pf.cityTourScoop]) {
          if (sc.captured === b.body) {
            sc.captureTimer = 1e6;
            return null;
          }
        }
        return b;
      };
      let b = null;
      for (let t = 0; t < 40 && !(b = free()); t++) await new Promise((r) => setTimeout(r, 100));
      if (!b) return false;
      const a = f.restAngle;
      const d = f.len * frac;
      let nx = -Math.sin(a);
      let ny = Math.cos(a);
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      b.setPosition(
        f.pivotX + Math.cos(a) * d + nx * (f.height / 2 + 11),
        f.pivotY + Math.sin(a) * d + ny * (f.height / 2 + 11),
      );
      b.setVelocity(0, 0);
      b.body.angularVelocity = 0;
      window.__hits = [];
      if (!g.__origScore) g.__origScore = g.handleScore.bind(g);
      g.handleScore = (e) => {
        window.__hits.push(e.kind + (e.letter ? ':' + e.letter : ''));
        g.__origScore(e);
      };
      return true;
    },
    shot,
  );
  if (!ok) return null; // voided: ball never came free
  await page.waitForTimeout(45);
  await page.keyboard.down(key);
  await page.waitForTimeout(90);
  await page.keyboard.up(key);
  const hits = await page.evaluate(async () => {
    for (let i = 0; i < 34; i++) await new Promise((r) => setTimeout(r, 30));
    return window.__hits || [];
  });
  await page.evaluate(() => {
    const b = window.__pinball.playfield.balls[0];
    if (b) {
      b.setPosition(240, 620);
      b.setVelocity(0, 0);
      b.body.angularVelocity = 0;
    }
  });
  await page.waitForTimeout(50);
  return hits.includes(shot.key);
}

console.log(`=== shot odds, ${T} trials each (95% Wilson interval) ===\n`);
for (const shot of SHOTS) {
  if (ONLY && shot.key !== ONLY) continue;
  let made = 0;
  let ran = 0;
  for (let i = 0; i < T; i++) {
    const r = await trial(shot);
    if (r === null) continue;
    ran++;
    if (r) made++;
  }
  const [lo, hi] = wilson(made, ran);
  const bar = '#'.repeat(Math.round((made / Math.max(1, ran)) * 24));
  const verdict =
    hi < 0.02 ? '  DEAD (upper bound under 2%)' : lo > 0.5 ? '  reliable' : lo > 0.1 ? '  makeable' : '  rare';
  console.log(
    `  ${shot.key.padEnd(11)} ${shot.side.padEnd(5)} @${String(Math.round(shot.frac * 100)).padStart(3)}%  ` +
      `${String(made).padStart(3)}/${String(ran).padEnd(3)} = ${((100 * made) / Math.max(1, ran)).toFixed(0).padStart(3)}%  ` +
      `[${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}%] ${bar}${verdict}`,
  );
}
console.log('\nERRORS:', JSON.stringify(errors.slice(0, 3)));
await browser.close();
