/** Which shots can this board actually make, and from where on the bat?
 *
 *  There has never been a deterministic answer to that. `tools/shotodds.mjs`
 *  drives the real game in a browser and is the only end-to-end judge, but it
 *  measured sd 4.3-5.3 on completely unchanged geometry, which is wide enough
 *  that three conclusions drawn from it in this project had to be withdrawn.
 *  `validateLayout` is exact but answers a different question: it measures the
 *  CLEARANCE of a straight line, and a straight line is not a trajectory. Both
 *  loop shots currently measure -11px against a slingshot and are made 90% of
 *  the time, because a real flipper shot leaves the bat tangentially and
 *  curves around its own slingshot.
 *
 *  This sits between them. It cradles a ball on the real bat at a spread of
 *  strike points, swings the real flipper, steps the real world, and records
 *  every ScoreEvent that comes back. No browser, no RNG, no clock — so unlike
 *  shotodds it is repeatable to the byte, and unlike validateLayout it is
 *  measuring the shot rather than a line drawn where the shot might go.
 *
 *  The flip model is lifted whole from src/dev/captivereach.ts, where it cost
 *  four corrections to get right: released into the bat (the solver ate the
 *  velocity and it read "90% short" with a median closest approach exactly
 *  equal to the starting distance), released into the slingshot (which kicked
 *  the ball at its own angle), an aperture band released inside a scoop's
 *  capture circle, and a stuck-detector checked too late to tell a wedged ball
 *  from a fast rejection. captivereach now imports `flick` from here rather
 *  than keeping a second copy — the same reason `measureShotLine` was
 *  exported after tools/baseline.mts drifted from the rule it was seeding.
 *
 *  Dev-only. Never imported by the game.
 */
import Matter from 'matter-js';
import { BALL_RADIUS } from '../constants';
import { Physics } from '../Physics';
import { Playfield, PlayfieldEvents } from '../scene/Playfield';
import { DEFAULT_LAYOUT } from '../layout/default';
import { PlayfieldLayout } from '../layout/types';
import { ScoreEvent } from '../types';

const DT = 1000 / 60;
/** Steps the world needs to settle before a trial means anything. Bodies are
 *  created at their rest pose and sag on the first frames; striking during the
 *  sag measures the harness, not the board. */
export const SETTLE_STEPS = 30;
/** Long enough for a ramp's whole transit and a scoop's hold-and-kick. */
const MAX_STEPS = 300;
/** How long the bat is held up, in steps. 6 ~= the 90ms tap shotodds uses. */
const HOLD_STEPS = 6;

/** Strike points along the bat, as a fraction of its length from the pivot.
 *  A flipper is aimed by WHERE the ball sits on it, so this is the fan that
 *  matters — sweeping an aim angle instead would be modelling a cannon.
 *
 *  It stops at 0.88 because past there the ball is off the end of the bat.
 *  Measured: launch speed falls off a cliff from 20.1 at frac 0.85 to 9.3 at
 *  0.90, and the launch angle goes NEGATIVE — the tip pushes the ball
 *  downward. Sampling 0.9-1.0 spends a quarter of the run on trials that
 *  cannot score anything. */
export const FRACS = [
  0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.88,
];

/** Frames the ball is left to settle onto the bat before the swing.
 *
 *  Swept, not chosen, because choosing is a knife edge. Measured over the
 *  whole frac range at a single dwell each:
 *
 *      dwell  0   ramp:L 2  ramp:R 3  loop:R 0  lake-bonus 7  scoop 1
 *      dwell  3   ramp:L 6  ramp:R 6  loop:R 1  lake-bonus 2  scoop 0
 *      dwell  6   ramp:L 2  ramp:R 2  loop:R 1  lake-bonus 2  scoop 0
 *
 *  Dwell 3 doubles the ramps and is the only setting that finds the right
 *  orbit at all; dwell 0 is the only one that finds the mode scoop. No
 *  setting dominates, so a table built on one of them reports its own choice
 *  as a fact about the board. That is the failure mode that made
 *  tools/makerate.mjs unusable (sd 5.3 on unchanged geometry).
 *
 *  Sweeping instead turns the statistic into something a designer can act
 *  on: not "is this shot makeable" but HOW BIG THE WINDOW IS — how much of
 *  the (strike point x settle) space produces it. */
export const DWELLS = [0, 3, 6, 12];

export const NO_EVENTS: PlayfieldEvents = {
  onScore: () => {},
  onLockComplete: () => {},
  onScoopMode: () => {},
  onLanesComplete: () => {},
  onDrain: () => {},
  onLeftOutlane: () => {},
  onRightOutlane: () => {},
};

/** One flip: what did it score, and did it even leave the bat? */
export interface FlickResult {
  side: 'left' | 'right';
  frac: number;
  /** Every distinct ScoreEvent key the trial produced, in order of arrival.
   *  Ramps and loops carry a letter, so 'ramp' alone would merge the two. */
  scored: string[];
  /** True when the ball never left the bat — a harness fault, not a board
   *  fact, and it must be visible as one. */
  stuck: boolean;
}

