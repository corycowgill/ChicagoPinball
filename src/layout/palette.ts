/** The palette: what you can add to a board, and what you must not remove.
 *
 *  Two lists, and the second one is the interesting one.
 *
 *  The brief for this editor was "warn me, but let me build anyway", so almost
 *  nothing here is forbidden — the validator complains and you carry on. But a
 *  handful of descriptors are not merely important, they are LOAD-BEARING for
 *  the loader: `PlayfieldParts` has non-optional singletons, and `Playfield`
 *  dereferences them unconditionally. Deleting the left flipper does not
 *  produce a bad board, it produces a `TypeError` — and since the editor draws
 *  by building the real world, it would take the editor down with it.
 *
 *  So: `REQUIRED` blocks deletion of exactly those, and nothing else. Anything
 *  that merely makes the board bad to play stays deletable.
 */
import { COLOR } from '../constants';
import { AnyDesc } from './handles';
import { ElementDesc, PlayfieldLayout, Pt, StaticDesc } from './types';

export interface PaletteItem {
  key: string;
  label: string;
  /** Which array it belongs in — build order, not decoration. */
  into: 'statics' | 'elements';
  /** Fresh descriptor placed at `p`, with an id the caller has made unique. */
  make: (id: string, p: Pt) => AnyDesc;
  hint: string;
}

export const PALETTE: PaletteItem[] = [
  {
    key: 'post',
    label: 'Post',
    into: 'statics',
    hint: 'A solid round post. The workhorse: it shapes lanes and rebounds.',
    make: (id, p): StaticDesc => ({ kind: 'post', id, x: p.x, y: p.y, r: 8 }),
  },
  {
    key: 'deco-post',
    label: 'Deco post',
    into: 'statics',
    hint: 'Drawn but has NO body — decoration only, a ball passes through it.',
    make: (id, p): StaticDesc => ({ kind: 'deco-post', id, x: p.x, y: p.y, r: 5 }),
  },
  {
    key: 'rail',
    label: 'Rail',
    into: 'statics',
    hint: 'A straight guide. Drag either end to aim it.',
    make: (id, p): StaticDesc => ({
      kind: 'rail',
      id,
      a: { x: p.x - 40, y: p.y },
      b: { x: p.x + 40, y: p.y },
      thickness: 6,
    }),
  },
  {
    key: 'pop-bumper',
    label: 'Pop bumper',
    into: 'elements',
    hint: 'Kicks the ball away on contact and scores. Put three in a nest.',
    make: (id, p): ElementDesc => ({
      kind: 'pop-bumper',
      id,
      x: p.x,
      y: p.y,
      radius: 22,
      color: COLOR.NEON_CYAN,
    }),
  },
  {
    key: 'standup',
    label: 'Standup target',
    into: 'elements',
    hint: 'A flat target that scores when struck.',
    make: (id, p): ElementDesc => ({
      kind: 'standup',
      id,
      targetId: id,
      x: p.x,
      y: p.y,
      angle: 0,
      width: 26,
      height: 8,
      color: COLOR.NEON_AMBER,
    }),
  },
  {
    key: 'rollover',
    label: 'Rollover lane',
    into: 'elements',
    hint: 'A top-lane trigger. Its letter and index drive the lane set.',
    make: (id, p): ElementDesc => ({
      kind: 'rollover',
      id,
      x: p.x,
      y: p.y,
      letter: 'W',
      idx: 0,
    }),
  },
  {
    key: 'scoop',
    label: 'Scoop',
    into: 'elements',
    hint: 'Catches the ball, holds it, then kicks it. Check where it ejects.',
    make: (id, p): ElementDesc => ({
      kind: 'scoop',
      id,
      label: 'scoop',
      x: p.x,
      y: p.y,
      kickAngle: -Math.PI / 2,
      kickSpeed: 14,
    }),
  },
  {
    key: 'spinner',
    label: 'Spinner',
    into: 'elements',
    hint: 'A free-swinging blade that scores per revolution.',
    make: (id, p): ElementDesc => ({ kind: 'spinner', id, cx: p.x, cy: p.y, length: 34 }),
  },
  {
    key: 'sensor',
    label: 'Lane sensor',
    into: 'elements',
    hint: 'An invisible trigger. Pick its role — each role may appear once.',
    make: (id, p): ElementDesc => ({
      kind: 'sensor',
      id,
      role: 'inlane-left',
      x: p.x,
      y: p.y,
      w: 34,
      h: 12,
    }),
  },
];

/** Would removing this descriptor break the LOADER (not merely the game)? */
export function requiredReason(layout: PlayfieldLayout, d: AnyDesc): string | null {
  const count = (pred: (e: ElementDesc) => boolean) => layout.elements.filter(pred).length;
  switch (d.kind) {
    case 'flipper':
      return `Playfield reads ${d.side}Flipper unconditionally — removing it throws on the first frame.`;
    case 'plunger':
      return 'The plunger is how a ball reaches the board; the loader has no fallback.';
    case 'ball-spawn':
      return count((e) => e.kind === 'ball-spawn') > 1
        ? null
        : 'Without a ball spawn there is no ball, and resetBall() has nothing to place.';
    case 'bean':
      return 'The Bean is the multiball lock; Playfield holds a non-optional reference.';
    case 'drop-bank':
      return 'The CHICAGO bank drives letters, bonus and the HUD strip.';
    case 'spinner':
      return 'Playfield ticks the spinner every frame.';
    case 'captive':
      return 'The captive ball is constructed unconditionally.';
    case 'drain':
      return 'No drain sensor means a lost ball is never detected — the game hangs on that ball.';
    case 'ramp':
      return count((e) => e.kind === 'ramp' && e.label === d.label) > 1
        ? null
        : `${d.label} is held as a non-optional part; the ramp handlers dereference it.`;
    case 'scoop':
      return count((e) => e.kind === 'scoop' && e.label === d.label) > 1
        ? null
        : `${d.label} is held as a non-optional part.`;
    default:
      return null;
  }
}

/** A fresh id in the same family, never colliding with an existing one. */
export function uniqueId(layout: PlayfieldLayout, base: string): string {
  const taken = new Set<string>([
    ...layout.statics.map((s) => s.id),
    ...layout.elements.map((e) => e.id),
  ]);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
