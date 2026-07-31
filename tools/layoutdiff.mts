/** Node entry: diff the hand-written constructor against the layout loader. */
import { diffWorlds } from '../src/dev/layoutdiff';
const r = diffWorlds();
console.log(`constructor bodies: ${r.legacyCount}   layout bodies: ${r.layoutCount}`);
if (r.ok) {
  console.log('IDENTICAL — the layout reproduces the constructor exactly');
} else {
  console.log(`${r.mismatches.length} mismatch(es):`);
  for (const m of r.mismatches) console.log('  ' + m);
  process.exitCode = 1;
}
