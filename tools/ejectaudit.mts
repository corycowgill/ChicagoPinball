/** Node entry: fire every kicker in the layout and report where the ball goes. */
import { auditEjects, ejectDiagnostics, formatEjects } from '../src/dev/ejectaudit';
import { formatDiagnostics } from '../src/layout/validate';

const reports = auditEjects();
console.log('eject fan (15 trials each: 5 angles x 3 speeds)');
console.log(formatEjects(reports));
console.log('');
const ds = ejectDiagnostics(reports);
console.log(formatDiagnostics(ds));
if (ds.some((x) => x.severity === 'error')) process.exitCode = 1;
