/** Node entry: do the DMD clips draw, and do they move?
 *
 *    npx tsx tools/dmdcheck.mts
 *
 *  Exits non-zero if any clip is blank or frozen, or if the controls do not
 *  behave. Runs headless with no canvas — Dmd keeps drawing and blitting
 *  separate, so the dot buffer is reachable under Node.
 */
import { controls, formatClips, inspectAll } from '../src/dev/dmdcheck';

const c = controls();
console.log(
  `controls: an empty panel reads ${c.emptyPanelDots} dots; ` +
    `a clip that draws nothing is ${c.blankClipCaught ? 'caught' : 'NOT CAUGHT'}`,
);
if (c.emptyPanelDots !== 0 || !c.blankClipCaught) {
  console.log('CONTROL FAILED — the rest of this run means nothing.');
  process.exitCode = 1;
}

console.log('\nclips (12 frames sampled across each duration):');
const rs = inspectAll();
console.log(formatClips(rs));

const bad = rs.filter((r) => r.blank || r.frozen);
console.log(`\n${rs.length - bad.length}/${rs.length} clips draw and move`);
if (bad.length) process.exitCode = 1;
