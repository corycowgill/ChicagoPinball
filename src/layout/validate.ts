/** Layout validation — the board's design intent, made executable.
 *
 *  About a dozen coordinates on this board are not free parameters. They are
 *  the output of reasoning that until now lived only in source comments:
 *
 *    - the centre pedestal is positioned by measured clearance against a dozen
 *      flipper->target shot lines;
 *    - the soccer legs sit at x=383 "so the captive approach stays clear" — a
 *      comment whose arithmetic omitted the ball's own radius and was
 *      therefore wrong. They are in fact the physics for the 3D soccer goal's
 *      two posts, placed at scoop.x-17 and scoop.y+-12, and the goal's mouth
 *      is 19px wide for a 22px ball;
 *    - the right ramp's exit velocity was raised 6->8 to punch through the
 *      spinner at its landing point;
 *    - inlane rails must stop short of a flipper pivot or the bat jams solid.
 *
 *  A comment cannot stop an editor dragging a post into a shot lane. These
 *  rules can.
 *
 *  ── What these rules could not see, for several rounds ──────────────────
 *
 *  The clearance rules tested a shot line against CIRCLES only: seven posts,
 *  three pop bumpers, the Bean and the captive. Twelve bodies. This board
 *  places fifty-seven. Rails, deco posts, slingshots, standups and drop
 *  targets were all invisible, so every measured baseline in the layout was
 *  a clearance against a fifth of the board, and the validator called the
 *  board clean the whole time.
 *
 *  Three things it was therefore certifying:
 *
 *    - a RAIL (`funnel-r-outer`) sitting 11.8px inside the left flipper's
 *      line to the captive, alongside a deco post on the same line — the
 *      captive is the one shot that has measured zero makes in every
 *      instrument this project has;
 *    - `R->captive` at "+8px clear", when the right flipper's line to it runs
 *      straight through the right SLINGSHOT, and a protected `captive-approach`
 *      corridor reserving space to serve that non-existent shot;
 *    - shot lines starting at the flipper HINGE, where a ball never is. That
 *      put the first point of every line inside the flipper's own slingshot
 *      the moment slingshots became visible, showing up as a uniform -11.0px
 *      — the ball's radius, and therefore a tell.
 *
 *  `obstacles()` now models everything as capsules and its switch is
 *  exhaustive, so a new element kind cannot be forgotten in silence again.
 *  `measureShotLine` is exported because tools/baseline.mts carried its own
 *  copy of this arithmetic and that copy drifted: a tool that seeds baselines
 *  from a different model than the rule reads writes baselines that pass
 *  forever.
 *
 *  Dev/editor only — never imported by the shipped game, so it tree-shakes out
 *  of the player bundle.
 */
import {
  BALL_RADIUS,
  FLIPPER_ACTIVE_ANGLE,
  FLIPPER_HEIGHT,
  FLIPPER_LEN,
  FLIPPER_REST_ANGLE,
} from '../constants';
import { CaptiveBall } from '../entities/CaptiveBall';
import { DropTarget } from '../entities/DropTarget';
import { Scoop } from '../entities/Scoop';
import { ResolvedLayout } from './resolve';
import { dist, inSweptSector, segmentToSegment } from './geometry';
import { ElementDesc, Pt, SENSOR_ROLES, StaticDesc } from './types';

/** Default deco-post radius, matching the loader's own fallback. */
const DECO_POST_R = 4;

export type Severity = 'error' | 'warn';

export interface Diagnostic {
  severity: Severity;
  /** Stable id so the editor can group, filter and link to the offender. */
  rule: string;
  message: string;
  elementIds: string[];
  measured?: number;
  expected?: number;
}

const BALL_D = BALL_RADIUS * 2;
/** A channel needs more than exactly one ball width or the ball wedges. */
const CHANNEL_MARGIN = 8;

