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

  // ── The rest of the board ────────────────────────────────────────────────
  // Everything below used to be missing, and the omission was not neutral:
  // the palette offered nine of the nineteen kinds a board is made of, so
  // half of what you could see on the shipped table could never be put on
  // your own. Now that a missing part builds a stand-in instead of throwing,
  // delete works on all of it — and add has to match, or deleting a ramp is
  // a one-way door.
  {
    key: 'ramp',
    label: 'Ramp',
    into: 'elements',
    hint: 'A raised lane. Drag the plate and habitrail points to shape it. Claims the left-ramp or right-ramp slot — a third replaces one.',
    make: (id, p): ElementDesc => ({
      kind: 'ramp',
      id,
      label: 'left-ramp',
      plate: [
        { x: p.x, y: p.y },
        { x: p.x, y: p.y - 70 },
        { x: p.x + 30, y: p.y - 130 },
      ],
      habitrail: [
        { x: p.x + 30, y: p.y - 130 },
        { x: p.x + 60, y: p.y - 90 },
      ],
      exitVel: { x: 0, y: 7 },
      color: COLOR.INSERT_CYAN,
      arrowAngle: -Math.PI / 2,
      themeText: 'RAMP',
    }),
  },
  {
    key: 'slingshot',
    label: 'Slingshot',
    into: 'elements',
    hint: 'A sprung triangle that kicks the ball away. Drag each corner; the normal is which way it fires.',
    make: (id, p): ElementDesc => ({
      kind: 'slingshot',
      id,
      verts: [
        { x: p.x, y: p.y - 35 },
        { x: p.x, y: p.y + 35 },
        { x: p.x + 64, y: p.y + 39 },
      ],
      normal: { x: 0.72, y: -0.69 },
    }),
  },
  {
    key: 'captive',
    label: 'Captive ball',
    into: 'elements',
    hint: 'A ball held in a short lane, struck from below. x,y is the MOUTH at the bottom.',
    make: (id, p): ElementDesc => ({ kind: 'captive', id, x: p.x, y: p.y }),
  },
  {
    key: 'bean',
    label: 'Bean (lock)',
    into: 'elements',
    hint: 'The multiball lock. Three locks light multiball.',
    make: (id, p): ElementDesc => ({ kind: 'bean', id, x: p.x, y: p.y, radius: 30 }),
  },
  {
    key: 'drop-bank',
    label: 'Drop bank',
    into: 'elements',
    hint: 'Seven drop targets spelling CHICAGO. Exactly seven — the bank throws on any other count.',
    make: (id, p): ElementDesc => ({
      kind: 'drop-bank',
      id,
      slots: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: p.x + (i - 3) * 34, y: p.y, angle: 0 })) as [
        { x: number; y: number; angle: number },
        { x: number; y: number; angle: number },
        { x: number; y: number; angle: number },
        { x: number; y: number; angle: number },
        { x: number; y: number; angle: number },
        { x: number; y: number; angle: number },
        { x: number; y: number; angle: number },
      ],
    }),
  },

  // ── The machine ──────────────────────────────────────────────────────────
  // Not features. A board missing any of these is not a hard board, it is one
  // that cannot be played — so validateLayout reports each absence as an
  // ERROR. They are here because delete no longer refuses them, and an editor
  // that lets you remove something it cannot give back is a trap.
  {
    key: 'flipper-left',
    label: 'Left flipper',
    into: 'elements',
    hint: 'The left bat. Its pivot comes from the frame (flipperGap, flipperY), not from where you click.',
    make: (id): ElementDesc => ({ kind: 'flipper', id, side: 'left' }),
  },
  {
    key: 'flipper-right',
    label: 'Right flipper',
    into: 'elements',
    hint: 'The right bat. Its pivot comes from the frame, not from where you click.',
    make: (id): ElementDesc => ({ kind: 'flipper', id, side: 'right' }),
  },
  {
    key: 'plunger',
    label: 'Plunger',
    into: 'elements',
    hint: 'The shooter. x comes from the shooter lane; only its y is yours.',
    make: (id, p): ElementDesc => ({ kind: 'plunger', id, y: p.y }),
  },
  {
    key: 'ball-spawn',
    label: 'Ball spawn',
    into: 'elements',
    hint: 'Where a ball appears. Placed on the plunger; add more for a multiball start.',
    make: (id): ElementDesc => ({ kind: 'ball-spawn', id }),
  },
  {
    key: 'drain',
    label: 'Drain',
    into: 'elements',
    hint: 'How a lost ball is detected. Without one the game waits forever on a ball it can never see.',
    make: (id, p): ElementDesc => ({ kind: 'drain', id, y: p.y, h: 6, inset: 12 }),
  },
];

