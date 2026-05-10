import Matter from 'matter-js';
import { BALL_RADIUS, BALL_MAX_SPEED, COLOR } from '../constants';

export class Ball {
  readonly body: Matter.Body;

  constructor(x: number, y: number) {
    this.body = Matter.Bodies.circle(x, y, BALL_RADIUS, {
      restitution: 0.42,
      friction: 0.005,
      frictionAir: 0.0008,
      density: 0.0024,
      label: 'ball',
      slop: 0.01,
    });
  }

  capVelocity() {
    const v = this.body.velocity;
    const mag = Math.hypot(v.x, v.y);
    if (mag > BALL_MAX_SPEED) {
      const s = BALL_MAX_SPEED / mag;
      Matter.Body.setVelocity(this.body, { x: v.x * s, y: v.y * s });
    }
  }

  setPosition(x: number, y: number) {
    Matter.Body.setPosition(this.body, { x, y });
    Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(this.body, 0);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y } = this.body.position;
    const r = BALL_RADIUS;

    ctx.save();
    ctx.shadowColor = COLOR.NEON_CYAN;
    ctx.shadowBlur = 14;

    const grad = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, 1, x, y, r);
    grad.addColorStop(0, COLOR.BALL_HIGHLIGHT);
    grad.addColorStop(0.55, COLOR.BALL);
    grad.addColorStop(1, '#5a6478');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
