# Tools

## The layout builder

The board is data (`src/layout/default.ts`), and there is a drag-and-drop
editor for it in the game itself. The title screen is a menu — **flippers
move, start selects**, or tap a row:

```
  PLAY            start a game
  BOARD  <name>   start cycles to the next saved board
  BUILD LAYOUT    open the editor
```

The `BOARD` row appears once you have saved something to choose between. There
is also a **BUILD LAYOUT** button in the page's top-right corner, which is the
only way in without abandoning a game in progress, and `?edit` in the URL.

- drag anything; handles resize circles, bend polylines and aim rails
- the palette has **all nineteen** kinds a board is made of — posts, rails,
  bumpers, targets, rollovers, scoops, spinners, sensors, ramps, slingshots,
  the captive, the Bean, the drop bank, both flippers, the plunger, the ball
  spawn and the drain
- **anything can be deleted.** Ten kinds used to be refused, because
  `PlayfieldParts` has no optional fields and deleting one produced a
  TypeError instead of a board without that feature. `standIns()` in
  `src/layout/build.ts` fixed the cause: a missing part is built off-table
  with no bodies in the world, so absence is absence. Deleting now tells you
  what it cost you and lets you do it — which is what "warn me, but let me
  build anyway" meant
- two rule sets run on every edit and list what they find; clicking a
  diagnostic selects the offender:
  - `src/layout/validate.ts` — geometry: clearances, corridors, flipper sweep,
    sensor arity, ramp joins
  - `src/layout/feasible.ts` — reachability: whether the board still supports
    the rules the game ships. The rules engine is keyed by collision label, so
    deleting the left ramp throws nothing and looks like nothing — BASEBALL
    simply never starts.
- **Play this board** saves to the draft slot and reloads into the game
- **Save as…** names a board so the title screen can offer it; **Boards…**
  lists what you have saved, to load or delete
- **Export JSON** / **Coordinates** get the board back out
- **Duplicate** (Ctrl+D) and **Mirror** (M) copy the selection; mirroring
  reflects it to the other side of the play centre and flips everything
  directional with it — kick angles, exit velocities, slingshot normals, and
  sided identity (`left-loop` becomes `right-loop`, a left flipper becomes a
  right one)
- **TEST**: **Drop a ball** (T) anywhere, or **Full plunge** (R) from the
  shooter lane, and watch the real engine play it out — real bumpers, real
  ramps, real scoops — with a trail and a live list of what it scored. Any
  edit ends the run, because the world it was rolling in is about to be
  rebuilt.

Choosing a board other than the one already built reloads onto it
(`Renderer3D` bakes its table once, so a swap needs a fresh page). The choice
is explicit and stored separately from the boards themselves — saving in the
builder does not change what the game plays. `?stock` forces the shipped board
without touching either.

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
  so the rules are held to the same standard as the oracles. It also runs a
  set of mutations that must produce **silence**, because a rule that fires on
  everything passes every positive case and is still worthless — specifically,
  the one-way orbit gates must never be reported as blocking the lanes they
  exist to serve.

  Worth knowing what it did *not* catch: rulecheck was 13/13 green the whole
  time the clearance rules were blind to rails, slingshots, deco posts,
  standups and drop targets. Every case happened to mutate a body class the
  rules could already see. One mutation per rule proves the rule can speak; it
  says nothing about what the rule is looking at.
- **`mirrorcheck.mts`** — proves the editor's mirror is exact, by reflecting
  the whole shipped board and checking three independent things: every body
  lands on its twin's reflection, every eject comes out mirrored, and the
  reflected board passes every rule with the same measured clearances. Note
  what does *not* work here: mirroring twice and comparing. A field the mirror
  forgets is unchanged by both flips, so the round trip passes precisely when
  the bug is present.
- **`orbitreturn.mts`** — releases balls down each orbit lane and asks where
  they cross the flipper line: within a bat's reach, or past it. Also asks
  whether the outlanes can still be REACHED, which is the other half of the
  question — an outlane nothing can enter is a dead kickback, a dead EL
  EXPRESS and a board with no risk on the sides. Prints the shipped board
  against a variant with the return gates removed, so both numbers sit side by
  side.
- **`shotreach.mts`** — which shots can this board make, and from where on the
  bat? Cradles a ball on the real bat at 12 strike points x 4 settle times x 2
  bats, swings the real flipper, steps the real world, and counts what scores.
  Deterministic, so unlike `shotodds.mjs` (sd 4.3–5.3 on unchanged geometry)
  it can resolve a single shot's change; unlike `validate.mts` it measures the
  shot rather than a straight line drawn where the shot might go.

  **`CHECK=1` is the regression gate — run it after any geometry change.**
  It compares every row against `BASELINE` in `src/dev/shotreach.ts` and exits
  non-zero if a shot went backwards. Nothing else catches this: the clearance
  rules in `validate.mts` measure a straight line's gap, which is a different
  quantity, and re-aiming the soccer goal once moved the mode scoop's make
  rate 1 → 6 while its shot-line clearance went −9 → −10. A board can pass
  every rule in the validator with a dead shot on it.

  The gate carries its own negative control and runs it every time: it deletes
  the left ramp and confirms the gate fires. A guard that cannot fail reads as
  coverage while providing none.

  The baseline belongs to **one harness version**. Change `FRACS`, `DWELLS`,
  `HOLD_STEPS` or `MAX_STEPS` and every number moves, because they define what
  a cell is — re-seed deliberately, never by pasting what the tool last
  printed.

  `CONTROLS=1` deletes each target in turn and checks its row falls to zero —
  ten of twelve rows are controllable and all ten fall.

  Read the count as **the size of the window**, not a probability: how much of
  the (strike point x settle) space produces the shot. Sweeping settle time
  rather than picking one is deliberate — dwell 0 is the only setting that
  finds the mode scoop and dwell 3 the only one that finds the right orbit, so
  any single choice reports itself as a fact about the board.

  Three harness bugs it had first, all of which produced confident numbers:
  exact-matching target keys (a drop target reports as `drop-target:C`, so two
  rows read 0 while the board was hitting them constantly); holding the bat up
  for the whole trial instead of tapping it; and sampling fracs past 0.88,
  where the ball is off the end of the bat and launch speed falls from 20.1 to
  9.3 with the angle going negative.

