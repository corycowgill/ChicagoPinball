/** Node entry: run the scripted replay and print its digest.
 *  See src/dev/replay.ts. Outside src/ for the same reason as snapshot.mts. */
import { replay } from '../src/dev/replay';
const r = replay(Number(process.env.STEPS || 3600));
process.stdout.write(
  JSON.stringify(
    {
      digest: r.digest,
      eventDigest: r.eventDigest,
      steps: r.steps,
      eventCount: r.events.length,
      finalBalls: r.finalBalls,
      events: r.events,
    },
    null,
    1,
  ),
);
