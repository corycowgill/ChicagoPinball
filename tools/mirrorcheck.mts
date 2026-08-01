/** Does mirroring actually mirror?
 *
 *  A mirror that misses a field produces a board that LOOKS right and PLAYS
 *  wrong — a scoop that kicks the wrong way, a slingshot whose normal points
 *  into the wall, a sensor still claiming to be the left orbit. That is the
 *  worst failure mode this feature has, and it is invisible.
 *
 *  Note what does NOT work as a test: mirroring twice and comparing. A field
 *  the mirror forgets is unchanged by the first flip and unchanged by the
 *  second, so it round-trips perfectly. The involution passes precisely when
 *  the bug is present. It had to be thrown away and replaced with checks that
 *  compare against something independent of the mirror itself.
 *
 *  Three that do work, all deterministic:
 *
 *  1. **Geometry.** Build both boards and compare body for body: every body in
 *     the mirrored world must sit at the reflection of its twin, with
 *     reflected vertices. This is end-to-end through the real loader, so it
 *     catches any positional field the mirror forgets — including ones nested
 *     inside an entity the schema never names.
 *
 *  2. **Behaviour.** Every eject the layout describes (both scoops, both ramp
 *     exits, the outlane kicker) must come out reflected: position mirrored,
 *     velocity mirrored in x. This is the half geometry cannot see, and it
 *     reuses the eject audit's own source list rather than a second copy of
 *     the rules for reading kick angles.
 *
 *  3. **Rules.** A reflected board is still a legal board: every sensor role
 *     appears exactly once, both flippers exist, and every shot line clears by
 *     the same measured distance as before. Zero diagnostics, not "fewer".
 */
import { Physics } from '../src/Physics';
import { buildPlayfield } from '../src/layout/build';
import { DEFAULT_LAYOUT } from '../src/layout/default';
import { resolveLayout } from '../src/layout/resolve';
import { validateLayout } from '../src/layout/validate';
import { validateRules } from '../src/layout/feasible';
import { mirrorAxis, mirrorLayout, SHOOTER_LANE_KINDS } from '../src/layout/transform';
import { ejectSources } from '../src/dev/ejectaudit';
import { PlayfieldLayout } from '../src/layout/types';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const axis = mirrorAxis(DEFAULT_LAYOUT);
/** The shooter lane's authored furniture. Its coordinates say nothing about
 *  belonging to the lane, so it has to be named — see mirrorLayout. */
const LANE_IDS = ['shooter-inner', 'launch-exit'];
const mirrored: PlayfieldLayout = clone(DEFAULT_LAYOUT);
mirrorLayout(mirrored, LANE_IDS);

const fail: string[] = [];
/** Positions round-trip through trig, so compare to a tolerance well under a
 *  pixel rather than to the bit. */
const EPS = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

// ── 1. Geometry ─────────────────────────────────────────────────────────────
function bodiesOf(l: PlayfieldLayout) {
  const physics = new Physics();
  const owner = new Map<number, string>();
  buildPlayfield(physics, resolveLayout(l), (id, bodies) => {
    for (const b of bodies) owner.set(b.id, id);
  });
  return { bodies: physics.world.bodies, owner };
}
const stock = bodiesOf(DEFAULT_LAYOUT);
const stockBodies = stock.bodies;
// ONE build, kept whole. Building twice and pairing the bodies of one with the
// owner map of the other silently matched nothing — Matter body ids are per
// build, so every lookup missed and every item "failed".
let mirrorBuild: ReturnType<typeof bodiesOf> | null = null;
try {
  mirrorBuild = bodiesOf(mirrored);
} catch (e) {
  fail.push(`mirrored board will not build: ${e instanceof Error ? e.message : String(e)}`);
}
const mirroredBodies = mirrorBuild?.bodies ?? [];

/** Descriptors the lane owns, and which therefore should NOT have moved. */
const isLaneId = (id: string) => {
  if (LANE_IDS.includes(id)) return true;
  const d = [...DEFAULT_LAYOUT.statics, ...DEFAULT_LAYOUT.elements].find((x) => x.id === id);
  return d ? SHOOTER_LANE_KINDS.has(d.kind) : false;
};

