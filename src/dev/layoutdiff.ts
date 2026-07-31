/** Prove the layout loader reproduces the hand-written constructor exactly.
 *
 *  Builds TWO independent worlds — one from `Playfield`'s own construction,
 *  one from `DEFAULT_LAYOUT` through `buildPlayfield` — and compares the
 *  bodies Matter ends up with, in insertion order.
 *
 *  Reporting the FIRST mismatch with both values makes the diff mechanical:
 *  it names the entry in `default.ts` that is wrong, rather than leaving you
 *  to guess from a changed digest.
 */
import Matter from 'matter-js';
import { Physics } from '../Physics';
import { Playfield } from '../scene/Playfield';
import { buildPlayfield } from '../layout/build';
import { resolveLayout } from '../layout/resolve';
import { DEFAULT_LAYOUT } from '../layout/default';
import { noopEvents } from './snapshot';

const r6 = (n: number) => Number(n.toFixed(6));

/** The physically meaningful properties of one body, in a stable shape. */
function sig(b: Matter.Body) {
  return {
    label: b.label,
    isStatic: b.isStatic,
    isSensor: b.isSensor,
    x: r6(b.position.x),
    y: r6(b.position.y),
    angle: r6(b.angle),
    verts: b.vertices.map((v) => `${r6(v.x)},${r6(v.y)}`).join(' '),
    area: r6(b.area),
    mass: r6(b.mass),
    inertia: r6(b.inertia),
    restitution: b.restitution,
    friction: b.friction,
    frictionAir: b.frictionAir,
    density: r6(b.density),
    circleRadius: (b as unknown as { circleRadius?: number }).circleRadius ?? null,
  };
}

export interface DiffResult {
  ok: boolean;
  legacyCount: number;
  layoutCount: number;
  mismatches: string[];
}

export function diffWorlds(): DiffResult {
  const legacyPhysics = new Physics();
  new Playfield(legacyPhysics, noopEvents());

  const layoutPhysics = new Physics();
  buildPlayfield(layoutPhysics, resolveLayout(DEFAULT_LAYOUT));

  const a = Matter.Composite.allBodies(legacyPhysics.world);
  const b = Matter.Composite.allBodies(layoutPhysics.world);
  const mismatches: string[] = [];

  if (a.length !== b.length) {
    mismatches.push(`body COUNT differs: constructor ${a.length}, layout ${b.length}`);
  }

  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const sa = sig(a[i]) as unknown as Record<string, unknown>;
    const sb = sig(b[i]) as unknown as Record<string, unknown>;
    for (const k of Object.keys(sa)) {
      if (sa[k] !== sb[k]) {
        mismatches.push(
          `body[${i}] (${a[i].label} vs ${b[i].label}) .${k}: ` +
            `constructor=${String(sa[k])} layout=${String(sb[k])}`,
        );
        break; // one line per body keeps the report readable
      }
    }
    if (mismatches.length >= 15) {
      mismatches.push('... (truncated)');
      break;
    }
  }

  // Constraints too — the flipper pivots and the captive tether live here.
  const ca = Matter.Composite.allConstraints(legacyPhysics.world);
  const cb = Matter.Composite.allConstraints(layoutPhysics.world);
  if (ca.length !== cb.length) {
    mismatches.push(`constraint COUNT differs: constructor ${ca.length}, layout ${cb.length}`);
  }

  return {
    ok: mismatches.length === 0,
    legacyCount: a.length,
    layoutCount: b.length,
    mismatches,
  };
}
