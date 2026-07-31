/** Drag handles: the bridge between a pointer and the layout.
 *
 *  Every layout descriptor is a different shape — a post is a point, a rail is
 *  two points, a ramp is a fourteen-point polyline, a flipper has no stored
 *  position at all — so the editor cannot just write `item.x = mouseX`.
 *
 *  Instead each descriptor publishes a list of handles, and dragging one calls
 *  back into a single `moveHandle`. The editor then knows nothing about ramps
 *  or drop banks; it knows about points you can grab. Adding a new element
 *  kind means adding it here, and the editor picks it up for free.
 *
 *  Two rules this file exists to enforce:
 *
 *    - **Derived positions are not draggable as positions.** A flipper's pivot
 *      is `playCenter ± flipperGap` at `flipperY`; dragging the bat therefore
 *      edits the FRAME, and the mirror flipper moves with it. Writing an x/y
 *      onto the flipper descriptor would create a second source of truth for a
 *      number the resolver already owns.
 *    - **Order is semantic.** Drop-bank slots are lettered by index and the
 *      ramp's transit path is its point order, so handles move points in place
 *      and never reorder, insert or remove them.
 */
import { PLAYFIELD_H, PLAYFIELD_W } from '../constants';
import { ResolvedLayout } from './resolve';
import { ElementDesc, ElementId, PlayfieldLayout, Pt, StaticDesc } from './types';

export type HandleRole =
  /** Moves the whole item. */
  | 'origin'
  /** Moves one vertex of a multi-point shape. */
  | 'point'
  /** Edits a size/extent rather than a position. */
  | 'size'
  /** Edits a frame number, so other items move too. */
  | 'frame';

export interface Handle {
  ownerId: ElementId;
  /** Stable within an owner: 'origin', 'a', 'b', 'plate:3', 'slot:2'. */
  key: string;
  x: number;
  y: number;
  role: HandleRole;
  label: string;
}

export type AnyDesc = StaticDesc | ElementDesc;

export function findDesc(layout: PlayfieldLayout, id: ElementId): AnyDesc | undefined {
  return (
    (layout.statics as AnyDesc[]).find((s) => s.id === id) ??
    (layout.elements as AnyDesc[]).find((e) => e.id === id)
  );
}

const clampX = (x: number) => Math.max(0, Math.min(PLAYFIELD_W, x));
const clampY = (y: number) => Math.max(0, Math.min(PLAYFIELD_H, y));

const h = (
  ownerId: string,
  key: string,
  x: number,
  y: number,
  role: HandleRole,
  label: string,
): Handle => ({ ownerId, key, x, y, role, label });

/** Every handle for one descriptor. `resolved` is needed because some items
 *  have no stored position of their own. */
export function handlesFor(
  d: AnyDesc,
  resolved: ResolvedLayout,
): Handle[] {
  const f = resolved.frame;
  switch (d.kind) {
    case 'cabinet-wall':
      return [h(d.id, 'origin', d.cx, d.cy, 'origin', 'cabinet')];
    case 'rail':
      return [
        h(d.id, 'origin', (d.a.x + d.b.x) / 2, (d.a.y + d.b.y) / 2, 'origin', 'rail'),
        h(d.id, 'a', d.a.x, d.a.y, 'point', 'end A'),
        h(d.id, 'b', d.b.x, d.b.y, 'point', 'end B'),
      ];
    case 'post':
    case 'deco-post':
      return [h(d.id, 'origin', d.x, d.y, 'origin', 'post')];
    case 'sensor':
      return [
        h(d.id, 'origin', d.x, d.y, 'origin', d.role),
        h(d.id, 'extent', d.x + d.w / 2, d.y + d.h / 2, 'size', 'size'),
      ];

    case 'plunger':
      // x is the shooter lane's centre — derived, so only y is grabbable.
      return [h(d.id, 'origin', f.launchX, d.y, 'origin', 'plunger')];
    case 'ball-spawn':
      // Fully derived from the plunger. Shown, never dragged.
      return [];
    case 'flipper': {
      const x = d.side === 'left' ? f.playCenter - f.flipperGap : f.playCenter + f.flipperGap;
      return [h(d.id, 'origin', x, f.flipperY, 'frame', `${d.side} flipper pivot`)];
    }
    case 'slingshot': {
      const cx = (d.verts[0].x + d.verts[1].x + d.verts[2].x) / 3;
      const cy = (d.verts[0].y + d.verts[1].y + d.verts[2].y) / 3;
      return [
        h(d.id, 'origin', cx, cy, 'origin', 'slingshot'),
        ...d.verts.map((v, i) => h(d.id, `vert:${i}`, v.x, v.y, 'point', `vertex ${i}`)),
      ];
    }
    case 'rollover':
      return [h(d.id, 'origin', d.x, d.y, 'origin', `lane ${d.letter}`)];
    case 'bean':
    case 'pop-bumper':
      return [
        h(d.id, 'origin', d.x, d.y, 'origin', d.kind),
        h(d.id, 'radius', d.x + d.radius, d.y, 'size', 'radius'),
      ];
    case 'standup':
      return [h(d.id, 'origin', d.x, d.y, 'origin', d.targetId)];
    case 'drop-bank':
      return [
        h(
          d.id,
          'origin',
          d.slots.reduce((a, s) => a + s.x, 0) / d.slots.length,
          d.slots.reduce((a, s) => a + s.y, 0) / d.slots.length,
          'origin',
          'CHICAGO bank',
        ),
        ...d.slots.map((s, i) => h(d.id, `slot:${i}`, s.x, s.y, 'point', `target ${i}`)),
      ];
    case 'ramp':
      return [
        h(d.id, 'origin', d.plate[0].x, d.plate[0].y, 'origin', d.label),
        ...d.plate.map((p, i) => h(d.id, `plate:${i}`, p.x, p.y, 'point', `plate ${i}`)),
        // The join point is plate[last]; the loader snaps habitrail[0] onto it,
        // so exposing habitrail[0] as its own handle would be a lie.
        ...d.habitrail
          .slice(1)
          .map((p, i) => h(d.id, `rail:${i + 1}`, p.x, p.y, 'point', `wireform ${i + 1}`)),
      ];
    case 'scoop':
      return [h(d.id, 'origin', d.x, d.y, 'origin', d.label)];
    case 'captive':
      return [h(d.id, 'origin', d.x, d.y, 'origin', 'captive lane')];
    case 'spinner':
      return [
        h(d.id, 'origin', d.cx, d.cy, 'origin', 'spinner'),
        h(d.id, 'length', d.cx + d.length / 2, d.cy, 'size', 'blade length'),
      ];
    case 'drain':
      return [h(d.id, 'origin', f.playCenter, d.y, 'origin', 'drain')];
  }
}

