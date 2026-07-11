import { COLOR, PLAYFIELD_W, PLAYFIELD_H, CHICAGO, BOSS_HP } from './constants';
import { Playfield, PLAYFIELD_TOP } from './scene/Playfield';
import { GameState } from './types';
import { metalPost, strokeMetalPath, insertArrow } from './Graphics';

interface Toast {
  text: string;
  color: string;
  ttl: number;
  total: number;
}

const IS_TOUCH =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;

/** Vertical layout of the rendered surface (top → bottom):
 *    0   ─ 60     Backbox art (skyline + landmarks only)
 *    60  ─ 130    HUD band (score, status, CHICAGO progress)
 *    130 ─ 190    Top apron (rollover lanes' decorative rail + back wall)
 *    190 ─ 960    Playfield proper
 */
const BACKBOX_H = 60;
const HUD_TOP = 60;
const HUD_BOT = 130;
const APRON_TOP = HUD_BOT;

export interface HudInfo {
  state: GameState;
  score: number;
  ballNumber: number;
  playerScores: number[];
  currentPlayer: number;
  extraBalls: number;
  matchNumber: number;
  matched: boolean;
  plungerHolding: boolean;
  multiball: boolean;
  tourName: string | null;
  tourKind: string | null;
  tourLetter: string | null;
  tourMsLeft: number;
  tiltHeat: number;
  tilted: boolean;
  kickbackLit: boolean;
  mysteryLit: boolean;
  bonusX: number;
  ballSaveMs: number;
  highScore: number;
  bossLit: boolean;
  bossActive: boolean;
  bossHp: number;
  bossMsLeft: number;
}

export class Renderer {
  private toasts: Toast[] = [];
  private flashJackpot = 0;
  private shakeMs = 0;
  private shakeAmp = 0;
  /** Cached static art. UNDER = floor/art/wireform below the toys; OVER =
   *  decals/walls/posts above them. Rebuilding gradients, shadows and text
   *  every frame was most of the frame cost — the geometry never moves. */
  private staticUnder: HTMLCanvasElement | null = null;
  private staticOver: HTMLCanvasElement | null = null;
  private stars: { x: number; y: number; r: number; tw: number }[] = [];
  private windows: { x: number; y: number; w: number; h: number; lit: boolean }[] = [];

