import { COLOR, PLAYFIELD_W, PLAYFIELD_H, CHICAGO } from './constants';
import { Playfield } from './scene/Playfield';
import { GameState } from './types';

interface Toast {
  text: string;
  color: string;
  ttl: number;
  total: number;
}

/** Treat the device as touch-first when it has no fine pointer (i.e. no
 *  mouse) and reports coarse pointer support. matchMedia is evaluated once at
 *  module load so the UI doesn't flicker if the user hot-plugs a mouse. */
const IS_TOUCH =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;

export class Renderer {
  private toasts: Toast[] = [];
  private flashJackpot = 0;

  pushToast(text: string, color = COLOR.NEON_AMBER, ttl = 1400) {
    this.toasts.push({ text, color, ttl, total: ttl });
  }

  triggerJackpotFlash() {
    this.flashJackpot = 1500;
  }

  tick(dtMs: number) {
    for (const t of this.toasts) t.ttl -= dtMs;
    this.toasts = this.toasts.filter((t) => t.ttl > 0);
    if (this.flashJackpot > 0) this.flashJackpot -= dtMs;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    pf: Playfield,
    state: GameState,
    score: number,
    ballsRemaining: number,
    plungerHolding: boolean,
  ) {
    this.drawBackground(ctx);
    this.drawWalls(ctx, pf);
    this.drawWater(ctx);
    pf.ramp.draw(ctx);
    pf.spinner.draw(ctx);
    pf.bank.draw(ctx);
    pf.bean.draw(ctx);
    for (const p of pf.popBumpers) p.draw(ctx);
    for (const s of pf.slingshots) s.draw(ctx);
    pf.leftFlipper.draw(ctx);
    pf.rightFlipper.draw(ctx);
    pf.plunger.draw(ctx);
    pf.ball.draw(ctx);

    this.drawHUD(ctx, score, ballsRemaining, pf, state);
    this.drawToasts(ctx);

    if (this.flashJackpot > 0) {
      const a = Math.min(0.4, (this.flashJackpot / 1500) * 0.4);
      ctx.save();
      ctx.fillStyle = `rgba(255, 215, 100, ${a})`;
      ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);
      ctx.restore();
    }

