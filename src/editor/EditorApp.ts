/** The layout builder.
 *
 *  Drag things, drop things, delete things — on the real board, with the real
 *  bodies, checked against the real rules as you go.
 *
 *  Three decisions shape everything here:
 *
 *  1. **The editor owns a draft, the game owns nothing.** Every edit mutates a
 *     private deep copy and rebuilds a throwaway world. Nothing is shared with
 *     a running game, so there is no state to keep in sync and no way for a
 *     half-finished drag to reach the physics the player is touching.
 *
 *  2. **Rebuild on every change, not on commit.** Constructing the whole world
 *     costs a couple of milliseconds, which buys exact feedback: drop a post
 *     and the shot-line clearance updates in the same frame. An incremental
 *     model of the geometry would be a second implementation of the loader,
 *     and it would be the one that is wrong.
 *
 *  3. **Warnings, not walls.** The brief was explicit: warn me, let me build
 *     anyway. Nothing here refuses an edit for being bad pinball. The only
 *     refusals are deletions the LOADER cannot survive — those throw rather
 *     than play badly, and would take the editor down with them.
 */
import { PLAYFIELD_H, PLAYFIELD_W } from '../constants';
import { DEFAULT_LAYOUT } from '../layout/default';
import { findDesc, Handle, moveHandle, snap } from '../layout/handles';
import { PALETTE, requiredReason, uniqueId } from '../layout/palette';
import { cloneLayout, loadFromStorage, saveToStorage, serialize, parseLayoutFile } from '../layout/storage';
import { PlayfieldLayout, Pt } from '../layout/types';
import { EditorScene, pickHandle, pickItem, tryBuildScene } from './scene';
import { drawEditor, toBoard } from './view';

const GRID_STEPS = [1, 2, 5, 10, 20];

export interface EditorHost {
  /** Leave the editor and play this layout. */
  play: (layout: PlayfieldLayout) => void;
  /** Leave the editor without changing what is being played. */
  close: () => void;
}

export class EditorApp {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private panel!: HTMLDivElement;
  private diagBox!: HTMLDivElement;
  private inspector!: HTMLDivElement;
  private statusBar!: HTMLDivElement;

  private layout: PlayfieldLayout;
  private scene: EditorScene;
  private undoStack: PlayfieldLayout[] = [];
  private redoStack: PlayfieldLayout[] = [];

  private selected: string | null = null;
  private hover: string | null = null;
  private drag: { handle: Handle; grabDX: number; grabDY: number } | null = null;
  private gridIdx = 3; // 10px
  private showIntent = true;
  private pendingAdd: string | null = null;
  private dirty = true;

  constructor(private host: EditorHost, initial?: PlayfieldLayout) {
    this.layout = cloneLayout(initial ?? loadFromStorage()?.layout ?? DEFAULT_LAYOUT);
    const built = tryBuildScene(this.layout);
    if ('error' in built) {
      // A stored layout can be unbuildable if it was saved by a newer editor
      // or hand-edited. Falling back beats showing an empty screen.
      this.layout = cloneLayout(DEFAULT_LAYOUT);
      this.scene = tryBuildScene(this.layout) as EditorScene;
    } else {
      this.scene = built;
    }

    this.root = document.createElement('div');
    this.root.id = 'editor';
    this.canvas = document.createElement('canvas');
    this.canvas.width = PLAYFIELD_W;
    this.canvas.height = PLAYFIELD_H;
    this.canvas.className = 'ed-board';
    const c = this.canvas.getContext('2d');
    if (!c) throw new Error('editor: no 2d context');
    this.ctx = c;

    this.buildDom();
    this.wirePointer();
    this.wireKeys();
    this.refresh();
  }

  destroy() {
    this.root.remove();
    window.removeEventListener('keydown', this.onKey);
  }

  /** The host uses this to decide whether Escape means "deselect" or "leave". */
  hasSelection(): boolean {
    return this.selected !== null || this.pendingAdd !== null;
  }

  // ── Model ───────────────────────────────────────────────────────────────

