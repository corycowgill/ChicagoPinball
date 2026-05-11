import Matter from 'matter-js';
import { COLOR } from '../constants';
import { metalPost, softShadow } from '../Graphics';

/** A captive ball: a real Matter ball constrained to a short horizontal lane.
 *  The player's ball strikes it through the lane's open side, momentum
 *  transfers, and each hit registers a score. */
export class CaptiveBall {
  readonly ball: Matter.Body;
  readonly walls: Matter.Body[] = [];
  private flash = 0;

  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly laneLen = 60,
  ) {
    // The captive ball itself.
    this.ball = Matter.Bodies.circle(x + laneLen / 2 - 14, y, 11, {
      restitution: 0.85,
      friction: 0.005,
      frictionAir: 0.02,
      density: 0.0024,
      label: 'captive-ball',
    });

    // End walls of the lane (left + right) and a top rail. The bottom is the
    // open side facing the playfield.
    const t = 6;
    this.walls.push(
      Matter.Bodies.rectangle(x - laneLen / 2, y, t, 28, {
        isStatic: true,
        label: 'wall',
      }),
    );
    this.walls.push(
      Matter.Bodies.rectangle(x + laneLen / 2, y, t, 28, {
        isStatic: true,
        label: 'wall',
      }),
    );
    this.walls.push(
      Matter.Bodies.rectangle(x, y - 14, laneLen, t, {
        isStatic: true,
        label: 'wall',
      }),
    );
  }

  pulseFlash() {
    this.flash = 1;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 250);
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Lane background — a recessed slot
    softShadow(ctx, this.x, this.y + 8, this.laneLen / 2 + 4, 14, 0.5);
    ctx.save();
    const grad = ctx.createLinearGradient(this.x, this.y - 12, this.x, this.y + 12);
    grad.addColorStop(0, '#0a1124');
    grad.addColorStop(0.5, '#020308');
    grad.addColorStop(1, '#0a1124');
    ctx.fillStyle = grad;
    ctx.fillRect(this.x - this.laneLen / 2, this.y - 12, this.laneLen, 24);

    // Lane edge highlights
    ctx.strokeStyle = COLOR.METAL_DARK;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(this.x - this.laneLen / 2, this.y - 12, this.laneLen, 24);
    ctx.restore();

    // Posts at the open corners (visible posts that hold the rubber-bumpered
    // opening on a real captive-ball lane).
    metalPost(ctx, this.x - this.laneLen / 2 - 2, this.y + 14, 5);
    metalPost(ctx, this.x + this.laneLen / 2 + 2, this.y + 14, 5);

    // Captive ball
    const bx = this.ball.position.x;
    const by = this.ball.position.y;
    softShadow(ctx, bx + 1, by + 4, 9, 6, 0.55);
    ctx.save();
    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 10 + 18 * this.flash;
    const bg = ctx.createRadialGradient(bx - 4, by - 5, 1, bx, by, 11);
    bg.addColorStop(0, COLOR.BALL_HI);
    bg.addColorStop(0.55, COLOR.BALL);
    bg.addColorStop(1, COLOR.BALL_DARK);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(bx, by, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Label
    ctx.save();
    ctx.fillStyle = this.flash > 0.05 ? COLOR.INSERT_AMBER : COLOR.TEXT_DIM;
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CAPTIVE', this.x, this.y - 18);
    ctx.restore();
  }
}
