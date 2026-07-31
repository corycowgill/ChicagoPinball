/** Layout validation — the board's design intent, made executable.
 *
 *  About a dozen coordinates on this board are not free parameters. They are
 *  the output of reasoning that until now lived only in source comments:
 *
 *    - the centre pedestal is positioned by measured clearance against a dozen
 *      flipper->target shot lines;
 *    - the soccer legs sit at x=383 "so the captive approach stays clear" — a
 *      comment whose arithmetic omitted the ball's own radius and was
 *      therefore wrong;
 *    - the right ramp's exit velocity was raised 6->8 to punch through the
 *      spinner at its landing point;
 *    - inlane rails must stop short of a flipper pivot or the bat jams solid.
 *
 *  A comment cannot stop an editor dragging a post into a shot lane. These
 *  rules can.
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
import { ResolvedLayout } from './resolve';
import { dist, inSweptSector, overlapsCorridor, segmentClearance } from './geometry';
import { ElementDesc, Pt, SENSOR_ROLES, StaticDesc } from './types';

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

/** Every physical (non-sensor) body the layout places, with a radius that
 *  bounds it. Rails use half their length as a conservative bound only when
 *  their centre is what we are testing, so they are handled separately. */
interface Solid {
  id: string;
  pos: Pt;
  r: number;
}

function solids(resolved: ResolvedLayout): Solid[] {
  const out: Solid[] = [];
  for (const s of resolved.layout.statics as StaticDesc[]) {
    if (s.kind === 'post') out.push({ id: s.id, pos: { x: s.x, y: s.y }, r: s.r });
    // Rails are line segments, not blobs; corridor rules test them by segment.
    // Cabinet walls bound the table and are never "in the way".
  }
  for (const e of resolved.layout.elements) {
    switch (e.kind) {
      case 'pop-bumper':
      case 'bean':
        out.push({ id: e.id, pos: { x: e.x, y: e.y }, r: e.radius });
        break;
      case 'captive':
        // The lane's outer envelope, read from the entity rather than copied.
        out.push({ id: e.id, pos: { x: e.x, y: e.y }, r: CaptiveBall.OUTER_HALF });
        break;
      default:
        break;
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
  const bodies = solids(resolved);
  for (const c of layout.corridors ?? []) {
    for (const b of bodies) {
      if (b.id === c.target) continue; // a corridor cannot be blocked by its own destination
      if (overlapsCorridor(b.pos, b.r, c.a, c.b, c.width)) {
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
    const from = flipperPivot(resolved, line.from);
    const to = targetPoint(resolved, line.to);
    if (!to) {
      push({
        severity: 'warn',
        rule: 'shot-line-target',
        message: `${line.id}: target '${line.to}' not found in the layout`,
        elementIds: [line.id],
      });
      continue;
    }
    let worst = Infinity;
    let worstId = '';
    for (const b of bodies) {
      if (b.id === line.to) continue; // a target cannot obstruct itself
      const gap = segmentClearance(from, to, b.pos, b.r, BALL_RADIUS);
      if (gap < worst) {
        worst = gap;
        worstId = b.id;
      }
    }
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
