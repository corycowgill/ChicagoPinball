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

/** Six-pointed Chicago-flag star, filled with the given style. */
export function decoStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  style = 'rgba(255, 255, 255, 0.55)',
) {
  ctx.save();
  ctx.fillStyle = style;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Noir Capone portrait — fedora, hat-shadowed eyes, cigar, pinstripes.
 *  Drawn centred on (cx, cy) ≈ the bridge of the nose; roughly 100×170
 *  units at scale 1. */
export function drawCapone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s = 1,
  alpha = 1,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';

  // Suit shoulders — pinstriped navy.
  ctx.beginPath();
  ctx.moveTo(-50, 84);
  ctx.quadraticCurveTo(-46, 40, -26, 32);
  ctx.lineTo(26, 32);
  ctx.quadraticCurveTo(46, 40, 50, 84);
  ctx.closePath();
  ctx.fillStyle = '#141b2c';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(190, 200, 220, 0.22)';
  ctx.lineWidth = 1;
  for (let x = -48; x <= 48; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, 30);
    ctx.lineTo(x + 4, 86);
    ctx.stroke();
  }
  ctx.restore();
  // Shirt + red tie.
  ctx.fillStyle = '#e8ecf2';
  ctx.beginPath();
  ctx.moveTo(-10, 33);
  ctx.lineTo(10, 33);
  ctx.lineTo(0, 60);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#b01a28';
  ctx.beginPath();
  ctx.moveTo(-4, 36);
  ctx.lineTo(4, 36);
  ctx.lineTo(3, 58);
  ctx.lineTo(0, 66);
  ctx.lineTo(-3, 58);
  ctx.closePath();
  ctx.fill();

  // Neck + face.
  ctx.fillStyle = '#dcae83';
  ctx.fillRect(-9, 16, 18, 18);
  ctx.beginPath();
  ctx.ellipse(0, -2, 24, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  // Jaw shading.
  ctx.fillStyle = 'rgba(120, 70, 40, 0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 18, 12, 0, 0, Math.PI);
  ctx.fill();
  // Ears.
  ctx.fillStyle = '#d2a077';
  ctx.beginPath();
  ctx.ellipse(-24, 0, 4, 7, 0, 0, Math.PI * 2);
  ctx.ellipse(24, 0, 4, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hat shadow across the eyes — the noir band.
  ctx.fillStyle = 'rgba(10, 12, 20, 0.62)';
  ctx.beginPath();
  ctx.moveTo(-24, -14);
  ctx.lineTo(24, -14);
  ctx.lineTo(22, 2);
  ctx.lineTo(-22, 2);
  ctx.closePath();
  ctx.fill();
  // Eye glints in the shadow.
  ctx.fillStyle = 'rgba(255, 245, 220, 0.85)';
  ctx.fillRect(-11, -5, 5, 1.6);
  ctx.fillRect(6, -5, 5, 1.6);

  // Nose + smirk.
  ctx.strokeStyle = 'rgba(110, 60, 35, 0.7)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(-2, 8);
  ctx.moveTo(-8, 15);
  ctx.quadraticCurveTo(2, 19, 10, 14);
  ctx.stroke();
  // The scar (left cheek).
  ctx.strokeStyle = 'rgba(150, 60, 50, 0.65)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-20, 6);
  ctx.lineTo(-13, 16);
  ctx.stroke();

  // Cigar with ember + smoke.
  ctx.save();
  ctx.translate(11, 15);
  ctx.rotate(0.12);
  ctx.fillStyle = '#6b3a1f';
  ctx.fillRect(0, -2.4, 20, 4.8);
  ctx.fillStyle = '#ff7b2e';
  ctx.beginPath();
  ctx.arc(20.5, 0, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(200, 210, 225, 0.35)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(32, 14);
  ctx.quadraticCurveTo(40, 2, 34, -10);
  ctx.quadraticCurveTo(29, -20, 36, -30);
  ctx.stroke();

  // Fedora — brim, crown, red band.
  ctx.fillStyle = '#10131c';
  ctx.beginPath();
  ctx.ellipse(0, -17, 35, 9, -0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-23, -18);
  ctx.quadraticCurveTo(-24, -44, -12, -48);
  ctx.quadraticCurveTo(2, -52, 16, -47);
  ctx.quadraticCurveTo(25, -42, 22, -18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a01522';
  ctx.beginPath();
  ctx.moveTo(-23, -28);
  ctx.lineTo(22, -28);
  ctx.lineTo(22, -20);
  ctx.lineTo(-23, -20);
  ctx.closePath();
  ctx.fill();
  // Brim highlight.
  ctx.strokeStyle = 'rgba(200, 210, 230, 0.25)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, -17, 35, 9, -0.04, Math.PI * 0.95, Math.PI * 1.9);
  ctx.stroke();

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
