// MAKE RATE v2 — repeated, with an error bar.
//
// v1 ran one 25-point strike sweep per flipper and reported the totals as if
// they were exact. They are not: two runs of v1 on IDENTICAL geometry gave
// 21 and 17 total makes. A single sweep carries about +-4 of noise, which is
// larger than most of the differences v1 was being used to judge.
//
// The noise is real physics, not a bug: the flip lands at a slightly
// different point in the substep cycle each time, and a pinball is chaotic —
// a fraction of a pixel at the bat becomes tens of pixels at the target.
//
// So: repeat the whole sweep R times and report mean and spread per shot.
// A difference only counts if it clears the spread.
import { chromium } from 'playwright';

const N = Number(process.env.N || 25);
const R = Number(process.env.R || 3);
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

const MAJOR = ['ramp:L', 'ramp:R', 'loop:L', 'loop:R', 'scoop', 'captive', 'lake-bonus', 'bean', 'lock'];

async function sweep(side) {
  const key = side === 'left' ? 'z' : '/';
  const made = Object.fromEntries(MAJOR.map((k) => [k, 0]));
  for (let i = 0; i < N; i++) {
    const frac = 0.3 + (0.68 * i) / (N - 1);
    await page.evaluate(
      ({ side, frac }) => {
        const g = window.__pinball;
        const pf = g.playfield;
        const f = side === 'left' ? pf.leftFlipper : pf.rightFlipper;
        const b = pf.balls[0];
        if (!b) return;
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
        // Zero the spin too: a carried-over angular velocity from the last
        // trial is one more thing that makes a "repeat" not a repeat.
        window.Matter?.Body?.setAngularVelocity?.(b.body, 0);
        b.body.angularVelocity = 0;
        window.__hits = [];
        if (!g.__origScore) g.__origScore = g.handleScore.bind(g);
        g.handleScore = (e) => {
          window.__hits.push(e.kind + (e.letter ? ':' + e.letter : ''));
          g.__origScore(e);
        };
      },
      { side, frac },
    );
    await page.waitForTimeout(45);
    await page.keyboard.down(key);
    await page.waitForTimeout(90);
    await page.keyboard.up(key);
    const hits = await page.evaluate(async () => {
      for (let i = 0; i < 34; i++) await new Promise((r) => setTimeout(r, 30));
      return window.__hits || [];
    });
    for (const k of MAJOR) if (hits.includes(k)) made[k]++;
    await page.evaluate(() => {
      const b = window.__pinball.playfield.balls[0];
      if (b) {
        b.setPosition(240, 620);
        b.setVelocity(0, 0);
        b.body.angularVelocity = 0;
      }
    });
    await page.waitForTimeout(50);
  }
  return made;
}

const runs = [];
for (let r = 0; r < R; r++) {
  const left = await sweep('left');
  const right = await sweep('right');
  const tot = MAJOR.reduce((s, k) => s + left[k] + right[k], 0);
  runs.push({ left, right, tot });
  console.log(`run ${r + 1}/${R}: total makes ${tot}`);
}

const stat = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  return { m, sd, lo: Math.min(...xs), hi: Math.max(...xs) };
};

console.log(`\n=== ${R} identical sweeps of ${N} strike points per flipper ===`);
console.log('  shot        left mean   right mean   combined (min-max)');
for (const k of MAJOR) {
  const l = stat(runs.map((r) => r.left[k]));
  const rt = stat(runs.map((r) => r.right[k]));
  const c = stat(runs.map((r) => r.left[k] + r.right[k]));
  const tag = c.hi === 0 ? '  DEAD in every run' : '';
  console.log(
    `  ${k.padEnd(11)} ${l.m.toFixed(1).padStart(9)} ${rt.m.toFixed(1).padStart(12)}` +
      `   ${c.m.toFixed(1).padStart(5)} (${c.lo}-${c.hi})${tag}`,
  );
}
const tots = runs.map((r) => r.tot);
const t = stat(tots);
console.log(`\n  TOTAL MAKES: mean ${t.m.toFixed(1)}  sd ${t.sd.toFixed(1)}  range ${t.lo}-${t.hi}`);
console.log(
  `  => a change must move the total by more than ~${Math.ceil(2 * t.sd)} to mean anything.`,
);
console.log('\nERRORS:', JSON.stringify(errors.slice(0, 3)));
await browser.close();
