/** Node entry: prove every layout rule can actually fail. */
import { baselineClean, runRuleChecks } from '../src/dev/rulecheck';

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
if (bad || base.length) process.exitCode = 1;
