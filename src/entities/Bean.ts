import Matter from 'matter-js';
import { COLOR } from '../constants';

/** The Cloud Gate "Bean" — a chrome dome at the top of the playfield. */
export class Bean {
  readonly body: Matter.Body;
  readonly radius: number;
  private flash = 0;

  constructor(x: number, y: number, radius = 56) {
    this.radius = radius;
    this.body = Matter.Bodies.circle(x, y, radius, {
      isStatic: true,
      restitution: 1.0,
      friction: 0,
      label: 'bean',
    });
  }

  pop(ball: Matter.Body) {
    const dx = ball.position.x - this.body.position.x;
    const dy = ball.position.y - this.body.position.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const force = 0.05 * ball.mass;
    Matter.Body.applyForce(ball, ball.position, { x: nx * force, y: ny * force });
    this.flash = 1;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 220);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y } = this.body.position;
    const r = this.radius;
    ctx.save();

    // Soft halo
    const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 1.6);
    halo.addColorStop(0, `rgba(150, 220, 255, ${0.18 + 0.25 * this.flash})`);
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Chrome dome
    ctx.shadowColor = '#9fc4ff';
    ctx.shadowBlur = 18 + 18 * this.flash;
    const grad = ctx.createRadialGradient(x - r * 0.45, y - r * 0.55, 1, x, y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, COLOR.BEAN);
    grad.addColorStop(0.7, '#7a8aa6');
    grad.addColorStop(1, COLOR.BEAN_DARK);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Reflection band
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x - r * 0.15, y - r * 0.2, r * 0.55, r * 0.18, -0.2, 0, Math.PI * 2);
    ctx.stroke();

    // Bottom shadow notch
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.65, r * 0.7, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