  /** Snapshot for undo. Call BEFORE mutating, once per user action — not per
   *  pointermove, or a single drag becomes a hundred undo steps. */
  private checkpoint() {
    this.undoStack.push(cloneLayout(this.layout));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private undo() {
    const prev = this.undoStack.pop();
    if (!prev) return this.status('nothing to undo');
    this.redoStack.push(cloneLayout(this.layout));
    this.layout = prev;
    this.refresh();
  }

  private redo() {
    const next = this.redoStack.pop();
    if (!next) return this.status('nothing to redo');
    this.undoStack.push(cloneLayout(this.layout));
    this.layout = next;
    this.refresh();
  }

  /** Rebuild the world and the panel from the current draft. */
  private refresh() {
    const built = tryBuildScene(this.layout);
    if ('error' in built) {
      // Keep the last good scene on screen so the board does not vanish, and
      // say plainly what is wrong — this is how a 6-target CHICAGO bank reads.
      this.status(`cannot build: ${built.error}`, true);
    } else {
      this.scene = built;
    }
    if (this.selected && !findDesc(this.layout, this.selected)) this.selected = null;
    this.renderDiagnostics();
    this.renderInspector();
    this.dirty = true;
  }

  // ── Interaction ─────────────────────────────────────────────────────────

  private wirePointer() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const raw = toBoard(cv, e.clientX, e.clientY);
      const p = this.snapPt(raw);

      if (this.pendingAdd) {
        this.addAt(this.pendingAdd, p);
        return;
      }
      // A handle of the CURRENT selection wins over anything under the
      // pointer: once something is selected, its handles are the controls,
      // and having a body underneath steal the grab makes fine edits
      // impossible.
      const own = this.selected ? pickHandle(this.scene, raw, this.selected) : null;
      const h = own ?? pickHandle(this.scene, raw);
      if (h) {
        this.selected = h.ownerId;
        this.checkpoint();
        this.drag = { handle: h, grabDX: h.x - p.x, grabDY: h.y - p.y };
        cv.setPointerCapture(e.pointerId);
        this.renderInspector();
        this.dirty = true;
        return;
      }
      const id = pickItem(this.scene, raw);
      this.selected = id;
      if (id) {
        const origin = this.scene.handles.find(
          (x) => x.ownerId === id && x.role !== 'point' && x.role !== 'size',
        );
        if (origin) {
          this.checkpoint();
          this.drag = { handle: origin, grabDX: origin.x - p.x, grabDY: origin.y - p.y };
          cv.setPointerCapture(e.pointerId);
        }
      }
      this.renderInspector();
      this.dirty = true;
    });

    cv.addEventListener('pointermove', (e) => {
      const raw = toBoard(cv, e.clientX, e.clientY);
      if (this.drag) {
        const p = this.snapPt(raw);
        const { handle, grabDX, grabDY } = this.drag;
        // Keep the grab offset so the item does not jump its centre to the
        // cursor on the first pixel of movement.
        moveHandle(this.layout, handle.ownerId, handle.key, {
          x: p.x + grabDX,
          y: p.y + grabDY,
        });
        this.refresh();
        // Re-point at the moved handle so it keeps drawing as active.
        const again = this.scene.handles.find(
          (x) => x.ownerId === handle.ownerId && x.key === handle.key,
        );
        if (again) this.drag.handle = again;
        this.status(`${handle.ownerId}  ${Math.round(p.x + grabDX)}, ${Math.round(p.y + grabDY)}`);
        return;
      }
      const hov = pickHandle(this.scene, raw) ?? null;
      const id = hov?.ownerId ?? pickItem(this.scene, raw);
      if (id !== this.hover) {
        this.hover = id;
        this.dirty = true;
      }
      cv.style.cursor = hov ? 'grab' : id ? 'move' : this.pendingAdd ? 'copy' : 'default';
    });

    const end = () => {
      if (this.drag) {
        this.drag = null;
        this.dirty = true;
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private snapPt(p: Pt): Pt {
    const g = GRID_STEPS[this.gridIdx];
    return { x: snap(p.x, g), y: snap(p.y, g) };
  }

  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      e.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (e.code === 'Escape') {
      this.pendingAdd = null;
      this.selected = null;
      this.dirty = true;
      this.renderInspector();
      this.syncPalette();
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      this.deleteSelected();
      return;
    }
    if (e.code === 'KeyG') {
      this.gridIdx = (this.gridIdx + 1) % GRID_STEPS.length;
      this.status(`grid ${GRID_STEPS[this.gridIdx]}px`);
      this.dirty = true;
      return;
    }
    const nudge: Record<string, Pt> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const n = nudge[e.code];
    if (n && this.selected) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const origin = this.scene.handles.find(
        (x) => x.ownerId === this.selected && x.role !== 'point' && x.role !== 'size',
      );
      if (!origin) return;
      this.checkpoint();
      moveHandle(this.layout, origin.ownerId, origin.key, {
        x: origin.x + n.x * step,
        y: origin.y + n.y * step,
      });
      this.refresh();
    }
  };

  private wireKeys() {
    window.addEventListener('keydown', this.onKey);
  }

  private addAt(paletteKey: string, p: Pt) {
    const item = PALETTE.find((x) => x.key === paletteKey);
    if (!item) return;
    this.checkpoint();
    const id = uniqueId(this.layout, item.key);
    const desc = item.make(id, p);
    if (item.into === 'statics') this.layout.statics.push(desc as never);
    else this.layout.elements.push(desc as never);
    this.selected = id;
    this.pendingAdd = null;
    this.syncPalette();
    this.refresh();
    this.status(`added ${item.label} as '${id}'`);
  }

  private deleteSelected() {
    if (!this.selected) return this.status('nothing selected');
    const d = findDesc(this.layout, this.selected);
    if (!d) return;
    const why = requiredReason(this.layout, d);
    if (why) return this.status(`cannot delete ${d.id}: ${why}`, true);
    this.checkpoint();
    this.layout.statics = this.layout.statics.filter((s) => s !== (d as never));
    this.layout.elements = this.layout.elements.filter((e) => e !== (d as never));
    this.status(`deleted ${d.id}`);
    this.selected = null;
    this.refresh();
  }

  // ── DOM ─────────────────────────────────────────────────────────────────

  private buildDom() {
    this.root.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    const stage = document.createElement('div');
    stage.className = 'ed-stage';
    stage.appendChild(this.canvas);
    this.root.appendChild(stage);

    this.panel = document.createElement('div');
    this.panel.className = 'ed-panel';
    this.root.appendChild(this.panel);

    const h = document.createElement('div');
    h.className = 'ed-title';
    h.textContent = 'LAYOUT BUILDER';
    const back = document.createElement('button');
    back.textContent = '✕';
    back.title = 'Back to the game (leaves the board being played unchanged)';
    back.className = 'ed-close';
    back.onclick = () => this.host.close();
    h.appendChild(back);
    this.panel.appendChild(h);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'ed-row';
    const mk = (label: string, cls: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = cls;
      b.onclick = fn;
      actions.appendChild(b);
      return b;
    };
    mk('▶ Play this board', 'ed-primary', () => {
      saveToStorage(this.layout, 'working');
      this.host.play(cloneLayout(this.layout));
    });
    mk('Save', '', () => {
      const ok = saveToStorage(this.layout, 'working');
      this.status(ok ? 'saved to this browser' : 'could not save — storage is unavailable', !ok);
    });
    mk('Export JSON', '', () => this.exportJson());
    mk('Import', '', () => this.importJson());
    mk('Coordinates', '', () => this.exportCoords());
    mk('Reset to stock', 'ed-danger', () => {
      this.checkpoint();
      this.layout = cloneLayout(DEFAULT_LAYOUT);
      this.selected = null;
      this.refresh();
      this.status('reset to the shipped board');
    });
    this.panel.appendChild(actions);

    // Tools
    const tools = document.createElement('div');
    tools.className = 'ed-row ed-tools';
    const gridSel = document.createElement('select');
    GRID_STEPS.forEach((g, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = g === 1 ? 'grid off' : `grid ${g}px`;
      gridSel.appendChild(o);
    });
    gridSel.value = String(this.gridIdx);
    gridSel.onchange = () => {
      this.gridIdx = Number(gridSel.value);
      this.dirty = true;
    };
    tools.appendChild(gridSel);

    const intent = document.createElement('label');
    intent.className = 'ed-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.showIntent;
    cb.onchange = () => {
      this.showIntent = cb.checked;
      this.dirty = true;
    };
    intent.appendChild(cb);
    intent.appendChild(document.createTextNode(' corridors + shot lines'));
    tools.appendChild(intent);

    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.className = 'ed-danger';
    del.onclick = () => this.deleteSelected();
    tools.appendChild(del);
    this.panel.appendChild(tools);

    // Palette
    const palHead = document.createElement('div');
    palHead.className = 'ed-h2';
    palHead.textContent = 'ADD — pick one, then click the board';
    this.panel.appendChild(palHead);
    const pal = document.createElement('div');
    pal.className = 'ed-palette';
    for (const item of PALETTE) {
      const b = document.createElement('button');
      b.textContent = item.label;
      b.title = item.hint;
      b.dataset.key = item.key;
      b.onclick = () => {
        this.pendingAdd = this.pendingAdd === item.key ? null : item.key;
        this.syncPalette();
        this.status(this.pendingAdd ? `click the board to place a ${item.label}` : 'add cancelled');
      };
      pal.appendChild(b);
    }
    this.panel.appendChild(pal);

    // Inspector + diagnostics
    this.inspector = document.createElement('div');
    this.inspector.className = 'ed-inspector';
    this.panel.appendChild(this.inspector);

    const dh = document.createElement('div');
    dh.className = 'ed-h2';
    dh.textContent = 'RULES';
    this.panel.appendChild(dh);
    this.diagBox = document.createElement('div');
    this.diagBox.className = 'ed-diags';
    this.panel.appendChild(this.diagBox);

    this.statusBar = document.createElement('div');
    this.statusBar.className = 'ed-status';
    this.panel.appendChild(this.statusBar);

    const help = document.createElement('div');
    help.className = 'ed-help';
    help.innerHTML =
      'drag to move · handles resize and bend · <b>G</b> grid · <b>Del</b> remove · ' +
      '<b>arrows</b> nudge (shift ×10) · <b>Ctrl+Z</b> undo · <b>Esc</b> deselect';
    this.panel.appendChild(help);
  }

  private syncPalette() {
    for (const b of Array.from(this.panel.querySelectorAll('.ed-palette button'))) {
      b.classList.toggle('on', (b as HTMLElement).dataset.key === this.pendingAdd);
    }
  }

  private status(text: string, bad = false) {
    this.statusBar.textContent = text;
    this.statusBar.classList.toggle('bad', bad);
  }

  private renderDiagnostics() {
    const ds = this.scene.diagnostics;
    this.diagBox.innerHTML = '';
    if (!ds.length) {
      const ok = document.createElement('div');
      ok.className = 'ed-diag ok';
      ok.textContent = 'No problems found.';
      this.diagBox.appendChild(ok);
      return;
    }
    for (const d of ds) {
      const row = document.createElement('div');
      row.className = `ed-diag ${d.severity}`;
      row.textContent = `[${d.rule}] ${d.message}`;
      row.onclick = () => {
        this.selected = d.elementIds[0] ?? null;
        this.renderInspector();
        this.dirty = true;
      };
      this.diagBox.appendChild(row);
    }
  }

  /** A generic property sheet: every scalar field of the selected descriptor.
   *  Generic rather than hand-written per kind because the schema is the
   *  authority — a new element kind becomes editable the day it is added,
   *  instead of the day someone remembers to write a form for it. */
  private renderInspector() {
    this.inspector.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'ed-h2';
    head.textContent = 'SELECTED';
    this.inspector.appendChild(head);

    if (!this.selected) {
      const none = document.createElement('div');
      none.className = 'ed-none';
      none.textContent = 'Nothing selected. Click a part of the board.';
      this.inspector.appendChild(none);
      return;
    }
    const d = findDesc(this.layout, this.selected) as Record<string, unknown> | undefined;
    if (!d) return;

    const idRow = document.createElement('div');
    idRow.className = 'ed-idrow';
    idRow.textContent = `${String(d.kind)} · ${String(d.id)}`;
    this.inspector.appendChild(idRow);

    const why = requiredReason(this.layout, d as never);
    if (why) {
      const lock = document.createElement('div');
      lock.className = 'ed-lock';
      lock.textContent = `Cannot be deleted — ${why}`;
      this.inspector.appendChild(lock);
    }

    const grid = document.createElement('div');
    grid.className = 'ed-props';
    for (const [k, v] of Object.entries(d)) {
      if (k === 'kind' || k === 'id') continue;
      if (typeof v !== 'number' && typeof v !== 'string') continue;
      const lab = document.createElement('label');
      lab.textContent = k;
      const inp = document.createElement('input');
      inp.value = typeof v === 'number' ? String(round(v)) : v;
      inp.onchange = () => {
        this.checkpoint();
        const target = findDesc(this.layout, String(d.id)) as Record<string, unknown>;
        if (!target) return;
        if (typeof v === 'number') {
          const n = Number(inp.value);
          if (!Number.isFinite(n)) {
            this.status(`${k}: '${inp.value}' is not a number`, true);
            return;
          }
          target[k] = n;
        } else {
          target[k] = inp.value;
        }
        this.refresh();
      };
      grid.appendChild(lab);
      grid.appendChild(inp);
    }
    this.inspector.appendChild(grid);
  }

  // ── Import / export ─────────────────────────────────────────────────────

  private exportJson() {
    const text = serialize(this.layout, 'windy-city-layout', new Date().toISOString());
    download('windy-city-layout.json', text);
    this.status(`exported ${text.length.toLocaleString()} bytes`);
  }

  private async importJson() {
    const text = await pickFile();
    if (text === null) return;
    const r = parseLayoutFile(text);
    if (typeof r === 'string') return this.status(`import failed: ${r}`, true);
    const built = tryBuildScene(r.layout);
    if ('error' in built) return this.status(`import failed to build: ${built.error}`, true);
    this.checkpoint();
    this.layout = r.layout;
    this.selected = null;
    this.refresh();
    this.status(`imported '${r.name}'`);
  }

  /** The developer view: every placed coordinate, in build order, ready to
   *  paste back into default.ts. This is what makes the editor useful for
   *  changing the SHIPPED board and not just a private copy. */
  private exportCoords() {
    const lines: string[] = ['# statics'];
    for (const s of this.layout.statics) lines.push(`${s.id}\t${describe(s)}`);
    lines.push('', '# elements');
    for (const e of this.layout.elements) lines.push(`${e.id}\t${describe(e)}`);
    lines.push('', '# frame');
    for (const [k, v] of Object.entries(this.layout.frame)) lines.push(`${k}\t${String(v)}`);
    download('windy-city-coordinates.txt', lines.join('\n'));
    this.status('exported coordinates');
  }

  // ── Frame ───────────────────────────────────────────────────────────────

  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    drawEditor(this.ctx, this.scene, {
      selected: this.selected,
      hover: this.hover,
      activeHandle: this.drag?.handle ?? null,
      grid: GRID_STEPS[this.gridIdx],
      showIntent: this.showIntent,
    });
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function describe(d: Record<string, unknown> | object): string {
  const o = d as Record<string, unknown>;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === 'id') continue;
    if (typeof v === 'number') parts.push(`${k}=${round(v)}`);
    else if (typeof v === 'string') parts.push(`${k}=${v}`);
    else if (v && typeof v === 'object' && 'x' in (v as object)) {
      const p = v as Pt;
      parts.push(`${k}=(${round(p.x)},${round(p.y)})`);
    } else if (Array.isArray(v)) {
      parts.push(
        `${k}=[${v
          .map((e) =>
            e && typeof e === 'object' && 'x' in e ? `(${round(e.x)},${round(e.y)})` : String(e),
          )
          .join(' ')}]`,
      );
    }
  }
  return parts.join('  ');
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately can beat the download on some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      resolve(f ? await f.text() : null);
    };
    inp.oncancel = () => resolve(null);
    inp.click();
  });
}

