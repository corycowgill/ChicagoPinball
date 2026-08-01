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

/** Closest distance between two SEGMENTS.
 *
 *  The primitive the clearance rules were missing. Without it the only
 *  obstacle a shot line could be tested against was a circle, so every rail,
 *  slingshot, standup and drop target on the board was invisible to
 *  validation — 45 of the 57 solid bodies, including the funnel rail that
 *  turned out to be sitting on the captive shot.
 *
 *  Segments, not lines: a rail that ends before it reaches the shot is not in
 *  the way, and treating it as infinite would invent blockers.
 */
export function segmentToSegment(a1: Pt, b1: Pt, a2: Pt, b2: Pt): number {
  // Four endpoint-to-segment distances bound the answer for every
  // non-crossing configuration; crossing segments are the one case they miss,
  // so test that separately and return 0.
  if (segmentsCross(a1, b1, a2, b2)) return 0;
  return Math.min(
    pointToSegment(a1, a2, b2),
    pointToSegment(b1, a2, b2),
    pointToSegment(a2, a1, b1),
    pointToSegment(b2, a1, b1),
  );
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Proper segment intersection. Collinear-overlap cases fall through to the
 *  endpoint distances above, which return 0 for them anyway. */
function segmentsCross(a1: Pt, b1: Pt, a2: Pt, b2: Pt): boolean {
  const d1 = cross(a2, b2, a1);
  const d2 = cross(a2, b2, b1);
  const d3 = cross(a1, b1, a2);
  const d4 = cross(a1, b1, b2);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
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
