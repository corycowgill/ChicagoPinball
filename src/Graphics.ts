import { COLOR } from './constants';

/** Drop a soft round shadow (like a body floating slightly above the
 *  playfield). x,y is the shadow centre on the playfield surface. */
export function softShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number = rx,
  alpha = 0.45,
) {
  ctx.save();
  const grad = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
  grad.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A short cylindrical chrome post (like the metal posts that hold rubbers
 *  in place on a real playfield). */
export function metalPost(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r = 5,
) {
  ctx.save();
  // Cast shadow.
  softShadow(ctx, x + 1.5, y + 3, r * 1.6, r * 0.9, 0.55);
  // Cylinder cap with a top-down highlight.
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, 0, x, y, r);
  grad.addColorStop(0, COLOR.METAL_LIGHT);
  grad.addColorStop(0.4, '#aab4c8');
  grad.addColorStop(0.85, COLOR.METAL_DARK);
  grad.addColorStop(1, COLOR.METAL_SHADOW);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Tiny specular pip.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.45, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A backlit insert (the colored arrow / circle / shape on a real playfield
 *  whose translucent plastic glows when its lamp is lit). */
export function insertCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  lit: boolean,
) {
  ctx.save();
  // Cut-out well (recessed look) — dark inner ring.
  ctx.fillStyle = '#02040a';
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
  ctx.fill();
  if (lit) {
    // Bright lamp.
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, color);
    g.addColorStop(1, color);
    ctx.fillStyle = g;
  } else {
    // Dimmed insert — visible but unlit.
    ctx.fillStyle = `rgba(${hexToRgb(color)}, 0.18)`;
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A backlit arrow insert pointing in the given direction (radians). */
export function insertArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  color: string,
  lit: boolean,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Recessed base.
  ctx.fillStyle = '#02040a';
  drawArrowPath(ctx, size + 2);
  ctx.fill();
  if (lit) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.fillStyle = color;
  } else {
    ctx.fillStyle = `rgba(${hexToRgb(color)}, 0.22)`;
  }
  drawArrowPath(ctx, size);
  ctx.fill();
  if (lit) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    drawArrowPath(ctx, size * 0.55);
    ctx.fill();
  }
  ctx.restore();
}

function drawArrowPath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(s * 0.2, -s * 0.7);
  ctx.lineTo(s * 0.2, -s * 0.25);
  ctx.lineTo(-s, -s * 0.25);
  ctx.lineTo(-s, s * 0.25);
  ctx.lineTo(s * 0.2, s * 0.25);
  ctx.lineTo(s * 0.2, s * 0.7);
  ctx.closePath();
}

/** Stroke a path with a centerline-bright metallic gradient — used to draw
 *  curved ramp rails so they read as polished steel under playfield lights. */
export function strokeMetalPath(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  width = 6,
) {
  if (pts.length < 2) return;
  ctx.save();
  // Drop shadow underneath for depth.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = width + 4;
  ctx.beginPath();
  ctx.moveTo(pts[0].x + 2, pts[0].y + 4);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + 2, pts[i].y + 4);
  ctx.stroke();

  // Outer rail (dark edge)
  ctx.strokeStyle = COLOR.METAL_DARK;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // Inner highlight (lit top of the rail)
  ctx.strokeStyle = COLOR.METAL_LIGHT;
  ctx.lineWidth = Math.max(1, width - 4);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

/** Translucent plastic / acrylic ramp surface — draws as a thick, glowing,
 *  semi-transparent band along the supplied centerline. */
export function strokePlasticRamp(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  color: string,
  width = 36,
  litAlpha = 0.55,
) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Cast shadow under the ramp.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = width + 6;
  ctx.beginPath();
  ctx.moveTo(pts[0].x + 1, pts[0].y + 6);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + 1, pts[i].y + 6);
  ctx.stroke();

  // Body (translucent color)
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = `rgba(${hexToRgb(color)}, ${litAlpha})`;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // Glossy top stripe (specular highlight along the curve)
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.lineWidth = Math.max(1.5, width * 0.12);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) ctx.moveTo(p.x, p.y - width * 0.25);
    else ctx.lineTo(p.x, p.y - width * 0.25);
  }
  ctx.stroke();

  // Dark bottom stripe (cast-shadow side)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.lineWidth = Math.max(1, width * 0.1);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) ctx.moveTo(p.x, p.y + width * 0.32);
    else ctx.lineTo(p.x, p.y + width * 0.32);
  }
  ctx.stroke();
  ctx.restore();
}

/** A guide rail (the metal rod that defines a lane on the playfield).
 *  Two parallel polished steel lines along a centerline. */
export function strokeGuideRail(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  laneWidth: number,
) {
  if (pts.length < 2) return;
  ctx.save();
  // Compute the perpendicular offsets on each side.
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let dx = 0,
      dy = 0;
    if (i === 0) {
      dx = pts[1].x - p.x;
      dy = pts[1].y - p.y;
    } else if (i === pts.length - 1) {
      dx = p.x - pts[i - 1].x;
      dy = p.y - pts[i - 1].y;
    } else {
      dx = pts[i + 1].x - pts[i - 1].x;
      dy = pts[i + 1].y - pts[i - 1].y;
    }
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const half = laneWidth / 2;
    left.push({ x: p.x + nx * half, y: p.y + ny * half });
    right.push({ x: p.x - nx * half, y: p.y - ny * half });
  }
  strokeMetalPath(ctx, left, 4);
  strokeMetalPath(ctx, right, 4);
  ctx.restore();
}

export function hexToRgb(hex: string): string {
  // Accepts "#rgb", "#rrggbb", or "rgba(...)" passthrough as fallback.
  if (hex.startsWith('rgb')) return hex.slice(hex.indexOf('(') + 1, hex.indexOf(')'));
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