const CSS = `
#editor { position:fixed; inset:0; display:flex; gap:12px; padding:12px;
  box-sizing:border-box; background:#05060a; font:13px/1.45 'Helvetica Neue',Arial,sans-serif;
  color:#dce6f7; overflow:hidden; }
.ed-stage { flex:1 1 auto; display:flex; align-items:center; justify-content:center; min-width:0; }
.ed-board { height:100%; width:auto; max-width:100%; aspect-ratio:540/960;
  background:#0a0e17; border:1px solid rgba(140,180,255,0.22); border-radius:6px;
  touch-action:none; box-shadow:0 0 40px rgba(0,150,255,0.10); }
.ed-panel { flex:0 0 340px; display:flex; flex-direction:column; gap:8px;
  overflow-y:auto; padding-right:4px; }
.ed-title { font-weight:700; letter-spacing:.18em; font-size:12px; color:#7fe6ff;
  display:flex; align-items:center; justify-content:space-between; }
#editor button.ed-close { padding:2px 8px; font-size:12px; letter-spacing:0; }
.ed-h2 { font-size:10px; letter-spacing:.16em; color:#7f8ca6; margin-top:6px; }
.ed-row { display:flex; flex-wrap:wrap; gap:6px; }
#editor button, #editor select, #editor input {
  font:inherit; color:#dce6f7; background:#141b28;
  border:1px solid #2b3648; border-radius:5px; padding:5px 9px; cursor:pointer; }
#editor input { cursor:text; }
#editor button:hover { background:#1d2738; border-color:#3d4b64; }
#editor button.ed-primary { background:#0f5b7a; border-color:#1b90bd; color:#dffaff; font-weight:600; }
#editor button.ed-primary:hover { background:#14719a; }
#editor button.ed-danger { border-color:#6d2733; color:#ffb9c4; }
#editor button.on { background:#3a2b12; border-color:#c99a2e; color:#ffd98a; }
.ed-tools { align-items:center; }
.ed-check { display:flex; align-items:center; gap:4px; font-size:12px; color:#9fb0c8; }
.ed-palette { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.ed-inspector { border-top:1px solid #1b2434; padding-top:6px; }
.ed-idrow { font-weight:600; color:#ffd98a; margin:2px 0 6px; word-break:break-all; }
.ed-lock { font-size:11px; color:#ffae7a; background:rgba(255,140,60,0.08);
  border-left:2px solid #ff8f3c; padding:5px 7px; margin-bottom:6px; }
.ed-none { color:#71809a; font-size:12px; }
.ed-props { display:grid; grid-template-columns:auto 1fr; gap:4px 8px; align-items:center; }
.ed-props label { color:#8fa0ba; font-size:11px; }
.ed-props input { width:100%; box-sizing:border-box; padding:3px 6px; }
.ed-diags { display:flex; flex-direction:column; gap:4px; max-height:30vh; overflow-y:auto; }
.ed-diag { font-size:11px; padding:5px 7px; border-radius:4px; cursor:pointer;
  border-left:3px solid transparent; }
.ed-diag.ok { color:#6fd39a; border-color:#2c6b48; background:rgba(60,200,130,0.06); cursor:default; }
.ed-diag.error { color:#ff9aa8; border-color:#c8394f; background:rgba(220,60,90,0.09); }
.ed-diag.warn { color:#ffd48a; border-color:#c79a2e; background:rgba(220,170,60,0.08); }
.ed-status { font-size:11px; color:#8fa0ba; min-height:16px; }
.ed-status.bad { color:#ff9aa8; }
.ed-help { font-size:10px; color:#63718a; line-height:1.6; }
@media (max-width: 820px) {
  #editor { flex-direction:column; }
  .ed-panel { flex:1 1 auto; }
  .ed-stage { flex:0 0 46vh; }
}
`;
