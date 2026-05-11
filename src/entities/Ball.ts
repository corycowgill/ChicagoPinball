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

    // Ground shadow (more elliptical = ball is closer to playfield)
    ctx.save();
    const sh = ctx.createRadialGradient(x + 1, y + r * 0.7, 0, x + 1, y + r * 0.7, r * 1.4);
    sh.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    sh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(x + 1.5, y + r * 0.85, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Chrome ball
    ctx.save();
    const grad = ctx.createRadialGradient(x - r * 0.4, y - r * 0.55, 1, x, y, r);
    grad.addColorStop(0, COLOR.BALL_HI);
    grad.addColorStop(0.45, COLOR.BALL);
    grad.addColorStop(0.85, '#7a849c');
    grad.addColorStop(1, COLOR.BALL_DARK);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Specular pip
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y - r * 0.5, r * 0.22, r * 0.13, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Faint reflection-line at the equator
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.05, r * 0.85, r * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
