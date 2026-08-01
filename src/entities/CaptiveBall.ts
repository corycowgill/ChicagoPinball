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

  /** Inner width between the side walls, and the half-width out to the OUTER
   *  face of a side wall. Exposed so layout validation can check the lane's
   *  clearance to the shooter wall by reading the entity instead of copying
   *  these numbers — the copied-literal pattern is exactly what let the 3D
   *  rails and the physics rails drift apart. */
  static readonly LANE_W = 40;
  static readonly WALL_T = 6;
  static readonly OUTER_HALF = CaptiveBall.LANE_W / 2 + CaptiveBall.WALL_T;

  /** The strike aperture, as three numbers instead of three literals buried in
   *  the constructor: the stop posts' offset from the lane centre, their
   *  radius, and how far above the mouth the captive hangs.
   *
   *  Deliberately NOT `readonly`, and that is the point. These three numbers
   *  decide whether the captive is hittable at all, and the only honest way to
   *  choose them is to sweep them and measure — src/dev/captivereach.ts does
   *  that, rebuilding the world for each combination. A dev harness varying
   *  them is the intended use; the game never writes them. */
  /** Flush with the OUTER face of each lane wall (LANE_W/2 + WALL_T/2), so
   *  the posts trim the mouth without narrowing it. At ±20/r5 they pinched
   *  the opening to an 8px window for the ball's centre and the captive's own
   *  geometry rejected a third of every strike that reached it. Measured with
   *  tools/captivereach.mts, aperture band, 80 strikes: 63% -> 90%. */
  static POST_DX = CaptiveBall.LANE_W / 2 + CaptiveBall.WALL_T / 2;
  static POST_R = 4;
  /** Captive centre height ABOVE the mouth plane when hanging at rest. Six,
   *  not twelve: the captive's underside then sits just BELOW the mouth
   *  plane, so a ball strikes it on arrival instead of having to travel up
   *  into the lane first. Worth 5 points of make rate on its own. */
  static REST_DY = 6;

  /** x,y = centre of the OPEN mouth at the bottom of the lane. */
  constructor(public readonly x: number, public readonly y: number) {
    const laneW = CaptiveBall.LANE_W; // inner width between the side walls
    const laneTop = y - 74;
    const anchorY = laneTop + 8;
    const restY = y - CaptiveBall.REST_DY; // captive centre hanging at rest

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

    const t = CaptiveBall.WALL_T;
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
    // Stop posts at the mouth — decorative trim, not a pinch. The clearance
    // they leave has been wrong twice: at ±17/r6 it was exactly 0px and the
    // solver absorbed every shot; ±20/r5 left 4px a side, which sounds fine
    // and still rejected 37% of strikes that reached the mouth. They now sit
    // flush with the lane walls, so the mouth is as wide as the lane. The
    // tether, not the posts, is what keeps the captive in its lane.
    const postR = CaptiveBall.POST_R;
    const postDx = CaptiveBall.POST_DX;
    this.posts = postR > 0
      ? [
          { x: x - postDx, y, r: postR },
          { x: x + postDx, y, r: postR },
        ]
      : [];
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
