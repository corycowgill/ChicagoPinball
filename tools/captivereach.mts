/** Node entry: can the captive ball be hit, and does this probe measure it?
 *
 *  Prints three things, in this order and for this reason:
 *
 *    1. SHIPPED — the board as it is. Expected near zero; that is the defect.
 *    2. NO STOP POSTS — the same board with the pinch removed entirely. This
 *       is the POSITIVE CONTROL and it is the whole reason the run is worth
 *       reading. A probe that reports zero on every input has not measured a
 *       dead shot, it has measured nothing, and every instrument in this repo
 *       produced exactly that result before it produced a right one. If this
 *       row does not move, fix the probe before touching the board.
 *    3. SWEEP — post offset x rest height, so the shipped numbers are chosen
 *       by measurement instead of by eye.
 *
 *    npx tsx tools/captivereach.mts
 *    SWEEP=0 npx tsx tools/captivereach.mts     # controls only, much faster
 */
import { CaptiveBall } from '../src/entities/CaptiveBall';
import { aperture, approach, formatReach, withAperture } from '../src/dev/captivereach';

const SWEEP = process.env.SWEEP !== '0';

function bands(label: string) {
  console.log(label);
  console.log(formatReach([aperture(), ...approach()]));
  console.log('');
}

withAperture(CaptiveBall.POST_DX, CaptiveBall.POST_R, CaptiveBall.REST_DY, () =>
  bands(
    `SHIPPED            posts ±${CaptiveBall.POST_DX}/r${CaptiveBall.POST_R}, rest ${CaptiveBall.REST_DY}px above the mouth`,
  ),
);

// Positive control: no pinch at all. The tether, not the posts, is what keeps
// the captive in its lane — the entity has said so in a comment for several
// rounds — so this is a legal board, just an ugly one.
withAperture(0, 0, CaptiveBall.REST_DY, () => bands('NO STOP POSTS      (positive control)'));

if (SWEEP) {
  console.log('SWEEP  aperture band only, MADE% by post offset x rest height\n');
  const REST = [6, 8, 10, 12];
  console.log('          ' + REST.map((r) => `rest ${String(r).padStart(2)}`).join('  '));
  for (const dx of [20, 23, 26]) {
    const cells = REST.map((restDy) => {
      const r = withAperture(dx, dx >= 23 ? 4 : 5, restDy, () => aperture());
      return `${String(Math.round((r.tally.made / r.total) * 100)).padStart(6)}%`.padStart(9);
    });
    console.log(`  ±${String(dx).padStart(2)}/r${dx >= 23 ? 4 : 5}  ${cells.join('')}`);
  }
}
