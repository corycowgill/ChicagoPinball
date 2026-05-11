import Matter from 'matter-js';
import { COLOR } from '../constants';
import { softShadow } from '../Graphics';

/** Cloud Gate ("The Bean") at the top of the playfield. Rendered as a
 *  polished chrome ellipsoid with a sky reflection on top, an environmental
 *  reflection band, and the playfield reflected as a darker tone underneath. */
export class Bean {
  readonly body: Matter.Body;
  readonly radius: number;
  private flash = 0;

  constructor(x: number, y: number, radius = 62) {
    this.radius = radius;
    this.body = Matter.Bodies.circle(x, y, radius, {
      isStatic: true,
      restitution: 1.05,
      friction: 0,
      label: 'bean',
    });
  }

  pop(ball: Matter.Body) {
    const dx = ball.position.x - this.body.position.x;
    const dy = ball.position.y - this.body.position.y;
    const len = Math.hypot(dx, dy) || 1;
    const force = 0.06 * ball.mass;
    Matter.Body.applyForce(ball, ball.position, {
      x: (dx / len) * force,
      y: (dy / len) * force,
    });
    this.flash = 1;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 240);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y } = this.body.position;
    const r = this.radius;
    ctx.save();

    // Soft drop-shadow on the playfield underneath.
    softShadow(ctx, x, y + r * 0.85, r * 1.15, r * 0.45, 0.65);

    // Outer halo when flashing
    if (this.flash > 0.01) {
      const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.55);
      halo.addColorStop(0, `rgba(150, 200, 255, ${0.5 * this.flash})`);
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // Chrome body — base radial gradient (top-lit, dark below).
    const body = ctx.createRadialGradient(x - r * 0.4, y - r * 0.55, 1, x, y, r);
    body.addColorStop(0, COLOR.BEAN_HI);
    body.addColorStop(0.18, '#e0e6ee');
    body.addColorStop(0.55, COLOR.BEAN_MID);
    body.addColorStop(0.85, '#5a6580');
    body.addColorStop(1, COLOR.BEAN_LOW);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Sky-reflection cap on the upper third (very bright blue-white smear).
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    const sky = ctx.createLinearGradient(x, y - r, x, y - r * 0.1);
    sky.addColorStop(0, 'rgba(180, 220, 255, 0.85)');
    sky.addColorStop(0.6, 'rgba(180, 220, 255, 0.18)');
    sky.addColorStop(1, 'rgba(180, 220, 255, 0)');
    ctx.fillStyle = sky;
    ctx.fillRect(x - r, y - r, r * 2, r);
    ctx.restore();

    // Mirror-line — the seam where the sky meets the city in the real Bean.
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x - r * 0.1, y - r * 0.15, r * 0.65, r * 0.18, -0.18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // City-reflection band (warmer tones, lower half).
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    const city = ctx.createLinearGradient(x, y, x, y + r);
    city.addColorStop(0, 'rgba(80, 100, 130, 0)');
    city.addColorStop(0.6, 'rgba(40, 50, 70, 0.4)');
    city.addColorStop(1, 'rgba(15, 20, 35, 0.7)');
    ctx.fillStyle = city;
    ctx.fillRect(x - r, y, r * 2, r);
    ctx.restore();

    // Specular pip
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.32, y - r * 0.55, r * 0.18, r * 0.10, 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Dark ground notch under the dome.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.78, r * 0.85, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