  constructor() {
    let seed = 1;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 70; i++) {
      this.stars.push({ x: rand() * PLAYFIELD_W, y: rand() * BACKBOX_H, r: rand() * 0.9 + 0.3, tw: rand() });
    }
    for (let bx = 30; bx < PLAYFIELD_W - 30; bx += 6) {
      for (let by = 16; by < BACKBOX_H - 4; by += 8) {
        if (rand() < 0.16) {
          this.windows.push({ x: bx, y: by, w: 2, h: 2, lit: rand() < 0.7 });
        }
      }
    }
  }

  pushToast(text: string, color = COLOR.NEON_AMBER, ttl = 1400) {
    this.toasts.push({ text, color, ttl, total: ttl });
  }
  triggerJackpotFlash() { this.flashJackpot = 1500; }

  /** Brief screen shake (bumpers, slings, drains). */
  kick(amp: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeMs = 90;
  }

  tick(dtMs: number) {
    for (const t of this.toasts) t.ttl -= dtMs;
    this.toasts = this.toasts.filter((t) => t.ttl > 0);
    if (this.flashJackpot > 0) this.flashJackpot -= dtMs;
    if (this.shakeMs > 0) {
      this.shakeMs -= dtMs;
      if (this.shakeMs <= 0) this.shakeAmp = 0;
    }
  }

  draw(ctx: CanvasRenderingContext2D, pf: Playfield, hud: HudInfo) {
    const { state, score } = hud;
    const hot = hud.multiball || hud.bossActive;
    this.ensureStaticLayers(pf);
    ctx.save();
    if (this.shakeMs > 0 && this.shakeAmp > 0) {
      ctx.translate(
        (Math.random() - 0.5) * 2 * this.shakeAmp,
        (Math.random() - 0.5) * 2 * this.shakeAmp,
      );
    }
    this.drawBackbox(ctx);
    this.drawHUDBand(ctx, hud, pf);
    // Static under-layer: top apron band, floor + art, lake pool, wireform.
    if (this.staticUnder) ctx.drawImage(this.staticUnder, 0, 0, PLAYFIELD_W, PLAYFIELD_H);
    // Animated lake shimmer over the static pool.
    this.drawLakeShimmer(ctx, pf);
    // Ramps (raised translucent plates) — drawn before toys so toys layer on top.
    pf.leftRamp.draw(ctx, hot || (hud.tourKind === 'ramp' && hud.tourLetter === 'L'));
    pf.rightRamp.draw(ctx, hot || (hud.tourKind === 'ramp' && hud.tourLetter === 'R'));
    // Toys.
    pf.bank.draw(ctx);
    pf.captive.draw(ctx);
    pf.spinner.draw(ctx);
    pf.cityTourScoop.draw(ctx);
    pf.lakeMichiganScoop.draw(ctx);
    for (const r of pf.rollovers) r.draw(ctx);
    for (const s of pf.standups) s.draw(ctx);
    pf.bean.draw(ctx, hud.bossActive);
    for (const p of pf.popBumpers) p.draw(ctx);
    for (const s of pf.slingshots) s.draw(ctx);
    pf.leftFlipper.draw(ctx);
    pf.rightFlipper.draw(ctx);
    pf.plunger.draw(ctx);
    // Static over-layer: decals, labels, walls, posts, loop arrows.
    if (this.staticOver) ctx.drawImage(this.staticOver, 0, 0, PLAYFIELD_W, PLAYFIELD_H);
    // SHOWDOWN marker over the MODE scoop while the boss is lit.
    if (hud.bossLit && state === GameState.PLAYING && Math.sin(performance.now() / 160) > -0.3) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.shadowColor = COLOR.INSERT_RED;
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('SHOWDOWN', pf.cityTourScoop.x, pf.cityTourScoop.y - 46);
      ctx.strokeStyle = COLOR.INSERT_RED;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pf.cityTourScoop.x, pf.cityTourScoop.y, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Loop arrows pulse while their shot pays extra.
    if ((hot || hud.tourKind === 'loop') && Math.sin(performance.now() / 120) > 0) {
      ctx.save();
      ctx.strokeStyle = COLOR.INSERT_PURPLE;
      ctx.shadowColor = COLOR.INSERT_PURPLE;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;
      for (const x of pf.loopArrowXs) {
        ctx.beginPath();
        ctx.arc(x, 590, 16, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Kickback lamp in the left outlane.
    {
      const kp = pf.kickbackPos;
      ctx.save();
      const on = hud.kickbackLit && Math.sin(performance.now() / 200) > -0.6;
      ctx.shadowColor = COLOR.NEON_GREEN;
      ctx.shadowBlur = on ? 14 : 0;
      ctx.fillStyle = on ? COLOR.NEON_GREEN : 'rgba(92, 255, 154, 0.14)';
      ctx.beginPath();
      ctx.arc(kp.x, kp.y - 4, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Kicker body.
      ctx.fillStyle = '#1a2236';
      ctx.fillRect(kp.x - 12, kp.y + 4, 24, 7);
      ctx.strokeStyle = COLOR.METAL_MID;
      ctx.lineWidth = 1;
      ctx.strokeRect(kp.x - 12, kp.y + 4, 24, 7);
      ctx.restore();
    }

    // Mystery "?" over the LAKE scoop while lit.
    if (hud.mysteryLit && state === GameState.PLAYING) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 250);
      ctx.shadowColor = COLOR.RIVER_HI;
      ctx.shadowBlur = 12 * pulse;
      ctx.fillStyle = `rgba(180, 230, 255, ${0.55 + 0.4 * pulse})`;
      ctx.font = 'bold 16px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('?', pf.lakeMichiganScoop.x, pf.lakeMichiganScoop.y - 44);
      ctx.restore();
    }

    // Tour-stop halos for the Bean / captive stops.
    if ((hud.tourKind === 'bean' || hud.tourKind === 'captive') && Math.sin(performance.now() / 120) > 0) {
      ctx.save();
      ctx.strokeStyle = COLOR.INSERT_CYAN;
      ctx.shadowColor = COLOR.INSERT_CYAN;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (hud.tourKind === 'bean') {
        ctx.arc(pf.bean.cx, pf.bean.cy, pf.bean.radius + 10, 0, Math.PI * 2);
      } else {
        ctx.arc(pf.captive.x, pf.captive.y - 10, 32, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();
    }

    // TILT — dead flippers until the ball drains.
    if (hud.tilted) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = COLOR.INSERT_RED;
      ctx.shadowBlur = 26;
      ctx.fillStyle = COLOR.INSERT_RED;
      ctx.font = 'bold 54px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('TILT', pf.playCenter, 560);
      ctx.restore();
    }
    // Balls (with trails) — then the apron covers the drain area, so a
    // draining ball visibly rolls in underneath it.
    for (const b of pf.balls) b.draw(ctx);
    this.drawApron(ctx, pf, hud);

    this.drawToasts(ctx);

    if (this.flashJackpot > 0) {
      const a = Math.min(0.45, (this.flashJackpot / 1500) * 0.45);
      ctx.save();
      ctx.fillStyle = `rgba(255, 215, 100, ${a})`;
      ctx.fillRect(0, APRON_TOP, PLAYFIELD_W, PLAYFIELD_H - APRON_TOP);
      ctx.restore();
    }

    if (state === GameState.TITLE) this.drawTitle(ctx, hud.highScore);
    else if (state === GameState.GAME_OVER) this.drawGameOver(ctx, hud);
    else if (state === GameState.READY) this.drawReadyHint(ctx, hud);
    ctx.restore();
  }

  // ── Static layer cache ───────────────────────────────────────────────────

  private ensureStaticLayers(pf: Playfield) {
    if (this.staticUnder && this.staticOver) return;
    const make = () => {
      const c = document.createElement('canvas');
      c.width = PLAYFIELD_W * 2;
      c.height = PLAYFIELD_H * 2;
      const cctx = c.getContext('2d')!;
      cctx.scale(2, 2);
      return { c, cctx };
    };

    const under = make();
    this.drawTopApron(under.cctx, pf);
    this.drawPlayfieldFloor(under.cctx);
    this.drawFloorArt(under.cctx, pf);
    this.drawLakePool(under.cctx, pf);
    // Chrome shooter wireform at the back — the launched ball actually rides
    // this path (see Playfield.shooterPath); drawn to the centre lane, the
    // branch into the outer lanes is implied.
    strokeMetalPath(under.cctx, pf.shooterPath(pf.rolloverXs[1]), 4);
    this.staticUnder = under.c;

    const over = make();
    this.drawPlayfieldDecals(over.cctx, pf);
    this.drawStandupLabels(over.cctx, pf);
    this.drawWalls(over.cctx, pf);
    for (const p of pf.postPositions) metalPost(over.cctx, p.x, p.y, p.r ?? 5);
    this.staticOver = over.c;
  }

  /** Painted playfield art — Chicago-flag decal, skyline silhouette,
   *  art-deco sunburst, lakefront water, street names, insert rings. All
   *  of this renders once into the cached static layer. */
  private drawFloorArt(ctx: CanvasRenderingContext2D, pf: Playfield) {
    ctx.save();
    let seed = 7;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    // Warm centre light — the playfield feels lit from the backbox.
    {
      const g = ctx.createRadialGradient(pf.playCenter, 520, 40, pf.playCenter, 520, 400);
      g.addColorStop(0, 'rgba(255, 220, 160, 0.05)');
      g.addColorStop(1, 'rgba(255, 220, 160, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, PLAYFIELD_TOP, pf.playRight, PLAYFIELD_H - PLAYFIELD_TOP);
    }

    // Street grid — faint avenues over the whole playfield.
    ctx.strokeStyle = 'rgba(120, 160, 220, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 60; x < pf.playRight; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, PLAYFIELD_TOP + 10);
      ctx.lineTo(x, PLAYFIELD_H - 40);
      ctx.stroke();
    }
    // Street-name decals along a couple of avenues.
    ctx.save();
    ctx.fillStyle = 'rgba(170, 200, 240, 0.14)';
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    for (const s of [
      { x: 120, y: 620, text: 'LAKE SHORE DR' },
      { x: 300, y: 548, text: 'STATE ST' },
    ]) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(s.text, 0, 3);
      ctx.restore();
    }
    ctx.restore();

    // Art-deco sunburst fanning up from behind the Bean / bumper nest.
    ctx.save();
    ctx.fillStyle = 'rgba(255, 205, 120, 0.045)';
    const bx = pf.bean.cx;
    const by = 372;
    for (let i = 0; i < 9; i++) {
      const a0 = Math.PI + (i / 9) * Math.PI + 0.02;
      const a1 = Math.PI + ((i + 0.55) / 9) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.arc(bx, by, 215, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Lakefront — a water body hugging the left shoreline around the LAKE
    // scoop, with static wave arcs.
    {
      const cx = pf.lakeMichiganScoop.x;
      const cy = pf.lakeMichiganScoop.y;
      ctx.save();
      const g = ctx.createLinearGradient(0, cy - 90, 0, cy + 90);
      g.addColorStop(0, 'rgba(48, 120, 180, 0.16)');
      g.addColorStop(0.5, 'rgba(60, 150, 210, 0.24)');
      g.addColorStop(1, 'rgba(30, 80, 140, 0.12)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(34, cy - 96);
      ctx.bezierCurveTo(96, cy - 88, 132, cy - 40, 126, cy);
      ctx.bezierCurveTo(120, cy + 52, 92, cy + 78, 40, cy + 92);
      ctx.lineTo(30, cy + 92);
      ctx.bezierCurveTo(24, cy + 40, 24, cy - 40, 34, cy - 96);
      ctx.closePath();
      ctx.fill();
      // Shoreline edge.
      ctx.strokeStyle = 'rgba(140, 205, 245, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Static wave dashes.
      ctx.strokeStyle = 'rgba(150, 205, 240, 0.18)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const wy = cy - 62 + i * 20;
        const wx = 52 + rand() * 30;
        ctx.beginPath();
        ctx.arc(wx, wy, 8, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Skyline silhouette across the strip above the slingshots — the city
    // seen from the lake, with sparse lit windows and a sky-glow roofline.
    {
      const baseY = 704;
      ctx.save();
      let x = 8;
      const roof: { x: number; w: number; h: number }[] = [];
      while (x < pf.playRight - 12) {
        const w = 18 + rand() * 26;
        const h = 16 + rand() * 34; // stays below the flag decal
        roof.push({ x, w: Math.min(w, pf.playRight - 12 - x), h });
        x += w + 2;
      }
      // Sky glow behind the roofline.
      ctx.fillStyle = 'rgba(120, 170, 255, 0.04)';
      ctx.fillRect(8, baseY - 56, pf.playRight - 16, 56);
      // Buildings.
      for (const b of roof) {
        ctx.fillStyle = 'rgba(4, 8, 18, 0.7)';
        ctx.fillRect(b.x, baseY - b.h, b.w, b.h);
        ctx.strokeStyle = 'rgba(140, 180, 240, 0.07)';
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x, baseY - b.h, b.w, b.h);
        // Windows.
        ctx.fillStyle = 'rgba(255, 214, 130, 0.32)';
        for (let wy = baseY - b.h + 5; wy < baseY - 6; wy += 8) {
          for (let wx = b.x + 4; wx < b.x + b.w - 3; wx += 7) {
            if (rand() < 0.28) ctx.fillRect(wx, wy, 1.6, 2.4);
          }
        }
      }
      ctx.restore();
    }

    // Chicago-flag decal — white field, two light-blue stripes, the four
    // red six-pointed stars between them.
    {
      // Compact banner centred on the stars, not a full-width bar.
      const x0 = pf.playCenter - 110;
      const x1 = pf.playCenter + 110;
      const y0 = 586;
      ctx.save();
      ctx.fillStyle = 'rgba(240, 248, 255, 0.08)';
      ctx.fillRect(x0, y0, x1 - x0, 38);
      ctx.fillStyle = 'rgba(120, 205, 235, 0.30)';
      ctx.fillRect(x0, y0 + 4, x1 - x0, 8);
      ctx.fillRect(x0, y0 + 26, x1 - x0, 8);
      ctx.fillStyle = 'rgba(235, 40, 55, 0.75)';
      for (let i = 0; i < 4; i++) {
        drawStar6(ctx, pf.playCenter - 72 + i * 48, y0 + 19, 7.5);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, x1 - x0, 38);
      ctx.restore();
    }

    // Scoop surround — painted insert rings around the MODE kickout hole.
    {
      const sx = pf.cityTourScoop.x;
      const sy = pf.cityTourScoop.y;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 167, 51, 0.30)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 26, 19, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 167, 51, 0.14)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 32, 24, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // GI light pools — warm glow around the bumper nest and the flippers.
    for (const pool of [
      { x: pf.playCenter, y: 380, r: 120, c: '255, 200, 130', a: 0.05 },
      { x: pf.playCenter, y: 760, r: 130, c: '150, 200, 255', a: 0.05 },
    ]) {
      const g = ctx.createRadialGradient(pool.x, pool.y, 10, pool.x, pool.y, pool.r);
      g.addColorStop(0, `rgba(${pool.c}, ${pool.a})`);
      g.addColorStop(1, `rgba(${pool.c}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pool.x, pool.y, pool.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cloud Gate plaza — concentric rings + paver ticks under the Bean.
    ctx.strokeStyle = 'rgba(180, 200, 230, 0.10)';
    ctx.lineWidth = 2;
    for (const r of [34, 44]) {
      ctx.beginPath();
      ctx.arc(pf.bean.cx, pf.bean.cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(180, 200, 230, 0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(pf.bean.cx + Math.cos(a) * 46, pf.bean.cy + Math.sin(a) * 46);
      ctx.lineTo(pf.bean.cx + Math.cos(a) * 52, pf.bean.cy + Math.sin(a) * 52);
      ctx.stroke();
    }

    // Deco accent lines inside the top corner diagonals.
    ctx.strokeStyle = 'rgba(63, 240, 255, 0.13)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(16, 252);
    ctx.lineTo(152, 186);
    ctx.moveTo(pf.playRight - 16, 252);
    ctx.lineTo(pf.playRight - 152, 186);
    ctx.stroke();

    ctx.restore();
  }

  /** Lower apron covering the drain area — a draining ball rolls in under
   *  it, like a real machine. Carries the SHOOT AGAIN (ball save) lamp. */
  private drawApron(ctx: CanvasRenderingContext2D, pf: Playfield, hud: HudInfo) {
    const topY = 898;
    ctx.save();
    // Body.
    const grad = ctx.createLinearGradient(0, topY, 0, PLAYFIELD_H);
    grad.addColorStop(0, '#7c1420');
    grad.addColorStop(0.5, '#540d16');
    grad.addColorStop(1, '#2e060c');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 946);
    ctx.lineTo(168, topY);
    ctx.lineTo(312, topY);
    ctx.lineTo(pf.playRight, 946);
    ctx.lineTo(pf.playRight, PLAYFIELD_H);
    ctx.lineTo(0, PLAYFIELD_H);
    ctx.closePath();
    ctx.fill();
    // Chrome trim along the top edge + gold pinstripe inset.
    ctx.strokeStyle = COLOR.METAL_LIGHT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 946);
    ctx.lineTo(168, topY);
    ctx.lineTo(312, topY);
    ctx.lineTo(pf.playRight, 946);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 210, 120, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4, 951);
    ctx.lineTo(170, topY + 5);
    ctx.lineTo(310, topY + 5);
    ctx.lineTo(pf.playRight - 4, 951);
    ctx.stroke();

    // Instruction cards flanking the wordmark (the little score/rule cards
    // every real apron carries).
    for (const cx of [72, pf.playRight - 72]) {
      ctx.save();
      ctx.fillStyle = 'rgba(238, 232, 214, 0.88)';
      ctx.strokeStyle = 'rgba(60, 40, 30, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cx - 24, 934, 48, 20, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(90, 20, 28, 0.85)';
      ctx.fillRect(cx - 19, 938, 38, 2.5);
      ctx.fillStyle = 'rgba(70, 70, 80, 0.6)';
      ctx.fillRect(cx - 19, 943, 38, 1.2);
      ctx.fillRect(cx - 19, 946.5, 30, 1.2);
      ctx.fillRect(cx - 19, 950, 34, 1.2);
      ctx.restore();
    }

    // Apron art: star + wordmark.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = 'bold 14px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CHICAGO', pf.playCenter, 944);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    drawStar6(ctx, pf.playCenter - 58, 944, 6);
    drawStar6(ctx, pf.playCenter + 58, 944, 6);

    // SHOOT AGAIN lamp — lit while ball save is armed.
    const saveOn = hud.ballSaveMs > 0 && hud.state === GameState.PLAYING;
    const blink = saveOn && Math.sin(performance.now() / 130) > -0.4;
    ctx.shadowColor = COLOR.NEON_GREEN;
    ctx.shadowBlur = blink ? 14 : 0;
    ctx.fillStyle = blink ? COLOR.NEON_GREEN : 'rgba(92, 255, 154, 0.15)';
    ctx.beginPath();
    ctx.arc(pf.playCenter, 916, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = blink ? '#ffffff' : 'rgba(255, 255, 255, 0.35)';
    ctx.font = 'bold 8px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('SHOOT AGAIN', pf.playCenter, 928);
    ctx.restore();
  }

  // ── Backbox (top 60 px) ─────────────────────────────────────────────────

  private drawBackbox(ctx: CanvasRenderingContext2D) {
    const grad = ctx.createLinearGradient(0, 0, 0, BACKBOX_H);
    grad.addColorStop(0, COLOR.SKY_TOP);
    grad.addColorStop(1, '#040814');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PLAYFIELD_W, BACKBOX_H);

    const t = performance.now() / 600;
    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      ctx.globalAlpha = 0.4 + 0.5 * Math.sin(t + s.tw * 7);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Small tight skyline silhouette
    this.drawCityLayer(ctx, COLOR.CITY_DARK, BACKBOX_H, [
      [0, 14], [40, 24], [80, 18], [110, 30], [150, 25], [190, 36],
      [230, 28], [270, 22], [310, 30], [350, 38], [390, 24], [430, 32], [470, 26], [510, 34],
    ], 22);
    this.drawWillisTower(ctx, 248, BACKBOX_H);
    this.drawFerrisWheel(ctx, 70, BACKBOX_H - 18, 14);
    this.drawCityLayer(ctx, COLOR.CITY_LIT, BACKBOX_H, [
      [0, 8], [30, 18], [60, 12], [90, 22], [120, 16], [150, 24],
      [180, 18], [210, 26], [240, 22], [280, 18], [310, 24],
      [340, 20], [370, 28], [400, 22], [430, 26], [460, 18], [490, 24], [520, 20],
    ], 22);
    for (const w of this.windows) {
      ctx.fillStyle = w.lit ? COLOR.WINDOW_LIGHT : COLOR.WINDOW_DIM;
      ctx.fillRect(w.x, w.y, w.w, w.h);
    }
    this.drawCTATrain(ctx, performance.now());

    // Bottom edge — chrome bezel between backbox and HUD.
    ctx.fillStyle = COLOR.METAL_DARK;
    ctx.fillRect(0, BACKBOX_H - 2, PLAYFIELD_W, 2);
    ctx.fillStyle = COLOR.METAL_LIGHT;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, BACKBOX_H - 1, PLAYFIELD_W, 0.6);
    ctx.globalAlpha = 1;
  }

  private drawCityLayer(
    ctx: CanvasRenderingContext2D,
    color: string,
    baseY: number,
    profile: number[][],
    width = 28,
  ) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (const [x, h] of profile) {
      ctx.lineTo(x, baseY - h);
      ctx.lineTo(x + width, baseY - h);
    }
    ctx.lineTo(PLAYFIELD_W, baseY);
    ctx.closePath();
    ctx.fill();
  }

  private drawWillisTower(ctx: CanvasRenderingContext2D, baseX: number, baseY: number) {
    ctx.save();
    ctx.fillStyle = '#020408';
    ctx.fillRect(baseX, baseY - 50, 28, 50);
    ctx.fillRect(baseX + 4, baseY - 56, 20, 8);
    ctx.fillRect(baseX + 9, baseY - 64, 10, 10);
    ctx.fillRect(baseX + 11, baseY - 76, 1, 13);
    ctx.fillRect(baseX + 16, baseY - 73, 1, 9);
    ctx.fillStyle = COLOR.INSERT_RED;
    ctx.shadowColor = COLOR.INSERT_RED;
    ctx.shadowBlur = 6;
    ctx.fillRect(baseX + 11, baseY - 76, 1.5, 1.5);
    ctx.fillRect(baseX + 16, baseY - 73, 1.5, 1.5);
    ctx.shadowBlur = 0;
    // Window glints
    ctx.fillStyle = COLOR.WINDOW_LIGHT;
    for (let yy = baseY - 46; yy < baseY - 4; yy += 5) {
      for (let xx = baseX + 3; xx < baseX + 25; xx += 4) {
        if (((xx + yy) % 11 + 11) % 11 < 5) {
          ctx.globalAlpha = 0.3 + ((xx * yy) % 7) * 0.06;
          ctx.fillRect(xx, yy, 1.2, 1.2);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawFerrisWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    ctx.save();
    const rot = performance.now() / 6000;
    ctx.strokeStyle = '#0a1124';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.85, cy + r * 0.75);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + r * 0.85, cy + r * 0.75);
    ctx.stroke();
    ctx.strokeStyle = '#1a233a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const cars = 10;
    for (let i = 0; i < cars; i++) {
      const a = rot + (i / cars) * Math.PI * 2;
      const sx = cx + Math.cos(a) * r;
      const sy = cy + Math.sin(a) * r;
      const hue = (i * 31) % 360;
      ctx.fillStyle = `hsl(${hue}, 90%, 65%)`;
      ctx.shadowColor = `hsl(${hue}, 90%, 65%)`;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private drawCTATrain(ctx: CanvasRenderingContext2D, now: number) {
    const trackY = 30;
    ctx.save();
    ctx.strokeStyle = '#2a3450';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, trackY);
    ctx.lineTo(PLAYFIELD_W, trackY);
    ctx.stroke();
    ctx.strokeStyle = '#1a2236';
    ctx.lineWidth = 1;
    for (let xx = 8; xx < PLAYFIELD_W; xx += 18) {
      ctx.beginPath();
      ctx.moveTo(xx, trackY);
      ctx.lineTo(xx, trackY + 12);
      ctx.stroke();
    }
    const period = 14000;
    const t = (now % period) / period;
    const trainX = -150 + t * (PLAYFIELD_W + 200);
    const carW = 32;
    const carH = 11;
    const cars = 3;
    for (let i = 0; i < cars; i++) {
      const x = trainX + i * (carW + 3);
      ctx.fillStyle = '#5a6278';
      ctx.fillRect(x, trackY - carH, carW, carH);
      ctx.fillStyle = COLOR.WINDOW_LIGHT;
      ctx.fillRect(x + 3, trackY - carH + 3, carW - 6, 3);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(x, trackY - carH, carW, 1);
    }
    ctx.restore();
  }

  // ── HUD band (60 → 130) ────────────────────────────────────────────────

  private drawHUDBand(ctx: CanvasRenderingContext2D, hud: HudInfo, pf: Playfield) {
    const { score, multiball: multiballActive } = hud;
    ctx.save();
    // Brushed-steel HUD background
    const grad = ctx.createLinearGradient(0, HUD_TOP, 0, HUD_BOT);
    grad.addColorStop(0, '#161e2e');
    grad.addColorStop(0.5, '#0c1322');
    grad.addColorStop(1, '#0a0f1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, HUD_TOP, PLAYFIELD_W, HUD_BOT - HUD_TOP);

    // Game-name plate (left)
    ctx.shadowColor = COLOR.NEON_PINK;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLOR.NEON_PINK;
    ctx.font = 'bold 16px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('CHICAGO', 12, HUD_TOP + 18);
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLOR.TEXT_DIM;
    ctx.font = '9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('THE WINDY CITY PINBALL', 12, HUD_TOP + 32);

    // Bonus multiplier (left, under the name plate) when above ×1.
    if (hud.bonusX > 1) {
      ctx.shadowColor = COLOR.NEON_GREEN;
      ctx.shadowBlur = 10;
      ctx.fillStyle = COLOR.NEON_GREEN;
      ctx.font = 'bold 13px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(`BONUS ×${hud.bonusX}`, 12, HUD_TOP + 52);
      ctx.shadowBlur = 0;
    }

    // Score (right, BIG)
    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COLOR.NEON_AMBER;
    ctx.font = 'bold 30px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(score.toLocaleString(), PLAYFIELD_W - 12, HUD_TOP + 22);
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLOR.TEXT_DIM;
    ctx.font = '9px "Helvetica Neue", Arial, sans-serif';
    const playerTag = hud.playerScores.length > 1 ? `P${hud.currentPlayer + 1} · ` : '';
    const ebTag = hud.extraBalls > 0 ? `  (+${hud.extraBalls} EB)` : '';
    ctx.fillText(`${playerTag}BALL ${Math.min(3, hud.ballNumber)} / 3${ebTag}`, PLAYFIELD_W - 12, HUD_TOP + 40);
    // Multiplayer score strip.
    if (hud.playerScores.length > 1) {
      ctx.font = 'bold 8px "Helvetica Neue", Arial, sans-serif';
      const parts = hud.playerScores.map((s, i) => `P${i + 1} ${s.toLocaleString()}`);
      for (let i = 0; i < parts.length; i++) {
        ctx.fillStyle = i === hud.currentPlayer ? COLOR.NEON_CYAN : COLOR.TEXT_DIM;
        ctx.textAlign = 'right';
        ctx.fillText(parts[i], PLAYFIELD_W - 12 - (parts.length - 1 - i) * 78, HUD_TOP + 52);
      }
    }

    // Status area — boss health bar beats everything else for the slot.
    if (hud.bossActive) {
      const barW = 170;
      const barH = 12;
      const bx = PLAYFIELD_W / 2 - barW / 2;
      const by = HUD_TOP + 10;
      ctx.save();
      ctx.fillStyle = 'rgba(40, 8, 12, 0.9)';
      ctx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
      const frac = Math.max(0, hud.bossHp) / BOSS_HP;
      ctx.shadowColor = COLOR.INSERT_RED;
      ctx.shadowBlur = 12;
      ctx.fillStyle = COLOR.INSERT_RED;
      ctx.fillRect(bx, by, barW * frac, barH);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 2, by - 2, barW + 4, barH + 4);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`CAPONE  ·  ${Math.ceil(hud.bossMsLeft / 1000)}s`, PLAYFIELD_W / 2, by + barH + 9);
      ctx.restore();
    } else if (multiballActive) {
      this.statusPill(ctx, 'MULTIBALL', COLOR.NEON_AMBER, PLAYFIELD_W / 2, HUD_TOP + 16);
    } else if (hud.tourName) {
      this.statusPill(
        ctx,
        `TOUR · ${hud.tourName} · ${Math.max(0, Math.ceil(hud.tourMsLeft / 1000))}s`,
        COLOR.INSERT_CYAN,
        PLAYFIELD_W / 2,
        HUD_TOP + 16,
      );
    } else if (hud.bossLit) {
      this.statusPill(ctx, 'SHOWDOWN LIT', COLOR.INSERT_RED, PLAYFIELD_W / 2, HUD_TOP + 16);
    }
    if (!hud.tilted && hud.tiltHeat >= 2) {
      this.statusPill(ctx, 'CAREFUL!', COLOR.INSERT_RED, PLAYFIELD_W / 2, HUD_TOP + 38);
    }

    // CHICAGO progress strip (bottom of HUD)
    const lit = pf.bank.litMask();
    const cellW = 22;
    const totalW = CHICAGO.length * cellW + (CHICAGO.length - 1) * 4;
    const startX = (PLAYFIELD_W - totalW) / 2;
    for (let i = 0; i < CHICAGO.length; i++) {
      const x = startX + i * (cellW + 4);
      const cy = HUD_TOP + 56;
      // Cell back
      ctx.fillStyle = lit[i] ? '#0a3848' : '#0a1224';
      ctx.fillRect(x, cy, cellW, 18);
      ctx.shadowColor = COLOR.NEON_CYAN;
      ctx.shadowBlur = lit[i] ? 16 : 0;
      ctx.strokeStyle = lit[i] ? COLOR.NEON_CYAN : 'rgba(63, 240, 255, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, cy, cellW, 18);
      ctx.fillStyle = lit[i] ? '#ffffff' : 'rgba(255, 255, 255, 0.45)';
      ctx.font = 'bold 13px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CHICAGO[i], x + cellW / 2, cy + 9);
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private statusPill(
    ctx: CanvasRenderingContext2D,
    text: string,
    color: string,
    cx: number,
    cy: number,
  ) {
    ctx.save();
    ctx.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 18;
    const h = 18;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = `rgba(${rgbOf(color)}, 0.18)`;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 6;
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  // ── Top apron (130 → 190) ──────────────────────────────────────────────

  private drawTopApron(ctx: CanvasRenderingContext2D, _pf: import('./scene/Playfield').Playfield) {
    const grad = ctx.createLinearGradient(0, APRON_TOP, 0, PLAYFIELD_TOP);
    grad.addColorStop(0, '#040814');
    grad.addColorStop(1, COLOR.PF_DARK);
    ctx.fillStyle = grad;
    ctx.fillRect(0, APRON_TOP, PLAYFIELD_W, PLAYFIELD_TOP - APRON_TOP);

    // "SKILL SHOT" decal across the apron.
    ctx.save();
    ctx.fillStyle = 'rgba(245, 250, 255, 0.85)';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★  SKILL SHOT  ★', PLAYFIELD_W / 2, 158);
    ctx.restore();

    // Skill-shot point values printed above the rollover lanes.
    const labels = ['10K', '25K', '10K'];
    ctx.save();
    ctx.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = COLOR.NEON_AMBER;
      ctx.fillText(labels[i], _pf.rolloverXs[i], 194);
    }
    ctx.restore();
  }

  /** Bigger themed labels stacked ABOVE each Cubs/Bears/Bulls/Sox standup. */
  private drawStandupLabels(ctx: CanvasRenderingContext2D, pf: import('./scene/Playfield').Playfield) {
    const labels = [
      { text: 'CUBS',  color: COLOR.INSERT_YELLOW, target: pf.standups[0] },
      { text: 'BEARS', color: COLOR.INSERT_AMBER,  target: pf.standups[1] },
      { text: 'BULLS', color: COLOR.INSERT_RED,    target: pf.standups[2] },
      { text: 'SOX',   color: COLOR.INSERT_PURPLE, target: pf.standups[3] },
    ];
    ctx.save();
    ctx.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { text, color, target } of labels) {
      const x = target.body.position.x;
      const y = target.body.position.y - 16;
      // Pill-shaped backdrop for the label so it reads against any
      // background (ramp plate, playfield wood, anything).
      const w = ctx.measureText(text).width + 12;
      const h = 14;
      ctx.fillStyle = 'rgba(2, 6, 14, 0.78)';
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Label text with strong glow + crisp shadow.
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x, y);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  /** Static blue water pool beneath the Lake Michigan scoop (cached). */
  private drawLakePool(ctx: CanvasRenderingContext2D, pf: Playfield) {
    const cx = pf.lakeMichiganScoop.x;
    const cy = pf.lakeMichiganScoop.y;
    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, 60);
    grad.addColorStop(0, 'rgba(78, 160, 216, 0.45)');
    grad.addColorStop(1, 'rgba(31, 74, 122, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 56, 48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Animated wave shimmer over the lake pool (drawn every frame). */
  private drawLakeShimmer(ctx: CanvasRenderingContext2D, pf: Playfield) {
    const cx = pf.lakeMichiganScoop.x;
    const cy = pf.lakeMichiganScoop.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 180, 220, 0.55)';
    ctx.lineWidth = 1;
    const t = performance.now() / 80;
    for (let yy = cy - 30; yy < cy + 30; yy += 6) {
      ctx.beginPath();
      const wob = Math.sin((yy + t) / 14) * 4;
      ctx.moveTo(cx - 36, yy + wob);
      for (let xx = cx - 30; xx <= cx + 36; xx += 8) {
        ctx.lineTo(xx, yy + Math.sin((xx + yy + t) / 12) * 1.4);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Playfield surface ─────────────────────────────────────────────────

  private drawPlayfieldFloor(ctx: CanvasRenderingContext2D) {
    const grad = ctx.createLinearGradient(0, PLAYFIELD_TOP, 0, PLAYFIELD_H);
    grad.addColorStop(0, COLOR.PF_DARK);
    grad.addColorStop(0.5, COLOR.PF_MID);
    grad.addColorStop(1, COLOR.PF_DEEP);
    ctx.fillStyle = grad;
    ctx.fillRect(0, PLAYFIELD_TOP, PLAYFIELD_W, PLAYFIELD_H - PLAYFIELD_TOP);

    // Subtle wood grain
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#3a5180';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 22; i++) {
      const yy = PLAYFIELD_TOP + 18 + i * 36;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      for (let xx = 0; xx <= PLAYFIELD_W; xx += 22) {
        ctx.lineTo(xx, yy + Math.sin(xx * 0.07 + i) * 1.5);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Edge vignette
    const vg = ctx.createRadialGradient(
      PLAYFIELD_W / 2,
      PLAYFIELD_H * 0.6,
      PLAYFIELD_W * 0.35,
      PLAYFIELD_W / 2,
      PLAYFIELD_H * 0.6,
      PLAYFIELD_W * 1.1,
    );
    vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vg.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, PLAYFIELD_TOP, PLAYFIELD_W, PLAYFIELD_H - PLAYFIELD_TOP);
  }

  private drawPlayfieldDecals(ctx: CanvasRenderingContext2D, pf: Playfield) {
    ctx.save();
    ctx.font = 'bold 11px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 5;

    // SPELL CHICAGO label in the open centre lane between the two banks.
    // (Spelling CHICAGO pays the SUPER JACKPOT; multiball comes from the
    // Bean locks — the old decal claimed otherwise.)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText('SPELL  CHICAGO', pf.playCenter, 496);
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = COLOR.INSERT_CYAN;
    ctx.fillText('FOR SUPER JACKPOT', pf.playCenter, 511);

    // Scoop labels — short so they don't collide with the ramp plates.
    ctx.font = 'bold 10px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = COLOR.RIVER_HI;
    ctx.fillText('LAKE', pf.lakeMichiganScoop.x, pf.lakeMichiganScoop.y + 26);
    ctx.fillStyle = COLOR.INSERT_AMBER;
    ctx.fillText('MODE', pf.cityTourScoop.x, pf.cityTourScoop.y + 26);

    // CAPTIVE BALL label above its lane.
    ctx.fillStyle = COLOR.NEON_GREEN;
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('CAPTIVE', pf.captive.x, pf.captive.y - 86);

    ctx.restore();

    // Loop-lane entrance arrows along the edge channels.
    for (const x of pf.loopArrowXs) {
      insertArrow(ctx, x, 590, 11, -Math.PI / 2, COLOR.INSERT_PURPLE, true);
    }
    ctx.save();
    ctx.font = 'bold 8px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR.INSERT_PURPLE;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    for (const x of pf.loopArrowXs) ctx.fillText('LOOP', x, 614);
    ctx.restore();
  }

  private drawWalls(ctx: CanvasRenderingContext2D, pf: Playfield) {
    ctx.save();
    for (const w of pf.walls) {
      const verts = w.body.vertices;
      if (verts.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
      ctx.closePath();
      if (w.kind === 'wood') {
        ctx.fillStyle = '#0a0a0e';
        ctx.fill();
      } else {
        // Polished steel rail: dark fill + bright chrome outline + faint
        // inner highlight stroke. Brightened so the lane structure reads
        // even against the dark playfield.
        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#1a2236';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = COLOR.METAL_LIGHT;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── Toasts + overlays ─────────────────────────────────────────────────

  private drawToasts(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let i = 0;
    for (const t of this.toasts) {
      const a = Math.min(1, t.ttl / 600);
      const offset = (1 - t.ttl / t.total) * -16;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = a;
      ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
      // Stronger contrast: white text with colored shadow.
      ctx.fillText(t.text, PLAYFIELD_W / 2, 700 + i * 30 + offset);
      ctx.fillStyle = t.color;
      ctx.shadowBlur = 0;
      ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(t.text, PLAYFIELD_W / 2, 700 + i * 30 + offset);
      i++;
    }
    ctx.restore();
  }

  private drawTitle(ctx: CanvasRenderingContext2D, highScore: number) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, APRON_TOP, PLAYFIELD_W, PLAYFIELD_H - APRON_TOP);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = COLOR.NEON_PINK;
    ctx.shadowBlur = 28;
    ctx.fillStyle = COLOR.NEON_PINK;
    ctx.font = 'bold 64px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('CHICAGO', PLAYFIELD_W / 2, 380);

    ctx.shadowColor = COLOR.NEON_CYAN;
    ctx.shadowBlur = 14;
    ctx.fillStyle = COLOR.NEON_CYAN;
    ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('THE WINDY CITY PINBALL', PLAYFIELD_W / 2, 432);

    ctx.shadowBlur = 0;
    ctx.fillStyle = COLOR.TEXT;
    ctx.font = '13px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('LOCK 3 BALLS · SPELL CHICAGO · HIT THE SCOOP', PLAYFIELD_W / 2, 478);

    if (highScore > 0) {
      ctx.shadowColor = COLOR.NEON_AMBER;
      ctx.shadowBlur = 10;
      ctx.fillStyle = COLOR.TEXT_GOLD;
      ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(`HIGH SCORE  ${highScore.toLocaleString()}`, PLAYFIELD_W / 2, 520);
      ctx.shadowBlur = 0;
    }

    const blink = Math.sin(performance.now() / 300) > 0;
    if (blink) {
      ctx.shadowColor = COLOR.NEON_AMBER;
      ctx.shadowBlur = 14;
      ctx.fillStyle = COLOR.NEON_AMBER;
      ctx.font = 'bold 18px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(IS_TOUCH ? 'TAP TO START' : 'PRESS ENTER TO START', PLAYFIELD_W / 2, 600);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLOR.TEXT_DIM;
    ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(
      IS_TOUCH ? 'Tap sides to flip · Hold to charge plunger' : 'Z / ⁄ flippers · SPACE plunger',
      PLAYFIELD_W / 2,
      640,
    );
    ctx.restore();
  }

  private drawGameOver(ctx: CanvasRenderingContext2D, hud: HudInfo) {
    const { playerScores, highScore, matchNumber, matched } = hud;
    const best = Math.max(...playerScores);
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, APRON_TOP, PLAYFIELD_W, PLAYFIELD_H - APRON_TOP);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = COLOR.NEON_PINK;
    ctx.shadowBlur = 22;
    ctx.fillStyle = COLOR.NEON_PINK;
    ctx.font = 'bold 52px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('GAME OVER', PLAYFIELD_W / 2, 400);
    // Scoreboard — every player, winner in amber.
    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 12;
    for (let i = 0; i < playerScores.length; i++) {
      const s = playerScores[i];
      const isWinner = s === best;
      ctx.fillStyle = isWinner ? COLOR.NEON_AMBER : COLOR.TEXT_DIM;
      ctx.font = `bold ${playerScores.length > 1 ? 22 : 28}px "Helvetica Neue", Arial, sans-serif`;
      const label = playerScores.length > 1 ? `P${i + 1}   ${s.toLocaleString()}` : s.toLocaleString();
      ctx.fillText(label, PLAYFIELD_W / 2, 452 + i * 30);
    }
    const afterScores = 452 + playerScores.length * 30 + 8;
    if (highScore > 0) {
      ctx.shadowBlur = 8;
      ctx.fillStyle = best >= highScore ? COLOR.TEXT_GOLD : COLOR.TEXT_DIM;
      ctx.font = 'bold 14px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(
        best >= highScore ? '★ NEW HIGH SCORE ★' : `HIGH SCORE  ${highScore.toLocaleString()}`,
        PLAYFIELD_W / 2,
        afterScores,
      );
    }
    // Match sequence.
    ctx.shadowBlur = matched ? 16 : 4;
    ctx.shadowColor = COLOR.NEON_GREEN;
    ctx.fillStyle = matched ? COLOR.NEON_GREEN : COLOR.TEXT_DIM;
    ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(
      matched ? `MATCH  ${String(matchNumber).padStart(2, '0')} — WELL PLAYED!` : `MATCH  ${String(matchNumber).padStart(2, '0')}`,
      PLAYFIELD_W / 2,
      afterScores + 26,
    );
    const blink = Math.sin(performance.now() / 300) > 0;
    if (blink) {
      ctx.shadowColor = COLOR.NEON_CYAN;
      ctx.shadowBlur = 14;
      ctx.fillStyle = COLOR.NEON_CYAN;
      ctx.font = 'bold 16px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(IS_TOUCH ? 'TAP TO RETURN TO TITLE' : 'PRESS ENTER FOR TITLE', PLAYFIELD_W / 2, afterScores + 62);
    }
    ctx.restore();
  }

  private drawReadyHint(ctx: CanvasRenderingContext2D, hud: HudInfo) {
    const holding = hud.plungerHolding;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = COLOR.NEON_CYAN;
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px "Helvetica Neue", Arial, sans-serif';
    let msg: string;
    if (IS_TOUCH) msg = holding ? 'RELEASE TO LAUNCH' : 'TAP & HOLD TO PULL PLUNGER';
    else msg = holding ? 'RELEASE SPACE TO LAUNCH' : 'HOLD SPACE TO PULL PLUNGER';
    // Above the apron so it doesn't collide with the apron art.
    ctx.fillText(msg, PLAYFIELD_W / 2, 874);
    if (hud.playerScores.length > 1) {
      ctx.fillStyle = COLOR.NEON_CYAN;
      ctx.font = 'bold 16px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(`PLAYER ${hud.currentPlayer + 1}`, PLAYFIELD_W / 2, 850);
    } else if (hud.ballNumber === 1 && !IS_TOUCH) {
      ctx.fillStyle = COLOR.TEXT_DIM;
      ctx.font = '10px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('ENTER ADDS PLAYERS (UP TO 4)', PLAYFIELD_W / 2, 852);
    }
    ctx.restore();
  }
}

/** Six-pointed star (the Chicago flag star). */
function drawStar6(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function rgbOf(hex: string): string {
  if (hex.startsWith('rgb')) return hex.slice(hex.indexOf('(') + 1, hex.indexOf(')'));
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}
