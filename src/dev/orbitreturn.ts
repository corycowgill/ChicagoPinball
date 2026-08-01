/** Where does a ball coming down an orbit lane actually end up?
 *
 *  Both orbits score loops, light the 2x/3x playfield and start two of the
 *  five sports modes. So where they DELIVER the ball is a first-order design
 *  question, and nothing measures it: the clearance rules see straight lines,
 *  and the eject audit only fires kickers.
 *
 *  This releases balls down each orbit channel across a spread of start x and
 *  small sideways drift, steps the REAL playfield, and tallies where they
 *  finish. Same fan-and-tally shape as src/dev/ejectaudit.ts, and the same
 *  reason for the fan: one trajectory through a pinball table is a knife edge.
 *
 *  Read it as a distribution, not a verdict. An outlane share of zero would be
 *  its own bug — a board where the outlanes cannot be reached does not need a
 *  kickback or an EL EXPRESS, and stops being pinball.
 */
import Matter from 'matter-js';
import { FLIPPER_LEN } from '../constants';
import { Physics } from '../Physics';
import { Playfield, PlayfieldEvents } from '../scene/Playfield';
import { DEFAULT_LAYOUT } from '../layout/default';
import { PlayfieldLayout } from '../layout/types';

/** What became of the ball, in the only terms that matter to a player:
 *  could a flipper have reached it?
 *
 *  The first version of this counted `inlane` (the sensor) against `drain`,
 *  which cannot distinguish the two things that matter — nothing is flipping
 *  in a headless run, so EVERY playable ball eventually drains. It scored a
 *  working guide at 0% inlane / 100% drain and read like a disaster. What is
 *  actually being asked is where the ball crosses the flipper line. */
type Fate =
  /** Reached an outlane. Past every flipper: unrecoverable by construction. */
  | 'outlane'
  /** Crossed the flipper line where a bat could have hit it. */
  | 'flipper'
  /** Crossed the flipper line in the centre gap, between the two bats. */
  | 'centre'
  | 'in-play';

const DT = 1000 / 60;
const MAX_STEPS = 600;
/** Where the lane is when it is still a lane, above anything that steers.
 *  Deliberately NOT the loop switch's height — this probe asks where a ball
 *  coming DOWN the lane ends up, which is a different question from where the
 *  switch that scores the climb should sit. The two were the same number
 *  until the switch moved down to 420. */
const RELEASE_Y = 340;
/** Sideways drift at release. A ball leaving an orbit is not falling
 *  perfectly straight, and a guide that only works for a plumb drop works for
 *  nothing. */
const DRIFTS = [-0.6, -0.2, 0, 0.2, 0.6];
/** Offsets from the lane's centre line, spanning the channel's width. */
const OFFSETS = [-8, -4, 0, 4, 8];

export function run(
  layout: PlayfieldLayout,
  x: number,
  y: number,
  drift: number,
  vy = 1.5,
): Fate {
  let fate: Fate = 'in-play';
  const settle = (f: Fate) => {
    if (fate === 'in-play') fate = f;
  };
  const physics = new Physics();
  const ev: PlayfieldEvents = {
    onScore: () => {},
    onLockComplete: () => {},
    onScoopMode: () => {},
    onLanesComplete: () => {},
    onDrain: () => {},
    onLeftOutlane: () => settle('outlane'),
    onRightOutlane: () => settle('outlane'),
  };
  const pf = new Playfield(physics, ev, layout);
  const ball = pf.balls[0].body;
  Matter.Body.setPosition(ball, { x, y });
  // Released with the small downward speed a ball has after cresting the
  // orbit, not from rest — a ball dropped from rest hugs the wall harder than
  // one that is actually travelling.
  Matter.Body.setVelocity(ball, { x: drift, y: vy });
  Matter.Body.setAngularVelocity(ball, 0);

  const line = pf.flipperY;
  // How far from the play centre a bat can still reach. Past this on either
  // side and no flip was ever going to save it.
  const reach = pf.flipperGap + FLIPPER_LEN;
  let wasAbove = ball.position.y < line;
  for (let s = 0; s < MAX_STEPS; s++) {
    pf.tick(DT);
    physics.step(DT);
    if (fate !== 'in-play') break;
    const below = ball.position.y >= line;
    if (wasAbove && below) {
      const off = Math.abs(ball.position.x - pf.playCenter);
      settle(off <= reach ? 'flipper' : 'outlane');
      break;
    }
    wasAbove = !below;
  }
  return fate;
}

