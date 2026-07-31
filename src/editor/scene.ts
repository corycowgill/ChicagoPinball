/** The editor's model of a board: the real world, built and indexed.
 *
 *  The editor does not draw from the layout descriptors. It builds the actual
 *  physics world through `buildPlayfield` and draws THAT — the same bodies the
 *  game collides against, with the same decomposition, chamfers and derived
 *  geometry. So what you see while dragging is not an approximation of the
 *  board; it is the board.
 *
 *  That also means the editor gets every element kind for free: a ramp's
 *  plate, the captive's lane walls, the bank's seven targets are all just
 *  bodies once built, and nothing here needs to know their shapes.
 */
import Matter from 'matter-js';
import { Physics } from '../Physics';
import { buildPlayfield } from '../layout/build';
import { resolveLayout, ResolvedLayout } from '../layout/resolve';
import { Diagnostic, validateLayout } from '../layout/validate';
import { allHandles, Handle } from '../layout/handles';
import { pointToSegment } from '../layout/geometry';
import { PlayfieldLayout, Pt } from '../layout/types';

export interface EditorScene {
  resolved: ResolvedLayout;
  /** Descriptor id -> the bodies it produced, in build order. */
  bodiesById: Map<string, Matter.Body[]>;
  handles: Handle[];
  diagnostics: Diagnostic[];
  /** Ids named by at least one diagnostic, for the offender highlight. */
  flagged: Set<string>;
  /** Set when the layout is broken badly enough that the loader threw. The
   *  editor keeps the previous scene and shows this, rather than dying. */
  error?: string;
}

export function buildScene(layout: PlayfieldLayout): EditorScene {
  const resolved = resolveLayout(layout);
  const bodiesById = new Map<string, Matter.Body[]>();
  const physics = new Physics();
  buildPlayfield(physics, resolved, (id, bodies) => {
    // Two descriptors may share an id in a half-edited layout; concatenating
    // keeps both selectable instead of silently dropping one.
    bodiesById.set(id, [...(bodiesById.get(id) ?? []), ...bodies]);
  });
  const diagnostics = validateLayout(resolved);
  const flagged = new Set<string>();
  for (const d of diagnostics) for (const id of d.elementIds) flagged.add(id);
  return { resolved, bodiesById, handles: allHandles(resolved), diagnostics, flagged };
}

/** Build, or report why not. A layout mid-edit can be genuinely unbuildable
 *  (a drop bank with six targets throws by design), and an editor that
 *  crashes on the way to a valid board is useless. */
export function tryBuildScene(layout: PlayfieldLayout): EditorScene | { error: string } {
  try {
    return buildScene(layout);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const HANDLE_PICK_R = 11;

export function pickHandle(scene: EditorScene, p: Pt, onlyOwner?: string): Handle | null {
  let best: Handle | null = null;
  let bestD = HANDLE_PICK_R;
  for (const h of scene.handles) {
    if (onlyOwner && h.ownerId !== onlyOwner) continue;
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

/** Which descriptor is under the point? Searched in REVERSE build order so
 *  the thing drawn on top is the thing you grab, which is what a pointer
 *  means. The cabinet walls are skipped: they cover the whole board and would
 *  swallow every miss. */
export function pickItem(scene: EditorScene, p: Pt): string | null {
  const order = [
    ...scene.resolved.layout.statics.map((s) => s.id),
    ...scene.resolved.layout.elements.map((e) => e.id),
  ];
  const skip = new Set(
    scene.resolved.layout.statics.filter((s) => s.kind === 'cabinet-wall').map((s) => s.id),
  );
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    if (skip.has(id)) continue;
    for (const b of scene.bodiesById.get(id) ?? []) {
      if (Matter.Vertices.contains(b.vertices, p)) return id;
    }
  }
  // Things with no body under the pointer, or barely any. A ramp contributes
  // only its entry sensor, so without this the two biggest shots on the board
  // would be a 28px target to click.
  for (let i = scene.resolved.layout.elements.length - 1; i >= 0; i--) {
    const e = scene.resolved.layout.elements[i];
    if (e.kind !== 'ramp') continue;
    if (nearPolyline(p, e.plate, 15) || nearPolyline(p, e.habitrail, 9)) return e.id;
  }
  for (const s of scene.resolved.layout.statics) {
    if (s.kind !== 'deco-post') continue;
    if (Math.hypot(s.x - p.x, s.y - p.y) <= (s.r ?? 5) + 6) return s.id;
  }
  return null;
}

function nearPolyline(p: Pt, pts: Pt[], within: number): boolean {
  for (let i = 1; i < pts.length; i++) {
    if (pointToSegment(p, pts[i - 1], pts[i]) <= within) return true;
  }
  return false;
}
