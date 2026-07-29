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

## makerate.mjs — is a shot actually makeable?

For each flipper it sweeps the strike point along the bat (which is how a
player varies the angle: flip earlier or later as the ball rolls down) and
counts how many strike points **score** each major shot.

`R=4 node tools/makerate.mjs` repeats the whole sweep and reports mean, sd
and range.

**Read the error bar before concluding anything.** A single sweep is noisy:
three sweeps of identical, unchanged geometry scored 21, 17 and 14 total
makes, and the per-shot zero readings moved around too — `bean` and `lock`
both read 0 on geometry nobody had touched. The noise is real physics, not a
harness bug: the flip lands at a different point in the substep cycle each
time, and a pinball is chaotic, so a fraction of a pixel at the bat is tens
of pixels at the target.

A change only means something if it moves the total by more than about
2 sd. Several conclusions in this project's history were drawn from single
sweeps and had to be withdrawn — see the note on `FLIPPER_ACTIVE_ANGLE`.

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