const keyOf = (e: ScoreEvent) => (e.letter ? `${e.kind}:${e.letter}` : e.kind);

/** Cradle a ball on the bat at `frac` along it, then swing.
 *
 *  Placement arithmetic matches tools/shotodds.mjs, which is the browser-side
 *  judge of the same question — two models of one thing is how they drift.
 */
export function flick(
  layout: PlayfieldLayout,
  side: 'left' | 'right',
  frac: number,
  dwell = 0,
  maxSteps = MAX_STEPS,
): FlickResult {
  const scored: string[] = [];
  const physics = new Physics();
  const pf = new Playfield(
    physics,
    { ...NO_EVENTS, onScore: (e: ScoreEvent) => scored.push(keyOf(e)) },
    layout,
  );
  for (let s = 0; s < SETTLE_STEPS; s++) {
    pf.tick(DT);
    physics.step(DT);
  }

  const ball = pf.balls[0].body;
  const f = side === 'left' ? pf.leftFlipper : pf.rightFlipper;
  const a = f.restAngle;
  // Outward normal of the bat, forced to point UP the playfield. `(-sin a,
  // cos a)` does that for the left bat but points DOWN for the right one
  // (rest angle pi - 0.46), which drops the ball under the flipper line and
  // straight out — a whole right-flipper data set was garbage before this was
  // spotted, in the browser probe, years of this project's time ago.
  let nx = -Math.sin(a);
  let ny = Math.cos(a);
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const d = f.len * frac;
  const from = {
    x: f.pivotX + Math.cos(a) * d + nx * (f.height / 2 + BALL_RADIUS),
    y: f.pivotY + Math.sin(a) * d + ny * (f.height / 2 + BALL_RADIUS),
  };
  // setPosition, never a raw write to body.position: a direct write leaves
  // Matter's cached bounds stale, and stale bounds mean the broadphase never
  // pairs the ball with a sensor. That bug silently zeroed an earlier probe.
  Matter.Body.setPosition(ball, from);
  Matter.Body.setVelocity(ball, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(ball, 0);
  // Let it settle onto the bat first. A real shot is taken off a cradle, not
  // off a ball hanging in mid-air at a commanded height.
  for (let s = 0; s < dwell; s++) {
    pf.tick(DT);
    physics.step(DT);
  }
  const released = { x: ball.position.x, y: ball.position.y };
  pf.setFlippers(side === 'left', side === 'right');

  let stuck = false;
  for (let s = 0; s < maxSteps; s++) {
    // A flip is a TAP, not a hold. Holding the bat up for the whole trial
    // leaves a raised paddle in the ball's way on the way back down, and a
    // held bat is deadening rather than driving (see Flipper.tick) — so a
    // ball returning to it dies instead of bouncing. tools/shotodds.mjs holds
    // the key for 90ms; this matches at 6 steps.
    if (s === HOLD_STEPS) pf.setFlippers(false, false);
    pf.tick(DT);
    physics.step(DT);
    // A cradled ball is stationary at rest, so this cannot be checked at
    // release; by step 8 a real flip has thrown it clear of the bat.
    if (s === 8 && Math.hypot(ball.position.x - released.x, ball.position.y - released.y) < 12) {
      stuck = true;
      break;
    }
  }
  return { side, frac, scored: [...new Set(scored)], stuck };
}

/** The shots worth asking about.
 *
 *  Matched by PREFIX, not equality, and that distinction was a bug first: a
 *  drop target reports as `drop-target:C` and a standup as `standup:bears`,
 *  so exact keys made both rows read a confident 0 while the board was
 *  hitting them constantly. Ramps and loops keep their letter because L and R
 *  are genuinely different shots; the lettered targets do not, because which
 *  CHICAGO letter you knocked down is not a different shot. */
export const TARGETS = [
  'ramp:L',
  'ramp:R',
  'loop:L',
  'loop:R',
  'scoop',
  'lake-bonus',
  'captive',
  'lock',
  'drop-target',
  'standup',
  'spinner',
  'pop-bumper',
] as const;

const hit = (scored: string[], target: string) =>
  scored.some((s) => s === target || s.startsWith(`${target}:`));

export interface ShotRow {
  target: string;
  /** How many (strike point x settle) cells scored it, per side. The window. */
  left: number;
  right: number;
  made: number;
  /** The strike points that ever worked, for a designer reading the map. */
  fracs: string;
}

export interface ShotTable {
  rows: ShotRow[];
  /** Cells per side, so a row can be read as a fraction of the bat's range. */
  perSide: number;
  trials: number;
  stuck: number;
}

export function shotTable(layout: PlayfieldLayout = DEFAULT_LAYOUT): ShotTable {
  const results: FlickResult[] = [];
  for (const side of ['left', 'right'] as const) {
    for (const frac of FRACS) {
      for (const dwell of DWELLS) results.push(flick(layout, side, frac, dwell));
    }
  }
  const rows: ShotRow[] = TARGETS.map((target) => {
    const on = results.filter((r) => hit(r.scored, target));
    const left = on.filter((r) => r.side === 'left').length;
    const right = on.filter((r) => r.side === 'right').length;
    const fracs = [...new Set(on.map((r) => `${r.side[0].toUpperCase()}${r.frac.toFixed(2)}`))]
      .sort()
      .join(' ');
    return { target, left, right, made: left + right, fracs };
  });
  return {
    rows,
    perSide: FRACS.length * DWELLS.length,
    trials: results.length,
    stuck: results.filter((r) => r.stuck).length,
  };
}

export function formatTable(t: ShotTable, compare?: ShotTable): string {
  const pct = (n: number) => `${Math.round((n / t.perSide) * 100)}%`.padStart(4);
  const lines = t.rows.map((r) => {
    const was = compare?.rows.find((x) => x.target === r.target);
    const d = was ? r.made - was.made : 0;
    const delta = was ? (d === 0 ? '      ' : `${d > 0 ? '+' : ''}${d}`.padStart(6)) : '';
    const verdict = r.made === 0 ? '  DEAD' : r.made <= 2 ? '  knife-edge' : '';
    return (
      `  ${r.target.padEnd(12)} ${String(r.made).padStart(3)}/${t.trials}${delta}  ` +
      `L${pct(r.left)} R${pct(r.right)}  ${'#'.repeat(Math.min(r.made, 24)).padEnd(24)}${verdict}`
    );
  });
  return (
    lines.join('\n') +
    (t.stuck ? `\n  (${t.stuck} trials STUCK on the bat — harness fault, not a board fact)` : '')
  );
}

/** Where each shot lives on the bat — the map, printed separately because it
 *  is long and only useful when you are moving something. */
export function formatMap(t: ShotTable): string {
  return t.rows
    .filter((r) => r.made > 0)
    .map((r) => `  ${r.target.padEnd(12)} ${r.fracs}`)
    .join('\n');
}

/** The shipped board's make counts, and a floor under them.
 *
 *  Every number here was won by a geometry change, and until now nothing
 *  stopped the next change giving one back. That is not hypothetical: moving
 *  the soccer posts 22px took right-orbit returns from 100% to 12%, and the
 *  only reason it was caught is that `orbitreturn` happened to be run by hand.
 *
 *  The `shotLines` baselines in src/layout/default.ts do NOT cover this, and
 *  the reason is worth stating because it is easy to assume otherwise: they
 *  measure the CLEARANCE of a straight line, which is a different quantity.
 *  Re-aiming the soccer goal moved the mode scoop's make rate 1 -> 6 while its
 *  shot-line clearance went -9 -> -10. A board can pass every clearance rule
 *  in the validator with a dead shot on it.
 *
 *  ── This is a property of ONE HARNESS VERSION, not of the board ──────────
 *  Change FRACS, DWELLS, HOLD_STEPS or MAX_STEPS and every number below moves,
 *  because they define what a "cell" is. Re-seed deliberately when the harness
 *  changes — the same rule tools/baseline.mts follows for shotLines — and
 *  never by pasting whatever the tool last printed.
 */
export const BASELINE: Record<string, number> = {
  'ramp:L': 11,
  'ramp:R': 12,
  'loop:L': 4,
  'loop:R': 3,
  scoop: 6,
  'lake-bonus': 12,
  // The board's one knife-edge shot, and it is knife-edge by a trade rather
  // than by an oversight. `soccer-post-s` sits 10.3px off the left flipper's
  // line to the captive, and it is also the funnel that makes the mode scoop
  // work. Measured: delete it and captive goes 1 -> 4 while scoop goes 6 -> 1.
  // A sweep of 8x8 positions found exactly ONE that holds the scoop at 6, it
  // is the position already shipped, and it scores captive 0. The two shots
  // are mutually exclusive here, and the mode scoop starts City Tour and four
  // of the five sports modes. Deleting the mode scoop outright leaves the
  // captive at 1, so its capture circle was never the blocker either.
  captive: 1,
  lock: 5,
  'drop-target': 10,
  standup: 14,
  spinner: 12,
  'pop-bumper': 10,
};

export interface Regression {
  target: string;
  was: number;
  now: number;
}

/** Every target that scores BELOW its baseline. Empty means no regression.
 *
 *  Only decreases fail. A change that improves a shot is not a problem to be
 *  reported, it is the point — but it does mean the baseline is stale, so
 *  improvements are listed separately for re-seeding. */
export function checkBaseline(t: ShotTable): { worse: Regression[]; better: Regression[] } {
  const worse: Regression[] = [];
  const better: Regression[] = [];
  for (const r of t.rows) {
    const was = BASELINE[r.target];
    if (was === undefined) continue;
    if (r.made < was) worse.push({ target: r.target, was, now: r.made });
    else if (r.made > was) better.push({ target: r.target, was, now: r.made });
  }
  return { worse, better };
}
