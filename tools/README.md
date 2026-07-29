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
