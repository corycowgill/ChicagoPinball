/** Eject audit — where does the ball actually GO when a kicker fires?
 *
 *  `validateLayout` reasons about straight lines and clearances. It cannot
 *  answer the question that produced the worst layout bug this project has
 *  shipped: the mode scoop's kick angle sent the ball off the CHICAGO bank
 *  and into the right outlane, so *making* the shot drained the ball. No
 *  clearance rule sees that. Only simulation does.
 *
 *  So: for every kicker whose eject is fully described by the layout — both
 *  scoops, the outlane kickback, both ramp exits — build the real world, put
 *  a ball at the real eject point with the real eject velocity, and step the
 *  REAL engine. Then look at which sensors it crosses.
 *
 *  Two design decisions worth stating, because they are what make the result
 *  mean something:
 *
 *  1. **The verdict is about outlanes, not the drain.** The flippers are inert
 *     here, so a ball returning down the middle always ends in the drain —
 *     that is the harness having no player, not a layout fault. An outlane is
 *     different: no flipper reaches it, so an eject that feeds one is
 *     unrecoverable by construction. That is the defect class worth failing on.
 *
 *  2. **A fan, not a single shot.** One trajectory through a pinball table is
 *     a knife edge; a kick that clears a post by a pixel would read as clean
 *     and then drain in play. Each eject is fired as a deterministic fan of
 *     angle x speed variants, and the verdict is the FRACTION that end up in
 *     an outlane. Fixed perturbations, no RNG — the audit stays reproducible.
 *
 *  Dev-only. Never imported by the game.
 */
import Matter from 'matter-js';
import { Physics } from '../Physics';
import { Playfield, PlayfieldEvents } from '../scene/Playfield';
import { DEFAULT_LAYOUT } from '../layout/default';
import { resolveLayout } from '../layout/resolve';
import { PlayfieldLayout, Pt } from '../layout/types';
import { Diagnostic } from '../layout/validate';

/** A kicker's eject, read entirely from layout data. */
export interface EjectSource {
  id: string;
  /** Where the ball is when the impulse is applied. */
  pos: Pt;
  /** The impulse itself, in Matter velocity units (px per 16.6ms). */
  vel: Pt;
  /** Human-readable note for the diagnostic message. */
  what: string;
  /** True when the eject is performed by a live Scoop entity rather than by
   *  the harness. A ball parked on a scoop's sensor is captured and re-kicked
   *  by the scoop itself, which silently overrides any velocity the harness
   *  sets — the first version of this audit ran fifteen identical trials
   *  without noticing. Scoop fans are therefore applied by perturbing the
   *  LAYOUT (the authored kick angle and speed) instead of the velocity. */
  viaScoop?: boolean;
}

/** Derive every fully-described eject from a layout.
 *
 *  Each entry mirrors the code that actually performs the kick, so if that
 *  code changes shape this must be updated with it — the alternative (calling
 *  into the entity) needs a live game state the audit does not have.
 */
export function ejectSources(layout: PlayfieldLayout): EjectSource[] {
  const out: EjectSource[] = [];
  const resolved = resolveLayout(layout);

  for (const e of layout.elements) {
    switch (e.kind) {
      case 'scoop': {
        // Scoop.tick: the held ball sits at (x, y+4) and is given
        // (cos a, sin a) * speed.
        const a = e.kickAngle ?? -Math.PI / 2 - 0.25;
        const s = e.kickSpeed ?? 18;
        out.push({
          id: e.id,
          pos: { x: e.x, y: e.y + 4 },
          vel: { x: Math.cos(a) * s, y: Math.sin(a) * s },
          what: 'scoop eject',
          viaScoop: true,
        });
        break;
      }
      case 'ramp': {
        // Playfield.tickTransits: at the end of the wireform the ball is
        // un-ghosted at the last path point and given exitVel.
        const end = e.habitrail[e.habitrail.length - 1];
        out.push({
          id: e.id,
          pos: { ...end },
          vel: { ...e.exitVel },
          what: 'ramp exit',
        });
        break;
      }
      default:
        break;
    }
  }

  // Outlane kickers (today: the left kickback) carry their impulse on the
  // sensor descriptor, so the kicker cannot drift away from the lane it sits
  // in. A sensor may be authored in either array — `statics` and `elements`
  // differ only in build order — so both are scanned.
  const sensors = [...layout.statics, ...layout.elements];
  for (const s of sensors) {
    if (s.kind !== 'sensor' || !s.kicker) continue;
    const pos = resolved.sensorPos[s.role];
    if (!pos) continue;
    out.push({
      id: s.id,
      pos: { x: pos.x, y: pos.y + s.kicker.riseY },
      vel: { x: s.kicker.vx, y: s.kicker.vy },
      what: 'outlane kicker',
    });
  }

  return out;
}

export type Fate = 'left-outlane' | 'right-outlane' | 'drain' | 'in-play';

export interface TrialResult {
  /** Degrees the eject angle was rotated for this trial. */
  angleDeg: number;
  /** Multiplier applied to the eject speed. */
  speedMul: number;
  fate: Fate;
  steps: number;
}

export interface EjectReport {
  source: EjectSource;
  trials: TrialResult[];
  outlaneRate: number;
}

