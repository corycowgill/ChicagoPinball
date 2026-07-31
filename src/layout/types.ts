/** The playfield described as data.
 *
 *  Everything the ball can touch is one entry in one of two ORDERED arrays.
 *  Order is load-bearing, not cosmetic: Matter's solver walks bodies in
 *  insertion order, which sets broadphase pair order, which sets the order
 *  position-correction is applied, which changes the float results. Two
 *  layouts with identical contents in a different order are different boards.
 *  So the array index IS the build order, `statics` always builds before
 *  `elements`, and an editor may sort for DISPLAY but must never reorder.
 *
 *  Authored layouts live in `default.ts` as a TypeScript module rather than
 *  JSON, so expressions like `-Math.PI / 2 - 0.45` and palette references like
 *  `COLOR.INSERT_AMBER` survive verbatim. JSON is only for user-made layouts,
 *  where a checksum guards against hand-editing drift.
 */

export interface Pt {
  x: number;
  y: number;
}

export type ElementId = string;

/** Exactly seven — one per letter of CHICAGO. `ChicagoBank` throws otherwise,
 *  and the tuple makes that unreachable from an authored layout. */
export type Septet<T> = [T, T, T, T, T, T, T];

/** Board-level scalars. Everything else on the Playfield derives from these;
 *  see `resolve.ts`. Editing them cascades hard (playCenter <- playRight <-
 *  laneInnerX moves the flippers, the drain and the pedestal), so an editor
 *  should keep them behind an advanced panel. */
export interface Frame {
  width: number;
  height: number;
  /** Inner edge of the shooter lane; also the right edge of the play area. */
  laneInnerX: number;
  laneOuterX: number;
  flipperY: number;
  flipperGap: number;
  rolloverY: number;
  rolloverXs: number[];
}

/** Sensors are a CLOSED set of roles, each of which must appear exactly once.
 *
 *  The role string is the physics label, and `wireCollisions` binds handlers
 *  by label. Leaving that open to free strings would let an editor create a
 *  second 'drain' and silently change which handler fires. A closed union plus
 *  an arity check means the editor can move and resize sensors but can never
 *  invent one — and `wireCollisions` needs no changes at all. */
export const SENSOR_ROLES = [
  'launch-exit',
  'left-outlane',
  'right-outlane',
  'inlane-left',
  'inlane-right',
  'left-loop',
  'right-loop',
  'drain',
] as const;
export type SensorRole = (typeof SENSOR_ROLES)[number];

/** How the renderer skins a static body. 'wood' is also the flag that hides a
 *  body from the 3D chrome-post pass, which the outer cabinet walls and the
 *  attraction support legs both rely on. */
export type WallSkin = 'rail' | 'wood' | 'plastic';

// ── Statics: built FIRST, in array order (today's buildWalls()) ─────────────

export type StaticDesc =
  /** Outer cabinet box. Deliberately bypasses the normal wall path: pushed
   *  with an EMPTY outline so the renderer skips drawing it. */
  | { kind: 'cabinet-wall'; id: ElementId; cx: number; cy: number; w: number; h: number }
  /** A rail is a segment. The body is a rotated rectangle whose chamfer
   *  radius is `min(3, thickness/2 - 0.1)` — a formula, not a constant,
   *  because it changes the vertex count with thickness and therefore
   *  changes contact behaviour. */
  | { kind: 'rail'; id: ElementId; a: Pt; b: Pt; thickness: number; skin?: WallSkin }
  /** A PHYSICAL circular post (pedestal, attraction legs, goal posts). */
  | { kind: 'post'; id: ElementId; x: number; y: number; r: number; restitution?: number; skin?: WallSkin }
  /** Render-list only — NO body. Distinct from 'post' because today the only
   *  thing distinguishing the two is which array they were pushed into. */
  | { kind: 'deco-post'; id: ElementId; x: number; y: number; r?: number }
  | SensorDesc;

/** A labelled trigger rectangle. Identical whether authored in `statics` or in
 *  `elements` — the two arrays differ only in build order — so both take this
 *  one shape. Anything that walks sensors (validation, the eject audit) can
 *  then scan both arrays without caring which one an author picked. */
export interface SensorDesc {
  kind: 'sensor';
  id: ElementId;
  role: SensorRole;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Outlanes only: the impulse this lane's kicker applies, and how far above
   *  the sensor the ball is lifted before it fires. Read by Playfield's
   *  kickback so the numbers live in the layout rather than in two places. */
  kicker?: { vx: number; vy: number; riseY: number };
}

