/** Copying and mirroring layout items.
 *
 *  A pinball board is very nearly symmetric — two flippers, two slingshots,
 *  two ramps, two orbits, two outlanes — and placing each side by hand is the
 *  tedious half of building one. Mirroring a finished left side into a right
 *  side is the single biggest ergonomic win the editor can offer.
 *
 *  Mirroring is not just negating x. Everything DIRECTIONAL has to flip with
 *  it, and the list is longer than it first looks:
 *
 *    - stored angles (a standup's face, a scoop's kick, a ramp's arrow)
 *    - stored vectors (a slingshot's normal, a ramp's exit velocity, an
 *      outlane kicker's impulse)
 *    - sided identity (a flipper's `side`, a ramp's `left-ramp` label, a
 *      sensor's `left-loop` role, an inlane feed)
 *
 *  Miss any one of them and the mirrored half looks right and plays wrong,
 *  which is the worst kind of wrong. Handling them here rather than in the
 *  editor keeps that list in one place, next to the schema it mirrors.
 */
import { AnyDesc } from './handles';
import { uniqueId } from './palette';
import { PlayfieldLayout, Pt, SensorRole } from './types';

const flipPt = (p: Pt, axisX: number): Pt => ({ x: 2 * axisX - p.x, y: p.y });
/** Reflecting across a vertical line maps a heading θ to π − θ. */
const flipAngle = (a: number) => Math.PI - a;

/** Sided names that must swap, in both directions. */
const SWAP: Record<string, string> = {
  left: 'right',
  right: 'left',
  'left-ramp': 'right-ramp',
  'right-ramp': 'left-ramp',
  'inlane-left': 'inlane-right',
  'inlane-right': 'inlane-left',
  'left-loop': 'right-loop',
  'right-loop': 'left-loop',
  'left-outlane': 'right-outlane',
  'right-outlane': 'left-outlane',
};
const swap = <T extends string>(v: T): T => (SWAP[v] as T) ?? v;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Mirror a descriptor across the vertical line `axisX`, in place. */
export function mirrorDesc(d: AnyDesc, axisX: number): void {
  const any = d as unknown as Record<string, unknown>;

  // Positions. `x`/`cx` are the two spellings the schema uses.
  if (typeof any.x === 'number') any.x = 2 * axisX - (any.x as number);
  if (typeof any.cx === 'number') any.cx = 2 * axisX - (any.cx as number);

  // Point pairs and polylines.
  for (const key of ['a', 'b']) {
    const p = any[key] as Pt | undefined;
    if (p && typeof p.x === 'number') any[key] = flipPt(p, axisX);
  }
  for (const key of ['verts', 'plate', 'habitrail']) {
    const arr = any[key] as Pt[] | undefined;
    if (Array.isArray(arr)) any[key] = arr.map((p) => flipPt(p, axisX));
  }
  // Drop-bank slots carry an angle each. Order is NOT reversed: slot index
  // assigns the letter, so reversing would relabel the bank rather than
  // mirror it. The mirrored bank therefore reads right-to-left, which is what
  // a mirror does.
  const slots = any.slots as { x: number; y: number; angle: number }[] | undefined;
  if (Array.isArray(slots)) {
    any.slots = slots.map((s) => ({ ...s, x: 2 * axisX - s.x, angle: flipAngle(s.angle) }));
  }

  // Directions.
  for (const key of ['angle', 'kickAngle', 'arrowAngle']) {
    if (typeof any[key] === 'number') any[key] = flipAngle(any[key] as number);
  }
  for (const key of ['normal', 'exitVel']) {
    const v = any[key] as Pt | undefined;
    if (v && typeof v.x === 'number') any[key] = { x: -v.x, y: v.y };
  }
  const kicker = any.kicker as { vx: number; vy: number; riseY: number } | undefined;
  if (kicker) any.kicker = { ...kicker, vx: -kicker.vx };

  // Sided identity.
  for (const key of ['side', 'label', 'role', 'feedsInlane']) {
    if (typeof any[key] === 'string') any[key] = swap(any[key] as string);
  }
}

/** Where to mirror about: the centre of the PLAY area, not of the canvas. The
 *  shooter lane lives outside it, so mirroring about the canvas centre would
 *  push everything one lane-width to the left. */
export const mirrorAxis = (layout: PlayfieldLayout) => layout.frame.laneInnerX / 2;

/** Items the shooter lane owns. They are positioned by the FRAME — the lane is
 *  outside the play area and has no mirror image — so reflecting them about
 *  the play centre would fling the plunger across the board and put the lane's
 *  inner wall at x=0. A whole-board mirror leaves the lane where it is. */
export const SHOOTER_LANE_KINDS = new Set(['plunger', 'ball-spawn']);