if (mirroredBodies.length !== stockBodies.length) {
  fail.push(`body count ${mirroredBodies.length} != ${stockBodies.length}`);
} else {
  // Grouped by descriptor and compared as a SET, not index by index. An
  // entity that builds a symmetric pair — the captive lane's two side walls,
  // its two stop posts — emits them in a fixed order, so reflecting the item
  // swaps which one is "left". Position 3 of the mirrored captive is the
  // reflection of position 4 of the original, and pairing by index reports a
  // 46px error that is really just the pair having traded places.
  const mirroredOwner = mirrorBuild!.owner;
  const group = (bodies: typeof stockBodies, owner: Map<number, string>, flip: boolean) => {
    const m = new Map<string, string[]>();
    for (const b of bodies) {
      const id = owner.get(b.id);
      if (!id) continue;
      const x = flip ? 2 * axis - b.position.x : b.position.x;
      const key = `${x.toFixed(6)},${b.position.y.toFixed(6)}`;
      m.set(id, [...(m.get(id) ?? []), key]);
    }
    for (const [k, v] of m) m.set(k, v.sort());
    return m;
  };
  const A = group(stockBodies, stock.owner, true);
  const B = group(mirroredBodies, mirroredOwner, false);
  let checked = 0;
  let skipped = 0;
  for (const [id, want] of A) {
    if (isLaneId(id)) {
      skipped++;
      continue;
    }
    const got = B.get(id);
    checked++;
    if (!got || got.length !== want.length || got.some((v, i) => v !== want[i])) {
      fail.push(`${id}: bodies are not the reflection of the original\n      want ${want.join(' ')}\n      got  ${(got ?? []).join(' ')}`);
    }
  }
  console.log(
    `1. geometry : ${checked} items reflected body-for-body (${skipped} shooter-lane items exempt)`,
  );
}

// ── 2. Behaviour ────────────────────────────────────────────────────────────
const a = ejectSources(DEFAULT_LAYOUT);
const b = ejectSources(mirrored);
console.log(`2. ejects   : ${a.length} described`);
for (let i = 0; i < a.length; i++) {
  const s = a[i];
  const m = b[i];
  if (!m || m.id !== s.id) {
    fail.push(`eject list changed shape at ${i}`);
    continue;
  }
  const okPos = near(2 * axis - s.pos.x, m.pos.x) && near(s.pos.y, m.pos.y);
  const okVel = near(-s.vel.x, m.vel.x) && near(s.vel.y, m.vel.y);
  const mark = okPos && okVel ? 'ok  ' : 'FAIL';
  console.log(
    `   ${mark} ${s.id.padEnd(13)} (${s.pos.x.toFixed(0)},${s.pos.y.toFixed(0)}) v(${s.vel.x.toFixed(2)},${s.vel.y.toFixed(2)})` +
      `  ->  (${m.pos.x.toFixed(0)},${m.pos.y.toFixed(0)}) v(${m.vel.x.toFixed(2)},${m.vel.y.toFixed(2)})`,
  );
  if (!okPos) fail.push(`${s.id}: eject position not reflected`);
  if (!okVel) fail.push(`${s.id}: eject velocity not reflected`);
}

// ── 3. Rules ────────────────────────────────────────────────────────────────
const diags = [...validateLayout(resolveLayout(mirrored)), ...validateRules(mirrored)];
console.log(
  diags.length
    ? `3. rules    : ${diags.length} diagnostic(s):\n${diags.map((d) => `     [${d.rule}] ${d.message}`).join('\n')}`
    : '3. rules    : the reflected board is clean, same clearances as the original',
);
if (diags.length) fail.push(`${diags.length} diagnostic(s) on the reflected board`);

// Sided identity has to swap, not merely move.
const sidedOf = (l: PlayfieldLayout, id: string) => {
  const d = [...l.statics, ...l.elements].find((x) => x.id === id) as Record<string, unknown>;
  return d ? String(d.role ?? d.side ?? d.label ?? '') : '(missing)';
};
console.log('4. identity :');
for (const id of ['left-loop', 'left-outlane', 'flipper-left', 'ramp-left', 'inlane-left']) {
  const from = sidedOf(DEFAULT_LAYOUT, id);
  const to = sidedOf(mirrored, id);
  console.log(`   ${from === to ? 'FAIL' : 'ok  '} ${id.padEnd(13)} ${from} -> ${to}`);
  if (from === to) fail.push(`${id} kept its sided name`);
}

console.log(fail.length ? `\nFAIL\n  ${fail.join('\n  ')}` : '\nPASS');
if (fail.length) process.exitCode = 1;
