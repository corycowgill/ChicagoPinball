import Matter from 'matter-js';
import { COLOR } from '../constants';
import { softShadow } from '../Graphics';

/** A standup-style drop target — a small lit plate with a metal back. */
export class DropTarget {
  readonly body: Matter.Body;
  readonly letter: string;
  readonly home: { x: number; y: number; angle: number };
  hit = false;

  constructor(letter: string, x: number, y: number, w = 28, h = 12, angle = 0) {
    this.letter = letter;
    this.home = { x, y, angle };
    this.body = Matter.Bodies.rectangle(x, y, w, h, {
      isStatic: true,
      restitution: 0.4,
      friction: 0,
      label: `drop-${letter}`,
      angle,
    });
    (this.body as any).$dropTarget = this;
  }

  reset() { this.hit = false; }

  draw(ctx: CanvasRenderingContext2D) {
    const cx = this.body.position.x;
    const cy = this.body.position.y;
    const a = this.body.angle;
    const w = 28;
    const h = 12;

    if (this.hit) {
      // Recessed slot once knocked.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.fillStyle = '#03060c';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = 'rgba(60, 78, 110, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
      return;
    }

    softShadow(ctx, cx + 1, cy + 6, w * 0.6, h + 2, 0.55);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);

    // Metal mounting plate behind the lit face.
    ctx.fillStyle = '#1a2236';
    ctx.fillRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
    ctx.strokeStyle = COLOR.METAL_DARK;
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);

    // Lit cyan plastic face with a glossy stripe.
    ctx.shadowColor = COLOR.NEON_CYAN;
    ctx.shadowBlur = 10;
    const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, COLOR.NEON_CYAN);
    grad.addColorStop(1, 'rgba(63, 240, 255, 0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(-w / 2 + 2, -h / 2 + 1, w - 4, 1.5);

    // Letter
    ctx.fillStyle = '#02101a';
    ctx.font = 'bold 11px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.letter, 0, 1);
    ctx.restore();
  }
}