- **`dmdcheck.mts`** — do the DMD clips draw, and do they move? Steps every
  clip in `src/DmdClips.ts` across its duration and counts lit dots per frame.
  Runs headless with no canvas at all: `Dmd` keeps drawing and blitting
  separate, so the dot buffer is reachable under Node and the answer is an
  integer rather than a judgement about a picture.

  It catches the two failure modes a screenshot misses. A **blank** clip looks
  identical to no clip — the panel just shows whatever the text pass put
  there. A **frozen** clip looks deliberate. Counting dots is not enough for
  the second one, because a puck sliding across lights the same number of dots
  every frame, so the frozen test hashes the buffer instead.

  Controls run every time: an empty panel must read 0 dots, and a clip that
  draws nothing must be reported. It has already earned this — it caught
  `Dmd.dot()` silently dropping fractional coordinates (`buf[3.5]` on a typed
  array is a no-op), which showed up as two frames of the jackpot burst
  reading zero while the frames either side read 98.

- **`partscheck.mts`** — can every part of the board actually be added and
  removed? For each kind on the shipped board: delete all of it, build the
  real world, step it 240 frames. For each palette entry: add one, build,
  step. Stepping matters as much as building — a stand-in that constructs
  happily and divides by zero in `tick()` would pass a build-only check.

  It carries a control that must FAIL: a six-target CHICAGO bank, which
  `ChicagoBank` rejects by name. Every row passing proves nothing if the
  harness is swallowing exceptions.

  The table also prints what the two rule sets report for each mutilated
  board, which is the other half of the question. Deleting the drain is
  allowed and says `sensor-arity`; deleting a flipper says `machine-missing`;
  deleting the Bean says `feature-unreachable`. A silent cell means the
  editor would tell you nothing.

- **`captivereach.mts`** — asks whether the captive ball can be HIT, in two
  bands that answer two different questions. The *aperture* band releases
  balls just below the mouth on a board with the mode scoop moved aside, so
  the only thing in the way is the captive's own posts and lane walls; the
  *flip* band cradles a ball on a real bat at eight strike points and swings
  it. Prints a positive control — the same board with the stop posts deleted —
  because a probe that reads zero on every input has measured nothing, which
  is how every other instrument here started out.

  It cost four corrections to its own harness, each of which produced a
  confident wrong number first: releasing the ball inside the flipper bat (the
  solver ate the velocity and it read "90% short" with a median closest
  approach exactly equal to the starting distance); releasing it inside a
  slingshot (which then kicked it at its own angle); an aperture band released
  inside the mode scoop's capture circle, which reaches to within 26px of the
  mouth so no clear band under it exists at all; and a stuck-detector checked
  at four steps, by which time a legitimately fast trial has already bounced
  off a post. The `stuck` and `blocked` fates exist so those failures show up
  as harness faults rather than board faults.

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

## kickback.mjs — does the outlane save actually save?

It reports two numbers, and mixing them up cost a wrong conclusion once.
**"Left the outlane and stayed out"** is the kicker's own job. **"Still in
play after the window"** is nearly always 0 with nobody at the flippers, so it
cannot be the pass criterion alone — using only it scored a kicker that
repeatedly re-fired a ball *inside* the outlane higher than one that punched
it out to the flipper first time.


The eject audit says where one eject *goes*. This says whether the *feature*
works: it fires the kickback for real, lets the real game loop handle whatever
comes back, and asks whether the ball was still in play afterwards.

One arm per run, because the renderer does not reliably survive two:

```
MODE=oneshot node tools/kickback.mjs     # award spent on the first fire
MODE=retry   node tools/kickback.mjs     # award held until the save sticks
T=20 MODE=retry node tools/kickback.mjs
```

The result that motivated the retry logic, same window both arms:

```
oneshot  saved  0/10   (0%)
retry    saved  9/10  (90%)   attempts used: 2,2,2,2,2,2,2,2,0,2
```

Four harness traps live in this file, all of which produced confidently wrong
numbers — or none at all — before they were found. They are worth reading
before writing any probe against this game:

1. **A drain is detected by the game STATE, not the ball's position.** The ball
   is respawned on the plunger, high on the board, so a snapshot at the end of
   a trial cannot tell a save from a drain-and-respawn. The first version of
   this probe reported a flawless 16/16 for *both* arms on that basis.
2. **Never teleport a ball by writing `body.position`.** That leaves Matter's
   bounds and vertices stale, so the sensor never fires and every trial
   silently records zero kickbacks.
3. **Never wait for `networkidle`.** Vite's HMR websocket never lets the page
   go idle, so `goto` blocks until its timeout.
4. **Time trials in GAME time, not wall clock.** Under software GL this page
   advances about 580 ms of game time per 3.8 s of wall clock — a 6.5x
   slowdown, caused by the three.js scene and *not* fixed by shrinking the
   viewport. A wall-clock window measures a different amount of pinball on
   every machine. Poll `game.timeMs`, which advances one fixed step per update.

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
