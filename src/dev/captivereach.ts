/** Can the captive ball actually be hit?
 *
 *  It is the one shot on this board that has measured ZERO makes in every run
 *  of every instrument — the strike sweeps, `makerate`, `shotodds` — with no
 *  variance at all, which is the signature of something structurally
 *  impossible rather than merely hard. And it is not a decorative target: a
 *  solid strike is 3000, feeds the combo chain, and SPOTS the next CHICAGO
 *  letter, which is the mechanism that makes the headline shot on the
 *  playfield art reachable inside a three-ball game.
 *
 *  Nothing existing can answer the question. `validateLayout` draws straight
 *  lines from a flipper pivot and measures clearance, so it sees blockers ON
 *  the way; it cannot see that the target's own mouth is too narrow to admit
 *  a ball. `ejectaudit` only fires kickers. So: build the REAL playfield,
 *  release a ball below the captive's mouth across a deterministic fan, step
 *  the REAL engine, and count `captive` score events.
 *
 *  Two bands, because they answer two different questions and mixing them
 *  produces a number that cannot be acted on:
 *
 *    - APERTURE: released just below the mouth, above everything else. This
 *      is the target's own geometry and nothing else — if this reads zero,
 *      no approach on any board can ever score.
 *    - APPROACH: released at the flipper line and aimed at the mouth. This
 *      is the shot as a player takes it, and it includes what is in the way.
 *
 *  Dev-only. Never imported by the game.
 */
import Matter from 'matter-js';
import { BALL_RADIUS } from '../constants';
import { Physics } from '../Physics';
import { CaptiveBall } from '../entities/CaptiveBall';
import { Playfield, PlayfieldEvents } from '../scene/Playfield';
import { DEFAULT_LAYOUT } from '../layout/default';
import { resolveLayout } from '../layout/resolve';
import { PlayfieldLayout } from '../layout/types';
import { ScoreEvent } from '../types';

const DT = 1000 / 60;
/** Steps the tether needs to settle before a trial means anything. The
 *  captive is created exactly at its rest length, so it sags on the first
 *  frames; striking during the sag measures the harness, not the board. */
const SETTLE_STEPS = 30;
/** Strike points along the bat, as a fraction of its length from the pivot.
 *  A flipper is aimed by WHERE the ball sits on it, so this is the fan that
 *  matters — sweeping aim angle instead would be modelling a cannon. */
const FRACS = [0.45, 0.55, 0.65, 0.75, 0.85, 0.9, 0.95, 1.0];

/** Events every trial ignores. Named so the two constructions in this file
 *  cannot drift apart. */
const NO_EVENTS: PlayfieldEvents = {
  onScore: () => {},
  onLockComplete: () => {},
  onScoopMode: () => {},
  onLanesComplete: () => {},
  onDrain: () => {},
  onLeftOutlane: () => {},
  onRightOutlane: () => {},
};

/** What happened to one strike. Ordered by how much it tells you. */
export type Fate =
  /** Scored. The whole point. */
  | 'made'
  /** Swallowed by a scoop on the way — the shot never reached the mouth. */
  | 'scooped'
  /** Reached the mouth's plane but never touched the captive: the aperture
   *  rejected it, or it glanced off a stop post. */
  | 'rejected'
  /** Never got near the mouth at all — blocked lower down, or badly aimed. */
  | 'short'
  /** There is nowhere on this aim line to put the ball. Solid material sits
   *  against the bat, so the shot cannot be taken at all — this is a verdict
   *  about the board, and the strongest one the probe can return. */
  | 'blocked'
  /** The release itself failed: the ball was placed overlapping a body and
   *  the solver ate the velocity on the first step. Not a fact about the
   *  board — a fact about the harness, and it must be visible rather than
   *  tallied as a miss. The first version of the approach band released the
   *  ball ON the flipper bat and read 90% 'short' with a median closest
   *  approach exactly equal to the starting distance. */
  | 'stuck';

export interface Trial {
  fate: Fate;
  /** Closest the striking ball's centre ever came to the captive's centre.
   *  Contact is at ball r + captive r = 21, so this separates "bounced off
   *  the pinch" (~22-30) from "never in the neighbourhood" (60+). */
  closest: number;
}

export interface ReachResult {
  label: string;
  tally: Record<Fate, number>;
  total: number;
  /** Median closest-approach over the whole fan, in px. */
  medianClosest: number;
}

function captiveOf(layout: PlayfieldLayout): { x: number; y: number } {
  const c = layout.elements.find((e) => e.kind === 'captive');
  if (!c || c.kind !== 'captive') throw new Error('captivereach: layout has no captive');
  return { x: c.x, y: c.y };
}

/** A settled world plus the fate the score stream has decided so far. */
interface World {
  physics: Physics;
  pf: Playfield;
  ball: Matter.Body;
  settle: (f: Fate) => void;
  fate: () => Fate | null;
}

