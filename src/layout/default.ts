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
const RAIL_TOP = 688;
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

  // Orbit return GATES — one-way, and they have to be. Both orbit lanes used
  // to run straight down into the
  // outlanes: measured with tools/orbitreturn.mts, 64% of left-orbit returns
  // and 76% of right-orbit returns ended past every flipper. The orbits score
  // loops, light the 2x/3x playfield and start two of the five sports modes,
  // so the board was punishing you for making them. These carry the
  // descending ball inboard, over the divider, onto the flipper: 100% and 100%.
  //
  // As plain rails they also blocked the SHOT. A lane is used both ways — the
  // orbit is shot up the same channel its return comes down — and a static
  // guide across it took orbit entry from 8/12 to 0/12, which would have
  // killed two of the five sports modes. They are one-way gates: solid to a
  // falling ball, open to a climbing one.
  //
  // A guide alone was not enough, and the measurement said so: it roofed the
  // outlane, which then had NO feed at all (0/40 reachable) and made the
  // kickback fire into a sealed pocket. An outlane nothing can enter is a dead
  // kickback, a dead EL EXPRESS and a board with no risk on the sides.
  //
  // The outlane's mouth is the gap between a gate's inboard end and the top of
  // its divider, and it has to admit a 22px ball with room to cross. At the
  // old positions that gap was 18px and the outlanes were unreachable — 0/64
  // — which is a dead kickback, a dead EL EXPRESS and no risk on the sides.
  // Ending the gates at x=76 and dropping RAIL_TOP from 608 to 688 opens it:
  // orbit returns still reach a flipper 100% of the time, and the outlanes are
  // reachable on 23% of the probe, up from 13% on the old board.
  { kind: 'rail', id: 'return-guide-l', a: { x: 6, y: 560 }, b: { x: 76, y: 600 }, thickness: 6, oneWay: 'down' },
  { kind: 'rail', id: 'return-guide-r', a: { x: PLAY_RIGHT - 6, y: 560 }, b: { x: PLAY_RIGHT - 76, y: 600 }, thickness: 6, oneWay: 'down' },

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
  // The soccer goal, which is also the mode scoop's funnel. These two are the
  // physics for the 3D goalposts, and Renderer3D reads them from here by id —
  // it used to derive its own from `scoop.x - 17, scoop.y ± 12`, which is the
  // copied-literal pattern that let the 3D rails and the physics rails drift
  // apart once already.
  //
  // They used to sit on a VERTICAL line 17px west of the scoop, because the
  // goal was built "mouth facing the hole" from the west. Nothing arrives
  // from the west. Both flipper shots come from the south-west — 50.2 deg
  // above horizontal off the left bat, 61.6 off the right — so the goal stood
  // side-on to every shot it exists to receive, and its 24px mouth measured
  // only 15.4px across the shot, for a ball that needs 27.
  //
  // Three things were learned fixing it, and only the third one shipped.
  //
  // 1. THE POSTS WERE NEVER THE BLOCKER. Deleting both entirely leaves the
  //    mode scoop at 1/96 on tools/shotreach.mts, exactly as shipped. The
  //    -9px and -5px clearances the validator reported against them were real
  //    arithmetic about a straight line and told us nothing about the shot.
  //    (The same null test debunked these posts as the captive's blocker a
  //    round earlier. Twice now.)
  //
  // 2. WHAT THEY CAN BE IS A FUNNEL — the part the ramp mouths already use,
  //    deflecting near-misses in. But a funnel wants to sit in FRONT of the
  //    hole, and in front of this hole is where the right orbit's return gate
  //    delivers its ball. Moved 22px down-shot, the mode scoop went 1 -> 7
  //    and the CHICAGO bank 5 -> 11 — and right-orbit returns reaching a
  //    flipper collapsed from 100% to 12%, undoing a whole previous round.
  //    Only one placement in 60 cleared the gate by 28px, and it was worse.
  //
  // 3. AND A THIRD CONSTRAINT ONLY THE EJECT AUDIT COULD SEE. The next
  //    candidate put a post 4.5px from the scoop's centre — effectively a
  //    backboard in the hole. It read best of all on make rate, and
  //    tools/ejectaudit.mts caught what that cost: the mode scoop's own kick
  //    started clipping it into the RIGHT OUTLANE on 20% of its fan, up from
  //    0%. Making the shot would have lost the ball, which is the single
  //    worst bug this board has ever shipped. Proximity to the scoop is not a
  //    usable proxy either — the ORIGINAL posts sit 20.8px from its centre,
  //    inside its capture circle, because a goal belongs at the mouth. Only
  //    firing the kicker answers it.
  //
  // The shipped placement is the best of 58 that clear the return gate by
  // 28px, searched over centre x angle x width and filtered on the eject:
  //
  //     mode scoop    1/96 -> 6/96
  //     CHICAGO bank  5/96 -> 10/96
  //     captive       0/96 -> 1/96   (its first non-zero reading, ever)
  //     right orbit   2/96 unchanged, returns still 100%
  //     scoop eject   0% into an outlane, unchanged
  //
  // 25 deg, not the 55 the bisector of the two approaches predicts. A funnel
  // does not want to face the shot square on — square on it stops the ball.
  // Angled shallower it glances the ball onward into the hole, which is what
  // the ramp funnels do. The analysis was corrected by the measurement here,
  // not confirmed by it.
  { kind: 'post', id: 'soccer-post-n', x: 372, y: 526, r: 2.5, restitution: 0.4, skin: 'wood' },
  { kind: 'post', id: 'soccer-post-s', x: 386, y: 556, r: 2.5, restitution: 0.4, skin: 'wood' },
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
      // Aimed INBOARD. Both ramp exits used to point at their own outlane,
      // which was harmless while the divider reached up to y=608 and blocked
      // the drift. With the divider shortened to open the outlane's mouth, the
      // right ramp started feeding the left outlane on 40% of the eject
      // audit's fan — the ramp's reward became a drain.
      exitVel: { x: -0.8, y: 6 },
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
      // the left inlane instead of stalling on it. x aimed inboard — see the
      // left ramp above.
      exitVel: { x: 0.8, y: 8 },
      color: COLOR.INSERT_CYAN,
      arrowAngle: -Math.PI / 2 + 0.45,
      themeText: 'CTA',
      feedsInlane: 'inlane-left',
    },

    // The audit reads 27% into the left outlane on this one — same failure
    // shape as the mode scoop below, one notch less severe: the eject clips
    // the left ramp's outer wall and drops into the left channel.
    { kind: 'scoop', id: 'scoop-lake', label: 'lake-scoop', x: 80, y: 540, kickAngle: -Math.PI / 2 + 0.35, kickSpeed: 15 },
    // Kick nearly vertical: the old (-0.35, 15) ricocheted off the CAGO bank
    // and fed the right outlane — draining as a reward for making the shot.
    { kind: 'scoop', id: 'scoop-mode', label: 'scoop', x: PLAY_RIGHT - 80, y: 545, kickAngle: -Math.PI / 2 - 0.2, kickSpeed: 13 },

    { kind: 'captive', id: 'captive', x: 420, y: 494 },
    { kind: 'spinner', id: 'spinner', cx: 63, cy: 678, length: 34 },

    // The kickback fires OUT, not UP. Firing up the lane was the old design and
    // it returned the ball to this same outlane on 73% of its fan — the lane
    // was a blind vertical corridor, and adding the return guide above it made
    // that worse, not better (93%): now the lane has a roof.
    //
    // What made a sideways kick possible is the shortened divider. It spans
    // y 632..740, so below 740 the outlane and the inlane are already one
    // space, and a ball punched right at the bottom of the lane crosses into
    // the flipper zone instead of climbing into a dead end. Measured over the
    // audit's 15-trial fan: 73% into the outlane before, 0% now.
    { kind: 'sensor', id: 'left-outlane', role: 'left-outlane', x: 21, y: 884, w: 38, h: 10, kicker: { vx: 6, vy: -18, riseY: -6 } },
    { kind: 'sensor', id: 'inlane-left', role: 'inlane-left', x: 63, y: 712, w: 34, h: 12 },
    { kind: 'sensor', id: 'inlane-right', role: 'inlane-right', x: PLAY_RIGHT - 63, y: 712, w: 34, h: 12 },
    { kind: 'sensor', id: 'right-outlane', role: 'right-outlane', x: 459, y: 884, w: 38, h: 10 },
    { kind: 'sensor', id: 'left-loop', role: 'left-loop', x: 20, y: 340, w: 34, h: 10 },
    { kind: 'sensor', id: 'right-loop', role: 'right-loop', x: 462, y: 340, w: 34, h: 10 },

    { kind: 'drain', id: 'drain', y: PLAYFIELD_H - 4, h: 6, inset: 12 },
  ],

  // ── Design intent, made checkable ────────────────────────────────────────
  // No-build zones. These were previously only source comments, and at least
  // one of them was WRONG: the soccer legs were placed at x=383 "so the
  // captive-lane approach corridor (x >= ~389) must stay clear", but that
  // arithmetic omits the ball's own 11 px radius, so a 2.5 px post at 383
  // actually excludes the ball's centre out to x=396.5.
  //
  // A SECOND one has now been deleted outright rather than fixed. There used
  // to be a `captive-approach` corridor from the right flipper to the captive
  // mouth, and the right flipper cannot take that shot: its line runs through
  // its OWN slingshot. Once slingshots became visible to validation the
  // corridor reported six blockers at once — the slingshot's three edges, its
  // post, the inlane return rail and the mode scoop — none of which is
  // movable, because between them they ARE the bottom right of the board.
  // src/dev/captivereach.ts says the same thing from the physics side: a real
  // flip from the right bat is blocked at the bat itself on 8 trials of 8.
  // A protected corridor for a shot that does not exist is worse than no
  // corridor: it reserves space and certifies a fiction.
  corridors: [
    {
      id: 'loop-channel-left',
      a: { x: 20, y: 548 },
      b: { x: 20, y: 340 },
      width: 30,
      note: 'left orbit lane, down to the return guide',
    },
    {
      id: 'loop-channel-right',
      a: { x: 462, y: 548 },
      b: { x: 462, y: 340 },
      width: 30,
      note: 'right orbit lane, down to the return guide',
    },
  ],

  // Measured against the shipped board by tools/baseline.mts. The board is
  // ground truth, so thresholds are seeded FROM it: a line that is already
  // obstructed records that fact rather than failing the build. Regressions
  // are caught by a DECREASE from the baseline, not by an absolute floor —
  // otherwise a shot clearing by 122 px could be walked down to 1 px and
  // nothing would complain.
  //
  // EVERY NUMBER BELOW CHANGED IN ONE ROUND, and the old ones were fiction.
  // The clearance rules used to test a line against circles only — seven
  // posts, three pop bumpers, the Bean, the captive: twelve bodies out of the
  // fifty-seven this board places. Rails, deco posts, slingshots, standups
  // and drop targets were invisible, so a "122px clear" shot was 122px clear
  // of a fifth of the board. See src/layout/validate.ts. Two consequences
  // are visible right here:
  //
  //   - the ramp lines fell from 71/39/10 to 3, because the funnel POSTS
  //     that frame each ramp mouth are on them. That is the funnel doing its
  //     job — it is meant to be a tight gate — but nothing measured it before.
  //   - every loop line went negative against a slingshot, and those shots
  //     are made 90% of the time (tools/shotodds.mjs). A shot line is a
  //     straight-line CLEARANCE heuristic, not a trajectory: a real flipper
  //     shot leaves the bat tangentially and curves round its own slingshot.
  //     Read a negative baseline as "this line is obstructed", never as "this
  //     shot is impossible" — the physics probes answer that question, not
  //     this table.
  //
  // Lines are measured from where the ball actually sits — cradled on the bat
  // — not from the hinge. Measuring from the hinge put the first point of
  // every line inside the flipper's own slingshot and produced a uniform
  // -11.0px, which is the ball's radius and therefore a tell.
  //
  // The Bean has no shot line: it sits behind the pop nest by design and is
  // reached THROUGH the nest, so a straight line from a flipper measures
  // nothing meaningful.
  shotLines: [
    { id: 'L->ramp-left', from: 'left-flipper', to: 'ramp-left', baselineClearance: 3, minClearance: 0 },
    { id: 'L->ramp-right', from: 'left-flipper', to: 'ramp-right', baselineClearance: 3, minClearance: 0 },
    { id: 'L->scoop-lake', from: 'left-flipper', to: 'scoop-lake', baselineClearance: 17, minClearance: 0 },
    // These two barely moved when the soccer goal was re-aimed: -9/-5 before,
    // -10/-7 after. The mode scoop went from 1 make in 96 to 6 over the same
    // change. That is the clearest demonstration on this board of what a shot
    // line is and is not — the straight-line gap to the target is not the
    // makeability of the shot, and a change can improve one while nudging the
    // other the wrong way. Judge geometry edits with tools/shotreach.mts;
    // these numbers are a regression tripwire, not a score.
    { id: 'L->scoop-mode', from: 'left-flipper', to: 'scoop-mode', baselineClearance: -10, minClearance: -10 },
    { id: 'L->captive', from: 'left-flipper', to: 'captive', baselineClearance: -11, minClearance: -11 },
    { id: 'L->left-loop', from: 'left-flipper', to: 'left-loop', baselineClearance: -11, minClearance: -11 },
    { id: 'L->right-loop', from: 'left-flipper', to: 'right-loop', baselineClearance: -12, minClearance: -12 },
    { id: 'R->ramp-left', from: 'right-flipper', to: 'ramp-left', baselineClearance: 3, minClearance: 0 },
    { id: 'R->ramp-right', from: 'right-flipper', to: 'ramp-right', baselineClearance: 3, minClearance: 0 },
    { id: 'R->scoop-lake', from: 'right-flipper', to: 'scoop-lake', baselineClearance: 13, minClearance: 0 },
    { id: 'R->scoop-mode', from: 'right-flipper', to: 'scoop-mode', baselineClearance: -7, minClearance: -7 },
    // The right flipper's line to the captive is blocked by the mode scoop's
    // capture circle and, before that, by the right slingshot itself. Kept
    // rather than deleted so the fact is recorded and any edit that changes
    // it is reported.
    { id: 'R->captive', from: 'right-flipper', to: 'captive', baselineClearance: -19, minClearance: -19 },
    { id: 'R->left-loop', from: 'right-flipper', to: 'left-loop', baselineClearance: -11, minClearance: -11 },
    { id: 'R->right-loop', from: 'right-flipper', to: 'right-loop', baselineClearance: -11, minClearance: -11 },
  ],
};