/** Everything a ball in flight can hit, as CAPSULES: a segment plus a radius.
 *
 *  One shape for all of it, because the old model had one shape too and it
 *  was the wrong one. `solids()` collected circles only — posts, pop bumpers,
 *  the Bean, the captive: twelve bodies. This board places fifty-seven. Every
 *  rail, deco post, standup, drop target and slingshot was invisible to the
 *  clearance rules, which means every `baselineClearance` in the layout was
 *  measured against a fifth of the board. The comment that used to sit here,
 *  claiming "corridor rules test them by segment", was simply false — nothing
 *  tested them at all.
 *
 *  How that surfaced: the captive ball has measured zero makes in every
 *  instrument this project has, and the blocker turned out to be
 *  `funnel-r-outer`, a RAIL sitting 11.8px inside the left flipper's line to
 *  it, with a deco post on the same line. The validator called the board
 *  clean throughout.
 *
 *  A capsule covers all of it: a circle is a capsule with a=b, a rail is its
 *  own segment with half its thickness, a target plate is its long axis with
 *  half its short side, a slingshot is its three edges. Then one primitive —
 *  segment-to-segment — answers every clearance question on the board.
 */
interface Capsule {
  id: string;
  a: Pt;
  b: Pt;
  r: number;
}

const circle = (id: string, x: number, y: number, r: number): Capsule => ({
  id,
  a: { x, y },
  b: { x, y },
  r,
});

/** A rotated rectangle as a capsule along its long axis. Conservative at the
 *  corners by design — a target that is nearly in the way should read as in
 *  the way. */
function plate(id: string, x: number, y: number, w: number, h: number, angle: number): Capsule {
  const half = Math.max(0, (w - h) / 2);
  const dx = Math.cos(angle) * half;
  const dy = Math.sin(angle) * half;
  return { id, a: { x: x - dx, y: y - dy }, b: { x: x + dx, y: y + dy }, r: h / 2 };
}

/** Gap a ball has passing this capsule while travelling a->b. Negative means
 *  it cannot pass. */
function clearance(a: Pt, b: Pt, c: Capsule): number {
  return segmentToSegment(a, b, c.a, c.b) - c.r - BALL_RADIUS;
}

function obstacles(resolved: ResolvedLayout): Capsule[] {
  const out: Capsule[] = [];
  for (const s of resolved.layout.statics as StaticDesc[]) {
    switch (s.kind) {
      case 'post':
        out.push(circle(s.id, s.x, s.y, s.r));
        break;
      case 'deco-post':
        out.push(circle(s.id, s.x, s.y, s.r ?? DECO_POST_R));
        break;
      case 'rail':
        // A ONE-WAY gate is not an obstacle to these rules. Corridors and
        // shot lines both describe travel UP the board, flipper to target,
        // and a gate is open to a climbing ball. Without this exemption the
        // two orbit return gates would be flagged as blocking the very lanes
        // they exist to serve — the same mistake the plain-rail experiment
        // made physically, and that one cost 8/12 orbit entries.
        if (!s.oneWay) out.push({ id: s.id, a: s.a, b: s.b, r: s.thickness / 2 });
        break;
      // Cabinet walls bound the table and are never "in the way"; a sensor is
      // a trigger a ball passes straight through.
      case 'cabinet-wall':
      case 'sensor':
        break;
      default: {
        // Exhaustiveness, and it is the whole point of the rewrite: the bug
        // was a SILENT omission. A new static kind must be classified here or
        // the build fails.
        const never: never = s;
        throw new Error(`obstacles(): unclassified static ${JSON.stringify(never)}`);
      }
    }
  }
  for (const e of resolved.layout.elements) {
    switch (e.kind) {
      case 'pop-bumper':
      case 'bean':
        out.push(circle(e.id, e.x, e.y, e.radius));
        break;
      case 'captive':
        // The lane's outer envelope, read from the entity rather than copied.
        out.push(circle(e.id, e.x, e.y, CaptiveBall.OUTER_HALF));
        break;
      case 'standup':
        out.push(plate(e.id, e.x, e.y, e.width, e.height, e.angle));
        break;
      case 'drop-bank':
        e.slots.forEach((sl, i) =>
          out.push(plate(`${e.id}-${i}`, sl.x, sl.y, DropTarget.W, DropTarget.H, sl.angle)),
        );
        break;
      case 'slingshot':
        // Three edges. The right slingshot is why this matters: the right
        // flipper's line to the captive runs straight through its own
        // slingshot, so that shot does not exist — and the layout recorded a
        // +8px clearance for it, and a protected corridor to serve it.
        for (let i = 0; i < 3; i++) {
          out.push({ id: e.id, a: e.verts[i], b: e.verts[(i + 1) % 3], r: 0 });
        }
        break;
      case 'scoop':
        // Not solid — but a ball entering the capture circle is taken out of
        // flight, which is what a blocker does. At the radius the Scoop
        // entity actually uses, read from it rather than copied.
        out.push(circle(e.id, e.x, e.y, Scoop.SENSOR_R));
        break;
      // A ramp is a shot TARGET, not a flat obstacle: its plate is raised and
      // a ball that reaches it goes up it. What blocks a ramp shot is the
      // furniture around its mouth, and that furniture is rails and deco
      // posts, which are now modelled. Stated, rather than skipped in silence.
      case 'ramp':
      // Triggers and fixtures a ball is never in flight against.
      case 'spinner':
      case 'rollover':
      case 'sensor':
      case 'drain':
      case 'plunger':
      case 'ball-spawn':
      case 'flipper':
        break;
      default: {
        const never: never = e;
        throw new Error(`obstacles(): unclassified element ${JSON.stringify(never)}`);
      }
    }
  }
  return out;
}