function build(layout: PlayfieldLayout): World {
  let fate: Fate | null = null;
  const settle = (f: Fate) => {
    if (fate === null) fate = f;
  };
  const physics = new Physics();
  const pf = new Playfield(
    physics,
    {
      ...NO_EVENTS,
      onScore: (e: ScoreEvent) => {
        if (e.kind === 'captive') settle('made');
        if (e.kind === 'scoop' || e.kind === 'lake-bonus') settle('scooped');
      },
    },
    layout,
  );
  for (let s = 0; s < SETTLE_STEPS; s++) {
    pf.tick(DT);
    physics.step(DT);
  }
  return { physics, pf, ball: pf.balls[0].body, settle, fate: () => fate };
}

/** Step until the score stream decides, tracking how near the captive the
 *  ball ever got and whether it reached the mouth at all. */
function follow(w: World, maxSteps: number, onStep?: (s: number) => Fate | null): Trial {
  const { pf, ball, physics } = w;
  const cap = pf.captive.ball;
  const mouthY = pf.captive.y;
  let closest = Infinity;
  let reachedMouth = false;
  for (let s = 0; s < maxSteps; s++) {
    pf.tick(DT);
    physics.step(DT);
    const abort = onStep?.(s);
    if (abort) return { fate: abort, closest: Math.round(Math.min(closest, 9999)) };
    const d = Math.hypot(ball.position.x - cap.position.x, ball.position.y - cap.position.y);
    if (d < closest) closest = d;
    if (
      Math.abs(ball.position.x - pf.captive.x) < CaptiveBall.OUTER_HALF &&
      ball.position.y < mouthY + 24
    ) {
      reachedMouth = true;
    }
    if (w.fate() !== null) break;
  }
  w.settle(reachedMouth ? 'rejected' : 'short');
  return { fate: w.fate() as Fate, closest: Math.round(closest) };
}

/** One strike: put a ball at (x,y), send it at (vx,vy), step until something
 *  decisive happens. */
export function strike(
  layout: PlayfieldLayout,
  x: number,
  y: number,
  vx: number,
  vy: number,
  maxSteps: number,
): Trial {
  const w = build(layout);
  // setPosition, never a raw write to body.position: a direct write leaves
  // Matter's cached bounds stale, and stale bounds mean the broadphase never
  // pairs the ball with a sensor. That bug silently zeroed an earlier probe.
  Matter.Body.setPosition(w.ball, { x, y });
  Matter.Body.setVelocity(w.ball, { x: vx, y: vy });
  Matter.Body.setAngularVelocity(w.ball, 0);
  const speed = Math.hypot(vx, vy);
  return follow(w, maxSteps, (s) =>
    // The release must have taken. Checked at TWO steps, not four: by four a
    // legitimately fast trial can already have hit a stop post and bounced
    // back to a small net displacement, which the first version of this
    // guard scored as a harness failure.
    s === 1 && Math.hypot(w.ball.position.x - x, w.ball.position.y - y) < speed * 0.8
      ? 'stuck'
      : null,
  );
}

/** One FLIP: cradle a ball on the bat at `frac` along its length, then swing.
 *
 *  This replaced a straight-line "aim from the pivot" model, and the
 *  replacement was not cosmetic. A flipper does not shoot along a line from
 *  its hinge — where the ball sits on the bat is what aims it — and modelling
 *  it as a line put the release point inside the slingshot on both sides. The
 *  slingshot then kicked the ball at its own angle and the probe reported the
 *  resulting mess as a fact about the captive. Same placement arithmetic as
 *  tools/shotodds.mjs, which is the browser-side judge for the same question.
 */
