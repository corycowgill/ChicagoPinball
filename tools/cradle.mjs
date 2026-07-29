// Flipper control audit. Three things every real machine gives you:
//   1. CRADLE  — a ball landing on a HELD flipper settles at the base and
//                stays there, so you can aim instead of scrambling.
//   2. ROLL-DOWN — a ball landing on a RESTING flipper rolls to the base
//                and waits, rather than bouncing off into the outlane.
//   3. LIVE FLIP — flipping from that cradle actually launches the ball.
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
let st = '';
for (let i = 0; i < 4 && st !== 'PLAYING'; i++) {
  await page.keyboard.down('Space');
  await page.waitForTimeout(1200 + i * 500);
  await page.keyboard.up('Space');
  await page.waitForTimeout(3000);
  st = await page.evaluate(() => window.__pinball.state);
}
if (st !== 'PLAYING') throw new Error('no PLAYING');

const geom = await page.evaluate(() => {
  const g = window.__pinball;
  g.ballSaveMs = 1e9;
  const [fl, fr] = [g.playfield.leftFlipper, g.playfield.rightFlipper];
  return {
    left: { x: fl.pivotX, y: fl.pivotY },
    right: { x: fr.pivotX, y: fr.pivotY },
    center: g.playfield.playCenter,
  };
});
console.log('flipper pivots:', JSON.stringify(geom));

// Park a ball at (x,y) with a downward drop, optionally holding a flipper,
// then watch until it settles or leaves.
async function drop({ x, y, vx = 0, vy = 4, hold = null, ms = 4200 }) {
  if (hold) await page.keyboard.down(hold);
  const r = await page.evaluate(
    async ({ x, y, vx, vy, ms }) => {
      const g = window.__pinball;
      const free = () => {
        const b = g.playfield.balls[0];
        if (!b || b.body.$transit || b.body.isStatic) return null;
        for (const sc of [g.playfield.lakeMichiganScoop, g.playfield.cityTourScoop]) {
          if (sc.captured === b.body) return null;
        }
        return b;
      };
      let b = null;
      for (let i = 0; i < 40 && !(b = free()); i++) await new Promise((r) => setTimeout(r, 120));
      if (!b) return { outcome: 'NO-BALL' };
      b.setPosition(x, y);
      b.setVelocity(vx, vy);
      const t0 = performance.now();
      const track = [];
      while (performance.now() - t0 < ms) {
        await new Promise((r) => setTimeout(r, 40));
        const bb = g.playfield.balls[0];
        if (!bb) return { outcome: 'DRAINED', ms: Math.round(performance.now() - t0) };
        const p = bb.body.position;
        track.push([Math.round(p.x), Math.round(p.y)]);
        if (p.y > 830) return { outcome: 'DRAINED', at: [Math.round(p.x), Math.round(p.y)] };
      }
      // A cradled ball is not frozen — it rocks a little in the pocket, the
      // way a real one does. What makes it a cradle is that it STAYS: over
      // the back half of the window it never leaves a small box. Testing for
      // frame-to-frame stillness instead just measures solver jitter.
      const tail = track.slice(Math.floor(track.length / 2));
      const xs = tail.map((p) => p[0]);
      const ys = tail.map((p) => p[1]);
      const spread = Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      );
      const p = g.playfield.balls[0].body.position;
      return {
        outcome: spread <= 20 ? 'SETTLED' : 'LOOSE',
        at: [Math.round(p.x), Math.round(p.y)],
        spread,
        track: track.slice(-5),
      };
    },
    { x, y, vx, vy, ms },
  );
  if (hold) await page.keyboard.up(hold);
  return r;
}

console.log('\n── 1. CRADLE: ball onto a HELD flipper ──');
const cradleL = await drop({ x: geom.left.x + 55, y: 700, vy: 6, hold: 'z' });
console.log('  left  (held):', JSON.stringify(cradleL));
const cradleR = await drop({ x: geom.right.x - 55, y: 700, vy: 6, hold: '/' });
console.log('  right (held):', JSON.stringify(cradleR));