/** Deterministic fan: five angles x three speeds. Small enough to run all of
 *  them in a few seconds, wide enough that a knife-edge clearance shows up. */
const ANGLES_DEG = [-3, -1.5, 0, 1.5, 3];
const SPEED_MULS = [0.95, 1, 1.05];
const DT = 1000 / 60;
/** 10 seconds. Long enough to cover a scoop's hold time plus a full flight. */
const MAX_STEPS = 600;

/** A copy of the layout with one scoop's aim nudged. Element ORDER is
 *  load-bearing for the physics (body insertion order changes broadphase pair
 *  order), so this maps in place rather than rebuilding the array. */
function nudgeScoop(
  layout: PlayfieldLayout,
  id: string,
  angleDeg: number,
  speedMul: number,
): PlayfieldLayout {
  return {
    ...layout,
    elements: layout.elements.map((e) =>
      e.kind === 'scoop' && e.id === id
        ? { ...e, kickAngle: e.kickAngle + (angleDeg * Math.PI) / 180, kickSpeed: e.kickSpeed * speedMul }
        : e,
    ),
  };
}

function runTrial(
  baseLayout: PlayfieldLayout,
  src: EjectSource,
  angleDeg: number,
  speedMul: number,
): TrialResult {
  const layout = src.viaScoop
    ? nudgeScoop(baseLayout, src.id, angleDeg, speedMul)
    : baseLayout;
  let fate: Fate = 'in-play';
  let atStep = MAX_STEPS;
  const settle = (f: Fate, step: number) => {
    if (fate !== 'in-play') return;
    fate = f;
    atStep = step;
  };

  const physics = new Physics();
  let step = 0;
  const ev: PlayfieldEvents = {
    onScore: () => {},
    onLockComplete: () => {},
    onScoopMode: () => {},
    onLanesComplete: () => {},
    onDrain: () => settle('drain', step),
    onLeftOutlane: () => settle('left-outlane', step),
    onRightOutlane: () => settle('right-outlane', step),
  };
  const pf = new Playfield(physics, ev, layout);

  const ball = pf.balls[0].body;
  Matter.Body.setPosition(ball, { x: src.pos.x, y: src.pos.y });
  Matter.Body.setAngularVelocity(ball, 0);
  if (src.viaScoop) {
    // Park it on the scoop and let the scoop do the work: the entity captures,
    // holds and kicks with the (perturbed) authored angle and speed.
    Matter.Body.setVelocity(ball, { x: 0, y: 0 });
  } else {
    const a = Math.atan2(src.vel.y, src.vel.x) + (angleDeg * Math.PI) / 180;
    const sp = Math.hypot(src.vel.x, src.vel.y) * speedMul;
    Matter.Body.setVelocity(ball, { x: Math.cos(a) * sp, y: Math.sin(a) * sp });
  }

  for (step = 0; step < MAX_STEPS; step++) {
    pf.tick(DT);
    physics.step(DT);
    if (fate !== 'in-play') break;
  }
  return { angleDeg, speedMul, fate, steps: atStep };
}

export function auditEjects(layout: PlayfieldLayout = DEFAULT_LAYOUT): EjectReport[] {
  return ejectSources(layout).map((source) => {
    const trials: TrialResult[] = [];
    for (const d of ANGLES_DEG) {
      for (const m of SPEED_MULS) trials.push(runTrial(layout, source, d, m));
    }
    const bad = trials.filter(
      (t) => t.fate === 'left-outlane' || t.fate === 'right-outlane',
    ).length;
    return { source, trials, outlaneRate: bad / trials.length };
  });
}

/** An eject that feeds an outlane on most of its fan is a defect; one that
 *  does it occasionally is a risk the author should see and decide about. */
const ERROR_RATE = 0.4;
const WARN_RATE = 0.15;

export function ejectDiagnostics(reports: EjectReport[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const r of reports) {
    if (r.outlaneRate < WARN_RATE) continue;
    const where = r.trials
      .filter((t) => t.fate.endsWith('outlane'))
      .map((t) => t.fate)
      .sort();
    const side = where[Math.floor(where.length / 2)];
    out.push({
      severity: r.outlaneRate >= ERROR_RATE ? 'error' : 'warn',
      rule: 'eject-into-outlane',
      message: `${r.source.id} (${r.source.what}) feeds the ${side} on ${(
        r.outlaneRate * 100
      ).toFixed(0)}% of its fan — an outlane is past every flipper, so making this shot loses the ball`,
      elementIds: [r.source.id],
      measured: Number(r.outlaneRate.toFixed(2)),
      expected: 0,
    });
  }
  return out;
}

export function formatEjects(reports: EjectReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    const tally = new Map<Fate, number>();
    for (const t of r.trials) tally.set(t.fate, (tally.get(t.fate) ?? 0) + 1);
    const parts = [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([f, n]) => `${f} ${n}`)
      .join(', ');
    lines.push(
      `  ${r.source.id.padEnd(14)} ${r.source.what.padEnd(15)} outlane ${(
        r.outlaneRate * 100
      )
        .toFixed(0)
        .padStart(3)}%   [${parts}]`,
    );
  }
  return lines.join('\n');
}
