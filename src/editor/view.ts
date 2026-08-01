/** Drawing the editor: a schematic, deliberately not a rendering.
 *
 *  The game's 3D presentation is the wrong view for building a board — a
 *  perspective table with lighting and plastics hides exactly what you need to
 *  see, which is where things are and what is in the way. This draws the real
 *  bodies flat, in plan, colour-coded by what they do, with the invisible
 *  design intent (corridors, shot lines) made visible.
 */
import Matter from 'matter-js';
import { PLAYFIELD_H, PLAYFIELD_W } from '../constants';
import { AnyDesc, Handle } from '../layout/handles';
import { Pt } from '../layout/types';
import { EditorScene } from './scene';

export interface ViewOptions {
  selected: string | null;
  hover: string | null;
  activeHandle: Handle | null;
  grid: number;
  showIntent: boolean;
  /** Where the test ball has been, oldest first. */
  trail: Pt[];
  /** Where it is now, or null when no run is active. */
  ball: Pt | null;
}

const BG = '#0a0e17';
const GRID = 'rgba(120,160,220,0.09)';
const GRID_BOLD = 'rgba(120,160,220,0.2)';

/** Colour by what a thing DOES, so the board reads at a glance. */
function colourOf(d: AnyDesc): { fill: string; stroke: string } {
  switch (d.kind) {
    case 'cabinet-wall':
      return { fill: 'rgba(255,255,255,0.02)', stroke: 'rgba(255,255,255,0.10)' };
    case 'rail':
    case 'post':
      return { fill: 'rgba(190,205,225,0.30)', stroke: '#c6d3e6' };
    case 'deco-post':
      return { fill: 'rgba(190,205,225,0.06)', stroke: 'rgba(198,211,230,0.45)' };
    case 'sensor':
    case 'drain':
      return { fill: 'rgba(0,220,255,0.10)', stroke: 'rgba(0,220,255,0.65)' };
    case 'flipper':
      return { fill: 'rgba(255,80,110,0.45)', stroke: '#ff5d78' };
    case 'slingshot':
      return { fill: 'rgba(255,255,255,0.35)', stroke: '#ffffff' };
    case 'pop-bumper':
    case 'bean':
      return { fill: 'rgba(0,235,200,0.30)', stroke: '#3ff0cf' };
    case 'ramp':
      return { fill: 'rgba(255,190,70,0.16)', stroke: '#ffbe46' };
    case 'scoop':
      return { fill: 'rgba(255,150,40,0.28)', stroke: '#ff9628' };
    case 'drop-bank':
    case 'standup':
      return { fill: 'rgba(120,150,255,0.32)', stroke: '#8ea6ff' };
    case 'captive':
      return { fill: 'rgba(220,220,235,0.25)', stroke: '#dfe3f2' };
    case 'spinner':
      return { fill: 'rgba(255,240,140,0.35)', stroke: '#fff08c' };
    case 'rollover':
      return { fill: 'rgba(160,120,255,0.20)', stroke: '#a878ff' };
    case 'plunger':
      return { fill: 'rgba(255,120,120,0.30)', stroke: '#ff7878' };
    default:
      return { fill: 'rgba(200,200,220,0.25)', stroke: '#c8c8dc' };
  }
}

function poly(ctx: CanvasRenderingContext2D, verts: Matter.Vector[]) {
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
}

