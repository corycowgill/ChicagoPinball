import Matter from 'matter-js';
import { COLOR } from '../constants';
import { softShadow } from '../Graphics';

/** A drop target — a small lit plate that drops out of play when hit. */
export class DropTarget {
  readonly body: Matter.Body;
  /** Letter printed on the face. */
  readonly letter: string;
  readonly home: { x: number; y: number; angle: number };
  hit = false;

  /** Plate size. Exposed so layout validation can treat a raised target as
   *  the obstacle it is by reading the entity, instead of copying two more
   *  literals that would drift. */
  static readonly W = 28;
  static readonly H = 12;

  /** `id` must be unique across the table (used as the physics label);
   *  `letter` is what's printed on the face and may repeat. */
  constructor(
    id: string,
    letter: string,
    x: number,
    y: number,
    angle = 0,
    w = DropTarget.W,
    h = DropTarget.H,
  ) {
    this.letter = letter;
    this.home = { x, y, angle };
    this.body = Matter.Bodies.rectangle(x, y, w, h, {
      isStatic: true,
      restitution: 0.4,
      friction: 0,
      label: `drop-${id}`,
      angle,
    });
  }

  reset() {
    this.hit = false;
  }

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