export function flick(
  layout: PlayfieldLayout,
  side: 'left' | 'right',
  frac: number,
  maxSteps: number,
): Trial {
  const w = build(layout);
  const f = side === 'left' ? w.pf.leftFlipper : w.pf.rightFlipper;
  const a = f.restAngle;
  // Outward normal of the bat, forced to point UP the playfield — the ball
  // rests on top of the bat, not under it.
  let nx = -Math.sin(a);
  let ny = Math.cos(a);
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const d = f.len * frac;
  Matter.Body.setPosition(w.ball, {
    x: f.pivotX + Math.cos(a) * d + nx * (f.height / 2 + BALL_RADIUS),
    y: f.pivotY + Math.sin(a) * d + ny * (f.height / 2 + BALL_RADIUS),
  });
  Matter.Body.setVelocity(w.ball, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(w.ball, 0);
  w.pf.setFlippers(side === 'left', side === 'right');
  return follow(w, maxSteps);
}

function summarise(label: string, trials: Trial[]): ReachResult {
  const tally: Record<Fate, number> = {
    made: 0,
    scooped: 0,
    rejected: 0,
    short: 0,
    blocked: 0,
    stuck: 0,
  };
  for (const t of trials) tally[t.fate]++;
  const sorted = trials.map((t) => t.closest).sort((a, b) => a - b);
  return {
    label,
    tally,
    total: trials.length,
    medianClosest: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
  };
}

/** Move the mode scoop somewhere harmless.
 *
 *  Not cosmetic. The first aperture band released balls 46px below the mouth
 *  and reported 43% swallowed by a scoop, because the mode scoop's capture
 *  circle (sensor r14 + ball r11 = 25px on centres) reaches up to y=520 —
 *  the captive's mouth is at 494, so there is NO band under the mouth that
 *  is clear of it. The captive's own geometry and the scoop's shadow cannot
 *  be separated in place, so the aperture band separates them by moving the
 *  scoop. What it costs elsewhere is irrelevant: this variant is never
 *  played, only measured. */
function withoutModeScoop(layout: PlayfieldLayout): PlayfieldLayout {
  return {
    ...layout,
    elements: layout.elements.map((e) =>
      e.kind === 'scoop' && e.id === 'scoop-mode' ? { ...e, x: 240, y: 880 } : e,
    ),
  };
}

/** BAND 1 — the target's own geometry, and nothing else.
 *
 *  Released 46px below the mouth on a board with the mode scoop moved aside,
 *  so the only thing between the ball and the captive is the captive's own
 *  stop posts and lane walls. Fanned over entry offset and arrival angle
 *  because a ball never arrives plumb, and an aperture that only admits a
 *  plumb ball admits nothing. */
export function aperture(base: PlayfieldLayout = DEFAULT_LAYOUT): ReachResult {
  const layout = withoutModeScoop(base);
  const { x, y } = captiveOf(layout);
  const trials: Trial[] = [];
  for (const off of [-14, -10, -6, -2, 2, 6, 10, 14]) {
    for (const deg of [-12, -6, 0, 6, 12]) {
      for (const speed of [12, 17]) {
        const a = -Math.PI / 2 + (deg * Math.PI) / 180;
        trials.push(strike(layout, x + off, y + 46, Math.cos(a) * speed, Math.sin(a) * speed, 90));
      }
    }
  }
  return summarise('aperture (released below the mouth)', trials);
}

/** BAND 2 — the shot as a player takes it: a real flip.
 *
 *  Swept over strike point along the bat, which is what actually aims a
 *  flipper shot. Per side and never pooled: the two flippers see completely
 *  different obstructions, and one averaged number hides which one is broken.
 *
 *  Everything in the way is included on purpose — the mode scoop's capture
 *  circle shadows the mouth by design (a fast ball skips it, a slow one
 *  sinks), and the point of measuring here is to see what survives that. */
export function approach(layout: PlayfieldLayout = DEFAULT_LAYOUT): ReachResult[] {
  const out: ReachResult[] = [];
  for (const side of ['left', 'right'] as const) {
    const trials: Trial[] = [];
    for (const frac of FRACS) trials.push(flick(layout, side, frac, 260));
    out.push(summarise(`flip from the ${side} flipper`, trials));
  }
  return out;
}

export function formatReach(rs: ReachResult[]): string {
  const pct = (n: number, t: number) => `${((n / t) * 100).toFixed(0)}%`.padStart(4);
  return rs
    .map(
      (r) =>
        `  ${r.label.padEnd(38)} MADE ${pct(r.tally.made, r.total)}` +
        `  (${r.tally.made}/${r.total})   rejected ${pct(r.tally.rejected, r.total)}` +
        `  scooped ${pct(r.tally.scooped, r.total)}` +
        `  short ${pct(r.tally.short, r.total)}` +
        (r.tally.blocked ? `  BLOCKED AT THE BAT ${pct(r.tally.blocked, r.total)}` : '') +
        (r.tally.stuck ? `  STUCK ${pct(r.tally.stuck, r.total)}` : '') +
        `   median closest ${r.medianClosest}px`,
    )
    .join('\n');
}

/** Run both bands with a given aperture, restoring it afterwards.
 *
 *  The aperture lives on CaptiveBall as mutable statics precisely so this can
 *  vary it: the entity is constructed deep inside Playfield, so there is no
 *  other seam, and a probe that cannot vary the thing it measures cannot show
 *  that it measures anything. */
export function withAperture<T>(
  postDx: number,
  postR: number,
  restDy: number,
  fn: () => T,
): T {
  const save = [CaptiveBall.POST_DX, CaptiveBall.POST_R, CaptiveBall.REST_DY] as const;
  CaptiveBall.POST_DX = postDx;
  CaptiveBall.POST_R = postR;
  CaptiveBall.REST_DY = restDy;
  try {
    return fn();
  } finally {
    [CaptiveBall.POST_DX, CaptiveBall.POST_R, CaptiveBall.REST_DY] = save;
  }
}
