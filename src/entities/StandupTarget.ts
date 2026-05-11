import Matter from 'matter-js';
import { COLOR } from '../constants';
import { softShadow } from '../Graphics';

/** A standup target: a small rectangular target that springs back when hit
 *  but isn't knocked down. Drawn as a glossy plastic plate on a metal base
 *  with a backlit color, positioned at an angle so the ball faces it. */
export class StandupTarget {
  readonly body: Matter.Body;
  readonly w: number;
  readonly h: number;
  readonly angle: number;
  readonly color: string;
  readonly label: string;
  private flash = 0;

  constructor(opts: {
    x: number;
    y: number;
    angle?: number;
    width?: number;
    height?: number;
    color?: string;
    id: string;
  }) {
    this.w = opts.width ?? 28;
    this.h = opts.height ?? 8;
    this.angle = opts.angle ?? 0;
    this.color = opts.color ?? COLOR.INSERT_YELLOW;
    this.label = `standup-${opts.id}`;
    this.body = Matter.Bodies.rectangle(opts.x, opts.y, this.w, this.h, {
      isStatic: true,
      restitution: 1.0,
      angle: this.angle,
      label: this.label,
    });
  }

  hit() {
    this.flash = 1;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 250);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const cx = this.body.position.x;
    const cy = this.body.position.y;
    const a = this.body.angle;

    // Drop shadow (target sits ~6 px above the playfield)
    softShadow(ctx, cx + 1, cy + 7, this.w * 0.7, this.h * 0.9 + 4, 0.55);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);

    // Metal mounting plate behind the lit face
    ctx.fillStyle = '#1a2236';
    ctx.fillRect(-this.w / 2 - 2, -this.h / 2 - 2, this.w + 4, this.h + 4);
    ctx.strokeStyle = COLOR.METAL_DARK;
    ctx.lineWidth = 1;
    ctx.strokeRect(-this.w / 2 - 2, -this.h / 2 - 2, this.w + 4, this.h + 4);

    // Lit plastic face
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12 + 16 * this.flash;
    const grad = ctx.createLinearGradient(0, -this.h / 2, 0, this.h / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, this.color);
    grad.addColorStop(1, dimRgba(this.color, 0.55));
    ctx.fillStyle = grad;
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);

    // Glossy stripe across the top edge
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(-this.w / 2 + 2, -this.h / 2 + 1, this.w - 4, 1.5);
    ctx.restore();
  }
}

function dimRgba(hex: string, alpha: number) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}