function findElement(resolved: ResolvedLayout, id: string): ElementDesc | undefined {
  return resolved.layout.elements.find((e) => e.id === id);
}

/** Target point for a shot line, by element id. */
function targetPoint(resolved: ResolvedLayout, id: string): Pt | null {
  const e = findElement(resolved, id);
  if (!e) return null;
  switch (e.kind) {
    case 'ramp':
      return { ...e.plate[0] };
    case 'scoop':
      return { x: e.x, y: e.y };
    case 'captive':
      return { x: e.x, y: e.y };
    case 'bean':
      return { x: e.x, y: e.y };
    case 'sensor':
      // An orbit is shot at its lane MOUTH, low on the board; its sensor sits
      // mid-channel at y=340. Aiming at the sensor would draw a line straight
      // across the middle of the playfield, which is not the shot.
      if (e.role === 'left-loop' || e.role === 'right-loop') return { x: e.x, y: 590 };
      return { x: e.x, y: e.y };
    default:
      return null;
  }
}

function flipperPivot(resolved: ResolvedLayout, which: 'left-flipper' | 'right-flipper'): Pt {
  const f = resolved.frame;
  return which === 'left-flipper'
    ? { x: f.playCenter - f.flipperGap, y: f.flipperY }
    : { x: f.playCenter + f.flipperGap, y: f.flipperY };
}

/** Where a shot actually STARTS: the ball cradled on the bat, not the hinge.
 *
 *  This distinction only became visible once slingshots were modelled, and
 *  then it was unmissable — every left-flipper line reported exactly -11.0px
 *  against `sling-left` and every right-flipper line exactly -11.0px against
 *  `sling-right`. A uniform number equal to the ball's radius is not a board
 *  fault, it is a line whose first point sits on a body: the slingshot's
 *  vertical edge is right beside the pivot by design, doubling as the
 *  inlane's inner wall.
 *
 *  A ball is never at the hinge. It sits on the bat's face, which is where
 *  src/dev/captivereach.ts and tools/shotodds.mjs both put it. */
const CRADLE_FRAC = 0.85;

function shotOrigin(resolved: ResolvedLayout, which: 'left-flipper' | 'right-flipper'): Pt {
  const pivot = flipperPivot(resolved, which);
  const rest = which === 'left-flipper' ? FLIPPER_REST_ANGLE : Math.PI - FLIPPER_REST_ANGLE;
  // Bat normal, forced to point UP the playfield — the ball rests on top.
  let nx = -Math.sin(rest);
  let ny = Math.cos(rest);
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const d = FLIPPER_LEN * CRADLE_FRAC;
  const off = FLIPPER_HEIGHT / 2 + BALL_RADIUS;
  return {
    x: pivot.x + Math.cos(rest) * d + nx * off,
    y: pivot.y + Math.sin(rest) * d + ny * off,
  };
}

/** The ONE measurement of a flipper->target shot line: how much room the
 *  tightest body on it leaves a ball.
 *
 *  Exported because tools/baseline.mts used to carry its own copy of this —
 *  its own obstacle list, its own pivot arithmetic, its own target rules —
 *  and that copy silently stopped matching the rule it was seeding. A tool
 *  that measures a different board from the one being validated will produce
 *  baselines that pass forever. One function, two callers.
 */
