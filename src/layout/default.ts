/** Windy City Showdown — the shipped board, as data.
 *
 *  A TypeScript module rather than JSON on purpose: `-Math.PI / 2 - 0.45` and
 *  `COLOR.INSERT_AMBER` survive verbatim, so the shipped board cannot drift
 *  through decimal transcription or a stale palette copy.
 *
 *  ORDER IS LOAD-BEARING. These arrays are in exactly the sequence the old
 *  constructor built things, because Matter's results depend on body
 *  insertion order. `statics` reproduces buildWalls(); `elements` reproduces
 *  the constructor body. Do not sort either one.
 *
 *  Coordinates are transcribed, not re-derived: several are the output of
 *  hand-tuning or of an optimisation over other elements (the centre pedestal
 *  is positioned by measured clearance against a dozen shot lines), and the
 *  asymmetries are deliberate — the lake scoop sits at y 540 and the mode
 *  scoop at y 545.
 */
import { COLOR, PLAYFIELD_H, PLAYFIELD_W, WALL_THICKNESS } from '../constants';
import { PlayfieldLayout, StaticDesc } from './types';

const W = PLAYFIELD_W;
const H = PLAYFIELD_H;
const T = WALL_THICKNESS;
const LANE_INNER_X = PLAYFIELD_W - 60; // 480
const PLAY_RIGHT = LANE_INNER_X;
const PLAY_CENTER = PLAY_RIGHT / 2; // 240
const LAUNCH_X = (LANE_INNER_X + (PLAYFIELD_W - 8)) / 2; // 506

// Bottom geometry: wall | outlane | rail(42) | inlane | slingshot(84+)
const RAIL_X = 42;
const RAIL_TOP = 608;
const RAIL_BOT = 740;
const R_RAIL_X = PLAY_RIGHT - RAIL_X; // 438