export function drawEditor(
  ctx: CanvasRenderingContext2D,
  scene: EditorScene,
  ui: ViewOptions,
) {
  const { layout } = scene.resolved;
  ctx.save();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);

  // ── Grid ────────────────────────────────────────────────────────────────
  if (ui.grid > 1) {
    ctx.lineWidth = 1;
    for (let x = 0; x <= PLAYFIELD_W; x += ui.grid) {
      ctx.strokeStyle = x % (ui.grid * 5) === 0 ? GRID_BOLD : GRID;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, PLAYFIELD_H);
      ctx.stroke();
    }
    for (let y = 0; y <= PLAYFIELD_H; y += ui.grid) {
      ctx.strokeStyle = y % (ui.grid * 5) === 0 ? GRID_BOLD : GRID;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(PLAYFIELD_W, y + 0.5);
      ctx.stroke();
    }
  }

  // The play area proper — the shooter lane is outside it, and that boundary
  // is invisible in the game but decides half the layout rules.
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(scene.resolved.frame.playRight, 0);
  ctx.lineTo(scene.resolved.frame.playRight, PLAYFIELD_H);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Design intent, under the bodies ─────────────────────────────────────
  if (ui.showIntent) {
    for (const c of layout.corridors ?? []) {
      ctx.strokeStyle = 'rgba(90,255,190,0.14)';
      ctx.lineWidth = c.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c.a.x, c.a.y);
      ctx.lineTo(c.b.x, c.b.y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]);
    for (const l of layout.shotLines ?? []) {
      const f = scene.resolved.frame;
      const from =
        l.from === 'left-flipper'
          ? { x: f.playCenter - f.flipperGap, y: f.flipperY }
          : { x: f.playCenter + f.flipperGap, y: f.flipperY };
      const target = scene.bodiesById.get(l.to)?.[0];
      if (!target) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(target.position.x, target.position.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ── Ramp paths, UNDER the bodies ────────────────────────────────────────
  // A ramp contributes exactly one body — its entry sensor. The plate the ball
  // rides and the wireform it returns on are a path, drawn by the renderer and
  // walked by the transit system, so drawing only bodies would leave the two
  // biggest shots on the board invisible in the tool for editing them. They go
  // underneath because the interesting question while editing is what a ramp
  // is covering.
  const all: AnyDesc[] = [...layout.statics, ...layout.elements];
  for (const d of all) {
    if (d.kind !== 'ramp') continue;
    const { stroke } = colourOf(d);
    const isSel = d.id === ui.selected;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = isSel ? '#ffffff' : stroke;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 26;
    path(ctx, d.plate);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = isSel ? 2 : 1.2;
    path(ctx, d.plate);
    ctx.stroke();
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.4;
    path(ctx, d.habitrail);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
  }

  // ── Bodies, in build order ──────────────────────────────────────────────
  for (const d of all) {
    const bodies = scene.bodiesById.get(d.id) ?? [];
    const { fill, stroke } = colourOf(d);
    const isSel = d.id === ui.selected;
    const isHover = d.id === ui.hover;
    const isFlagged = scene.flagged.has(d.id);
    for (const b of bodies) {
      poly(ctx, b.vertices);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = isSel ? 2.5 : 1.2;
      ctx.strokeStyle = isSel ? '#ffffff' : isHover ? '#ffe9a8' : stroke;
      if (b.isSensor) ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (isFlagged) {
        ctx.strokeStyle = 'rgba(255,70,90,0.9)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    // Deco posts produce no body; draw the ring the renderer will draw.
    if (d.kind === 'deco-post') {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r ?? 5, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = isSel ? '#ffffff' : stroke;
      ctx.lineWidth = isSel ? 2.5 : 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ── Vectors nothing else makes visible ──────────────────────────────────
  for (const d of all) {
    if (d.kind === 'ramp') {
      // Where the wireform spits the ball out, and which way.
      const end = d.habitrail[d.habitrail.length - 1];
      arrow(ctx, end, d.exitVel, 26, colourOf(d).stroke);
    }
    if (d.kind === 'scoop') {
      // The eject vector — the difference between a rewarding shot and one
      // that drains you, and invisible everywhere else.
      arrow(
        ctx,
        { x: d.x, y: d.y },
        { x: Math.cos(d.kickAngle), y: Math.sin(d.kickAngle) },
        d.kickSpeed * 2.4,
        '#ff9628',
      );
    }
    if (d.kind === 'sensor' && d.kicker) {
      arrow(ctx, { x: d.x, y: d.y }, { x: d.kicker.vx, y: d.kicker.vy }, 46, '#4ad9ff');
    }
    if (d.kind === 'ball-spawn') {
      const f = scene.resolved.frame;
      ring(ctx, f.launchX, f.launchRestY, 11, '#ffffff', 'ball');
    }
  }

  // ── The test ball ───────────────────────────────────────────────────────
  // Drawn last so it is never lost behind a ramp plate. The trail fades from
  // the tail so the direction of travel reads without an arrow.
  if (ui.trail.length > 1) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 1; i < ui.trail.length; i++) {
      const t = i / ui.trail.length;
      ctx.strokeStyle = `rgba(255,240,150,${0.08 + t * 0.6})`;
      ctx.lineWidth = 1 + t * 2.5;
      ctx.beginPath();
      ctx.moveTo(ui.trail[i - 1].x, ui.trail[i - 1].y);
      ctx.lineTo(ui.trail[i].x, ui.trail[i].y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  if (ui.ball) {
    ctx.beginPath();
    ctx.arc(ui.ball.x, ui.ball.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#fff6c8';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffb63c';
    ctx.stroke();
  }

  // ── Labels ──────────────────────────────────────────────────────────────
  // Only for what the pointer is on. Labelling everything turns the board into
  // a wall of text; labelling nothing means clicking things to find out what
  // they are.
  for (const id of [ui.hover, ui.selected]) {
    if (!id) continue;
    const d = all.find((x) => x.id === id);
    if (!d) continue;
    const b = scene.bodiesById.get(id)?.[0];
    const at = b
      ? { x: b.position.x, y: b.position.y }
      : d.kind === 'deco-post'
        ? { x: d.x, y: d.y }
        : null;
    if (!at) continue;
    label(ctx, `${d.id}  ·  ${d.kind}`, at.x, at.y - 18, id === ui.selected);
  }

  // ── Handles for the selection ───────────────────────────────────────────
  if (ui.selected) {
    for (const h of scene.handles) {
      if (h.ownerId !== ui.selected) continue;
      drawHandle(ctx, h, ui.activeHandle?.key === h.key);
    }
  }
  ctx.restore();
}

function path(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/** A direction indicator for a vector that has no visible geometry: a ramp's
 *  exit velocity, a scoop's kick, an outlane kicker's impulse. */
function arrow(ctx: CanvasRenderingContext2D, at: Pt, dir: Pt, len: number, colour: string) {
  const m = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / m;
  const uy = dir.y / m;
  const tipX = at.x + ux * len;
  const tipY = at.y + uy * len;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * 8 - uy * 4, tipY - uy * 8 + ux * 4);
  ctx.lineTo(tipX - ux * 8 + uy * 4, tipY - uy * 8 - ux * 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  colour: string,
  label?: string,
) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  if (label) {
    ctx.setLineDash([]);
    ctx.fillStyle = colour;
    ctx.font = '10px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - r - 4);
  }
  ctx.restore();
}

/** A small plate behind the text, so an id stays readable over a bright ramp
 *  or a pale slingshot rather than only over the dark playfield. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  strong: boolean,
) {
  ctx.save();
  ctx.font = `${strong ? 'bold ' : ''}11px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  const w = ctx.measureText(text).width + 10;
  const cx = Math.max(w / 2 + 2, Math.min(PLAYFIELD_W - w / 2 - 2, x));
  ctx.fillStyle = 'rgba(4,8,16,0.85)';
  ctx.fillRect(cx - w / 2, y - 11, w, 16);
  ctx.strokeStyle = strong ? 'rgba(255,255,255,0.55)' : 'rgba(150,190,235,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - w / 2 + 0.5, y - 10.5, w - 1, 15);
  ctx.fillStyle = strong ? '#ffffff' : '#bcd0ea';
  ctx.fillText(text, cx, y + 1);
  ctx.restore();
}

function drawHandle(ctx: CanvasRenderingContext2D, h: Handle, active: boolean) {
  const r = h.role === 'origin' ? 7 : 5;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
  ctx.fillStyle = active
    ? '#ffffff'
    : h.role === 'origin'
      ? 'rgba(255,255,255,0.92)'
      : h.role === 'size'
        ? '#ffd24a'
        : h.role === 'frame'
          ? '#ff7fa8'
          : '#4ad9ff';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.stroke();
}

/** Canvas pixel -> playfield coordinate. The canvas is letterboxed by CSS, so
 *  this must go through the rendered rect rather than the backing store size. */
export function toBoard(canvas: HTMLCanvasElement, clientX: number, clientY: number): Pt {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((clientX - r.left) / r.width) * PLAYFIELD_W,
    y: ((clientY - r.top) / r.height) * PLAYFIELD_H,
  };
}
