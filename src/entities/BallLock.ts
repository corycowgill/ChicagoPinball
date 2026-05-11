import Matter from 'matter-js';
import { COLOR, LOCKS_FOR_MULTIBALL } from '../constants';
import { insertCircle, softShadow } from '../Graphics';

/** A vertical bank of three lock holes. A ball that enters while a lock is
 *  available is captured (removed from play and a new one served). When all
 *  three are full, multiball begins and the held balls are released. */
export class BallLock {
  readonly sensor: Matter.Body;
  /** Number of balls currently locked. */
  locked = 0;

  constructor(public readonly x: number, public readonly y: number) {
    this.sensor = Matter.Bodies.circle(x, y, 18, {
      isStatic: true,
      isSensor: true,
      label: 'lock',
    });
  }

  /** Try to lock the ball. Returns true if locked (caller should remove the
   *  ball from play). False if the lock is already full. */
  tryLock(_ball: Matter.Body): boolean {
    if (this.locked >= LOCKS_FOR_MULTIBALL) return false;
    this.locked++;
    return true;
  }

  /** Reset locked count — used when multiball starts. */
  release() {
    this.locked = 0;
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Three lock indicators stacked vertically above the lock hole.
    const indicatorY0 = this.y - 60;
    for (let i = 0; i < LOCKS_FOR_MULTIBALL; i++) {
      const ix = this.x;
      const iy = indicatorY0 + i * 18;
      const lit = i < this.locked;
      insertCircle(ctx, ix, iy, 6, lit ? COLOR.INSERT_RED : COLOR.INSERT_RED, lit);
    }
    // "LOCK" label
    ctx.save();
    ctx.fillStyle = this.locked >= LOCKS_FOR_MULTIBALL ? COLOR.INSERT_RED : COLOR.TEXT_DIM;
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LOCK', this.x, indicatorY0 - 12);
    ctx.restore();

    // Hole itself.
    softShadow(ctx, this.x, this.y + 6, 22, 14, 0.6);
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, 18, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR.METAL_MID;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, 18, 12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLOR.METAL_LIGHT;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y - 1, 17, 10, 0, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
  }
}
