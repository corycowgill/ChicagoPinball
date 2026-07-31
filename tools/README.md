# Tools

## The layout builder

The board is data (`src/layout/default.ts`), and there is a drag-and-drop
editor for it in the game itself: the **BUILD LAYOUT** button top-right, or
`?edit` in the URL.

- drag anything; handles resize circles, bend polylines and aim rails
- the palette adds posts, rails, bumpers, targets, scoops, spinners, sensors
- the rules from `src/layout/validate.ts` run on every edit and list what they
  find; clicking a diagnostic selects the offender
- **Play this board** saves to `localStorage` and reloads into the game
- **Export JSON** / **Coordinates** get the board back out
- `?stock` plays the shipped board without clearing what you saved

The editor draws the *real* bodies — it builds the world through
`buildPlayfield` on every change — so what you see is what the ball collides
with, not a sketch of it.

---

Two families of checks, and the difference matters.

**Deterministic checks** (`verify.sh`, `layoutdiff`, `validate`, `rulecheck`,
`ejectaudit`) run headless under Node with no browser and no randomness. Run
them the same way twice and you get the same bytes. They answer questions
about the board with certainty.

**Measurement probes** (`shotodds`, `makerate`, `cradle`) drive the real game
in a browser and count what it scores. They answer questions the code alone
cannot — but they carry a real error bar, documented below, that cost this
project three withdrawn conclusions.

---

# Deterministic checks

```
bash tools/verify.sh              # both oracles, print digests
bash tools/verify.sh save NAME    # record a baseline
bash tools/verify.sh check NAME   # diff against it (exit 1 on drift)
```

`verify.sh` runs the two determinism oracles: a bit-exact dump of the
constructed world, and a fixed 3600-step replay digested into a trajectory
hash plus an ordered ScoreEvent stream. Together they detect a one-pixel
change. Save a baseline before touching layout code; check it after.

The rest are bundled with esbuild and run under Node:

```
npx esbuild tools/validate.mts   --bundle --platform=node --format=esm --outfile=/tmp/x.mjs && node /tmp/x.mjs
```

- **`layoutdiff.mts`** — builds the board twice, once through the layout
  loader and once through the old hand-written constructor, and compares every
  body. The proof that turning the playfield into data changed nothing.
- **`validate.mts`** — runs the layout rules (clearances, corridors, flipper
  sweep, sensor arity) and prints diagnostics. Instant; this is what the
  editor calls on every drag.
- **`rulecheck.mts`** — mutates the board once per rule and asserts that rule
  fires. A validator that cannot fail reads as coverage while providing none,
  so the rules are held to the same standard as the oracles.
- **`ejectaudit.mts`** — fires every kicker described by the layout (both
  scoops, both ramp exits, the outlane kickback) as a deterministic fan of
  angle × speed variants, steps the **real engine**, and reports the fraction
  that end in an outlane. This is the only check that catches "making the shot
  loses the ball" — the class of bug the mode scoop shipped with.

---

# Measurement probes

Headless Playwright probes that measure how the machine actually plays. They
drive the real game through `window.__pinball` and read what it scores, so
they answer questions the code alone cannot.

## Prerequisites

Playwright is **not** a dependency of the game — it would drag a browser
download into every `npm install` for something only used to measure the
board. Install it where you run the probes:

```
npm install --no-save playwright
```

Then start the dev server on the port the probes expect (5199) and run one:

```
npm run dev -- --port 5199
node tools/makerate.mjs
```

If you have a Chromium already on disk, point the probes at it by editing
the `executablePath` in each file; they default to `/opt/pw-browsers/chromium`.

## shotodds.mjs — how often can a shot be made? (start here)

Picks one shot, hammers the strike point that suits it T times, and reports
the make fraction with a 95% Wilson interval. Wilson rather than the
textbook normal approximation because several shots sit at or near 0/T,
which is exactly where the normal approximation falls apart.

```
node tools/shotodds.mjs              # every shot, 12 trials each
SHOT=ramp:R T=40 node tools/shotodds.mjs
```

**Prefer this over makerate for judging a change.** A change to a shot gets
judged on that shot's own odds, against an interval that shrinks as T
grows. It also distinguishes the two things a 0 can mean: "dead" (upper
bound under 2%) versus "rare" (wide interval, just never came up).

## makerate.mjs — which strike points make which shots?

Useful as a **map** — it shows where along the bat each shot lives — but do
not compare its totals between runs. See the error bar below.

For each flipper it sweeps the strike point along the bat (which is how a
player varies the angle: flip earlier or later as the ball rolls down) and
counts how many strike points **score** each major shot.

`R=4 node tools/makerate.mjs` repeats the whole sweep and reports mean, sd
and range.

**Do not compare "total makes" between runs.** Measured on identical,
unchanged geometry:

```
unguarded:  21, 17, 14, then 10, 15, 23, 10   -> mean 14.5, sd 5.3
guarded:    16, 9, ...                        -> no better
```

A change would have to move the total by ~11 to clear 2 sd, which is most
of the board. Three conclusions in this project were drawn from single
sweeps and had to be withdrawn: the wider flipper sweep "rejection"
(21 -> 18), a captive-fix "regression" (21 -> 14), and a layout-fix
"improvement" (11 -> 16). All three sat inside the noise.

Adding a free-ball guard — so a trial cannot silently void when the ball is
held in a scoop — did **not** shrink the spread. The variance is intrinsic
to the statistic: summing 50 chaotic one-shot trials inherits every trial's
noise at once and throws away which shot moved. The trials are correlated
too; sd 5.3 is well above the ~3.2 independent Bernoulli trials would give.
That is why shotodds.mjs exists.

The one thing makerate does support: a shot reading 0 across *many* runs is
genuinely dead. The captive has read 0 in every run of every measurement.

## cradle.mjs — can you trap a ball and shoot it?

Checks the three things flipper control depends on:

1. a ball landing on a **held** bat settles into the crook and stays there
   (a cradle you can aim from),
2. a ball on a **resting** bat stays within flipper reach — note it may
   simply sit there, which is an ordinary pinball state and not a defect,
3. a flip out of the cradle reaches the top of the playfield.

## Caveats that cost real time here

- **Don't edit `src/` while a probe runs.** Vite hot-reloads the page and
  destroys the probe's execution context mid-sweep.
- **`Matter.Body.setVelocity` takes px per *substep***, not per frame. With
  `PHYSICS_SUBSTEPS = 3` a "speed 20" is 60 px/frame and the ball rockets off
  the board. Read via `Matter.Body.getVelocity`, which is normalized.
- **The bat normal must point up (−y).** `(-sin a, cos a)` does that for the
  left bat but points *down* for the right one (rest angle π−0.46), which
  drops the ball under the flipper line and straight out — a whole
  right-flipper data set was garbage before this was spotted.
- **Closest-approach is not makeability.** Tracking a ball for a second after
  the shot picks up post-shot rattle, so a shot can read "7 px away" and
  never once be made. Count what scores.
