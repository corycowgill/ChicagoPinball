import Matter from 'matter-js';
import { strokePlasticRamp, strokeMetalPath, insertArrow } from '../Graphics';

interface Pt {
  x: number;
  y: number;
}

/** A raised ramp: an entry sensor at the mouth, a translucent plastic plate
 *  curving up the side of the playfield, and a chrome habitrail carrying the
 *  ball back down to an inlane. A ball entering the mouth with enough upward
 *  speed is carried along the FULL drawn path (plate + habitrail) by the
 *  Playfield's transit system, so what the player sees is what the ball
 *  actually does. */
export class Ramp {
  readonly entry: Matter.Body;
  readonly plate: Pt[];
  readonly habitrail: Pt[];
  /** plate + habitrail joined — the path a made ball travels. */
  readonly fullPath: Pt[];
  /** Velocity handed to the ball when it leaves the habitrail. */
  readonly exitVel: Pt;
  readonly color: string;
  readonly arrowAt: Pt;
  readonly arrowAngle: number;
  readonly label: string;
  readonly themeText: string;
  /** Minimum upward speed (px/step) for the ball to "make" the ramp. */
  readonly minSpeed: number;
  private flash = 0;

  constructor(opts: {
    plate: Pt[];
    habitrail: Pt[];
    exitVel: Pt;
    color: string;
    arrowAngle: number;
    label: string;
    themeText: string;
    minSpeed?: number;
  }) {
    const mouth = opts.plate[0];
    // r16: a whisker more generous than the old 15 — near-misses that
    // clipped the funnel post now catch the mouth.
    this.entry = Matter.Bodies.circle(mouth.x, mouth.y, 16, {
      isStatic: true,
      isSensor: true,
      label: `${opts.label}-entry`,
    });
    this.plate = opts.plate;
    this.habitrail = opts.habitrail;
    this.fullPath = [...opts.plate, ...opts.habitrail.slice(1)];
    this.exitVel = opts.exitVel;
    this.color = opts.color;
    this.arrowAt = { x: mouth.x, y: mouth.y + 34 };
    this.arrowAngle = opts.arrowAngle;
    this.label = opts.label;
    this.themeText = opts.themeText;
    // 4.5 (was 6): a firm-but-not-perfect flip makes the ramp — misses
    // now mean genuinely soft shots, and those get the flap reject.
    this.minSpeed = opts.minSpeed ?? 4.5;
  }

  /** True if the ball is moving up fast enough to make the ramp. */
  canMake(ball: Matter.Body): boolean {
    return Matter.Body.getVelocity(ball).y <= -this.minSpeed;
  }

  flashNow() {
    this.flash = 1;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 600);
  }

  /** `hot` pulses the mouth arrow (mode / multiball — the shot pays extra). */
  draw(ctx: CanvasRenderingContext2D, hot = false) {
    // Glow when freshly made.
    const alpha = 0.34 + this.flash * 0.4;
    strokePlasticRamp(ctx, this.plate, this.color, 26, alpha);
    // Printed chevrons marching up the plate — plastic ramp art.
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.17)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    let leftover = 0;
    for (let i = 1; i < this.plate.length; i++) {
      const a = this.plate[i - 1];
      const b = this.plate[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      for (let d = 34 - leftover; d < len; d += 34) {
        const px = a.x + ux * d;
        const py = a.y + uy * d;
        // Chevron opens along travel direction.
        ctx.beginPath();
        ctx.moveTo(px - ux * 5 - uy * 6, py - uy * 5 + ux * 6);
        ctx.lineTo(px + ux * 4, py + uy * 4);
        ctx.lineTo(px - ux * 5 + uy * 6, py - uy * 5 - ux * 6);
        ctx.stroke();
      }
      leftover = (len - leftover) % 34;
    }
    ctx.restore();
    // Habitrail return rail (chrome).
    strokeMetalPath(ctx, this.habitrail, 4);
    // Backlit arrow at the mouth pointing up the ramp.
    insertArrow(ctx, this.arrowAt.x, this.arrowAt.y, 13, this.arrowAngle, this.color, true);
    if (hot && Math.sin(performance.now() / 120) > 0) {
      ctx.save();
      ctx.strokeStyle = this.color;
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.arrowAt.x, this.arrowAt.y, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Theme text alongside the plate.
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
