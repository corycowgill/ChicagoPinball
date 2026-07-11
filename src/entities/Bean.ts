import Matter from 'matter-js';
import { COLOR, LOCKS_FOR_MULTIBALL } from '../constants';
import { softShadow, insertCircle } from '../Graphics';

/** Cloud Gate ("The Bean") at the centre of the upper playfield. Doubles as
 *  the **multiball lock**: every Nth bean hit (HITS_PER_LOCK = 4) captures a
 *  ball. After three captures multiball starts. Earlier the lock was a
 *  separate sensor under the bean dome, but the dome's collision body sat
 *  in front of it — a ball couldn't physically reach the sensor without
 *  going through the bean. Now the bean ITSELF counts hits and decides
 *  when to lock, so the mechanic actually triggers during normal play. */
export class Bean {
  /** Hard chrome shell — ball bounces off the dome. */
  readonly body: Matter.Body;
  readonly radius: number;
  locked = 0;
  private hitsSinceLastLock = 0;
  // 2 hits per lock × 3 locks = 6 Bean hits to multiball. (4 per lock made
  // multiball a 12-hit grind nobody reached.)
  static readonly HITS_PER_LOCK = 2;
  private flash = 0;

  constructor(public readonly cx: number, public readonly cy: number, radius = 38) {
    this.radius = radius;
    this.body = Matter.Bodies.circle(cx, cy, radius, {
      isStatic: true,
      restitution: 1.05,
      friction: 0,
      label: 'bean',
    });
  }

  /** Returns true if THIS hit should also count as a lock. The caller is
   *  responsible for removing the player ball + advancing lock state. */
  registerHit(): boolean {
    if (this.locked >= LOCKS_FOR_MULTIBALL) {
      // All slots filled — bean is just a bumper until multiball releases.
      return false;
    }
    this.hitsSinceLastLock++;
    if (this.hitsSinceLastLock >= Bean.HITS_PER_LOCK) {
      this.hitsSinceLastLock = 0;
      this.locked++;
      this.flash = 1;
      return true;
    }
    return false;
  }

  pop(ball: Matter.Body) {
    const dx = ball.position.x - this.cx;
    const dy = ball.position.y - this.cy;
    const len = Math.hypot(dx, dy) || 1;
    // Direct velocity impulse (applyForce loses strength under substepping).
    const kick = 12;
    const v = Matter.Body.getVelocity(ball);
    Matter.Body.setVelocity(ball, {
      x: v.x + (dx / len) * kick,
      y: v.y + (dy / len) * kick,
    });
    this.flash = 1;
  }

  releaseLocks() {
    this.locked = 0;
    this.hitsSinceLastLock = 0;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 280);
  }

  /** `boss` dresses the dome as Capone's hideout during the SHOWDOWN. */
  draw(ctx: CanvasRenderingContext2D, boss = false) {
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

    if (boss) {
      // Capone's fedora perched on the dome + red hat band.
      ctx.save();
      const hatY = y - r + 2;
      ctx.fillStyle = '#14161c';
      // Brim
      ctx.beginPath();
      ctx.ellipse(x, hatY, r * 0.95, r * 0.3, -0.08, 0, Math.PI * 2);
      ctx.fill();
      // Crown
      ctx.beginPath();
      ctx.moveTo(x - r * 0.55, hatY - 2);
      ctx.quadraticCurveTo(x - r * 0.5, hatY - r * 0.85, x - r * 0.15, hatY - r * 0.9);
      ctx.quadraticCurveTo(x + r * 0.45, hatY - r * 0.95, x + r * 0.55, hatY - 4);
      ctx.closePath();
      ctx.fill();
      // Band
      ctx.fillStyle = '#a01522';
      ctx.fillRect(x - r * 0.52, hatY - r * 0.34, r * 1.06, r * 0.2);
      ctx.restore();

      // Name plate.
      ctx.save();
      ctx.font = 'bold 10px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = COLOR.INSERT_RED;
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('CAPONE', x, y - r - 20);
      ctx.restore();
      return;
    }

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
