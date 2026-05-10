import Matter from 'matter-js';
import { COLOR } from '../constants';

/**
 * The Loop ramp: a sensor strip the ball passes through; entry + exit detect
 * a successful traversal.
 */
export class Ramp {
  readonly entry: Matter.Body;
  readonly exit: Matter.Body;
  readonly path: { x: number; y: number }[];
  private armed = false;
  private armTimer = 0;
  private flash = 0;

  constructor(opts: {
    entry: { x: number; y: number };
    exit: { x: number; y: number };
    path: { x: number; y: number }[];
  }) {
    this.entry = Matter.Bodies.circle(opts.entry.x, opts.entry.y, 14, {
      isStatic: true,
      isSensor: true,
      label: 'ramp-entry',
    });
    this.exit = Matter.Bodies.circle(opts.exit.x, opts.exit.y, 14, {
      isStatic: true,
      isSensor: true,
      label: 'ramp-exit',
    });
    this.path = opts.path;
  }

  arm() {
    this.armed = true;
    this.armTimer = 1800;
  }

  /** Returns true if a successful loop completed (entry then exit within window). */
  triggerExit(): boolean {
    if (this.armed) {
      this.armed = false;
      this.armTimer = 0;
      this.flash = 1;
      return true;
    }
    return false;
  }

  tick(dtMs: number) {
    if (this.armed) {
      this.armTimer -= dtMs;
      if (this.armTimer <= 0) this.armed = false;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 400);
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 14 + 18 * this.flash;
    ctx.strokeStyle = this.armed
      ? `rgba(255, 181, 71, ${0.85 + 0.15 * Math.sin(performance.now() / 80)})`
      : `rgba(255, 181, 71, ${0.55 + 0.4 * this.flash})`;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.path[0].x, this.path[0].y);
    for (let i = 1; i < this.path.length; i++) {
      ctx.lineTo(this.path[i].x, this.path[i].y);
    }
    ctx.stroke();

    // Entry/exit halos
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.entry.position.x, this.entry.position.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.exit.position.x, this.exit.position.y, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}
