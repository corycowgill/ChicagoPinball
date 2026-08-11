/** A dot-matrix display — the orange plasma panel of a 90s machine.
 *  Compose a frame into the dot buffer each tick (text/bars/sprites), then
 *  render() blits it. The unlit dot grid + bezel are cached once. */

const COLS = 128;
const ROWS = 18;

/** Classic 5×7 font, one number per row, 5 bits wide (MSB left). */
const FONT: Record<string, number[]> = {
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x0e, 0, 0, 0],
  '+': [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ',': [0, 0, 0, 0, 0, 0x0c, 0x04],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '?': [0x0e, 0x11, 0x01, 0x06, 0x04, 0, 0x04],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '*': [0x04, 0x15, 0x0e, 0x1f, 0x0e, 0x15, 0x04],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
};

/** Capone's mug for the boss bar — 12×10 fedora + face. */
const CAPONE_SPRITE = [
  0b000111111000,
  0b011111111110,
  0b111111111111,
  0b000111111000,
  0b000100001000,
  0b000110011000,
  0b000100001000,
  0b000101101000,
  0b000100001000,
  0b000011110000,
];

function sanitize(text: string): string {
  return text
    .toUpperCase()
    .replace(/✓/g, '*')
    .replace(/×/g, 'X')
    .replace(/[—–·]/g, '-')
    .replace(/…/g, '...')
    .replace(/★/g, '*')
    .replace(/[^0-9A-Z \-+.,!?/:'*()]/g, ' ');
}

/** A short animation for the panel.
 *
 *  A function of elapsed time, not a list of baked frames. A ball arcing
 *  across 128 dots is arithmetic; as bitmaps it would be twenty rows of hex
 *  per clip and impossible to retime. `draw` is called with `t` in [0, ms]
 *  and may assume nothing about what else is on the panel — the caller
 *  decides whether to clear first. */
export interface DmdClip {
  id: string;
  /** Total duration in ms. The runner drops the clip once t passes it. */
  ms: number;
  draw: (d: Dmd, t: number) => void;
}

export class Dmd {
  /** Clock driving the marquee scroll of over-long lines. */
  private scrollMs = 0;
  private clip: DmdClip | null = null;
  private clipMs = 0;
  readonly cols = COLS;
  readonly rows = ROWS;
  private buf = new Uint8Array(COLS * ROWS);
  private panel: HTMLCanvasElement | null = null;

  clear() {
    this.buf.fill(0);
  }

  /** Lit dots in the current frame, and a hash of which ones.
   *
   *  For src/dev/dmdcheck.ts, which steps every clip headless. A clip that
   *  draws nothing and a clip that never ran look identical on screen; both
   *  are obvious here. The count alone is not enough — a puck sliding across
   *  lights the same number of dots every frame — so the signature exists to
   *  tell motion from a freeze. */
  litCount(): number {
    let n = 0;
    for (let i = 0; i < this.buf.length; i++) n += this.buf[i];
    return n;
  }

  signature(): string {
    let h = 2166136261;
    for (let i = 0; i < this.buf.length; i++) {
      h ^= this.buf[i] * (i % 251);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  /** Light a dot. Coordinates are ROUNDED, and that is load-bearing.
   *
   *  This used to index the buffer with whatever it was given. Every caller
   *  inside this file passes integers, so it went unnoticed — but a clip
   *  animating a ball along an arc passes floats, and `buf[3.5]` on a typed
   *  array is a silent no-op. The dot does not land and nothing reports it.
   *  src/dev/dmdcheck.ts caught it as two frames of the jackpot burst reading
   *  zero lit dots while the frames either side read 98. */
  dot(x: number, y: number) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px >= 0 && px < COLS && py >= 0 && py < ROWS) this.buf[py * COLS + px] = 1;
  }

  textWidth(text: string): number {
    return sanitize(text).length * 6 - 1;
  }

  /** Draw 5×7 text with the glyph top-left at (x, y) in dot coordinates.
   *  `gap` is the inter-glyph spacing (1 normally, 0 when condensing a
   *  long line to fit). Dots outside the panel are dropped by dot(). */
  text(str: string, x: number, y: number, gap = 1) {
    const s = sanitize(str);
    let cx = x;
    for (const ch of s) {
      const glyph = FONT[ch] ?? FONT['?'];
      for (let r = 0; r < 7; r++) {
        const bits = glyph[r];
        for (let c = 0; c < 5; c++) {
          if (bits & (1 << (4 - c))) this.dot(cx + c, y + r);
        }
      }
      cx += 5 + gap;
    }
  }

  /** Centre a line, condensing then scrolling if it's too wide for the
   *  panel — a long message used to just run off the right edge and
   *  vanish (e.g. "SUPER SKILL AT THE BEAN" read "...AT THE BE"). */
  centerText(str: string, y: number) {
    const s = sanitize(str);
    const wide = this.textWidth(s);
    if (wide <= COLS) {
      this.text(s, Math.max(0, Math.floor((COLS - wide) / 2)), y);
      return;
    }
    // Condensed: 5px glyphs butted together.
    const tight = s.length * 5;
    if (tight <= COLS) {
      this.text(s, Math.max(0, Math.floor((COLS - tight) / 2)), y, 0);
      return;
    }
    // Still too long — marquee it, with a pause at each end.
    const overflow = tight - COLS;
    const cycle = overflow + 44; // 22 dots of dwell at both ends
    const phase = Math.floor(this.scrollMs / 45) % cycle;
    const shift = Math.min(overflow, Math.max(0, phase - 22));
    this.text(s, -shift, y, 0);
  }

  /** Advance the marquee clock and any running clip (once per frame). */
  tick(dtMs: number) {
    this.scrollMs += dtMs;
    if (this.clip) {
      this.clipMs += dtMs;
      if (this.clipMs >= this.clip.ms) this.clip = null;
    }
  }

  /** Start a clip, replacing whatever was running.
   *
   *  Replacing rather than queueing on purpose: a clip is a reaction to
   *  something that just happened, and a queue would play the reaction to a
   *  shot several seconds after the shot. */
  playClip(c: DmdClip) {
    this.clip = c;
    this.clipMs = 0;
  }

  clipActive(): boolean {
    return this.clip !== null;
  }

  /** Compose the running clip's current frame. No-op when none is running,
   *  so the caller can always ask. */
  drawClip() {
    this.clip?.draw(this, this.clipMs);
  }

  rightText(str: string, y: number, rightX = COLS - 2) {
    this.text(str, rightX - this.textWidth(str), y);
  }

  /** Horizontal progress bar (filled portion + 1-dot outline). */
  bar(x: number, y: number, w: number, h: number, frac: number) {
    const fill = Math.round(w * Math.max(0, Math.min(1, frac)));
    for (let yy = 0; yy < h; yy++) {
      this.dot(x, y + yy);
      this.dot(x + w, y + yy);
      for (let xx = 0; xx < fill; xx++) this.dot(x + xx, y + yy);
    }
    for (let xx = 0; xx <= w; xx++) {
      this.dot(x + xx, y);
      this.dot(x + xx, y + h - 1);
    }
  }

  capone(x: number, y: number) {
    this.sprite(CAPONE_SPRITE, 12, x, y);
  }

  /** Blit a bitmap sprite: one number per row, `w` bits wide, MSB left.
   *
   *  This is `capone()` with the 12 taken out. It stayed hardcoded because
   *  Capone was the only sprite the panel had — which is the thing this pass
   *  is about. `capone()` now calls straight through, so the wizard-mode
   *  display cannot drift from what it drew before. */
  sprite(rows: number[], w: number, x: number, y: number) {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < w; c++) {
        if (rows[r] & (1 << (w - 1 - c))) this.dot(x + c, y + r);
      }
    }
  }

  /** Bresenham. A net, a goalpost and a diamond are lines; hand-authoring
   *  them as bitmaps would be a lot of hex for shapes the panel can just
   *  compute, and they have to move. */
  line(x0: number, y0: number, x1: number, y1: number) {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.dot(x, y);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Midpoint circle outline. `fill` for a ball, hollow for a hoop. */
  circle(cx: number, cy: number, r: number, fill = false) {
    if (r <= 0) {
      this.dot(Math.round(cx), Math.round(cy));
      return;
    }
    for (let yy = -r; yy <= r; yy++) {
      for (let xx = -r; xx <= r; xx++) {
        const d = Math.hypot(xx, yy);
        if (fill ? d <= r + 0.3 : Math.abs(d - r) < 0.6) {
          this.dot(Math.round(cx + xx), Math.round(cy + yy));
        }
      }
    }
  }

  /** Blit the panel into the given rect. */
  render(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number) {
    if (!this.panel) this.panel = buildPanel(pw, ph);
    ctx.drawImage(this.panel, px, py, pw, ph);
    const pitchX = (pw - 10) / COLS;
    const pitchY = (ph - 8) / ROWS;
    const dw = Math.max(1.6, pitchX - 1.3);
    const dh = Math.max(1.6, pitchY - 1.3);
    const ox = px + 5;
    const oy = py + 4;
    ctx.save();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!this.buf[y * COLS + x]) continue;
        const dx = ox + x * pitchX;
        const dy = oy + y * pitchY;
        ctx.fillStyle = '#ff9b1e';
        ctx.fillRect(dx, dy, dw, dh);
        ctx.fillStyle = '#ffd9a0';
        ctx.fillRect(dx + dw * 0.25, dy + dh * 0.2, dw * 0.5, dh * 0.4);
      }
    }
    ctx.restore();
  }
}

/** Bezel + unlit dot grid, cached at 2× for crispness. */
function buildPanel(pw: number, ph: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = pw * 2;
  c.height = ph * 2;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  // Bezel
  const grad = ctx.createLinearGradient(0, 0, 0, ph);
  grad.addColorStop(0, '#2a2f3c');
  grad.addColorStop(0.5, '#12151e');
  grad.addColorStop(1, '#080a10');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, pw, ph);
  ctx.strokeStyle = 'rgba(210, 170, 90, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, pw - 1, ph - 1);
  // Glass
  ctx.fillStyle = '#180b02';
  ctx.fillRect(3, 2.5, pw - 6, ph - 5);
  // Unlit dots
  const pitchX = (pw - 10) / COLS;
  const pitchY = (ph - 8) / ROWS;
  const dw = Math.max(1.6, pitchX - 1.3);
  const dh = Math.max(1.6, pitchY - 1.3);
  ctx.fillStyle = 'rgba(120, 60, 15, 0.28)';
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      ctx.fillRect(5 + x * pitchX, 4 + y * pitchY, dw, dh);
    }
  }
  return c;
}
