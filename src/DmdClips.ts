/** What the dot-matrix panel PLAYS, as opposed to what it says.
 *
 *  Every sports mode used to start with its name and a countdown, which is
 *  the one moment a real machine's display performs. These are the
 *  performances. They live here rather than in Dmd.ts because that file is a
 *  panel — a dot buffer, a font and a blitter — and these are content.
 *
 *  ## The constraint that shapes all of them
 *
 *  Eighteen dots of height. A recognisable *scene* is not available; a
 *  recognisable *motion* is. So each clip is one moving object against one
 *  static target, and the sport is legible from how the object moves — a
 *  puck slides flat and fast, a basketball drops steeply, a football wobbles
 *  end over end. Detail spent on the object itself is wasted at this size.
 *
 *  ## Original imagery only
 *
 *  Standing constraint on this project: no official team logos, league
 *  logos, player likenesses or Stern artwork. These are generic sports
 *  objects — a ball, a puck, a net, a hoop — and the SPORTS table in
 *  types.ts is already generic (BASEBALL / GRAND SLAM, not a club name).
 *  Nothing here draws a team mark, and nothing here should start.
 */
import { Dmd, DmdClip } from './Dmd';
import { SportId } from './types';

const COLS = 128;
const ROWS = 18;

/** The panel splits in two, and every sport clip uses the same split.
 *
 *  Learned by looking at the first version on the real backbox: with the
 *  animation free to use all 18 rows, the motion finished in the right
 *  quarter and left two thirds of the panel dark, and the mode name only
 *  appeared once the action was over. A 90s machine does the opposite — it
 *  names the mode for the whole animation and runs the picture underneath.
 *
 *  Top rows 0-6 are the name. Rows 8-17 are the picture, and the picture
 *  crosses the FULL width so the panel is never mostly empty. */
const NAME_Y = 0;
const FLOOR = ROWS - 2;

/** Ease a value from 0..1. Motion that starts and stops abruptly reads as a
 *  glitch on a panel this small. */
const easeOut = (p: number) => 1 - (1 - p) * (1 - p);

/** A ball on a parabolic arc from (x0,y0) to (x1,y1) peaking `h` dots up.
 *
 *  Keep `h` under (y0+y1)/2 - 8 or the ball climbs into the name row and the
 *  text goes muddy — the picture band is rows 8..17 and that is all of it.
 *  The first pass used h=6..8 everywhere and every arc crossed the title. */
function arc(p: number, x0: number, y0: number, x1: number, y1: number, h: number) {
  return {
    x: x0 + (x1 - x0) * p,
    y: y0 + (y1 - y0) * p - Math.sin(Math.PI * p) * h,
  };
}

/** A net: uprights plus a slack mesh. Used by hockey and soccer, which is
 *  why it is a function and not two copies. */
function net(d: Dmd, x: number, y: number, w: number, h: number) {
  d.line(x, y, x, y + h);
  d.line(x + w, y, x + w, y + h);
  d.line(x, y, x + w, y);
  for (let i = 2; i < w; i += 3) d.line(x + i, y, x + i, y + h);
}

/** BASEBALL — a ball arcs out over a diamond and away over the wall. */
const baseball: DmdClip = {
  id: 'baseball',
  ms: 1500,
  draw(d, t) {
    d.centerText('GRAND SLAM', NAME_Y);
    const p = Math.min(1, t / 1300);
    // Diamond seen from above, left of centre; home plate at its foot.
    const cx = 20;
    d.line(cx, FLOOR - 4, cx + 8, FLOOR - 8);
    d.line(cx + 8, FLOOR - 8, cx + 16, FLOOR - 4);
    d.line(cx + 16, FLOOR - 4, cx + 8, FLOOR);
    d.line(cx + 8, FLOOR, cx, FLOOR - 4);
    // Outfield wall at the far right — the ball clears it.
    d.line(120, FLOOR - 6, 120, FLOOR);
    d.line(116, FLOOR - 6, 120, FLOOR - 6);
    const b = arc(p, cx + 8, FLOOR, 126, FLOOR - 7, 4);
    d.circle(b.x, b.y, 1, true);
  },
};

