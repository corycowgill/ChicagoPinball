/** Node entry: print the deterministic world snapshot. See src/dev/snapshot.ts.
 *  Lives outside src/ so tsconfig (which has no @types/node) still gates the
 *  build; esbuild bundles it without typechecking. */
import { snapshot } from '../src/dev/snapshot';
process.stdout.write(snapshot());
