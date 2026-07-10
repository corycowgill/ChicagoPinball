import Matter from 'matter-js';
import { COLOR } from '../constants';
import { metalPost, softShadow } from '../Graphics';

/** A captive ball in a short vertical lane along the right side of the
 *  playfield. The lane is open at the bottom except for two stop posts:
 *  the captive rests on them, the player's ball strikes it from below
 *  through the gap, and neither ball can pass the posts. A pin constraint
 *  to the top of the lane (a short pendulum) guarantees the captive can
 *  never leave the lane even under a violent hit. */
export class CaptiveBall {
  readonly ball: Matter.Body;
  readonly walls: Matter.Body[] = [];
  readonly tether: Matter.Constraint;
  /** Stop-post positions (drawn as chrome posts). */
  readonly posts: { x: number; y: number; r: number }[];
  private flash = 0;

  /** x,y = centre of the OPEN mouth at the bottom of the lane. */
  constructor(public readonly x: number, public readonly y: number) {
    const laneW = 40; // inner width between the side walls
    const laneTop = y - 74;
    const anchorY = laneTop + 8;
    const restY = y - 12; // captive centre when resting on the posts

    this.ball = Matter.Bodies.circle(x, restY, 10, {
      restitution: 0.4,
      friction: 0.01,
      frictionAir: 0.03,
      density: 0.0024,
      label: 'captive-ball',
    });
    // Pendulum tether from the lane top — the hard guarantee that the
    // captive stays in its lane no matter what hits it.
    this.tether = Matter.Constraint.create({
      pointA: { x, y: anchorY },
      bodyB: this.ball,
      pointB: { x: 0, y: 0 },
      length: restY - anchorY,
      stiffness: 0.9,
      damping: 0.06,
    });

    const t = 6;
    const wallLen = y - laneTop - 4;
    this.walls.push(
      Matter.Bodies.rectangle(x - laneW / 2 - t / 2, laneTop + wallLen / 2, t, wallLen, {
        isStatic: true,
        label: 'wall',
      }),
      Matter.Bodies.rectangle(x + laneW / 2 + t / 2, laneTop + wallLen / 2, t, wallLen, {
        isStatic: true,
        label: 'wall',
      }),
      Matter.Bodies.rectangle(x, laneTop - t / 2, laneW + 2 * t, t, {
        isStatic: true,
        label: 'wall',
      }),
    );
    // Stop posts at the mouth. Gap between their surfaces ≈ ball diameter,
    // so the captive rests wedged on them and the striking ball can touch
    // it but can't squeeze into the lane.
    const postR = 6;
    this.posts = [
      { x: x - 17, y, r: postR },
      { x: x + 17, y, r: postR },
    ];
    for (const p of this.posts) {
      this.walls.push(
        Matter.Bodies.circle(p.x, p.y, p.r, { isStatic: true, label: 'wall' }),
      );
    }
  }

  pulseFlash() {
    this.flash = 1;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 250);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const laneW = 40;
    const laneTop = this.y - 74;
    const laneH = this.y - laneTop;

    // Recessed lane slot.
    softShadow(ctx, this.x, this.y - laneH / 2, laneW / 2 + 8, laneH / 2, 0.5);
    ctx.save();
    const grad = ctx.createLinearGradient(this.x - laneW / 2, 0, this.x + laneW / 2, 0);
    grad.addColorStop(0, '#0a1124');
    grad.addColorStop(0.5, '#020308');
    grad.addColorStop(1, '#0a1124');
    ctx.fillStyle = grad;
    ctx.fillRect(this.x - laneW / 2, laneTop, laneW, laneH);
    ctx.strokeStyle = COLOR.METAL_DARK;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(this.x - laneW / 2, laneTop, laneW, laneH);
    ctx.restore();

    // Captive ball.
    const bx = this.ball.position.x;
    const by = this.ball.position.y;
    softShadow(ctx, bx + 1, by + 4, 9, 6, 0.55);
    ctx.save();
    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 8 + 18 * this.flash;
    const bg = ctx.createRadialGradient(bx - 4, by - 5, 1, bx, by, 10);
    bg.addColorStop(0, COLOR.BALL_HI);
    bg.addColorStop(0.55, COLOR.BALL);
    bg.addColorStop(1, COLOR.BALL_DARK);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(bx, by, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Stop posts at the mouth.
    for (const p of this.posts) metalPost(ctx, p.x, p.y, p.r);
  }
}
