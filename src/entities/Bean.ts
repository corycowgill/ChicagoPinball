import Matter from 'matter-js';
import { COLOR, LOCKS_FOR_MULTIBALL } from '../constants';
import { softShadow, insertCircle } from '../Graphics';

/** Cloud Gate ("The Bean") at the centre of the upper playfield. Doubles as
 *  the **multiball lock**: a ball that hits the Bean's hole at the base is
 *  captured. Three captures arms multiball; the next captured ball releases
 *  all three back into play. The visible Bean itself is a polished chrome
 *  ellipsoid; the lock entrance is a small dark slot at its base. */
export class Bean {
  /** Hard chrome shell — ball bounces off the upper part of the dome. */
  readonly body: Matter.Body;
  /** The lock-saucer sensor at the base of the bean. */
  readonly lockSensor: Matter.Body;
  readonly radius: number;
  locked = 0;
  private flash = 0;

  constructor(public readonly cx: number, public readonly cy: number, radius = 38) {
    this.radius = radius;
    this.body = Matter.Bodies.circle(cx, cy, radius, {
      isStatic: true,
      restitution: 1.05,
      friction: 0,
      label: 'bean',
    });
    // Lock saucer just BELOW the bean body. Previously the sensor was
    // placed inside the bean's collision area (cy + radius - 4) — the
    // ball would bounce off the bean's chrome dome and never reach the
    // sensor. Now it sits at cy + radius + 8 so a ball travelling along
    // the bean's underside actually trips it.
    this.lockSensor = Matter.Bodies.circle(cx, cy + radius + 8, 11, {
      isStatic: true,
      isSensor: true,
      label: 'bean-lock',
    });
  }

  pop(ball: Matter.Body) {
    const dx = ball.position.x - this.cx;
    const dy = ball.position.y - this.cy;
    const len = Math.hypot(dx, dy) || 1;
    const force = 0.05 * ball.mass;
    Matter.Body.applyForce(ball, ball.position, {
      x: (dx / len) * force,
      y: (dy / len) * force,
    });
    this.flash = 1;
  }

  /** Returns true if the lock accepted this ball. */
  tryLock(): boolean {
    if (this.locked >= LOCKS_FOR_MULTIBALL) return false;
    this.locked++;
    this.flash = 1;
    return true;
  }

  releaseLocks() {
    this.locked = 0;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 280);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const r = this.radius;
    const x = this.cx;
    const y = this.cy;

    // Drop shadow
    softShadow(ctx, x, y + r * 0.85, r * 1.15, r * 0.5, 0.7);

    ctx.save();
    if (this.flash > 0.01) {
      const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.6);
      halo.addColorStop(0, `rgba(150, 200, 255, ${0.55 * this.flash})`);
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Chrome dome
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

    // Sky-reflection cap on the upper half.
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

    // Equator mirror seam.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(x - r * 0.1, y - r * 0.18, r * 0.65, r * 0.2, -0.18, 0, Math.PI * 2);
    ctx.stroke();

    // City reflection lower half.
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

    // Specular pip.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.32, y - r * 0.55, r * 0.18, r * 0.10, 0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Lock saucer BELOW the bean (matches the lockSensor position) — a
    // dark hole with chrome rim where the ball enters to be locked.
    const slotX = x;
    const slotY = y + r + 8;
    ctx.save();
    softShadow(ctx, slotX, slotY + 4, 14, 8, 0.6);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(slotX, slotY, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLOR.METAL_MID;
    ctx.beginPath();
    ctx.ellipse(slotX, slotY, 12, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLOR.METAL_LIGHT;
    ctx.beginPath();
    ctx.ellipse(slotX, slotY - 1, 11, 5, 0, Math.PI, 0);
    ctx.stroke();
    ctx.restore();

    // Lock indicator lights — three dots above the bean (LOCK 1 / 2 / 3).
    ctx.save();
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = this.locked >= LOCKS_FOR_MULTIBALL ? COLOR.INSERT_AMBER : 'rgba(255, 255, 255, 0.55)';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.fillText('BEAN LOCK', x, y - r - 18);
    ctx.shadowBlur = 0;
    for (let i = 0; i < LOCKS_FOR_MULTIBALL; i++) {
      const lx = x - 14 + i * 14;
      const ly = y - r - 6;
      insertCircle(ctx, lx, ly, 5, COLOR.INSERT_RED, i < this.locked);
    }
    ctx.restore();
  }
}
