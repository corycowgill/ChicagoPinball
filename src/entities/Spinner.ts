import Matter from 'matter-js';
import { COLOR } from '../constants';

/** A spinner that rotates around a fixed pivot when the ball strikes it. */
export class Spinner {
  readonly body: Matter.Body;
  readonly pivot: Matter.Constraint;
  readonly stop: Matter.Constraint;
  private prevAngle: number;
  private revAccum = 0;
  private newRevs = 0;

  constructor(x: number, y: number, length = 60) {
    this.body = Matter.Bodies.rectangle(x, y, length, 5, {
      density: 0.001,
      frictionAir: 0.04,
      restitution: 0.2,
      label: 'spinner',
    });
    this.pivot = Matter.Constraint.create({
      pointA: { x, y },
      bodyB: this.body,
      pointB: { x: 0, y: 0 },
      stiffness: 1,
      length: 0,
    });
    // Light return-to-rest spring so it eventually stops
    this.stop = Matter.Constraint.create({
      pointA: { x: x + length / 2, y },
      bodyB: this.body,
      pointB: { x: length / 2, y: 0 },
      stiffness: 0.0008,
      damping: 0.02,
      length: 0,
    });
    this.prevAngle = this.body.angle;
  }

  /** Call each step. Returns the number of new full revolutions since last call. */
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
    this.newRevs = rev;
    return rev;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const verts = this.body.vertices;
    ctx.save();
    ctx.shadowColor = COLOR.WATER_HIGHLIGHT;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLOR.WATER_HIGHLIGHT;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
    ctx.fill();

    // pivot dot
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0c1830';
    ctx.beginPath();
    ctx.arc(this.pivot.pointA.x, this.pivot.pointA.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