    if (state === GameState.TITLE) this.drawTitle(ctx);
    else if (state === GameState.GAME_OVER) this.drawGameOver(ctx, score);
    else if (state === GameState.READY) this.drawReadyHint(ctx, plungerHolding);
  }

  private drawBackground(ctx: CanvasRenderingContext2D) {
    const grad = ctx.createLinearGradient(0, 0, 0, PLAYFIELD_H);
    grad.addColorStop(0, COLOR.BG_TOP);
    grad.addColorStop(0.55, '#050a1c');
    grad.addColorStop(1, COLOR.BG_BOTTOM);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);

    // Skyline silhouette behind The Bean
    ctx.fillStyle = COLOR.SKYLINE;
    const baseY = 200;
    const towers = [
      [40, 70],
      [80, 100],
      [120, 130],
      [170, 160],
      [220, 90],
      [260, 140],
      [320, 175],
      [370, 110],
      [420, 150],
      [470, 80],
    ];
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (const [x, h] of towers) {
      ctx.lineTo(x, baseY - h);
      ctx.lineTo(x + 30, baseY - h);
      ctx.lineTo(x + 30, baseY);
    }
    ctx.lineTo(PLAYFIELD_W, baseY);
    ctx.lineTo(PLAYFIELD_W, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();

    // Skyline window glints
    ctx.fillStyle = 'rgba(255, 220, 120, 0.55)';
    for (const [x, h] of towers) {
      for (let yy = baseY - h + 8; yy < baseY - 6; yy += 12) {
        for (let xx = x + 4; xx < x + 28; xx += 6) {
          if (Math.random() < 0.18) ctx.fillRect(xx, yy, 2, 2);
        }
      }
    }

    // Vignette
    const vg = ctx.createRadialGradient(
      PLAYFIELD_W / 2,
      PLAYFIELD_H / 2,
      PLAYFIELD_W * 0.3,
      PLAYFIELD_W / 2,
      PLAYFIELD_H / 2,
      PLAYFIELD_W * 0.95,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);
  }

  private drawWater(ctx: CanvasRenderingContext2D) {
    // "Lake Michigan" patch behind the spinner
    ctx.save();
    const grad = ctx.createLinearGradient(0, 400, 0, 700);
    grad.addColorStop(0, 'rgba(63, 161, 212, 0.20)');
    grad.addColorStop(1, 'rgba(29, 58, 100, 0.20)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(20, 400);
    ctx.lineTo(140, 420);
    ctx.lineTo(140, 720);
    ctx.lineTo(20, 720);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(63, 161, 212, 0.45)';
    ctx.lineWidth = 1;
    for (let yy = 430; yy < 720; yy += 18) {
      ctx.beginPath();
      const wob = Math.sin((yy + performance.now() / 80) / 14) * 5;
      ctx.moveTo(30, yy + wob);
      ctx.lineTo(130, yy - wob);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120, 180, 220, 0.6)';
    ctx.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LAKE MICHIGAN', 80, 700);
    ctx.restore();
  }

  private drawWalls(ctx: CanvasRenderingContext2D, pf: Playfield) {
    ctx.save();
    ctx.shadowColor = COLOR.NEON_CYAN;
    ctx.shadowBlur = 6;
    ctx.strokeStyle = 'rgba(63, 240, 255, 0.7)';
    ctx.fillStyle = 'rgba(15, 28, 56, 0.7)';
    ctx.lineWidth = 1.5;
    for (const verts of pf.wallVerts) {
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHUD(
    ctx: CanvasRenderingContext2D,
    score: number,
    ballsRemaining: number,
    pf: Playfield,
    state: GameState,
  ) {
    ctx.save();
    // Top banner
    ctx.fillStyle = 'rgba(5, 8, 20, 0.7)';
    ctx.fillRect(0, 0, PLAYFIELD_W, 28);
    ctx.shadowColor = COLOR.NEON_PINK;
    ctx.shadowBlur = 10;
    ctx.fillStyle = COLOR.NEON_PINK;
    ctx.font = 'bold 14px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('CHICAGO', 12, 14);
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLOR.TEXT_DIM;
    ctx.font = '10px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('THE WINDY CITY PINBALL', 90, 15);

    // Score
    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLOR.NEON_AMBER;
    ctx.font = 'bold 20px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(score.toLocaleString(), PLAYFIELD_W - 12, 14);

    // Balls remaining
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLOR.TEXT_DIM;
    ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`BALL ${Math.max(1, ballsRemaining)} / 3`, 12, 42);

    // CHICAGO progress strip
    const lit = pf.bank.litMask();
    const startX = 130;
    const cellW = 22;
    for (let i = 0; i < CHICAGO.length; i++) {
      const x = startX + i * (cellW + 4);
      ctx.shadowBlur = lit[i] ? 14 : 0;
      ctx.shadowColor = COLOR.NEON_CYAN;
      ctx.strokeStyle = lit[i] ? COLOR.NEON_CYAN : 'rgba(63, 240, 255, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, 32, cellW, 18);
      ctx.fillStyle = lit[i] ? COLOR.NEON_CYAN : 'rgba(63, 240, 255, 0.35)';
      ctx.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CHICAGO[i], x + cellW / 2, 41);
    }
    ctx.shadowBlur = 0;

    // Hint band when playing
    if (state === GameState.PLAYING) {
      ctx.fillStyle = COLOR.TEXT_DIM;
      ctx.font = '10px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        IS_TOUCH ? 'TAP SIDES TO FLIP' : 'Z / ⁄ FLIPPERS',
        PLAYFIELD_W - 12,
        42,
      );
    }

    ctx.restore();
  }

  private drawToasts(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let i = 0;
    for (const t of this.toasts) {
      const a = Math.min(1, t.ttl / 600);
      const offset = (1 - t.ttl / t.total) * -20;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 16;
      ctx.fillStyle = t.color;
      ctx.globalAlpha = a;
      ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(t.text, PLAYFIELD_W / 2, 540 + i * 28 + offset);
      i++;
    }
    ctx.restore();
  }

  private drawTitle(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = COLOR.NEON_PINK;
    ctx.shadowBlur = 26;
    ctx.fillStyle = COLOR.NEON_PINK;
    ctx.font = 'bold 60px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('CHICAGO', PLAYFIELD_W / 2, 320);

    ctx.shadowColor = COLOR.NEON_CYAN;
    ctx.shadowBlur = 14;
    ctx.fillStyle = COLOR.NEON_CYAN;
    ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('THE WINDY CITY PINBALL', PLAYFIELD_W / 2, 370);

    ctx.shadowBlur = 0;
    ctx.fillStyle = COLOR.TEXT;
    ctx.font = '14px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('SPELL C-H-I-C-A-G-O FOR THE SUPER JACKPOT', PLAYFIELD_W / 2, 420);

    const blink = Math.sin(performance.now() / 300) > 0;
    if (blink) {
      ctx.shadowColor = COLOR.NEON_AMBER;
      ctx.shadowBlur = 14;
      ctx.fillStyle = COLOR.NEON_AMBER;
      ctx.font = 'bold 18px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(
        IS_TOUCH ? 'TAP TO START' : 'PRESS ENTER TO START',
        PLAYFIELD_W / 2,
        540,
      );
    }

    ctx.shadowBlur = 0;
    ctx.fillStyle = COLOR.TEXT_DIM;
    ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(
      IS_TOUCH
        ? 'Tap sides to flip · Hold to charge plunger'
        : 'Z / ⁄ flippers · SPACE plunger',
      PLAYFIELD_W / 2,
      580,
    );

    ctx.restore();
  }

  private drawGameOver(ctx: CanvasRenderingContext2D, score: number) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = COLOR.NEON_PINK;
    ctx.shadowBlur = 22;
    ctx.fillStyle = COLOR.NEON_PINK;
    ctx.font = 'bold 48px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('GAME OVER', PLAYFIELD_W / 2, 360);

    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 16;
    ctx.fillStyle = COLOR.NEON_AMBER;
    ctx.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(score.toLocaleString(), PLAYFIELD_W / 2, 420);

    const blink = Math.sin(performance.now() / 300) > 0;
    if (blink) {
      ctx.shadowColor = COLOR.NEON_CYAN;
      ctx.shadowBlur = 14;
      ctx.fillStyle = COLOR.NEON_CYAN;
      ctx.font = 'bold 16px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(
        IS_TOUCH ? 'TAP TO RETURN TO TITLE' : 'PRESS ENTER FOR TITLE',
        PLAYFIELD_W / 2,
        500,
      );
    }
    ctx.restore();
  }

  private drawReadyHint(ctx: CanvasRenderingContext2D, holding: boolean) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = COLOR.NEON_CYAN;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLOR.NEON_CYAN;
    ctx.font = 'bold 14px "Helvetica Neue", Arial, sans-serif';
    let msg: string;
    if (IS_TOUCH) {
      msg = holding ? 'RELEASE TO LAUNCH' : 'TAP & HOLD TO PULL PLUNGER';
    } else {
      msg = holding ? 'RELEASE SPACE TO LAUNCH' : 'HOLD SPACE TO PULL PLUNGER';
    }
    ctx.fillText(msg, PLAYFIELD_W / 2, PLAYFIELD_H - 40);
    ctx.restore();
  }
}
