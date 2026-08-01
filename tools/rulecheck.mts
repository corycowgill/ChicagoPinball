/** Node entry: prove every layout rule can actually fail. */
import { baselineClean, runRuleChecks, runSilentChecks } from '../src/dev/rulecheck';

const base = baselineClean();
console.log(
  base.length === 0
    ? 'control: shipped board is clean'
    : `control: FAILED — shipped board reports [${base.join(', ')}]`,
);

const results = runRuleChecks();
for (const r of results) {
  console.log(
    `  ${r.fired ? 'fires' : 'SILENT'}  [${r.rule}] ${r.what}\n           tripped: ${r.got.join(', ') || '(nothing)'}`,
  );
}
const bad = results.filter((r) => !r.fired).length;
console.log(`\n${results.length - bad}/${results.length} rules fired on their mutation`);

// And the other half of the question: a rule that fires on everything passes
// every case above and is worthless.
console.log('\nmust stay SILENT:');
const silent = runSilentChecks();
for (const r of silent) {
  console.log(
    `  ${r.fired ? 'FIRED ' : 'quiet'}  [${r.rule}] ${r.what}` +
      (r.fired ? `\n           tripped: ${r.got.join(', ')}` : ''),
  );
}
const noisy = silent.filter((r) => r.fired).length;
console.log(`${silent.length - noisy}/${silent.length} stayed silent`);
if (bad || noisy || base.length) process.exitCode = 1;
