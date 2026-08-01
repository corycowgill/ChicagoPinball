/** Node entry: which shots can this board make, and from where on the bat?
 *
 *    npx tsx tools/shotreach.mts              # the shipped board
 *    CONTROLS=1 npx tsx tools/shotreach.mts   # + the positive controls (slow)
 *
 *  The controls are the reason to trust the table. For each target, delete it
 *  from the layout and confirm its own count falls to zero while the rest hold
 *  steady. A table that cannot be made to fall is not measuring the board —
 *  and every instrument in this repo produced exactly that result before it
 *  produced a right one.
 */
import { DEFAULT_LAYOUT } from '../src/layout/default';
import { formatMap, formatTable, shotTable, TARGETS } from '../src/dev/shotreach';
import { ElementDesc, PlayfieldLayout, StaticDesc } from '../src/layout/types';

const base = shotTable();
console.log(
  `SHIPPED BOARD — ${base.trials} flips ` +
    `(12 strike points x 4 settle times x 2 bats)\n`,
);
console.log(formatTable(base));
console.log('\nwhere each shot lives on the bat:');
console.log(formatMap(base));

if (process.env.CONTROLS === '1') {
  // Which descriptor to remove to kill each target. Anything not listed here
  // has no single owner to delete (pop bumpers and standups are lists), and
  // saying so beats quietly omitting the row.
  const OWNER: Record<string, (l: PlayfieldLayout) => PlayfieldLayout> = {
    'ramp:L': drop((e) => e.kind === 'ramp' && e.label === 'left-ramp'),
    'ramp:R': drop((e) => e.kind === 'ramp' && e.label === 'right-ramp'),
    'loop:L': drop((e) => e.kind === 'sensor' && e.role === 'left-loop'),
    'loop:R': drop((e) => e.kind === 'sensor' && e.role === 'right-loop'),
    scoop: drop((e) => e.kind === 'scoop' && e.label === 'scoop'),
    'lake-bonus': drop((e) => e.kind === 'scoop' && e.label === 'lake-scoop'),
    captive: drop((e) => e.kind === 'captive'),
    lock: drop((e) => e.kind === 'bean'),
    'drop-target': drop((e) => e.kind === 'drop-bank'),
    spinner: drop((e) => e.kind === 'spinner'),
  };

  console.log('\n\nPOSITIVE CONTROLS — delete the target, its row must fall to 0\n');
  for (const target of TARGETS) {
    const mutate = OWNER[target];
    const before = base.rows.find((r) => r.target === target)!;
    if (!mutate) {
      console.log(`  ${target.padEnd(12)} ${String(before.made).padStart(2)}  (no single owner to delete — not controlled)`);
      continue;
    }
    if (before.made === 0) {
      console.log(`  ${target.padEnd(12)}  0  (already 0 on the shipped board — the control says nothing)`);
      continue;
    }
    const t = shotTable(mutate(DEFAULT_LAYOUT));
    const after = t.rows.find((r) => r.target === target)!;
    const others = t.rows
      .filter((r) => r.target !== target)
      .filter((r) => r.made !== base.rows.find((x) => x.target === r.target)!.made);
    console.log(
      `  ${target.padEnd(12)} ${String(before.made).padStart(2)} -> ${String(after.made).padStart(2)}  ` +
        `${after.made === 0 ? 'OK' : 'CONTROL FAILED — deleting it did not stop it scoring'}` +
        (others.length ? `   side effects: ${others.map((r) => r.target).join(', ')}` : ''),
    );
  }
}

function drop(pred: (e: ElementDesc) => boolean) {
  return (l: PlayfieldLayout): PlayfieldLayout => ({
    ...l,
    statics: l.statics as StaticDesc[],
    elements: l.elements.filter((e) => !pred(e)),
  });
}
