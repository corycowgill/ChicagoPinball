/** Measure DEFAULT_LAYOUT and emit ShotLine baselines to paste into it.
 *  The shipped board is ground truth: rules are calibrated to it, not the
 *  other way round.
 *
 *  This used to carry its OWN obstacle list, its own pivot arithmetic and its
 *  own target rules — a second implementation of the thing it was seeding.
 *  The two drifted: the validator learned about rails, slingshots, deco posts,
 *  standups, drop targets and scoops, and this tool went on measuring seven
 *  posts. A seeding tool that measures a different board from the one being
 *  validated writes baselines that pass forever. It now calls the validator's
 *  own `measureShotLine`, so drift is not possible.
 */
import { DEFAULT_LAYOUT } from '../src/layout/default';
import { resolveLayout } from '../src/layout/resolve';
import { measureShotLine } from '../src/layout/validate';

const resolved = resolveLayout(DEFAULT_LAYOUT);

// EVERY flipper->target pair, not just the documented ones. The undocumented
// lines are exactly what a future edit breaks silently.
// The Bean is deliberately behind the pop nest — reached THROUGH the nest, not
// on a straight line from a flipper — so a shot line to it measures nothing.
const TARGETS = [
  'ramp-left',
  'ramp-right',
  'scoop-lake',
  'scoop-mode',
  'captive',
  'left-loop',
  'right-loop',
];

const out: string[] = [];
console.log('measured clearances (px):');
for (const from of ['left-flipper', 'right-flipper'] as const) {
  for (const t of TARGETS) {
    const m = measureShotLine(resolved, from, t);
    if (!m) continue;
    const id = `${from === 'left-flipper' ? 'L' : 'R'}->${t}`;
    console.log(`  ${id.padEnd(24)} ${m.gap.toFixed(1).padStart(7)}  (nearest: ${m.who})`);
    out.push(
      `    { id: '${id}', from: '${from}', to: '${t}', baselineClearance: ${Math.floor(m.gap)}, minClearance: ${Math.min(0, Math.floor(m.gap))} },`,
    );
  }
}
console.log('\n  shotLines: [\n' + out.join('\n') + '\n  ],');
