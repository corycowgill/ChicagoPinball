import Matter from 'matter-js';
import { COLOR, PLUNGER_KICK, PLUNGER_MAX_PULL } from '../constants';

/**
 * Vertical plunger in the right launch lane. We don't simulate it as a spring;
 * we just track a "pull" amount while space is held and apply an upward impulse
 * to a ball resting on top when released.
 */
export class Plunger {
  readonly body: Matter.Body;
  readonly width = 26;
  readonly height = 36;
  private restY: number;
  private pull = 0;     // 0..1
  private holding = false;

  constructor(x: number, y: number) {
    this.restY = y;
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
    Matter.Body.setPosition(this.body, { x: this.body.position.x, y: this.restY });
    return force;
  }

  tick(dtMs: number) {
    if (this.holding) {
      this.pull = Math.min(1, this.pull + dtMs / 800);
    } else {
      this.pull = 0;
    }
    const offset = this.pull * PLUNGER_MAX_PULL;
    Matter.Body.setPosition(this.body, {
      x: this.body.position.x,
      y: this.restY + offset,
    });
  }

  isHolding() {
    return this.holding;
  }

  pullAmount() {
    return this.pull;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y } = this.body.position;
    ctx.save();
    // Shaft tracks from rest position upward
    ctx.strokeStyle = '#3b4663';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, this.restY - PLUNGER_MAX_PULL - 8);
    ctx.lineTo(x, y);
    ctx.stroke();

    // Plunger head
    ctx.shadowColor = COLOR.NEON_PINK;
    ctx.shadowBlur = 14;
    const grad = ctx.createLinearGradient(x - 14, y, x + 14, y);
    grad.addColorStop(0, '#a01a32');
    grad.addColorStop(0.5, COLOR.NEON_PINK);
    grad.addColorStop(1, '#a01a32');
    ctx.fillStyle = grad;
    const w = this.width;
    const h = this.height;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
    ctx.fill();

    // Pull indicator
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(x - 1, y - h / 2 + 4, 2, (h - 8) * (1 - this.pull) + 1);

    ctx.restore();
  }
}
