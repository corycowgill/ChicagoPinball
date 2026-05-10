import Matter from 'matter-js';
import { COLOR } from '../constants';

/**
 * Triangular slingshot. Pass the three vertices in world space (CCW or CW
 * doesn't matter — Matter normalizes them). The "active edge" is the edge
 * facing the play area; on collision we pop the ball away along that normal.
 */
export class Slingshot {
  readonly body: Matter.Body;
  readonly verts: { x: number; y: number }[];
  /** Normal of the active (ball-facing) edge, pointing into the playfield. */
  readonly normal: { x: number; y: number };
  private flash = 0;

  constructor(verts: [Matter.Vector, Matter.Vector, Matter.Vector], normal: Matter.Vector) {
    this.verts = verts.map((v) => ({ x: v.x, y: v.y }));
    const cx = (verts[0].x + verts[1].x + verts[2].x) / 3;
    const cy = (verts[0].y + verts[1].y + verts[2].y) / 3;
    this.normal = normal;

    this.body = Matter.Bodies.fromVertices(
      cx,
      cy,
      [verts.map((v) => ({ x: v.x, y: v.y }))],
      {
        isStatic: true,
        restitution: 1.1,
        friction: 0,
        label: 'slingshot',
      },
      true,
    );
  }

  pop(ball: Matter.Body) {
    const force = 0.045 * ball.mass;
    Matter.Body.applyForce(ball, ball.position, {
      x: this.normal.x * force,
      y: this.normal.y * force,
    });
    this.flash = 1;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 180);
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.shadowColor = COLOR.NEON_PINK;
    ctx.shadowBlur = 14 + 18 * this.flash;
    ctx.fillStyle = `rgba(255, 58, 120, ${0.85 + 0.15 * this.flash})`;
    ctx.beginPath();
    ctx.moveTo(this.verts[0].x, this.verts[0].y);
    ctx.lineTo(this.verts[1].x, this.verts[1].y);
    ctx.lineTo(this.verts[2].x, this.verts[2].y);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}