/** Every handle in the layout, statics first — the same order they build in,
 *  so hit-testing ties resolve the way the world stacks. */
export function allHandles(resolved: ResolvedLayout): Handle[] {
  const out: Handle[] = [];
  for (const s of resolved.layout.statics) out.push(...handlesFor(s, resolved));
  for (const e of resolved.layout.elements) out.push(...handlesFor(e, resolved));
  return out;
}

function translate(pts: Pt[], dx: number, dy: number) {
  for (const p of pts) {
    p.x += dx;
    p.y += dy;
  }
}

/** Apply a drag. Mutates the draft layout in place; the caller owns cloning.
 *  Returns false when the handle does not exist, which is the editor's signal
 *  that its selection went stale (an item deleted under it, say). */
export function moveHandle(
  layout: PlayfieldLayout,
  ownerId: ElementId,
  key: string,
  to: Pt,
): boolean {
  const x = clampX(to.x);
  const y = clampY(to.y);
  const d = findDesc(layout, ownerId) as any;
  if (!d) return false;
  const f = layout.frame;

  // Frame handles are the exception: nothing is written to the descriptor.
  if (d.kind === 'flipper' && key === 'origin') {
    const playCenter = f.laneInnerX / 2;
    // Gap is a half-separation, so it is signed off the centre line and both
    // bats move. Floor it at a ball's width or the two bats overlap.
    const gap = Math.abs(x - playCenter);
    f.flipperGap = Math.max(12, gap);
    f.flipperY = y;
    return true;
  }

  if (key === 'origin') {
    switch (d.kind) {
      case 'cabinet-wall':
        d.cx = x;
        d.cy = y;
        return true;
      case 'rail': {
        const dx = x - (d.a.x + d.b.x) / 2;
        const dy = y - (d.a.y + d.b.y) / 2;
        translate([d.a, d.b], dx, dy);
        return true;
      }
      case 'slingshot': {
        const dx = x - (d.verts[0].x + d.verts[1].x + d.verts[2].x) / 3;
        const dy = y - (d.verts[0].y + d.verts[1].y + d.verts[2].y) / 3;
        translate(d.verts, dx, dy);
        return true;
      }
      case 'drop-bank': {
        const n = d.slots.length;
        const dx = x - d.slots.reduce((a: number, s: any) => a + s.x, 0) / n;
        const dy = y - d.slots.reduce((a: number, s: any) => a + s.y, 0) / n;
        translate(d.slots, dx, dy);
        return true;
      }
      case 'ramp': {
        const dx = x - d.plate[0].x;
        const dy = y - d.plate[0].y;
        translate(d.plate, dx, dy);
        translate(d.habitrail, dx, dy);
        return true;
      }
      case 'spinner':
        d.cx = x;
        d.cy = y;
        return true;
      case 'plunger':
        d.y = y; // x is the lane centre, derived
        return true;
      case 'drain':
        d.y = y; // x and width come from the frame
        return true;
      default:
        d.x = x;
        d.y = y;
        return true;
    }
  }

  if (key === 'a' || key === 'b') {
    d[key] = { x, y };
    return true;
  }
  if (key === 'extent') {
    d.w = Math.max(6, (x - d.x) * 2);
    d.h = Math.max(6, (y - d.y) * 2);
    return true;
  }
  if (key === 'radius') {
    d.radius = Math.max(6, Math.hypot(x - d.x, y - d.y));
    return true;
  }
  if (key === 'length') {
    d.length = Math.max(8, Math.hypot(x - d.cx, y - d.cy) * 2);
    return true;
  }

  const [group, idxStr] = key.split(':');
  const i = Number(idxStr);
  if (!Number.isInteger(i)) return false;
  switch (group) {
    case 'vert':
      if (!d.verts?.[i]) return false;
      d.verts[i] = { x, y };
      return true;
    case 'slot':
      if (!d.slots?.[i]) return false;
      d.slots[i] = { ...d.slots[i], x, y };
      return true;
    case 'plate':
      if (!d.plate?.[i]) return false;
      d.plate[i] = { x, y };
      // The habitrail starts where the plate ends. Keeping them welded here
      // means the ramp-join rule can never fire from an ordinary drag.
      if (i === d.plate.length - 1) d.habitrail[0] = { x, y };
      return true;
    case 'rail':
      if (!d.habitrail?.[i]) return false;
      d.habitrail[i] = { x, y };
      return true;
    default:
      return false;
  }
}

/** Snap to a grid, with the grid disabled at size <= 1. */
export const snap = (v: number, grid: number) => (grid > 1 ? Math.round(v / grid) * grid : v);
