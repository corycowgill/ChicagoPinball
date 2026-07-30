/** Scripted replay digest — the second oracle.
 *
 *  The world snapshot proves the CONSTRUCTED world is identical. It cannot
 *  prove the collision wiring is identical, because wiring only expresses
 *  itself once bodies move. This runs a fixed input script through a fixed
 *  number of fixed-size steps and digests (a) the ball trajectory and (b) the
 *  ordered stream of ScoreEvents.
 *
 *  Everything here must stay deterministic: fixed dt, no wall clock, no RNG.
 */
import Matter from 'matter-js';
import { Physics } from '../Physics';
import { Playfield, PlayfieldEvents } from '../scene/Playfield';
import { ScoreEvent } from '../types';

/** FNV-1a over a string — stable, dependency-free, and good enough to make
 *  any trajectory divergence obvious. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface ReplayResult {
  digest: string;
  events: string[];
  eventDigest: string;
  steps: number;
  finalBalls: Array<{ x: number; y: number }>;
}

/** One deterministic run. `steps` at a fixed 1000/60 ms. */
export function replay(steps = 3600): ReplayResult {
  const events: string[] = [];
  const physics = new Physics();

  const ev: PlayfieldEvents = {
    onScore: (e: ScoreEvent) =>
      events.push(`${step}|score|${e.kind}|${e.points}|${e.letter ?? ''}`),
    onDrain: () => events.push(`${step}|drain`),
    onLockComplete: () => events.push(`${step}|lock`),
    onScoopMode: () => events.push(`${step}|scoopMode`),
    onLanesComplete: () => events.push(`${step}|lanes`),
    onLeftOutlane: () => events.push(`${step}|leftOutlane`),
    onRightOutlane: () => events.push(`${step}|rightOutlane`),
  };

  const pf = new Playfield(physics, ev);
  let step = 0;
  const DT = 1000 / 60;

  // Fixed input script: [step, action]. Chosen to exercise the plunger, both
  // flippers and a spread of the board without depending on any timing that
  // could drift.
  const script: Array<[number, () => void]> = [
    [30, () => pf.applyPlungerLaunch(0.95)],
    [200, () => pf.leftFlipper.setActive(true)],
    [206, () => pf.leftFlipper.setActive(false)],
    [420, () => pf.rightFlipper.setActive(true)],
    [426, () => pf.rightFlipper.setActive(false)],
    [700, () => pf.leftFlipper.setActive(true)],
    [709, () => pf.leftFlipper.setActive(false)],
    [1100, () => pf.rightFlipper.setActive(true)],
    [1108, () => pf.rightFlipper.setActive(false)],
    [1600, () => pf.leftFlipper.setActive(true)],
    [1607, () => pf.leftFlipper.setActive(false)],
    [2200, () => pf.rightFlipper.setActive(true)],
    [2210, () => pf.rightFlipper.setActive(false)],
    [2900, () => pf.leftFlipper.setActive(true)],
    [2906, () => pf.leftFlipper.setActive(false)],
  ];
  let next = 0;

  const trail: string[] = [];
  for (step = 0; step < steps; step++) {
    while (next < script.length && script[next][0] === step) {
      script[next][1]();
      next++;
    }
    pf.tick(DT);
    physics.step(DT);
    // Sample every 10 steps to keep the digest input bounded but dense
    // enough that divergence shows up within a few frames of occurring.
    if (step % 10 === 0) {
      for (const b of pf.balls) {
        const p = b.body.position;
        trail.push(`${step}:${p.x.toFixed(6)},${p.y.toFixed(6)}`);
      }
    }
  }

  const finalBalls = pf.balls.map((b) => ({ x: b.body.position.x, y: b.body.position.y }));
  void Matter;
  return {
    digest: fnv1a(trail.join(';')),
    events,
    eventDigest: fnv1a(events.join(';')),
    steps,
    finalBalls,
  };
}