const statics: StaticDesc[] = [
  // Outer cabinet box — empty outline, 'wood' skin, so the renderer skips it.
  { kind: 'cabinet-wall', id: 'cab-top', cx: W / 2, cy: -T / 2, w: W, h: T },
  { kind: 'cabinet-wall', id: 'cab-bottom', cx: W / 2, cy: H + T / 2, w: W, h: T },
  { kind: 'cabinet-wall', id: 'cab-left', cx: -T / 2, cy: H / 2, w: T, h: H },
  { kind: 'cabinet-wall', id: 'cab-right', cx: W + T / 2, cy: H / 2, w: T, h: H },

  // Shooter lane inner wall, then the lane's exit sensor. The sensor is built
  // HERE, mid-way through the statics, exactly as buildWalls() did it.
  { kind: 'rail', id: 'shooter-inner', a: { x: LANE_INNER_X, y: 176 }, b: { x: LANE_INNER_X, y: H - 32 }, thickness: 6 },
  { kind: 'sensor', id: 'launch-exit', role: 'launch-exit', x: LAUNCH_X, y: 172, w: (PLAYFIELD_W - 8) - LANE_INNER_X, h: 8 },

  { kind: 'rail', id: 'back-wall', a: { x: 6, y: 172 }, b: { x: LANE_INNER_X - 4, y: 172 }, thickness: 6 },
  { kind: 'rail', id: 'corner-left', a: { x: 6, y: 250 }, b: { x: 148, y: 180 }, thickness: 6 },
  { kind: 'rail', id: 'corner-right', a: { x: PLAY_RIGHT - 6, y: 250 }, b: { x: PLAY_RIGHT - 148, y: 180 }, thickness: 6 },

  // Rollover lane guides: rail then deco post, interleaved per lane.
  { kind: 'rail', id: 'lane-guide-0', a: { x: 165, y: 202 }, b: { x: 165, y: 248 }, thickness: 5 },
  { kind: 'deco-post', id: 'lane-guide-post-0', x: 165, y: 250, r: 4 },
  { kind: 'rail', id: 'lane-guide-1', a: { x: 215, y: 202 }, b: { x: 215, y: 248 }, thickness: 5 },
  { kind: 'deco-post', id: 'lane-guide-post-1', x: 215, y: 250, r: 4 },
  { kind: 'rail', id: 'lane-guide-2', a: { x: 265, y: 202 }, b: { x: 265, y: 248 }, thickness: 5 },
  { kind: 'deco-post', id: 'lane-guide-post-2', x: 265, y: 250, r: 4 },
  { kind: 'rail', id: 'lane-guide-3', a: { x: 315, y: 202 }, b: { x: 315, y: 248 }, thickness: 5 },
  { kind: 'deco-post', id: 'lane-guide-post-3', x: 315, y: 250, r: 4 },

  // Inlane / outlane L-guides. The diagonal must stop short of the flipper
  // pivot: a static rail inside the bat's swept volume jams the swing solid.
  { kind: 'rail', id: 'outlane-rail-l', a: { x: RAIL_X, y: RAIL_TOP }, b: { x: RAIL_X, y: RAIL_BOT }, thickness: 6 },
  { kind: 'rail', id: 'inlane-return-l', a: { x: RAIL_X, y: RAIL_BOT }, b: { x: 104, y: 750 }, thickness: 6 },
  { kind: 'rail', id: 'outlane-rail-r', a: { x: R_RAIL_X, y: RAIL_TOP }, b: { x: R_RAIL_X, y: RAIL_BOT }, thickness: 6 },
  { kind: 'rail', id: 'inlane-return-r', a: { x: R_RAIL_X, y: RAIL_BOT }, b: { x: PLAY_RIGHT - 104, y: 750 }, thickness: 6 },

  { kind: 'deco-post', id: 'lane-mouth-l', x: RAIL_X, y: RAIL_TOP - 8, r: 5 },
  { kind: 'deco-post', id: 'lane-mouth-r', x: R_RAIL_X, y: RAIL_TOP - 8, r: 5 },
  { kind: 'deco-post', id: 'sling-post-l', x: 84, y: 644, r: 5 },
  { kind: 'deco-post', id: 'sling-post-r', x: PLAY_RIGHT - 84, y: 644, r: 5 },

  // Ramp mouth funnels — frame each shot so near-misses deflect in.
  { kind: 'rail', id: 'funnel-l-outer', a: { x: 112, y: 512 }, b: { x: 132, y: 556 }, thickness: 5 },
  { kind: 'rail', id: 'funnel-l-inner', a: { x: 196, y: 516 }, b: { x: 172, y: 556 }, thickness: 5 },
  { kind: 'deco-post', id: 'funnel-l-post-a', x: 132, y: 558, r: 4 },
  { kind: 'deco-post', id: 'funnel-l-post-b', x: 172, y: 558, r: 4 },
  { kind: 'rail', id: 'funnel-r-outer', a: { x: PLAY_RIGHT - 112, y: 512 }, b: { x: PLAY_RIGHT - 132, y: 556 }, thickness: 5 },
  { kind: 'rail', id: 'funnel-r-inner', a: { x: PLAY_RIGHT - 196, y: 516 }, b: { x: PLAY_RIGHT - 172, y: 556 }, thickness: 5 },
  { kind: 'deco-post', id: 'funnel-r-post-a', x: PLAY_RIGHT - 132, y: 558, r: 4 },
  { kind: 'deco-post', id: 'funnel-r-post-b', x: PLAY_RIGHT - 172, y: 558, r: 4 },

  // Stadium pedestal. ONE central column: four posts here previously blocked
  // five separate shot lines. Its position is the output of a clearance
  // optimisation, not a free parameter — see the ShotLine baselines.
  { kind: 'post', id: 'stadium-pedestal', x: PLAY_CENTER, y: 600, r: 12, restitution: 0.5, skin: 'rail' },

  // Attraction support legs. 'wood' hides them from the chrome-post pass.
  { kind: 'post', id: 'baseball-leg-ne', x: 162, y: 244, r: 3, restitution: 0.4, skin: 'wood' },
  { kind: 'post', id: 'baseball-leg-sw', x: 110, y: 288, r: 3, restitution: 0.4, skin: 'wood' },
  { kind: 'post', id: 'hockey-leg-nw', x: 380, y: 236, r: 3, restitution: 0.4, skin: 'wood' },
  { kind: 'post', id: 'hockey-leg-se', x: 431, y: 281, r: 3, restitution: 0.4, skin: 'wood' },
  { kind: 'post', id: 'soccer-post-n', x: 383, y: 533, r: 2.5, restitution: 0.4, skin: 'wood' },
  { kind: 'post', id: 'soccer-post-s', x: 383, y: 557, r: 2.5, restitution: 0.4, skin: 'wood' },
];

