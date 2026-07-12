import { Game } from './Game';
import { Renderer3D } from './Renderer3D';

const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const uiCanvas = document.getElementById('ui') as HTMLCanvasElement;
if (!glCanvas || !uiCanvas) throw new Error('stage canvases not found');

const renderer = new Renderer3D(glCanvas, uiCanvas);
// Input lands on the top (overlay) canvas.
const game = new Game(renderer, uiCanvas);
// Test hook: expose the game for headless probes.
(window as unknown as { __pinball?: unknown }).__pinball = game;

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
