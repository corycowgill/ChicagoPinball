import Matter from 'matter-js';
import { COLOR } from '../constants';
import { insertArrow, softShadow } from '../Graphics';

/** A scoop is a hole in the playfield that catches the ball, holds it for a
 *  beat (mode-start animation), then kicks it back into play. The visible
 *  shape is a metal-trimmed half-pipe with a glowing arrow above it. */
export class Scoop {
  readonly sensor: Matter.Body;
  /** When the ball is held inside, this is its body — for visual purposes we
   *  draw a "captured" indicator. */
  private captured: Matter.Body | null = null;
  private captureTimer = 0;
  private flash = 0;
  /** Direction (radians) the kicked ball is launched. */
  private readonly kickAngle: number;
  private readonly kickSpeed: number;

  constructor(
    public readonly x: number,
    public readonly y: number,
    kickAngle = -Math.PI / 2 - 0.25, // up and slightly left
    kickSpeed = 18,
    // The label used to be hardcoded 'scoop', which forced the Playfield to
    // reach in and re-label the lake scoop after construction. Taking it as a
    // parameter lets a layout describe the scoop completely.
    label = 'scoop',
  ) {
    this.kickAngle = kickAngle;
    this.kickSpeed = kickSpeed;
    this.sensor = Matter.Bodies.circle(x, y, 14, {
      isStatic: true,
      isSensor: true,
      label,
    });
  }

  /** Returns true if a new capture began on this contact. */
  capture(ball: Matter.Body): boolean {
    if (this.captured) return false;
    this.captured = ball;
    this.captureTimer = 0;
    this.flash = 1;
    // Park the ball at the scoop and freeze it.
    Matter.Body.setVelocity(ball, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(ball, 0);
    Matter.Body.setPosition(ball, { x: this.x, y: this.y + 4 });
    return true;
  }

  /** Tick the capture timer; returns the held ball + impulse vector when it's
   *  time to release, otherwise null. */
  tick(dtMs: number, holdMs: number): { ball: Matter.Body; vx: number; vy: number } | null {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 600);
    if (!this.captured) return null;
    this.captureTimer += dtMs;
    if (this.captureTimer < holdMs) {
      // Keep ball pinned at scoop (in case anything bumped it).
      Matter.Body.setPosition(this.captured, { x: this.x, y: this.y + 4 });
      Matter.Body.setVelocity(this.captured, { x: 0, y: 0 });
      return null;
    }
    const ball = this.captured;
    this.captured = null;
    this.captureTimer = 0;
    const vx = Math.cos(this.kickAngle) * this.kickSpeed;
    const vy = Math.sin(this.kickAngle) * this.kickSpeed;
    Matter.Body.setVelocity(ball, { x: vx, y: vy });
    return { ball, vx, vy };
  }

  isHoldingBall() {
    return this.captured !== null;
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Backlit arrow ABOVE the scoop pointing into it.
    insertArrow(ctx, this.x, this.y - 32, 12, Math.PI / 2, COLOR.INSERT_AMBER, true);

    // The scoop well — black hole with metal lip.
    softShadow(ctx, this.x, this.y + 6, 22, 14, 0.65);
    ctx.save();
    // Black inner pit
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, 17, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    // Metal lip around the rim
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR.METAL_MID;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, 17, 11, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLOR.METAL_LIGHT;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y - 1, 16, 9, 0, Math.PI, 0);
    ctx.stroke();

    // Held ball indicator
    if (this.captured) {
      ctx.fillStyle = 'rgba(255, 215, 100, 0.6)';
      ctx.shadowColor = COLOR.NEON_AMBER;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.flash > 0) {
      ctx.shadowColor = COLOR.NEON_AMBER;
      ctx.shadowBlur = 30 * this.flash;
      ctx.strokeStyle = `rgba(255, 200, 90, ${this.flash})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, 19 + this.flash * 8, 13 + this.flash * 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