/** Mirror an ENTIRE board in place — descriptors and the design intent with
 *  them. Corridors are geometry and reflect; shot lines are named per flipper
 *  and swap ends, keeping their target id and measured baseline, because a
 *  reflected board's clearances are the same numbers on the other side.
 *
 *  Not exposed in the editor's UI. It exists because it is the strongest test
 *  available for the field-by-field mirror above: reflect the whole shipped
 *  board and every rule must still pass, with the same measurements.
 *
 *  `skipIds` is for the shooter lane's authored furniture — the lane's inner
 *  wall and its exit sensor carry explicit coordinates, so nothing about their
 *  shape says "I belong to the lane" and the caller has to name them. */
export function mirrorLayout(layout: PlayfieldLayout, skipIds: string[] = []): void {
  const axis = mirrorAxis(layout);
  const skip = new Set(skipIds);
  for (const d of [...layout.statics, ...layout.elements]) {
    if (skip.has(d.id) || SHOOTER_LANE_KINDS.has(d.kind)) continue;
    mirrorDesc(d as AnyDesc, axis);
  }
  for (const c of layout.corridors ?? []) {
    c.a = flipPt(c.a, axis);
    c.b = flipPt(c.b, axis);
  }
  for (const l of layout.shotLines ?? []) {
    l.from = l.from === 'left-flipper' ? 'right-flipper' : 'left-flipper';
  }
}

export interface AddResult {
  id: string;
  /** True when the copy went into `statics` rather than `elements`. */
  intoStatics: boolean;
}

/** Add a copy of `id` to the layout, transformed by `fn`, and return its new
 *  id. The copy goes into the SAME array, at the end — build order is
 *  load-bearing, and appending is the only position that cannot change how
 *  anything already on the board behaves. */
export function addCopy(
  layout: PlayfieldLayout,
  id: string,
  fn: (d: AnyDesc) => void,
): AddResult | null {
  const inStatics = layout.statics.findIndex((s) => s.id === id);
  const inElements = layout.elements.findIndex((e) => e.id === id);
  const src =
    inStatics >= 0 ? layout.statics[inStatics] : inElements >= 0 ? layout.elements[inElements] : null;
  if (!src) return null;

  const copy = clone(src) as AnyDesc;
  fn(copy);
  const newId = uniqueId(layout, `${id}-copy`);
  (copy as { id: string }).id = newId;
  // A standup names its own target id; leaving the original's would give two
  // targets the same identity and the lit-pair logic would treat them as one.
  const asAny = copy as unknown as Record<string, unknown>;
  if (typeof asAny.targetId === 'string') asAny.targetId = newId;

  if (inStatics >= 0) layout.statics.push(copy as never);
  else layout.elements.push(copy as never);
  return { id: newId, intoStatics: inStatics >= 0 };
}

/** Duplicate in place, nudged clear so the copy is visible and grabbable. */
export function duplicate(layout: PlayfieldLayout, id: string): AddResult | null {
  return addCopy(layout, id, (d) => translateDesc(d, 16, 16));
}

/** Mirror-copy across the play centre. */
export function mirrorCopy(layout: PlayfieldLayout, id: string): AddResult | null {
  return addCopy(layout, id, (d) => mirrorDesc(d, mirrorAxis(layout)));
}

/** Shift a descriptor by (dx, dy), in place. Same field survey as the mirror,
 *  minus everything directional — a translation rotates nothing. */
export function translateDesc(d: AnyDesc, dx: number, dy: number): void {
  const any = d as unknown as Record<string, unknown>;
  if (typeof any.x === 'number') any.x = (any.x as number) + dx;
  if (typeof any.y === 'number') any.y = (any.y as number) + dy;
  if (typeof any.cx === 'number') any.cx = (any.cx as number) + dx;
  if (typeof any.cy === 'number') any.cy = (any.cy as number) + dy;
  for (const key of ['a', 'b']) {
    const p = any[key] as Pt | undefined;
    if (p && typeof p.x === 'number') any[key] = { x: p.x + dx, y: p.y + dy };
  }
  for (const key of ['verts', 'plate', 'habitrail']) {
    const arr = any[key] as Pt[] | undefined;
    if (Array.isArray(arr)) any[key] = arr.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  const slots = any.slots as { x: number; y: number; angle: number }[] | undefined;
  if (Array.isArray(slots)) any.slots = slots.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
}

/** Roles that may only appear once, for the editor to warn about after a
 *  mirror: mirroring a `left-loop` sensor produces a second `right-loop`. The
 *  validator catches it too — this is just so the editor can say it at the
 *  moment it happens, rather than leaving you to find it in the rules list. */
export function duplicatedRoleAfter(layout: PlayfieldLayout, newId: string): SensorRole | null {
  const all = [...layout.statics, ...layout.elements];
  const made = all.find((d) => d.id === newId);
  if (!made || made.kind !== 'sensor') return null;
  const n = all.filter((d) => d.kind === 'sensor' && d.role === made.role).length;
  return n > 1 ? made.role : null;
}