/** What you lose by deleting this — or null if nothing worth saying.
 *
 *  This used to be `requiredReason`, and it BLOCKED deletion of ten of the
 *  nineteen element kinds: both flippers, the plunger, the ball spawn, the
 *  Bean, the drop bank, the spinner, the captive, both ramps, both scoops.
 *  The reason was real at the time — every one of those is a non-optional
 *  field on `PlayfieldParts` that `Playfield` and both renderers dereference
 *  unconditionally, so deleting one produced a TypeError rather than a board
 *  without that feature, and took the editor down with it.
 *
 *  `standIns()` in build.ts fixed the cause: a missing part is now built
 *  off-table with no bodies in the world, so absence is absence. Nothing here
 *  blocks any more. What is left is a warning, which is what the brief for
 *  this editor asked for in the first place — "warn me, but let me build
 *  anyway".
 *
 *  The four MACHINE parts are called out because they are a different class
 *  of loss: a board with no Bean is a board without multiball, but a board
 *  with no drain is a board that waits forever on a ball it can never see.
 *  validateLayout reports those as errors as well; this is just the sentence
 *  you get at the moment you press Delete.
 */
export function deleteWarning(layout: PlayfieldLayout, d: AnyDesc): string | null {
  const count = (pred: (e: ElementDesc) => boolean) => layout.elements.filter(pred).length;
  const last = (pred: (e: ElementDesc) => boolean) => count(pred) <= 1;
  // EVERY case asks whether this is the LAST of its kind. Deleting one of two
  // captives costs you nothing, and saying "no captive ball" at that moment
  // is not a warning, it is a false alarm — which is what the first version
  // of this said, caught by clicking Add then Delete in the real editor.
  switch (d.kind) {
    case 'flipper':
      return last((e) => e.kind === 'flipper' && e.side === d.side)
        ? `no ${d.side} bat — half the board becomes unreachable`
        : null;
    case 'plunger':
      return last((e) => e.kind === 'plunger')
        ? 'no shooter — nothing puts a ball on the board'
        : null;
    case 'ball-spawn':
      return last((e) => e.kind === 'ball-spawn') ? 'no ball spawn — there is no ball' : null;
    case 'drain':
      return last((e) => e.kind === 'drain')
        ? 'no drain — a lost ball is never detected and the game waits on it forever'
        : null;
    case 'bean':
      return last((e) => e.kind === 'bean')
        ? 'no multiball lock — LOCK and multiball can never start'
        : null;
    case 'drop-bank':
      return last((e) => e.kind === 'drop-bank')
        ? 'no CHICAGO bank — letters, bonus and the HUD strip go dead'
        : null;
    case 'spinner':
      return last((e) => e.kind === 'spinner')
        ? 'no spinner — the rip award and its growing value are gone'
        : null;
    case 'captive':
      return last((e) => e.kind === 'captive')
        ? 'no captive ball — its 3000 and its CHICAGO letter spot are gone'
        : null;
    case 'ramp':
      return last((e) => e.kind === 'ramp' && e.label === d.label)
        ? `no ${d.label} — the modes that start on it can never start`
        : null;
    case 'scoop':
      return last((e) => e.kind === 'scoop' && e.label === d.label)
        ? `no ${d.label} — the award it grants can never be collected`
        : null;
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
