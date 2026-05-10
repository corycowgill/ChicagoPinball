import Matter from 'matter-js';
import { COLOR, PLUNGER_KICK } from '../constants';

/**
 * Vertical plunger in the right launch lane. We don't simulate it as a spring;
 * we just track a "pull" amount while space is held and apply an upward impulse
 * to a ball resting on top when released.
 */
export class Plunger {
  readonly body: Matter.Body;
  readonly width: number;
  readonly height = 32;
  private restY: number;
  private pull = 0;     // 0..1
  private holding = false;

  constructor(x: number, y: number, width = 46) {
    this.restY = y;
    this.width = width;
    this.body = Matter.Bodies.rectangle(x, y, this.width, this.height, {
      isStatic: true,
      label: 'plunger',
      chamfer: { radius: 4 },
    });
  }

  hold() {
    this.holding = true;
  }

  /** Returns the impulse magnitude applied (0 if not released from a pull). */
  release(): number {
    if (!this.holding) return 0;
    const force = this.pull * PLUNGER_KICK;
    this.holding = false;
    this.pull = 0;
    return force;
  }

  /** Plunger body stays fixed at restY (static bodies don't drag dynamic ones
   *  along in Matter.js, so animating its position would just drop the ball
   *  through it). We only track the pull amount for kick power + the visual. */
  tick(dtMs: number) {
    if (this.holding) {
      this.pull = Math.min(1, this.pull + dtMs / 800);
    } else {
      this.pull = 0;
    }
  }

  isHolding() {
    return this.holding;
  }

  pullAmount() {
    return this.pull;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y } = this.body.position;
    const w = this.width;
    const h = this.height;
    ctx.save();

    // Pull-strength gauge below the plunger (since the body itself doesn't move).
    const gaugeH = 70;
    const gaugeTop = y + h / 2 + 8;
    ctx.fillStyle = 'rgba(20, 28, 48, 0.7)';
    ctx.fillRect(x - 4, gaugeTop, 8, gaugeH);
    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLOR.NEON_AMBER;
    const fillH = gaugeH * this.pull;
    ctx.fillRect(x - 3, gaugeTop + (gaugeH - fillH), 6, fillH);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 181, 71, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 4, gaugeTop, 8, gaugeH);

    // Plunger head
    ctx.shadowColor = COLOR.NEON_PINK;
    ctx.shadowBlur = 14;
    const grad = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y);
    grad.addColorStop(0, '#a01a32');
    grad.addColorStop(0.5, COLOR.NEON_PINK);
    grad.addColorStop(1, '#a01a32');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
    ctx.fill();

    // Subtle highlight bar across the head.
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(x - w / 2 + 4, y - h / 2 + 4, w - 8, 2);

    ctx.restore();
  }
}