/** FOOTBALL — the ball wobbles end over end the length of the field. */
const football: DmdClip = {
  id: 'football',
  ms: 1500,
  draw(d, t) {
    d.centerText('TOUCHDOWN DRIVE', NAME_Y);
    const p = Math.min(1, t / 1300);
    // Yard lines the whole way, so the field reads even before the ball
    // gets there.
    for (let x = 6; x < 108; x += 12) d.line(x, FLOOR - 1, x, FLOOR);
    d.line(112, FLOOR - 9, 112, FLOOR);
    d.line(122, FLOOR - 9, 122, FLOOR);
    d.line(112, FLOOR - 7, 122, FLOOR - 7);
    const b = arc(p, 4, FLOOR - 1, 117, FLOOR - 8, 3);
    const spin = t / 80;
    const ox = Math.round(Math.cos(spin));
    const oy = Math.round(Math.sin(spin));
    d.dot(b.x, b.y);
    d.dot(b.x + ox, b.y + oy);
    d.dot(b.x - ox, b.y - oy);
  },
};

/** BASKETBALL — a long arc dropping through the hoop. */
const basketball: DmdClip = {
  id: 'basketball',
  ms: 1500,
  draw(d, t) {
    d.centerText('THREE POINTS', NAME_Y);
    const p = Math.min(1, t / 1150);
    const hx = 106;
    const hy = FLOOR - 5;
    d.line(hx + 10, FLOOR - 9, hx + 10, FLOOR - 1); // backboard
    d.line(hx, hy, hx + 9, hy); // rim
    const through = t > 1150;
    const sag = through ? 5 : 3;
    for (let i = 0; i <= 8; i += 2) d.line(hx + i, hy, hx + 2 + i / 2, hy + sag);
    // Shooter at the far left, so the arc has somewhere to come from.
    d.line(4, FLOOR - 2, 4, FLOOR);
    d.line(2, FLOOR - 3, 6, FLOOR - 3);
    const b = arc(p, 6, FLOOR - 3, hx + 4, hy - 1, 4);
    d.circle(b.x, through ? hy + sag + 2 : b.y, 2);
  },
};

/** HOCKEY — the puck slides the length of the ice and shakes the net. */
const hockey: DmdClip = {
  id: 'hockey',
  ms: 1400,
  draw(d, t) {
    d.centerText('SLAP SHOT', NAME_Y);
    const p = Math.min(1, easeOut(t / 850));
    // Blue lines, so the ice reads as ice rather than as blank panel.
    for (const x of [30, 62, 94]) d.line(x, FLOOR - 8, x, FLOOR);
    const shake = t > 850 ? Math.sin((t - 850) / 40) * 1.5 : 0;
    net(d, 108 + shake, FLOOR - 9, 16, 9);
    const x = 4 + (104 - 4) * p;
    // Wide and flat: that shape IS the sport at this size.
    d.line(x, FLOOR - 1, x + 4, FLOOR - 1);
    d.line(x, FLOOR, x + 4, FLOOR);
    if (p < 1) for (let i = 1; i <= 4; i++) d.dot(x - i * 5, FLOOR - (i % 2));
  },
};

/** SOCCER — a keeper dives the wrong way. */
const soccer: DmdClip = {
  id: 'soccer',
  ms: 1500,
  draw(d, t) {
    d.centerText('PENALTY KICK', NAME_Y);
    const p = Math.min(1, t / 1050);
    net(d, 100, FLOOR - 9, 24, 9);
    // Penalty spot and the striker, far left.
    d.dot(8, FLOOR);
    d.line(5, FLOOR - 4, 5, FLOOR - 1);
    const b = arc(p, 10, FLOOR, 120, FLOOR - 8, 3);
    d.circle(b.x, b.y, 1, true);
    // Keeper commits low, late and to the wrong corner.
    const dive = Math.min(1, Math.max(0, (t - 350) / 550));
    const kx = 110;
    const ky = FLOOR - 6 + dive * 4;
    d.line(kx, ky, kx, ky + 3);
    d.line(kx - 2 - dive * 4, ky + 1, kx + 2, ky + 1);
  },
};

