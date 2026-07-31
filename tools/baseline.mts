/** Measure DEFAULT_LAYOUT and emit ShotLine baselines to paste into it.
 *  The shipped board is ground truth: rules are calibrated to it, not the
 *  other way round. */
import { DEFAULT_LAYOUT } from '../src/layout/default';
import { resolveLayout } from '../src/layout/resolve';
import { segmentClearance } from '../src/layout/geometry';
import { BALL_RADIUS } from '../src/constants';
import { CaptiveBall } from '../src/entities/CaptiveBall';

const resolved = resolveLayout(DEFAULT_LAYOUT);
const f = resolved.frame;
const pivot = (s: string) =>
  s === 'left-flipper'
    ? { x: f.playCenter - f.flipperGap, y: f.flipperY }
    : { x: f.playCenter + f.flipperGap, y: f.flipperY };

const bodies: Array<{ id: string; pos: { x: number; y: number }; r: number }> = [];
for (const s of DEFAULT_LAYOUT.statics) {
  if (s.kind === 'post') bodies.push({ id: s.id, pos: { x: s.x, y: s.y }, r: s.r });
}
for (const e of DEFAULT_LAYOUT.elements) {
  if (e.kind === 'pop-bumper' || e.kind === 'bean') bodies.push({ id: e.id, pos: { x: e.x, y: e.y }, r: e.radius });
  if (e.kind === 'captive') bodies.push({ id: e.id, pos: { x: e.x, y: e.y }, r: CaptiveBall.OUTER_HALF });
}

const target = (id: string) => {
  const e = DEFAULT_LAYOUT.elements.find((x) => x.id === id);
  if (!e) return null;
  if (e.kind === 'ramp') return { ...e.plate[0] };
  // An orbit is entered at its lane MOUTH, low on the board; the sensor sits
  // mid-channel at y=340. Aiming at the sensor draws a straight line across
  // the middle of the playfield, which is not the shot at all.
  if (e.kind === 'sensor' && (e.role === 'left-loop' || e.role === 'right-loop'))
    return { x: e.x, y: 590 };
  if (e.kind === 'scoop' || e.kind === 'captive' || e.kind === 'bean') return { x: e.x, y: e.y };
  if (e.kind === 'sensor') return { x: e.x, y: e.y };
  return null;
};

// EVERY flipper->target pair, not just the documented ones. The undocumented
// lines are exactly what a future edit breaks silently.
// The Bean is deliberately behind the pop nest — reached THROUGH the nest, not
// on a straight line from a flipper — so a shot line to it measures nothing.
const TARGETS = ['ramp-left', 'ramp-right', 'scoop-lake', 'scoop-mode', 'captive', 'left-loop', 'right-loop'];
const out: string[] = [];
console.log('measured clearances (px):');
for (const from of ['left-flipper', 'right-flipper'] as const) {
  for (const t of TARGETS) {
    const to = target(t);
    if (!to) continue;
    let worst = Infinity;
    let who = '';
    for (const b of bodies) {
      // A target cannot obstruct itself: the segment ends inside it.
      if (b.id === t) continue;
      const g = segmentClearance(pivot(from), to, b.pos, b.r, BALL_RADIUS);
      if (g < worst) { worst = g; who = b.id; }
    }
    const id = `${from === 'left-flipper' ? 'L' : 'R'}->${t}`;
    console.log(`  ${id.padEnd(24)} ${worst.toFixed(1).padStart(7)}  (nearest: ${who})`);
    out.push(
      `    { id: '${id}', from: '${from}', to: '${t}', baselineClearance: ${Math.floor(worst)}, minClearance: ${Math.min(0, Math.floor(worst))} },`,
    );
  }
}
console.log('\n  shotLines: [\n' + out.join('\n') + '\n  ],');
