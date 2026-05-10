import Matter from 'matter-js';
import { COLOR } from '../constants';

export class PopBumper {
  readonly body: Matter.Body;
  readonly radius: number;
  private flash = 0; // 0..1 fades each frame
  private color: string;

  constructor(x: number, y: number, radius = 22, color = COLOR.NEON_AMBER, label = 'pop-bumper') {
    this.radius = radius;
    this.color = color;
    this.body = Matter.Bodies.circle(x, y, radius, {
      isStatic: true,
      restitution: 0.9,
      friction: 0,
      label,
    });
  }

  /** Apply outward impulse to ball on collision. Call from collision handler. */
  pop(ball: Matter.Body) {
    const dx = ball.position.x - this.body.position.x;
    const dy = ball.position.y - this.body.position.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const force = 0.04 * ball.mass;
    Matter.Body.applyForce(ball, ball.position, { x: nx * force, y: ny * force });
    this.flash = 1;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 200);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y } = this.body.position;
    ctx.save();
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 18 + 22 * this.flash;

    // outer glow ring
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 3 + 3 * this.flash;
    ctx.beginPath();
    ctx.arc(x, y, this.radius, 0, Math.PI * 2);
    ctx.stroke();

    // inner cap
    const grad = ctx.createRadialGradient(x - this.radius * 0.3, y - this.radius * 0.4, 1, x, y, this.radius);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, this.color);
    grad.addColorStop(1, '#1a1a2a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, this.radius * 0.65, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