/** JACKPOT — a radial burst from the centre. */
const jackpot: DmdClip = {
  id: 'jackpot',
  ms: 900,
  draw(d, t) {
    const p = t / 900;
    const r = 2 + p * 46;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      d.dot(COLS / 2 + Math.cos(a) * r, ROWS / 2 + Math.sin(a) * r * 0.32);
      d.dot(COLS / 2 + Math.cos(a) * r * 0.6, ROWS / 2 + Math.sin(a) * r * 0.2);
    }
    if (p > 0.25) d.centerText('JACKPOT', 6);
  },
};

/** MULTIBALL — three balls scatter out of one. */
const multiball: DmdClip = {
  id: 'multiball',
  ms: 1200,
  draw(d, t) {
    const p = Math.min(1, easeOut(t / 800));
    const paths: [number, number][] = [
      [-1, -0.6],
      [1, -0.35],
      [0.2, 0.9],
    ];
    for (const [vx, vy] of paths) {
      d.circle(COLS / 2 + vx * 52 * p, ROWS / 2 + vy * 9 * p, 1, true);
    }
    if (t > 500) d.centerText('MULTIBALL', 6);
  },
};

/** CHICAGO complete — the seven letters light left to right, then all flash. */
const chicago: DmdClip = {
  id: 'chicago',
  ms: 1600,
  draw(d, t) {
    const letters = 'CHICAGO';
    const step = 130;
    const lit = Math.floor(t / step);
    const x0 = Math.floor((COLS - letters.length * 12) / 2);
    for (let i = 0; i < letters.length; i++) {
      if (i > lit) continue;
      // Once every letter is up, flash the whole word.
      if (lit >= letters.length && Math.floor(t / 110) % 2 === 0) continue;
      d.text(letters[i], x0 + i * 12, 3);
      d.line(x0 + i * 12, 12, x0 + i * 12 + 4, 12);
    }
  },
};

/** ATTRACT — an L train crosses a skyline silhouette.
 *
 *  Long and looping rather than a one-shot: this one plays while nobody is
 *  at the machine, so it is written to be watched twice. */
const elTrain: DmdClip = {
  id: 'el-train',
  ms: 6000,
  draw(d, t) {
    // Skyline along the bottom — a fixed, deliberately irregular profile.
    const tops = [12, 9, 13, 6, 11, 8, 14, 10, 5, 12, 9, 13, 7, 11, 15, 8];
    for (let i = 0; i < tops.length; i++) {
      const x = i * 8;
      d.line(x, tops[i], x + 6, tops[i]);
      d.line(x, tops[i], x, ROWS - 1);
      d.line(x + 6, tops[i], x + 6, ROWS - 1);
    }
    // Elevated track and a three-car train running right to left.
    d.line(0, 4, COLS - 1, 4);
    const x = COLS + 10 - ((t / 6000) * (COLS + 60));
    for (let c = 0; c < 3; c++) {
      const cx = x + c * 15;
      d.line(cx, 0, cx + 11, 0);
      d.line(cx, 3, cx + 11, 3);
      d.line(cx, 0, cx, 3);
      d.line(cx + 11, 0, cx + 11, 3);
      d.dot(cx + 3, 2);
      d.dot(cx + 8, 2);
    }
  },
};

export const SPORT_CLIPS: Record<SportId, DmdClip> = {
  baseball,
  football,
  basketball,
  hockey,
  soccer,
};

export const CLIPS = {
  jackpot,
  multiball,
  chicago,
  elTrain,
} as const;

/** Everything, for tools/dmdcheck.mts. A clip that is never listed here is
 *  never checked, so this is the list and not a hand-written copy of it. */
export const ALL_CLIPS: DmdClip[] = [
  ...Object.values(SPORT_CLIPS),
  ...Object.values(CLIPS),
];