export interface SideResult {
  side: 'left' | 'right';
  tally: Record<Fate, number>;
  total: number;
}

export function orbitReturn(layout: PlayfieldLayout = DEFAULT_LAYOUT): SideResult[] {
  const out: SideResult[] = [];
  for (const side of ['left', 'right'] as const) {
    // The lane's centre is its loop sensor, read from the layout so this keeps
    // measuring the right place when the lane moves.
    const role = side === 'left' ? 'left-loop' : 'right-loop';
    const sensor = [...layout.statics, ...layout.elements].find(
      (d) => d.kind === 'sensor' && d.role === role,
    ) as { x: number } | undefined;
    const centre = sensor?.x ?? (side === 'left' ? 20 : 462);
    const tally: Record<Fate, number> = { outlane: 0, flipper: 0, centre: 0, 'in-play': 0 };
    let total = 0;
    for (const off of OFFSETS) {
      for (const drift of DRIFTS) {
        tally[run(layout, centre + off, RELEASE_Y, drift)]++;
        total++;
      }
    }
    out.push({ side, tally, total });
  }
  return out;
}

export function formatOrbit(rs: SideResult[]): string {
  const pct = (n: number, t: number) => `${((n / t) * 100).toFixed(0)}%`.padStart(4);
  return rs
    .map(
      (r) =>
        `  ${r.side.padEnd(5)} orbit   reaches a flipper ${pct(r.tally.flipper, r.total)}` +
        `   OUTLANE ${pct(r.tally.outlane, r.total)}` +
        `   still rolling ${pct(r.tally['in-play'], r.total)}`,
    )
    .join('\n');
}

/** The other half of the question. A guide that delivers every orbit ball to
 *  the flipper is only right if the outlane is still REACHABLE — from the
 *  playfield, which is where an outlane is fed on a real machine. An outlane
 *  nothing can enter makes the kickback and the EL EXPRESS dead features and
 *  takes the risk out of the board.
 *
 *  Releases balls across the lower playfield, outside the orbit lanes, and
 *  reports how many still find an outlane. */
export function outlaneReach(layout: PlayfieldLayout = DEFAULT_LAYOUT): {
  outlane: number;
  total: number;
} {
  let outlane = 0;
  let total = 0;
  // Two feeds, because an outlane has two on a real machine and the first
  // version of this probe only modelled one. Dropping balls from above the
  // slingshots misses the way most outlane drains actually happen.
  const releases: [number, number, number][] = [];
  // (a) drifting down the lower playfield, outside the orbit lanes
  for (const x of [55, 70, 85, 100, 380, 395, 410, 425]) {
    for (const drift of [-1.2, 1.2]) releases.push([x, 560, drift]);
  }
  for (const [x, y, drift] of releases) {
    if (run(layout, x, y, drift) === 'outlane') outlane++;
    total++;
  }
  // (b) kicked OUT of a slingshot — up and sideways, which is what a
  // slingshot actually does. Modelling it as a falling ball (the first
  // version of this) misses the feed entirely.
  for (const [x, y] of [[86, 656], [86, 672], [394, 656], [394, 672]] as [number, number][]) {
    for (const [dx, dy] of [[-5, -5], [-3, -7], [-6, -3], [5, -5], [3, -7], [6, -3]] as [number, number][]) {
      const sx = x < 240 ? dx : -dx;
      if (run(layout, x, y, sx, dy) === 'outlane') outlane++;
      total++;
    }
  }
  // (c) drifting across the outlane's MOUTH — the band between a return gate's
  // inboard end and the top of its divider. Releasing only from above the gate
  // (a) or below the divider (b) samples nowhere a ball can actually enter an
  // outlane, so the probe reported 0 for every board including the shipped one.
  for (const [x, y] of [[54, 614], [66, 616], [78, 618], [426, 614], [414, 616], [402, 618]] as [number, number][]) {
    for (const dx of [-3, -1.5, 1.5, 3]) {
      const sx = x < 240 ? dx : -dx;
      if (run(layout, x, y, sx) === 'outlane') outlane++;
      total++;
    }
  }
  return { outlane, total };
}
