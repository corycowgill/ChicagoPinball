import Matter from 'matter-js';
import { COLOR } from '../constants';
import { softShadow, decoStar } from '../Graphics';

/** Stern-style pop bumper: a translucent skirt at playfield level, a chrome
 *  collar, and a domed lit cap on top with a flashing lamp inside. Pops the
 *  ball outward on contact. */
export class PopBumper {
  readonly body: Matter.Body;
  readonly radius: number;
  private flash = 0;
  private color: string;

  constructor(x: number, y: number, radius = 24, color = COLOR.INSERT_AMBER) {
    this.radius = radius;
    this.color = color;
    this.body = Matter.Bodies.circle(x, y, radius, {
      isStatic: true,
      restitution: 0.95,
      friction: 0,
      label: 'pop-bumper',
    });
  }

  pop(ball: Matter.Body) {
    const dx = ball.position.x - this.body.position.x;
    const dy = ball.position.y - this.body.position.y;
    const len = Math.hypot(dx, dy) || 1;
    // Direct velocity impulse (applyForce integrates over dt² and loses
    // ~9× strength under physics substepping).
    const kick = 12;
    const v = Matter.Body.getVelocity(ball);
    Matter.Body.setVelocity(ball, {
      x: v.x + (dx / len) * kick,
      y: v.y + (dy / len) * kick,
    });
    this.flash = 1;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 220);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y } = this.body.position;
    const r = this.radius;

    // Skirt — translucent ring at playfield level the ball physically rebounds
    // off in real pinball. Drawn as a wider, dimmer disc.
    ctx.save();
    softShadow(ctx, x, y + 6, r * 1.3, r * 0.55, 0.55);

    // Lit ring (the "skirt LED" glow) when flashing.
    const skirtAlpha = 0.3 + 0.55 * this.flash;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 18 + 24 * this.flash;
    ctx.fillStyle = `rgba(${hexToRgb(this.color)}, ${skirtAlpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
    ctx.fill();

    // Chrome collar
    ctx.shadowBlur = 0;
    const collar = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r * 0.85);
    collar.addColorStop(0, COLOR.METAL_LIGHT);
    collar.addColorStop(0.6, COLOR.METAL_MID);
    collar.addColorStop(1, COLOR.METAL_DARK);
    ctx.fillStyle = collar;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
    ctx.fill();

    // Inner lit cap
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12 + 16 * this.flash;
    const cap = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, 1, x, y, r * 0.6);
    cap.addColorStop(0, '#ffffff');
    cap.addColorStop(0.45, this.color);
    cap.addColorStop(1, dimRgba(this.color, 0.25));
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Printed cap art: deco ring + Chicago star.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.44, 0, Math.PI * 2);
    ctx.stroke();
    decoStar(ctx, x, y, r * 0.3, 'rgba(255, 255, 255, 0.7)');

    // Specular pip
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.22, y - r * 0.32, r * 0.13, r * 0.07, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function hexToRgb(hex: string): string {
  if (hex.startsWith('rgb')) return hex.slice(hex.indexOf('(') + 1, hex.indexOf(')'));
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}
function dimRgba(hex: string, alpha: number): string {
  return `rgba(${hexToRgb(hex)}, ${alpha})`;
}
