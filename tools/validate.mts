/** Node entry: validate a layout and print its diagnostics. */
import { DEFAULT_LAYOUT } from '../src/layout/default';
import { resolveLayout } from '../src/layout/resolve';
import { formatDiagnostics, validateLayout } from '../src/layout/validate';
import { validateRules } from '../src/layout/feasible';
const ds = [
  ...validateLayout(resolveLayout(DEFAULT_LAYOUT)),
  ...validateRules(DEFAULT_LAYOUT),
];
console.log(formatDiagnostics(ds));
if (ds.some((x) => x.severity === 'error')) process.exitCode = 1;