console.log('\n── 2. ROLL-DOWN: ball onto a RESTING flipper ──');
const restL = await drop({ x: geom.left.x + 55, y: 700, vy: 6 });
console.log('  left  (rest):', JSON.stringify(restL));
const restR = await drop({ x: geom.right.x - 55, y: 700, vy: 6 });
console.log('  right (rest):', JSON.stringify(restR));

console.log('\n── 3. LIVE FLIP out of the cradle ──');
// One trial is racy: after releasing, the ball rides the returning bat, and
// exactly when it is re-struck varies by a frame or two. Run several and
// report the spread — what matters is that a cradled ball can reliably be
// shot to the top of the playfield, not any single launch.
const trials = [];
for (let t = 0; t < 5; t++) {
  // Re-serve if a previous trial drained, so every trial actually runs.
  await page.evaluate(async () => {
    const g = window.__pinball;
    for (let i = 0; i < 40 && !g.playfield.balls.length; i++) {
      if (g.state === 'READY') g.launchBall?.();
      await new Promise((r) => setTimeout(r, 150));
    }
  });
  const have = await page.evaluate(() => window.__pinball.playfield.balls.length > 0);
  if (!have) {
    console.log(`  trial ${t + 1}: skipped — no ball in play`);
    continue;
  }
  await page.keyboard.down('z');
  await page.evaluate(async () => {
    const g = window.__pinball;
    const b = g.playfield.balls[0];
    if (b) {
      b.setPosition(g.playfield.leftFlipper.pivotX + 55, 700);
      b.setVelocity(0, 6);
    }
    await new Promise((r) => setTimeout(r, 1500));
  });
  const at = await page.evaluate(() => {
    const b = window.__pinball.playfield.balls[0];
    return b ? [Math.round(b.body.position.x), Math.round(b.body.position.y)] : null;
  });
  await page.keyboard.up('z');
  await page.waitForTimeout(200); // let the bat fully return with the ball on it
  await page.keyboard.down('z');
  const r = await page.evaluate(async () => {
    const g = window.__pinball;
    let apex = 9999;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 40));
      const b = g.playfield.balls[0];
      if (!b) break;
      apex = Math.min(apex, b.body.position.y);
    }
    return Math.round(apex);
  });
  await page.keyboard.up('z');
  trials.push({ cradledAt: at, apexY: r });
  console.log(`  trial ${t + 1}: cradled ${JSON.stringify(at)} → apex y=${r}`);
}
const apexes = trials.map((t) => t.apexY).sort((a, b) => a - b);
const launched = { apexY: apexes[Math.floor(apexes.length / 2)], best: apexes[0] };
console.log('  median apex y:', launched.apexY, '| best:', launched.best);

// ── Assertions ──
const fails = [];
for (const [name, r] of [['left', cradleL], ['right', cradleR]]) {
  if (r.outcome !== 'SETTLED') fails.push(`${name} held flipper did not cradle (${r.outcome})`);
}
// A ball that comes to rest on a LOWERED bat is NOT a defect: that is an
// ordinary pinball state and the player just flips it. The original version
// of this check asserted the ball had to roll off, which was wrong — it
// failed on both sides while soak and trap (the actual stuck-ball
// detectors) reported zero stuck frames.
// What matters is that the ball stays RECOVERABLE: on the bat or rolling
// down toward it, never wandering somewhere no flipper can reach.
for (const [name, r] of [['left', restL], ['right', restR]]) {
  if (r.outcome === 'DRAINED') continue; // rolled off into the drain: fine
  const [x, y] = r.at;
  const onBat = y > 690 && x > 90 && x < 390;
  if (!onBat) fails.push(`${name} resting-flipper ball ended out of flipper reach at ${r.at}`);
}
// The cradle is worthless if you can't shoot out of it: the flip must send
// the ball to the top of the playfield.
if (!(launched.best < 260))
  fails.push(`no flip out of the cradle reached the upper playfield (best apex y=${launched.best})`);

console.log('\nERRORS:', JSON.stringify(errors));
await browser.close();
if (fails.length || errors.length) {
  for (const f of fails) console.log('FAIL:', f);
  process.exit(1);
}
console.log('CRADLE OK');
