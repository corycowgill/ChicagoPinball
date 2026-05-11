import Matter from 'matter-js';
import { COLOR, PLUNGER_KICK } from '../constants';
import { metalPost } from '../Graphics';

export class Plunger {
  readonly body: Matter.Body;
  readonly width: number;
  readonly height = 32;
  private restY: number;
  private pull = 0;
  private holding = false;

  constructor(x: number, y: number, width = 46) {
    this.restY = y;
    this.width = width;
    this.body = Matter.Bodies.rectangle(x, y, this.width, this.height, {
      isStatic: true,
      label: 'plunger',
      chamfer: { radius: 4 },
    });
  }

  hold() {
    this.holding = true;
  }

  release(): number {
    if (!this.holding) return 0;
    const force = this.pull * PLUNGER_KICK;
    this.holding = false;
    this.pull = 0;
    return force;
  }

  tick(dtMs: number) {
    if (this.holding) this.pull = Math.min(1, this.pull + dtMs / 800);
    else this.pull = 0;
  }

  isHolding() { return this.holding; }
  pullAmount() { return this.pull; }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y } = this.body.position;
    const w = this.width;
    const h = this.height;

    // Power gauge to the LEFT of the plunger so it doesn't overlap the head.
    const gaugeX = x - w / 2 - 14;
    const gaugeH = 84;
    const gaugeTop = y - gaugeH / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(20, 28, 48, 0.85)';
    ctx.strokeStyle = 'rgba(255, 181, 71, 0.45)';
    ctx.lineWidth = 1;
    ctx.fillRect(gaugeX - 4, gaugeTop, 8, gaugeH);
    ctx.strokeRect(gaugeX - 4, gaugeTop, 8, gaugeH);
    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLOR.NEON_AMBER;
    const fillH = gaugeH * this.pull;
    ctx.fillRect(gaugeX - 3, gaugeTop + (gaugeH - fillH), 6, fillH);
    ctx.restore();

    // Mounting post above the plunger (decorative chrome cap).
    metalPost(ctx, x, y - 90, 6);

    // Spring shaft between the post and the plunger head — coil that
    // visually compresses when pulled.
    ctx.save();
    const coilTop = y - 90 + 6;
    const coilBottom = y - h / 2 - 4;
    const coils = 9;
    ctx.strokeStyle = COLOR.METAL_MID;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i <= coils; i++) {
      const t = i / coils;
      const cy = coilTop + (coilBottom - coilTop) * t;
      const cx = x + Math.sin(t * Math.PI * coils) * 4;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    // Bright side of the coil (specular)
    ctx.strokeStyle = COLOR.METAL_LIGHT;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i <= coils; i++) {
      const t = i / coils;
      const cy = coilTop + (coilBottom - coilTop) * t;
      const cx = x + Math.sin(t * Math.PI * coils) * 4 - 1;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.restore();

    // Plunger head — chrome puck with red knob highlight.
    ctx.save();
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2 + 2, y - h / 2 + 5, w, h, 6);
    ctx.fill();

    const headGrad = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
    headGrad.addColorStop(0, '#ff6075');
    headGrad.addColorStop(0.5, '#d62a3e');
    headGrad.addColorStop(1, '#5e0a18');
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
    ctx.fill();
    // Glossy stripe across the head.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(x - w / 2 + 4, y - h / 2 + 4, w - 8, 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(x - w / 2 + 4, y - h / 2 + 7, w - 8, 1);
    // Bottom shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x - w / 2 + 4, y + h / 2 - 4, w - 8, 2);
    ctx.restore();
  }
}
