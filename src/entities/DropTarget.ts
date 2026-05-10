import Matter from 'matter-js';
import { COLOR } from '../constants';

export class DropTarget {
  readonly body: Matter.Body;
  readonly letter: string;
  /** Position remembered for re-adding on bank reset. */
  readonly home: { x: number; y: number; angle: number };
  hit = false;

  constructor(letter: string, x: number, y: number, w = 30, h = 16, angle = 0) {
    this.letter = letter;
    this.home = { x, y, angle };
    this.body = Matter.Bodies.rectangle(x, y, w, h, {
      isStatic: true,
      restitution: 0.3,
      friction: 0,
      label: `drop-${letter}`,
      angle,
    });
    (this.body as any).$dropTarget = this;
  }

  reset() {
    this.hit = false;
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.hit) {
      // Show a faint outlined "down" marker so the player can see the slot.
      ctx.save();
      const verts = this.body.vertices;
      ctx.strokeStyle = 'rgba(60, 78, 110, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return;
    }

    const verts = this.body.vertices;
    const cx = this.body.position.x;
    const cy = this.body.position.y;

    ctx.save();
    ctx.shadowColor = COLOR.NEON_CYAN;
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#0d1c30';
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = COLOR.NEON_CYAN;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Letter label
    ctx.translate(cx, cy);
    ctx.rotate(this.body.angle);
    ctx.fillStyle = COLOR.NEON_CYAN;
    ctx.font = 'bold 13px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.letter, 0, 0);
    ctx.restore();
  }
}
