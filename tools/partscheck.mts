/** Node entry: is every part of the board actually addable and removable?
 *
 *    npx tsx tools/partscheck.mts
 *
 *  Exits non-zero if any removal or addition fails to build and run, or if
 *  the control fails to throw.
 */
import { additions, control, formatParts, removals } from '../src/dev/partscheck';

const ctl = control();
console.log(
  ctl.ok
    ? 'CONTROL FAILED: a six-target CHICAGO bank did not throw, so this harness\n' +
        '                is not detecting failures and every row below is worthless.'
    : `control: a six-target bank throws as it should — "${ctl.error}"`,
);
console.log('');

console.log('REMOVE every instance of each kind on the shipped board:');
const rm = removals();
console.log(formatParts(rm));

console.log('\nADD one of everything the palette offers:');
const add = additions();
console.log(formatParts(add));

const bad = [...rm, ...add].filter((r) => !r.ok);
console.log(
  `\n${rm.length + add.length - bad.length}/${rm.length + add.length} build and run` +
    (bad.length ? `\nFAILED: ${bad.map((b) => b.what).join(', ')}` : ''),
);
if (bad.length || ctl.ok) process.exitCode = 1;