export function measureShotLine(
  resolved: ResolvedLayout,
  from: 'left-flipper' | 'right-flipper',
  toId: string,
  bodies: Capsule[] = obstacles(resolved),
): { gap: number; who: string } | null {
  const a = shotOrigin(resolved, from);
  const b = targetPoint(resolved, toId);
  if (!b) return null;
  let gap = Infinity;
  let who = '';
  for (const c of bodies) {
    if (c.id === toId) continue; // a target cannot obstruct itself
    const g = clearance(a, b, c);
    if (g < gap) {
      gap = g;
      who = c.id;
    }
  }
  return { gap, who };
}

export function validateLayout(resolved: ResolvedLayout): Diagnostic[] {
  const d: Diagnostic[] = [];
  const { layout, frame } = resolved;
  const push = (x: Diagnostic) => d.push(x);

  // ── Structural ───────────────────────────────────────────────────────────
  const seen = new Map<string, string[]>();
  for (const s of layout.statics) if (s.kind === 'sensor') {
    seen.set(s.role, [...(seen.get(s.role) ?? []), s.id]);
  }
  for (const e of layout.elements) if (e.kind === 'sensor') {
    seen.set(e.role, [...(seen.get(e.role) ?? []), e.id]);
  }
  // The drain has its own element kind (its x and width are derived from the
  // frame), but it still occupies the 'drain' collision label.
  for (const e of layout.elements) if (e.kind === 'drain') {
    seen.set('drain', [...(seen.get('drain') ?? []), e.id]);
  }
  for (const role of SENSOR_ROLES) {
    const ids = seen.get(role) ?? [];
    if (ids.length !== 1) {
      push({
        severity: 'error',
        rule: 'sensor-arity',
        message:
          ids.length === 0
            ? `no '${role}' sensor — the handler bound to that label can never fire`
            : `${ids.length} '${role}' sensors — collision handlers bind by label, so duplicates fire the wrong one`,
        elementIds: ids,
        measured: ids.length,
        expected: 1,
      });
    }
  }

  const bank = layout.elements.find((e) => e.kind === 'drop-bank');
  if (bank && bank.kind === 'drop-bank' && bank.slots.length !== 7) {
    push({
      severity: 'error',
      rule: 'drop-bank-size',
      message: `CHICAGO bank needs exactly 7 targets, found ${bank.slots.length} — ChicagoBank throws otherwise`,
      elementIds: [bank.id],
      measured: bank.slots.length,
      expected: 7,
    });
  }

  for (const e of layout.elements) {
    if (e.kind !== 'ramp') continue;
    const last = e.plate[e.plate.length - 1];
    const first = e.habitrail[0];
    if (dist(last, first) > 0.001) {
      push({
        severity: 'error',
        rule: 'ramp-join',
        message: `${e.id}: habitrail must start where the plate ends, or the transit path teleports the ball`,
        elementIds: [e.id],
        measured: Math.round(dist(last, first)),
        expected: 0,
      });
    }
  }

  // ── Flipper safety ───────────────────────────────────────────────────────
  // A static body inside the bat's swept sector does not merely obstruct: the
  // solver cancels the commanded rotation every step and the flipper jams.
  const sweepR = FLIPPER_LEN + FLIPPER_HEIGHT / 2;
  for (const which of ['left-flipper', 'right-flipper'] as const) {
    const pivot = flipperPivot(resolved, which);
    const rest = which === 'left-flipper' ? FLIPPER_REST_ANGLE : Math.PI - FLIPPER_REST_ANGLE;
    const active = which === 'left-flipper' ? FLIPPER_ACTIVE_ANGLE : Math.PI - FLIPPER_ACTIVE_ANGLE;
    for (const s of layout.statics) {
      if (s.kind !== 'post' && s.kind !== 'rail') continue;
      const pts: Pt[] =
        s.kind === 'post' ? [{ x: s.x, y: s.y }] : [s.a, s.b];
      for (const p of pts) {
        if (inSweptSector(p, pivot, sweepR, rest, active)) {
          push({
            severity: 'error',
            rule: 'flipper-sweep',
            message: `${s.id} sits inside the ${which} swept arc — a static body there jams the bat solid`,
            elementIds: [s.id],
          });
          break;
        }
      }
    }
  }

  // ── Corridors: authored no-build zones ───────────────────────────────────
  const bodies = obstacles(resolved);
  for (const c of layout.corridors ?? []) {
    for (const b of bodies) {
      if (b.id === c.target) continue; // a corridor cannot be blocked by its own destination
      if (segmentToSegment(c.a, c.b, b.a, b.b) < c.width / 2 + b.r) {
        push({
          severity: 'error',
          rule: 'corridor-blocked',
          message: `${b.id} intrudes into the ${c.id} corridor (${c.note})`,
          elementIds: [b.id, c.id],
        });
      }
    }
  }

  // ── Shot lines: regress on a DECREASE from the measured baseline ─────────
  // An absolute floor is not enough: a shot that clears by 90 px today could
  // be walked down to 17 and nothing would complain.
  for (const line of layout.shotLines ?? []) {
    const m = measureShotLine(resolved, line.from, line.to, bodies);
    if (!m) {
      push({
        severity: 'warn',
        rule: 'shot-line-target',
        message: `${line.id}: target '${line.to}' not found in the layout`,
        elementIds: [line.id],
      });
      continue;
    }
    const worst = m.gap;
    const worstId = m.who;
    if (worst < line.minClearance) {
      push({
        severity: 'error',
        rule: 'shot-line-blocked',
        message: `${line.id}: ${worstId} leaves ${worst.toFixed(1)}px, under the ${line.minClearance}px a ball needs`,
        elementIds: [line.id, worstId],
        measured: Number(worst.toFixed(1)),
        expected: line.minClearance,
      });
    } else if (worst < line.baselineClearance - 1) {
      push({
        severity: 'warn',
        rule: 'shot-line-narrowed',
        message: `${line.id}: clearance fell to ${worst.toFixed(1)}px from a baseline of ${line.baselineClearance} (${worstId})`,
        elementIds: [line.id, worstId],
        measured: Number(worst.toFixed(1)),
        expected: line.baselineClearance,
      });
    }
  }

  // ── Captive lane to the shooter wall ─────────────────────────────────────
  const captive = layout.elements.find((e) => e.kind === 'captive');
  if (captive && captive.kind === 'captive') {
    const gap = frame.laneInnerX - 3 - (captive.x + CaptiveBall.OUTER_HALF);
    if (gap < BALL_D) {
      push({
        severity: 'error',
        rule: 'captive-channel',
        message: `only ${gap.toFixed(1)}px between the captive lane and the shooter wall — a ball cannot pass`,
        elementIds: [captive.id],
        measured: Number(gap.toFixed(1)),
        expected: BALL_D,
      });
    } else if (gap < BALL_D + CHANNEL_MARGIN) {
      push({
        severity: 'warn',
        rule: 'captive-channel',
        message: `captive-to-shooter channel is tight: ${gap.toFixed(1)}px for a ${BALL_D}px ball`,
        elementIds: [captive.id],
        measured: Number(gap.toFixed(1)),
        expected: BALL_D + CHANNEL_MARGIN,
      });
    }
  }

  // ── Kickers must sit inside their own outlane ────────────────────────────
  for (const role of ['left-outlane', 'right-outlane'] as const) {
    const pos = resolved.sensorPos[role];
    if (!pos) continue;
    const insideBoard = pos.x > BALL_RADIUS && pos.x < frame.playRight - BALL_RADIUS;
    if (!insideBoard) {
      push({
        severity: 'error',
        rule: 'kicker-placement',
        message: `${role} kicker at x=${pos.x} is not inside the play area`,
        elementIds: [role],
        measured: pos.x,
      });
    }
  }

  return d;
}

export function formatDiagnostics(ds: Diagnostic[]): string {
  if (!ds.length) return 'no diagnostics — layout is clean';
  const errs = ds.filter((x) => x.severity === 'error').length;
  const warns = ds.length - errs;
  const lines = ds.map(
    (x) => `  ${x.severity === 'error' ? 'ERROR' : 'warn '} [${x.rule}] ${x.message}`,
  );
  return `${errs} error(s), ${warns} warning(s)\n${lines.join('\n')}`;
}