export const DEFAULT_LAYOUT: PlayfieldLayout = {
  schema: 1,
  name: 'Windy City Showdown',
  frame: {
    width: PLAYFIELD_W,
    height: PLAYFIELD_H,
    laneInnerX: LANE_INNER_X,
    laneOuterX: PLAYFIELD_W - 8,
    flipperY: PLAYFIELD_H - 200,
    flipperGap: 118,
    rolloverY: 226,
    rolloverXs: [190, 240, 290],
  },
  statics,
  elements: [
    { kind: 'plunger', id: 'plunger', y: PLAYFIELD_H - 60 },
    { kind: 'ball-spawn', id: 'ball-spawn' },

    { kind: 'flipper', id: 'flipper-left', side: 'left' },
    { kind: 'flipper', id: 'flipper-right', side: 'right' },

    // The slingshot's vertical outer edge doubles as the inlane's inner wall.
    // `normal` is raw; the loader normalises it.
    {
      kind: 'slingshot',
      id: 'sling-left',
      verts: [
        { x: 84, y: 650 },
        { x: 84, y: 720 },
        { x: 148, y: 724 },
      ],
      normal: { x: 0.72, y: -0.69 },
    },
    {
      kind: 'slingshot',
      id: 'sling-right',
      verts: [
        { x: PLAY_RIGHT - 84, y: 650 },
        { x: PLAY_RIGHT - 84, y: 720 },
        { x: PLAY_RIGHT - 148, y: 724 },
      ],
      normal: { x: -0.72, y: -0.69 },
    },

    { kind: 'rollover', id: 'rollover-0', x: 190, y: 226, letter: '10K', idx: 0 },
    { kind: 'rollover', id: 'rollover-1', x: 240, y: 226, letter: '25K', idx: 1 },
    { kind: 'rollover', id: 'rollover-2', x: 290, y: 226, letter: '10K', idx: 2 },

    { kind: 'bean', id: 'bean', x: PLAY_CENTER, y: 300, radius: 24 },

    // Surface-to-surface gaps ~32 px: a ball entering the nest rattles
    // between all three rather than sailing through.
    { kind: 'pop-bumper', id: 'pop-0', x: PLAY_CENTER - 35, y: 358, radius: 19, color: COLOR.INSERT_AMBER },
    { kind: 'pop-bumper', id: 'pop-1', x: PLAY_CENTER + 35, y: 358, radius: 19, color: COLOR.INSERT_RED },
    { kind: 'pop-bumper', id: 'pop-2', x: PLAY_CENTER, y: 412, radius: 19, color: COLOR.INSERT_BLUE },

    { kind: 'standup', id: 'standup-cubs', targetId: 'cubs', x: 126, y: 316, angle: 0.5, width: 34, height: 11, color: COLOR.INSERT_YELLOW },
    { kind: 'standup', id: 'standup-bears', targetId: 'bears', x: 114, y: 388, angle: 0.72, width: 34, height: 11, color: COLOR.INSERT_AMBER },
    { kind: 'standup', id: 'standup-bulls', targetId: 'bulls', x: PLAY_RIGHT - 126, y: 316, angle: -0.5, width: 34, height: 11, color: COLOR.INSERT_RED },
    { kind: 'standup', id: 'standup-sox', targetId: 'sox', x: PLAY_RIGHT - 114, y: 388, angle: -0.72, width: 34, height: 11, color: COLOR.INSERT_PURPLE },

    // C-H-I up the left diagonal, C-A-G-O down the right. Order is semantic.
    {
      kind: 'drop-bank',
      id: 'chicago-bank',
      slots: [
        { x: 152, y: 468, angle: -0.8 },
        { x: 178, y: 441, angle: -0.8 },
        { x: 204, y: 414, angle: -0.8 },
        { x: 276, y: 414, angle: 0.8 },
        { x: 302, y: 441, angle: 0.8 },
        { x: 328, y: 468, angle: 0.8 },
        { x: 354, y: 495, angle: 0.8 },
      ],
    },

    {
      kind: 'ramp',
      id: 'ramp-left',
      label: 'left-ramp',
      plate: [
        { x: 150, y: 560 },
        { x: 110, y: 495 },
        { x: 88, y: 410 },
        { x: 84, y: 320 },
        { x: 106, y: 255 },
        { x: 150, y: 222 },
        { x: 195, y: 208 },
      ],
      habitrail: [
        { x: 195, y: 208 },
        { x: 258, y: 192 },
        { x: 336, y: 200 },
        { x: 404, y: 232 },
        { x: 459, y: 300 },
        { x: 459, y: 580 },
        { x: 434, y: 618 },
        { x: 417, y: 640 },
      ],
      exitVel: { x: 0.4, y: 6 },
      color: COLOR.INSERT_AMBER,
      arrowAngle: -Math.PI / 2 - 0.45,
      themeText: 'WILLIS',
      feedsInlane: 'inlane-right',
    },
    {
      kind: 'ramp',
      id: 'ramp-right',
      label: 'right-ramp',
      plate: [
        { x: 330, y: 560 },
        { x: 370, y: 495 },
        { x: 392, y: 410 },
        { x: 396, y: 320 },
        { x: 374, y: 255 },
        { x: 330, y: 222 },
        { x: 285, y: 208 },
      ],
      habitrail: [
        { x: 285, y: 208 },
        { x: 222, y: 192 },
        { x: 144, y: 200 },
        { x: 76, y: 232 },
        { x: 21, y: 300 },
        { x: 21, y: 580 },
        { x: 46, y: 618 },
        { x: 63, y: 640 },
      ],
      // y 8 rather than 6: enough punch to push through the spinner blade in
      // the left inlane instead of stalling on it.
      exitVel: { x: -0.4, y: 8 },
      color: COLOR.INSERT_CYAN,
      arrowAngle: -Math.PI / 2 + 0.45,
      themeText: 'CTA',
      feedsInlane: 'inlane-left',
    },

    { kind: 'scoop', id: 'scoop-lake', label: 'lake-scoop', x: 80, y: 540, kickAngle: -Math.PI / 2 + 0.35, kickSpeed: 15 },
    // Kick nearly vertical: the old (-0.35, 15) ricocheted off the CAGO bank
    // and fed the right outlane — draining as a reward for making the shot.
    { kind: 'scoop', id: 'scoop-mode', label: 'scoop', x: PLAY_RIGHT - 80, y: 545, kickAngle: -Math.PI / 2 - 0.2, kickSpeed: 13 },

    { kind: 'captive', id: 'captive', x: 420, y: 494 },
    { kind: 'spinner', id: 'spinner', cx: 63, cy: 678, length: 34 },

    { kind: 'sensor', id: 'left-outlane', role: 'left-outlane', x: 21, y: 884, w: 38, h: 10, kicker: { vx: 0.6, vy: -21, riseY: -6 } },
    { kind: 'sensor', id: 'inlane-left', role: 'inlane-left', x: 63, y: 712, w: 34, h: 12 },
    { kind: 'sensor', id: 'inlane-right', role: 'inlane-right', x: PLAY_RIGHT - 63, y: 712, w: 34, h: 12 },
    { kind: 'sensor', id: 'right-outlane', role: 'right-outlane', x: 459, y: 884, w: 38, h: 10 },
    { kind: 'sensor', id: 'left-loop', role: 'left-loop', x: 20, y: 340, w: 34, h: 10 },
    { kind: 'sensor', id: 'right-loop', role: 'right-loop', x: 462, y: 340, w: 34, h: 10 },

    { kind: 'drain', id: 'drain', y: PLAYFIELD_H - 4, h: 6, inset: 12 },
  ],
};
