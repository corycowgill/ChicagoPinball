import { Game } from './Game';
import { PLAYFIELD_W, PLAYFIELD_H } from './constants';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
if (!canvas) throw new Error('canvas #stage not found');

// Hi-DPI scaling for crisp rendering on retina displays.
const ctx = canvas.getContext('2d', { alpha: false })!;
const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
canvas.width = PLAYFIELD_W * dpr;
canvas.height = PLAYFIELD_H * dpr;
ctx.scale(dpr, dpr);

const game = new Game(ctx);

// Fixed-timestep loop with accumulator.
const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 100; // cap to avoid spiral-of-death after tab pause
let last = performance.now();
let acc = 0;

function frame(now: number) {
  let elapsed = now - last;
  last = now;
  if (elapsed > MAX_FRAME_MS) elapsed = MAX_FRAME_MS;
  acc += elapsed;
  // Cap iterations per frame so a long pause doesn't run 100 steps.
  let safety = 5;
  while (acc >= STEP_MS && safety-- > 0) {
    game.update(STEP_MS);
    acc -= STEP_MS;
  }
  game.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
