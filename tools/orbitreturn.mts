/** Node entry: where do the orbit lanes deliver the ball, and can the outlanes
 *  still be reached?
 *
 *  Prints the shipped board against a variant with the return gates removed
 *  and the divider back at its old height, so the two numbers that matter are
 *  side by side rather than in two runs of a changing tool. */
import { formatOrbit, orbitReturn, outlaneReach } from '../src/dev/orbitreturn';
import { DEFAULT_LAYOUT } from '../src/layout/default';
import { PlayfieldLayout } from '../src/layout/types';

function withoutGates(): PlayfieldLayout {
  const l = JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) as PlayfieldLayout;
  l.statics = l.statics.filter((s) => !s.id.startsWith('return-guide'));
  for (const id of ['outlane-rail-l', 'outlane-rail-r']) {
    const r = l.statics.find((s) => s.id === id) as { a: { y: number } } | undefined;
    if (r) r.a.y = 608;
  }
  for (const id of ['lane-mouth-l', 'lane-mouth-r']) {
    const p = l.statics.find((s) => s.id === id) as { y: number } | undefined;
    if (p) p.y = 600;
  }
  return l;
}

for (const [name, l] of [
  ['BEFORE (no gates, divider at 608)', withoutGates()],
  ['AFTER  (shipped)', DEFAULT_LAYOUT],
] as [string, PlayfieldLayout][]) {
  const r = outlaneReach(l);
  console.log(`${name}`);
  console.log(formatOrbit(orbitReturn(l)));
  console.log(
    `  outlanes reachable  ${r.outlane}/${r.total}` +
      ` (${Math.round((r.outlane / r.total) * 100)}%)\n`,
  );
}
