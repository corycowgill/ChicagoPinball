# Verification oracles

These exist to make the layout-as-data refactor provable rather than plausible.

The physics path is **fully deterministic** — no `Math.random`, no clock, no DOM
in `src/entities/*`, `src/scene/Playfield.ts` or `src/Physics.ts` — so
`new Playfield(...)` is a pure function of the source and can be constructed
headless under Node. Both oracles exploit that.

## Why not the Playwright probes

The gameplay probes (`makerate` and friends) were measured at **sd 4.3–5.3 total
makes on completely unchanged geometry** (runs of 21, 17, 14, then 16, 9, 8, 18).
Detecting a one-shot regression that way needs on the order of a thousand trials
per shot. They are useful for *designing* a board and useless for *proving a
refactor changed nothing*. Gate on the oracles here; treat the probes as
informational.

## snapshot.ts — the world dump

Walks every body in insertion order (which matters: Matter's broadphase pair
order, and therefore its float results, depend on it) and dumps position, angle,
vertices, mass, inertia, restitution, friction, collision filters and radius,
plus every constraint and the whole derived public surface (`launchRestY`, both
ramp `fullPath`s, slingshot `bandA/bandB/normal`, `postPositions`, resolved
paths…).

JS prints the shortest round-tripping decimal for a double, so equal doubles
serialise to equal strings — comparing the text compares the doubles exactly.

## replay.ts — the wiring digest

The snapshot proves the constructed world is identical; it cannot prove the
collision wiring is, because wiring only expresses itself once bodies move.
`replay.ts` runs a fixed input script at a fixed `dt` for a fixed number of
steps and digests the ball trajectory plus the ordered stream of ScoreEvents.

## Running

```
npx esbuild src/dev/run-snapshot.ts --bundle --platform=node --format=esm --outfile=/tmp/snap.mjs
node /tmp/snap.mjs > before.json
# ...make a change...
node /tmp/snap.mjs > after.json
cmp before.json after.json
```

Same for `run-replay.ts`.

## Measured on this board

- Construction: **3/3 byte-identical** (70 bodies, 5 constraints, 27 walls).
- Replay: **5/5 byte-identical** trajectory and event digests over 3600 steps.
- Sensitivity check: moving one pop bumper by **1 px** changed the trajectory
  digest, changed the event digest, and dropped a scoring event (12 → 11). An
  oracle that cannot fail is worthless, so this check should be re-run whenever
  the harness changes.
