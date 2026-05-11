import Matter from 'matter-js';
import { COLOR } from '../constants';
import { strokePlasticRamp, strokeMetalPath, insertArrow } from '../Graphics';

/** A real raised ramp: an entry sensor at the bottom, an exit sensor at the
 *  top, a curved translucent plastic plate connecting them, and a return
 *  habitrail back to an inlane. When a ball enters the entry sensor moving
 *  upward with sufficient speed, it's teleported to the exit and given a
 *  velocity matching the habitrail return direction. */
export class Ramp {
  readonly entry: Matter.Body;
  readonly exit: Matter.Body;
  readonly plate: { x: number; y: number }[];
  readonly habitrail: { x: number; y: number }[];
  readonly returnVel: { x: number; y: number };
  readonly color: string;
  readonly arrowAt: { x: number; y: number };
  readonly arrowAngle: number;
  readonly label: string;
  readonly themeText: string;
  /** Minimum upward speed (px/step) for the ball to "make" the ramp. */
  readonly minSpeed: number;
  private flash = 0;

  constructor(opts: {
    entry: { x: number; y: number };
    exit: { x: number; y: number };
    plate: { x: number; y: number }[];
    habitrail: { x: number; y: number }[];
    returnVel: { x: number; y: number };
    color: string;
    arrowAt: { x: number; y: number };
    arrowAngle: number;
    label: string;
    themeText: string;
    minSpeed?: number;
  }) {
    this.entry = Matter.Bodies.circle(opts.entry.x, opts.entry.y, 16, {
      isStatic: true,
      isSensor: true,
      label: `${opts.label}-entry`,
    });
    this.exit = Matter.Bodies.circle(opts.exit.x, opts.exit.y, 14, {
      isStatic: true,
      isSensor: true,
      label: `${opts.label}-exit`,
    });
    this.plate = opts.plate;
    this.habitrail = opts.habitrail;
    this.returnVel = opts.returnVel;
    this.color = opts.color;
    this.arrowAt = opts.arrowAt;
    this.arrowAngle = opts.arrowAngle;
    this.label = opts.label;
    this.themeText = opts.themeText;
    this.minSpeed = opts.minSpeed ?? 9;
  }

  /** Try to "make" the ramp shot. If the ball's velocity is upward and fast
   *  enough, it's teleported to the exit and the ball's velocity is set to
   *  the habitrail return velocity. Returns true on a made shot. */
  tryMake(ball: Matter.Body): boolean {
    if (ball.velocity.y > -this.minSpeed) return false;
    Matter.Body.setPosition(ball, { x: this.exit.position.x, y: this.exit.position.y });
    Matter.Body.setVelocity(ball, { x: this.returnVel.x, y: this.returnVel.y });
    Matter.Body.setAngularVelocity(ball, 0);
    this.flash = 1;
    return true;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 600);
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Glow when freshly made.
    const alpha = 0.5 + this.flash * 0.4;
    strokePlasticRamp(ctx, this.plate, this.color, 38, alpha);
    // Habitrail return rail (chrome).
    strokeMetalPath(ctx, this.habitrail, 5);
    // Backlit arrow at the entry pointing up the ramp.
    insertArrow(ctx, this.arrowAt.x, this.arrowAt.y, 14, this.arrowAngle, this.color, true);
    // Theme text inside the ramp plate.
    ctx.save();
    const mid = this.plate[Math.floor(this.plate.length / 2)];
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.themeText, mid.x, mid.y);
    ctx.restore();
  }
}