// ── Elements: built SECOND, in array order (today's constructor body) ───────

export interface FlipperOpts {
  len?: number;
  height?: number;
  restAngle?: number;
  activeAngle?: number;
}

export type ElementDesc =
  /** x and width are derived from the frame's lane geometry. */
  | { kind: 'plunger'; id: ElementId; y: number }
  /** Position fully derived: (launchX, launchRestY). */
  | { kind: 'ball-spawn'; id: ElementId }
  /** Pivot derived: playCenter -/+ flipperGap, at flipperY. */
  | { kind: 'flipper'; id: ElementId; side: 'left' | 'right'; opts?: FlipperOpts }
  /** `normal` is stored RAW and normalised by the loader. Storing the
   *  normalised result instead would not round-trip: norm({0.72,-0.69}) and a
   *  decimal transcription of its output are different doubles. */
  | { kind: 'slingshot'; id: ElementId; verts: [Pt, Pt, Pt]; normal: Pt }
  | { kind: 'rollover'; id: ElementId; x: number; y: number; letter: string; idx: number }
  | { kind: 'bean'; id: ElementId; x: number; y: number; radius: number }
  | { kind: 'pop-bumper'; id: ElementId; x: number; y: number; radius: number; color: string }
  | {
      kind: 'standup';
      id: ElementId;
      targetId: string;
      x: number;
      y: number;
      angle: number;
      width: number;
      height: number;
      color: string;
    }
  /** Slot ORDER is semantic: letters are assigned by index, and both the HUD
   *  strip and the in-order bonus index by position. An editor may move slots
   *  but must not reorder, add or delete them. */
  | { kind: 'drop-bank'; id: ElementId; slots: Septet<{ x: number; y: number; angle: number }> }
  /** The entry sensor derives from plate[0] and `fullPath` is plate +
   *  habitrail, so editing the polyline moves the visual, the trigger and the
   *  ball's transit path together. The loader snaps habitrail[0] onto
   *  plate[last] so the `slice(1)` join can never silently teleport a ball. */
  | {
      kind: 'ramp';
      id: ElementId;
      label: string;
      plate: Pt[];
      habitrail: Pt[];
      exitVel: Pt;
      color: string;
      arrowAngle: number;
      themeText: string;
      minSpeed?: number;
      /** Declared intent, checked by validation rather than derived. */
      feedsInlane?: 'inlane-left' | 'inlane-right';
    }
  | {
      kind: 'scoop';
      id: ElementId;
      label: 'scoop' | 'lake-scoop';
      x: number;
      y: number;
      kickAngle: number;
      kickSpeed: number;
    }
  | { kind: 'captive'; id: ElementId; x: number; y: number }
  | { kind: 'spinner'; id: ElementId; cx: number; cy: number; length: number }
  | SensorDesc
  /** x and width derived from the frame; only the depth is authored. */
  | { kind: 'drain'; id: ElementId; y: number; h: number; inset: number };

// ── Design intent — the part that is NOT arithmetic ────────────────────────

/** A no-build zone: the captive approach, the loop channels, the inlanes.
 *  Invisible at runtime, drawn as a ghost in the editor. Any physical body
 *  overlapping one is an error. This is how invisible intent — currently
 *  living only in source comments — becomes machine-checkable. */
export interface Corridor {
  id: ElementId;
  a: Pt;
  b: Pt;
  width: number;
  note: string;
  /** The element this corridor is the approach TO. A corridor ends at its
   *  destination, so the destination necessarily overlaps it and must be
   *  exempt — otherwise every approach flags the thing it approaches. */
  target?: ElementId;
}

/** A flipper-to-target shot line carrying the clearance it has TODAY.
 *  Regressions are judged on a DECREASE from the baseline rather than against
 *  an absolute floor, so a shot that currently clears by 90 px cannot be
 *  quietly walked down to 17 without complaint. */
export interface ShotLine {
  id: ElementId;
  from: 'left-flipper' | 'right-flipper';
  to: ElementId;
  baselineClearance: number;
  minClearance: number;
}

export interface PlayfieldLayout {
  schema: 1;
  name: string;
  frame: Frame;
  statics: StaticDesc[];
  elements: ElementDesc[];
  corridors?: Corridor[];
  shotLines?: ShotLine[];
  /** Set on JSON export: hash of the canonical resolved form. */
  checksum?: string;
}
