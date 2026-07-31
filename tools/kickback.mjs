/** Does one kickback award actually save the ball?
 *
 *  The eject audit (tools/ejectaudit.mts) measures where ONE eject goes. This
 *  measures whether the FEATURE works: fire the kickback for real, let the
 *  real game loop handle whatever comes back, and ask whether the ball was
 *  still in play afterwards.
 *
 *  It is an A/B, one arm per run against the same build:
 *
 *    oneshot  the award is cleared on the first fire (what shipped)
 *    retry    the award stays lit while the ball keeps falling back into the
 *             outlane, and is consumed only once the save has held
 *
 *  Three harness traps, all of which produced confidently wrong numbers or no
 *  numbers at all before they were found — keep them fixed:
 *
 *  1. **A drain is detected by the STATE, not by the ball's position.** After a
 *     drain the ball is respawned on the plunger, which is high on the board,
 *     so a snapshot at the end of the trial cannot tell a save from a
 *     drain-and-respawn. The first version of this probe reported a flawless
 *     16/16 for both arms on that basis.
 *  2. **Never teleport the ball by writing `body.position`.** That leaves
 *     Matter's bounds and vertices stale, so the outlane sensor never fires and
 *     every trial silently records zero kickbacks. Go through
 *     `playfield.fireKickback()`, which uses `Matter.Body.setPosition`.
 *  3. **Never wait for `networkidle`.** Vite's HMR websocket never lets the
 *     page go idle, so `goto` blocks until its timeout.
 *  4. **Time the trial in GAME time, not wall clock.** Under software GL this
 *     page advances about 580 ms of game time per 3.8 s of wall clock — a 6.5x
 *     slowdown, and it is the three.js scene that costs it, not the viewport
 *     (shrinking the window changes nothing). A wall-clock window therefore
 *     measures a different amount of pinball on every machine. Poll
 *     `game.timeMs`, which advances by exactly one fixed step per update.
 *
 *  Usage:
 *      npm install --no-save playwright
 *      npm run dev -- --port 5199
 *      MODE=oneshot node tools/kickback.mjs
 *      MODE=retry   node tools/kickback.mjs
 *      T=20 MODE=retry node tools/kickback.mjs
 */
import { chromium } from 'playwright';

/** Hard watchdog. A renderer that dies mid-run can leave both the page and the
 *  browser teardown wedged, and a probe that never returns is worse than one
 *  that returns a short arm — the per-trial loop below has already printed
 *  whatever it measured by then. */
const budgetMs = (Number(process.env.T || 10) + 2) * 40_000;
setTimeout(() => {
  console.log(`\n  watchdog: ${Math.round(budgetMs / 1000)}s budget spent, exiting`);
  process.exit(0);
}, budgetMs);

const TRIALS = Number(process.env.T || 10);
const PORT = process.env.PORT || 5199;
/** GAME milliseconds, not wall clock — see trap 4 above. A failed save falls
 *  the length of the outlane and drains in about 2.2 s of game time, so 3.5 s
 *  settles every trial with margin. Expect roughly 25 s of WALL clock per
 *  trial that survives the full window. */
const WATCH_MS = 3500;

/** ONE arm per process, by design. Under software GL the renderer does not
 *  reliably survive a second long run in the same node process — whether the
 *  arm reuses the page, reloads it, or launches a fresh browser, the second
 *  one dies with "Target page, context or browser has been closed". Rather
 *  than paper over that with retries, run the script twice. */
async function arm(mode) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 700, height: 1000 } });
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    // ?stock so a layout saved by the builder cannot change what is measured.
    // NOT `networkidle`: Vite's HMR websocket never lets the page go idle, so
    // that wait hangs until the timeout.
    await page.goto(`http://localhost:${PORT}/?stock`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__pinball !== undefined, null, { timeout: 30_000 });
    await page.waitForTimeout(1200);
    return await run(page, mode);
  } finally {
    // A browser whose renderer has already died can hang here, so do not let
    // teardown swallow the numbers the run did produce.
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
  }
}

/** One trial per `evaluate`, looped from Node rather than inside the page.
 *  The renderer is the fragile part of this harness — a long software-GL run
 *  can lose it — and a crash inside a single long evaluate takes every trial
 *  with it. Per-trial calls mean a crash costs one trial and the arm still
 *  reports what it measured, marked as short. */
async function run(page, mode) {
  const tries = [];
  let saved = 0;
  let done = 0;
  for (let t = 0; t < TRIALS; t++) {
    let r;
    try {
      // `page.evaluate` has no timeout of its own, and a wedged renderer makes
      // it hang rather than reject — so race it. Without this a single dead
      // trial eats the whole run and the arm reports nothing at all.
      r = await Promise.race([
        page.evaluate(
        async ([mode, watchMs]) => {
          const g = window.__pinball;
          const pf = g.playfield;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          g.state = 'PLAYING';
          g.tilted = false;
          let guard = 0;
          while (pf.balls.length > 1 && guard++ < 8) {
            pf.removeBall(pf.balls[pf.balls.length - 1].body);
          }
          if (pf.balls.length === 0) pf.resetBall();
          const ball = pf.balls[0].body;

          // Put the game in the state it is in one frame after the award
          // fires, then let it run. `oneshot` differs only in the light being
          // spent on that first fire.
          g.kickbackLit = mode === 'retry';
          g.kickbackTries = mode === 'retry' ? 1 : 0;
          g.lastKickbackFireAt = g.timeMs;
          pf.lastKickbackAt = -1000;
          pf.fireKickback(ball);

          const until = g.timeMs + watchMs;
          while (g.timeMs < until) {
            await sleep(50);
            if (g.state !== 'PLAYING') return { drained: true, tries: g.kickbackTries ?? -1 };
          }
          return { drained: false, tries: g.kickbackTries ?? -1 };
        },
          [mode, WATCH_MS],
        ),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('trial timed out — renderer wedged')), 90_000),
        ),
      ]);
    } catch (e) {
      console.log(`  trial ${t + 1}: lost the page (${String(e).split('\n')[0]}) — stopping short`);
      break;
    }
    done++;
    if (!r.drained) saved++;
    tries.push(r.tries);
  }
  return { saved, total: done, tries };
}

const MODE = process.env.MODE || 'retry';
if (MODE !== 'retry' && MODE !== 'oneshot') {
  throw new Error(`MODE must be 'retry' or 'oneshot', got '${MODE}'`);
}
const r = await arm(MODE);
const pct = ((r.saved / r.total) * 100).toFixed(0);
console.log(`kickback save rate — ${MODE}`);
console.log(`  saved ${r.saved}/${r.total}  (${pct}%)`);
console.log(`  attempts used per trial: ${r.tries.join(',')}`);
console.log(
  '\n  attempts of 0 mean the award was retired because the save held;\n' +
    '  a non-zero count is a trial that was still retrying when time ran out.',
);
// A wedged renderer can keep the process alive after close(); the numbers are
// printed, so leaving is the right move.
process.exit(0);
