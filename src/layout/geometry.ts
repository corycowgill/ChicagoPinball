/** Geometry primitives for layout validation.
 *
 *  Pure functions on plain numbers — no Matter, no DOM — so they can be
 *  reasoned about and unit-checked directly. Everything here answers one of
 *  two questions: "can a ball of radius r get through here?" and "does this
 *  body sit in the way of that shot?".
 */
import { Pt } from './types';

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Closest distance from a point to a SEGMENT (not an infinite line — a shot
 *  line stops at its target, and a body beyond the target is not in the way). */
export function pointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Gap a ball of `ballR` has passing a circular body of `bodyR` centred at
 *  `c` while travelling the segment a->b. Negative means it cannot pass. */
export function segmentClearance(a: Pt, b: Pt, c: Pt, bodyR: number, ballR: number): number {
  return pointToSegment(c, a, b) - bodyR - ballR;
}

/** Does a circle overlap a corridor (a thick segment)? Used for no-build
 *  zones — the captive approach, the loop channels, the inlanes. */
export function overlapsCorridor(
  c: Pt,
  bodyR: number,
  a: Pt,
  b: Pt,
  corridorWidth: number,
): boolean {
  return pointToSegment(c, a, b) < corridorWidth / 2 + bodyR;
}

/** Is a point inside the sector a flipper bat sweeps through?
 *
 *  A static body in here does not merely obstruct: the solver cancels the
 *  bat's commanded rotation every step and the flipper jams solid. That makes
 *  it a different failure class from ordinary clearance.
 *
 *  Angles are Matter's convention (+y down). The sector runs between the bat's
 *  rest and active angles at the pivot, out to `radius`.
 */
export function inSweptSector(
  p: Pt,
  pivot: Pt,
  radius: number,
  restAngle: number,
  activeAngle: number,
): boolean {
  const d = dist(p, pivot);
  if (d > radius) return false;
  const ang = Math.atan2(p.y - pivot.y, p.x - pivot.x);
  const lo = Math.min(restAngle, activeAngle);
  const hi = Math.max(restAngle, activeAngle);
  // Normalise into [lo, lo + 2pi) so a sector spanning the -pi/pi seam works.
  const norm = (a: number) => {
    let v = a;
    while (v < lo) v += Math.PI * 2;
    while (v >= lo + Math.PI * 2) v -= Math.PI * 2;
    return v;
  };
  return norm(ang) <= hi;
}

/** Axis-aligned span of a rotated rectangle, used for channel width checks. */
export function rectHalfExtentX(w: number, h: number, angle: number): number {
  return (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / 2;
}
