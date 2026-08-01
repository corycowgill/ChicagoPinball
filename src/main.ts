import { Game } from './Game';
import { Renderer3D } from './Renderer3D';
import { EditorApp } from './editor/EditorApp';
import { tryBuildScene } from './editor/scene';
import { DEFAULT_LAYOUT } from './layout/default';
import { loadBoard, selectedBoardId, setSelectedBoardId, STOCK_ID } from './layout/storage';
import { PlayfieldLayout } from './layout/types';

const stage = document.getElementById('stage') as HTMLDivElement;
const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const uiCanvas = document.getElementById('ui') as HTMLCanvasElement;
if (!stage || !glCanvas || !uiCanvas) throw new Error('stage canvases not found');

/** Which board to play: the one the player picked on the title screen, which
 *  defaults to stock. Saving a board in the builder used to make it the game
 *  silently and permanently, with `?stock` the only way back — a board is now
 *  played because it was chosen.
 *
 *  A stored board is untrusted input — it can be hand-edited, or saved by a
 *  build with a different schema. Rather than let it white-screen the game
 *  with no way back, it is built once here and discarded if it throws. The
 *  player gets the shipped board and a note, not a blank canvas. */
function bootLayout(): PlayfieldLayout {
  if (new URLSearchParams(location.search).has('stock')) return DEFAULT_LAYOUT;
  const id = selectedBoardId();
  if (id === STOCK_ID) return DEFAULT_LAYOUT;
  const stored = loadBoard(id)?.layout;
  if (!stored) {
    // The chosen board was deleted, or storage was cleared under us.
    setSelectedBoardId(STOCK_ID);
    return DEFAULT_LAYOUT;
  }
  const built = tryBuildScene(stored);
  if ('error' in built) {
    console.warn(`saved layout '${id}' could not be built (${built.error}); playing stock`);
    setSelectedBoardId(STOCK_ID);
    return DEFAULT_LAYOUT;
  }
  return stored;
}

/** Reload onto a different board. Same reasoning as the builder's "play this
 *  board": Renderer3D bakes its table once, so swapping the layout in place
 *  would leave the 3D presentation showing the previous board. The choice is
 *  already persisted by the time this runs. */
function swapBoard() {
  const url = new URL(location.href);
  url.searchParams.delete('stock');
  url.searchParams.delete('edit');
  location.replace(url.toString());
}

const renderer = new Renderer3D(glCanvas, uiCanvas);
// Input lands on the top (overlay) canvas.
const game = new Game(renderer, uiCanvas, bootLayout(), swapBoard);
// Test hook: expose the game for headless probes.
(window as unknown as { __pinball?: unknown }).__pinball = game;

// Fixed-timestep loop with accumulator.
const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 100; // cap to avoid spiral-of-death after tab pause
let last = performance.now();
let acc = 0;
let editor: EditorApp | null = null;

function frame(now: number) {
  let elapsed = now - last;
  last = now;
  if (elapsed > MAX_FRAME_MS) elapsed = MAX_FRAME_MS;
  acc += elapsed;
  if (editor) {
    // The game is suspended while the builder is open: no stepping, no
    // rendering, no audio. Nothing to keep in sync when it comes back.
    acc = 0;
    editor.draw();
  } else {
    // Cap iterations per frame so a long pause doesn't run 100 steps.
    let safety = 5;
    while (acc >= STEP_MS && safety-- > 0) {
      game.update(STEP_MS);
      acc -= STEP_MS;
    }
    game.draw();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── The layout builder ─────────────────────────────────────────────────────
//
// Opening the builder hides the table rather than tearing it down: Renderer3D
// bakes a 1080x1920 playfield texture in its constructor and has no teardown
// path, so a second one on the same canvas would fail. Playing an edited board
// therefore saves it and reloads — a page load is the only guaranteed-correct
// way to rebuild both the world and its 3D presentation from new data.

function openEditor() {
  if (editor) return;
  stage.style.display = 'none';
  launch.style.display = 'none';
  // The builder owns the keyboard from here; the two share bindings.
  game.setInputEnabled(false);
  editor = new EditorApp({
    play: (layout) => {
      void layout; // already persisted by the editor before this fires
      // Drop `stock` and `edit` on the way out, or "play this board" would
      // reload straight back into the shipped layout or the builder.
      const url = new URL(location.href);
      url.searchParams.delete('stock');
      url.searchParams.delete('edit');
      location.replace(url.toString());
    },
    close: closeEditor,
  });
  document.body.appendChild(editor.root);
}

function closeEditor() {
  if (!editor) return;
  editor.destroy();
  editor = null;
  stage.style.display = '';
  launch.style.display = '';
  last = performance.now();
  game.setInputEnabled(true);
  // The builder may have saved or deleted boards; the title screen's picker
  // reads a snapshot of the library, so it needs telling.
  game.refreshBoards();
}

const launch = document.createElement('button');
launch.id = 'edit-launch';
launch.textContent = 'BUILD LAYOUT';
launch.title = 'Open the drag-and-drop layout builder';
launch.onclick = openEditor;
document.body.appendChild(launch);

const launchCss = document.createElement('style');
launchCss.textContent = `
#edit-launch { position:fixed; top:10px; right:10px; z-index:50;
  font:600 10px/1 'Helvetica Neue',Arial,sans-serif; letter-spacing:.14em;
  color:#9fe9ff; background:rgba(10,20,32,0.72); border:1px solid rgba(90,190,235,0.45);
  border-radius:5px; padding:7px 10px; cursor:pointer; opacity:.55; }
#edit-launch:hover { opacity:1; background:rgba(16,40,60,0.9); }
`;
document.head.appendChild(launchCss);

// Escape leaves the builder; the editor itself uses Escape to deselect, so
// this only fires when the editor has nothing selected to give up.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && editor && !editor.hasSelection()) closeEditor();
});

if (new URLSearchParams(location.search).has('edit')) openEditor();
