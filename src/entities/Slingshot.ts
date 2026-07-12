import Matter from 'matter-js';
import { COLOR } from '../constants';
import { metalPost, softShadow, decoStar } from '../Graphics';

/** Slingshot — triangular rubber kicker above the inlane that pops a ball
 *  inward when struck. Drawn as black rubber stretched between two metal
 *  posts, with a translucent plastic decal layered over it. */
export class Slingshot {
  readonly body: Matter.Body;
  readonly verts: { x: number; y: number }[];
  readonly normal: { x: number; y: number };
  /** Endpoints of the rubber band (the active edge facing the play area). */
  readonly bandA: { x: number; y: number };
  readonly bandB: { x: number; y: number };
  /** Apex post (the third vertex). */
  readonly apex: { x: number; y: number };
  private flash = 0;

  constructor(verts: [Matter.Vector, Matter.Vector, Matter.Vector], normal: Matter.Vector) {
    this.verts = verts.map((v) => ({ x: v.x, y: v.y }));
    const cx = (verts[0].x + verts[1].x + verts[2].x) / 3;
    const cy = (verts[0].y + verts[1].y + verts[2].y) / 3;
    this.normal = normal;

    // The rubber-band edge is the one whose midpoint is closest along the
    // normal to the centroid — that's the face the ball will strike.
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < 3; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 3];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = mx - cx;
      const dy = my - cy;
      const dot = dx * normal.x + dy * normal.y;
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    this.bandA = { x: verts[best].x, y: verts[best].y };
    this.bandB = { x: verts[(best + 1) % 3].x, y: verts[(best + 1) % 3].y };
    this.apex = { x: verts[(best + 2) % 3].x, y: verts[(best + 2) % 3].y };

    this.body = Matter.Bodies.fromVertices(
      cx,
      cy,
      [verts.map((v) => ({ x: v.x, y: v.y }))],
      {
        isStatic: true,
        restitution: 1.05,
        friction: 0,
        label: 'slingshot',
      },
      true,
    );
  }

  pop(ball: Matter.Body) {
    // Direct velocity impulse (applyForce loses strength under substepping).
    const kick = 11;
    const v = Matter.Body.getVelocity(ball);
    Matter.Body.setVelocity(ball, {
      x: v.x + this.normal.x * kick,
      y: v.y + this.normal.y * kick,
    });
    this.flash = 1;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 200);
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Drop shadow under the whole triangle for raised-toy depth.
    const cx = (this.verts[0].x + this.verts[1].x + this.verts[2].x) / 3;
    const cy = (this.verts[0].y + this.verts[1].y + this.verts[2].y) / 3;
    softShadow(ctx, cx + 1, cy + 6, 38, 16, 0.6);

    // Plastic decal — a translucent red triangle slightly inset.
    ctx.save();
    const inset = 4;
    const verts = inflateTriangle(this.verts, -inset);
    const flashLift = 0.3 * this.flash;

    ctx.shadowColor = COLOR.INSERT_RED;
    ctx.shadowBlur = 14 + 28 * this.flash;
    const grad = ctx.createLinearGradient(verts[0].x, verts[0].y, verts[2].x, verts[2].y);
    grad.addColorStop(0, `rgba(255, 65, 90, ${0.7 + flashLift})`);
    grad.addColorStop(0.5, `rgba(255, 110, 130, ${0.85 + flashLift * 0.3})`);
    grad.addColorStop(1, `rgba(180, 30, 50, ${0.75 + flashLift})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    ctx.lineTo(verts[1].x, verts[1].y);
    ctx.lineTo(verts[2].x, verts[2].y);
    ctx.closePath();
    ctx.fill();

    // Printed plastic art: deco fan rays from the apex toward the live
    // edge, a Chicago star, and a brass trim line.
    ctx.shadowBlur = 0;
    ctx.save();
    ctx.clip(); // keep the print inside the decal triangle
    ctx.strokeStyle = 'rgba(255, 235, 220, 0.28)';
    ctx.lineWidth = 1.2;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const ex = this.bandA.x + (this.bandB.x - this.bandA.x) * t;
      const ey = this.bandA.y + (this.bandB.y - this.bandA.y) * t;
      ctx.beginPath();
      ctx.moveTo(this.apex.x, this.apex.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.restore();
    decoStar(ctx, cx, cy + 4, 8, 'rgba(255, 245, 235, 0.6)');

    // Outer trim — brass over white (rebuild the decal path; the print
    // drawing above replaced the current path).
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    ctx.lineTo(verts[1].x, verts[1].y);
    ctx.lineTo(verts[2].x, verts[2].y);
    ctx.closePath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.55)';
    ctx.stroke();

    // Glossy highlight along one edge (the apex-to-bandA edge)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(this.apex.x, this.apex.y);
    ctx.lineTo(this.bandA.x, this.bandA.y);
    ctx.stroke();
    ctx.restore();

    // Black rubber band along the active edge.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(this.bandA.x, this.bandA.y);
    ctx.lineTo(this.bandB.x, this.bandB.y);
    ctx.stroke();
    // Subtle highlight on the rubber's "lit" side.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 80, 100, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.bandA.x, this.bandA.y);
    ctx.lineTo(this.bandB.x, this.bandB.y);
    ctx.stroke();
    ctx.restore();

    // Metal posts at the band endpoints (the rubber stretches between these).
    metalPost(ctx, this.bandA.x, this.bandA.y, 6);
    metalPost(ctx, this.bandB.x, this.bandB.y, 6);
  }
}

function inflateTriangle(
  verts: { x: number; y: number }[],
  delta: number,
): { x: number; y: number }[] {
  const cx = (verts[0].x + verts[1].x + verts[2].x) / 3;
  const cy = (verts[0].y + verts[1].y + verts[2].y) / 3;
  return verts.map((v) => {
    const dx = v.x - cx;
    const dy = v.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: v.x + (dx / len) * delta, y: v.y + (dy / len) * delta };
  });
}
