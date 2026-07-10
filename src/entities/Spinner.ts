import Matter from 'matter-js';
import { COLOR } from '../constants';
import { metalPost, softShadow } from '../Graphics';

/** A free-spinning blade pinned at its centre. Each ball pass through the
 *  lane sets it spinning; we count revolutions for scoring. */
export class Spinner {
  readonly body: Matter.Body;
  readonly pivot: Matter.Constraint;
  readonly stop: Matter.Constraint;
  private prevAngle: number;
  private revAccum = 0;

  constructor(public readonly cx: number, public readonly cy: number, public readonly length = 60) {
    this.body = Matter.Bodies.rectangle(cx, cy, length, 5, {
      density: 0.001,
      frictionAir: 0.04,
      restitution: 0.2,
      label: 'spinner',
    });
    this.pivot = Matter.Constraint.create({
      pointA: { x: cx, y: cy },
      bodyB: this.body,
      pointB: { x: 0, y: 0 },
      stiffness: 1,
      length: 0,
    });
    // Light return-to-rest spring so it eventually stops.
    this.stop = Matter.Constraint.create({
      pointA: { x: cx + length / 2, y: cy },
      bodyB: this.body,
      pointB: { x: length / 2, y: 0 },
      stiffness: 0.0008,
      damping: 0.02,
      length: 0,
    });
    this.prevAngle = this.body.angle;
  }

  collectRevolutions(): number {
    const a = this.body.angle;
    const delta = a - this.prevAngle;
    this.prevAngle = a;
    this.revAccum += Math.abs(delta);
    let rev = 0;
    while (this.revAccum >= Math.PI) {
      this.revAccum -= Math.PI;
      rev++;
    }
    return rev;
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Subtle recessed strip under the blade (the spinner sits in the left
    // inlane, whose guide walls already frame it — no big slot needed).
    softShadow(ctx, this.cx, this.cy + 4, this.length / 1.5, 10, 0.4);

    // Spinning blade with chrome shading
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.body.angle);
    const bg = ctx.createLinearGradient(0, -3, 0, 3);
    bg.addColorStop(0, COLOR.METAL_LIGHT);
    bg.addColorStop(0.5, COLOR.METAL_MID);
    bg.addColorStop(1, COLOR.METAL_DARK);
    ctx.fillStyle = bg;
    ctx.fillRect(-this.length / 2, -3, this.length, 6);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-this.length / 2 + 2, -2);
    ctx.lineTo(this.length / 2 - 2, -2);
    ctx.stroke();
    ctx.restore();

    // Pivot stud
    metalPost(ctx, this.cx, this.cy, 4);
  }
}
