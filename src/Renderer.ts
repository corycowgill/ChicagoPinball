import { COLOR, PLAYFIELD_W, PLAYFIELD_H, CHICAGO } from './constants';
import { Playfield } from './scene/Playfield';
import { GameState } from './types';
import { metalPost } from './Graphics';

interface Toast {
  text: string;
  color: string;
  ttl: number;
  total: number;
}

const IS_TOUCH =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;

export class Renderer {
  private toasts: Toast[] = [];
  private flashJackpot = 0;
  /** Procedurally-generated star field for the night sky. */
  private stars: { x: number; y: number; r: number; tw: number }[] = [];
  /** Procedurally-generated city windows. */
  private windows: { x: number; y: number; w: number; h: number; lit: boolean }[] = [];

  constructor() {
    // Stable seeded layout — same across all renders within this session.
    let seed = 1;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 60; i++) {
      this.stars.push({ x: rand() * PLAYFIELD_W, y: rand() * 130, r: rand() * 0.9 + 0.3, tw: rand() });
    }
    // Window grid for the city silhouette
    for (let bx = 30; bx < PLAYFIELD_W - 30; bx += 6) {
      for (let by = 80; by < 200; by += 9) {
        if (rand() < 0.2) {
          this.windows.push({ x: bx, y: by, w: 2, h: 2, lit: rand() < 0.7 });
        }
      }
    }
  }

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
    multiballActive: boolean,
    modeMsLeft: number,
  ) {
    // Layer 1: backbox sky + city silhouette (above the playfield).
    this.drawBackdrop(ctx);
    // Layer 2: playfield wood + decals (beneath all toys).
    this.drawPlayfieldFloor(ctx, pf);
    // Layer 3: ramps and orbits (raised plastic / metal).
    this.drawLanesAndRamps(ctx, pf);
    // Layer 4: inserts and decals on the playfield surface.
    this.drawInserts(ctx, pf);
    // Layer 5: toys (bumpers, slings, scoop, lock, captive, bean, drop targets, spinner, flippers, plunger).
    pf.bank.draw(ctx);
    pf.captive.draw(ctx);
    pf.spinner.draw(ctx);
    pf.scoop.draw(ctx);
    pf.lock.draw(ctx);
    pf.bean.draw(ctx);
    for (const p of pf.popBumpers) p.draw(ctx);
    for (const s of pf.slingshots) s.draw(ctx);
    pf.leftFlipper.draw(ctx);
    pf.rightFlipper.draw(ctx);
    pf.plunger.draw(ctx);
    // Layer 6: walls outline (for railings).
    this.drawWalls(ctx, pf);
    // Layer 7: chrome posts at junctions.
    for (const p of pf.postPositions) metalPost(ctx, p.x, p.y, p.r ?? 5);
    // Layer 8: balls (always on top of toys).
    for (const b of pf.balls) b.draw(ctx);

    // HUD + overlays.
    this.drawHUD(ctx, score, ballsRemaining, pf, state, multiballActive, modeMsLeft);
    this.drawToasts(ctx);

    if (this.flashJackpot > 0) {
      const a = Math.min(0.45, (this.flashJackpot / 1500) * 0.45);
      ctx.save();
      ctx.fillStyle = `rgba(255, 215, 100, ${a})`;
      ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);
      ctx.restore();
    }

    if (state === GameState.TITLE) this.drawTitle(ctx);
    else if (state === GameState.GAME_OVER) this.drawGameOver(ctx, score);
    else if (state === GameState.READY) this.drawReadyHint(ctx, plungerHolding);
  }

  // ── Layers ─────────────────────────────────────────────────────────────

  private drawBackdrop(ctx: CanvasRenderingContext2D) {
    // Deep night sky
    const grad = ctx.createLinearGradient(0, 0, 0, 220);
    grad.addColorStop(0, COLOR.SKY_TOP);
    grad.addColorStop(1, '#040814');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PLAYFIELD_W, 220);

    // Atmospheric glow over the city
    const glow = ctx.createRadialGradient(PLAYFIELD_W / 2, 200, 50, PLAYFIELD_W / 2, 200, 220);
    glow.addColorStop(0, 'rgba(80, 130, 220, 0.35)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, PLAYFIELD_W, 220);

    // Stars (twinkle)
    const t = performance.now() / 600;
    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      const a = 0.4 + 0.5 * Math.sin(t + s.tw * 7);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // City silhouette layers (back to front)
    this.drawCityLayer(ctx, COLOR.CITY_DARK, 200, [
      [0, 60], [40, 100], [70, 80], [100, 130], [140, 110], [170, 160],
      [200, 140], [240, 130], [280, 90], [320, 110], [360, 140], [400, 100], [440, 130], [480, 110], [520, 140],
    ]);

    // Willis Tower — distinctive black tower with antenna, slightly right-of-center.
    this.drawWillisTower(ctx, 305, 200);

    // Ferris wheel (Navy Pier) — far left
    this.drawFerrisWheel(ctx, 70, 175, 38);

    // Front silhouette + windows
    this.drawCityLayer(ctx, COLOR.CITY_LIT, 200, [
      [0, 30], [30, 70], [60, 50], [90, 90], [120, 70], [150, 95],
      [180, 75], [210, 105], [240, 95], [270, 60], [300, 80], [330, 100],
      [360, 90], [390, 110], [420, 90], [450, 105], [480, 70], [510, 95], [540, 80],
    ]);

    // Windows
    for (const w of this.windows) {
      ctx.fillStyle = w.lit ? COLOR.WINDOW_LIGHT : COLOR.WINDOW_DIM;
      ctx.fillRect(w.x, w.y, w.w, w.h);
    }

    // Chicago River bridge (Michigan Avenue style — twin bascule towers)
    this.drawBridge(ctx, PLAYFIELD_W / 2, 200);

    // CTA elevated train across the upper backbox
    this.drawCTATrain(ctx, performance.now());
  }

  private drawCityLayer(
    ctx: CanvasRenderingContext2D,
    color: string,
    baseY: number,
    profile: number[][],
  ) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (const [x, h] of profile) {
      ctx.lineTo(x, baseY - h);
      ctx.lineTo(x + 28, baseY - h);
    }
    ctx.lineTo(PLAYFIELD_W, baseY);
    ctx.closePath();
    ctx.fill();
  }

  private drawWillisTower(ctx: CanvasRenderingContext2D, baseX: number, baseY: number) {
    ctx.save();
    // Stepped tower silhouette
    ctx.fillStyle = '#020408';
    ctx.fillRect(baseX, baseY - 165, 36, 165);
    ctx.fillRect(baseX + 4, baseY - 175, 28, 30); // mid setback
    ctx.fillRect(baseX + 10, baseY - 195, 16, 30); // upper setback
    // Antenna spires
    ctx.fillRect(baseX + 13, baseY - 220, 2, 25);
    ctx.fillRect(baseX + 21, baseY - 215, 2, 20);
    // Spire tip lights
    ctx.fillStyle = COLOR.INSERT_RED;
    ctx.shadowColor = COLOR.INSERT_RED;
    ctx.shadowBlur = 8;
    ctx.fillRect(baseX + 13, baseY - 220, 2, 2);
    ctx.fillRect(baseX + 21, baseY - 215, 2, 2);
    ctx.shadowBlur = 0;
    // Window grid on the main shaft
    ctx.fillStyle = COLOR.WINDOW_LIGHT;
    for (let yy = baseY - 158; yy < baseY - 8; yy += 7) {
      for (let xx = baseX + 3; xx < baseX + 33; xx += 5) {
        if (((xx + yy) % 11 + 11) % 11 < 6) {
          ctx.globalAlpha = 0.35 + ((xx * yy) % 7) * 0.06;
          ctx.fillRect(xx, yy, 1.5, 1.5);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawFerrisWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    ctx.save();
    // Slow rotation
    const rot = performance.now() / 6000;
    // Support legs
    ctx.strokeStyle = '#0a1124';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.85, cy + r);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + r * 0.85, cy + r);
    ctx.stroke();
    // Wheel rim
    ctx.strokeStyle = '#1a233a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // Spokes + cars (lit dots at the rim)
    const cars = 12;
    for (let i = 0; i < cars; i++) {
      const a = rot + (i / cars) * Math.PI * 2;
      const sx = cx + Math.cos(a) * r;
      const sy = cy + Math.sin(a) * r;
      ctx.strokeStyle = 'rgba(40, 50, 80, 0.6)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      // Car (lit)
      const hue = (i * 31) % 360;
      ctx.fillStyle = `hsl(${hue}, 90%, 65%)`;
      ctx.shadowColor = `hsl(${hue}, 90%, 65%)`;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    // Hub
    ctx.fillStyle = COLOR.METAL_DARK;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawBridge(ctx: CanvasRenderingContext2D, cx: number, baseY: number) {
    ctx.save();
    // Two short bascule towers at the river's edge
    const towerH = 38;
    const towerW = 8;
    const span = 50;
    ctx.fillStyle = '#080c1a';
    ctx.fillRect(cx - span / 2 - towerW, baseY - towerH, towerW, towerH);
    ctx.fillRect(cx + span / 2, baseY - towerH, towerW, towerH);
    // Cross-cable indicating a bascule mechanism
    ctx.strokeStyle = '#1a2236';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - span / 2 - towerW + 1, baseY - towerH);
    ctx.lineTo(cx + span / 2 + towerW - 1, baseY - towerH);
    ctx.stroke();
    // River beneath the bridge
    const river = ctx.createLinearGradient(0, baseY - 2, 0, baseY + 16);
    river.addColorStop(0, COLOR.RIVER_BLUE);
    river.addColorStop(1, '#0c1a2e');
    ctx.fillStyle = river;
    ctx.fillRect(0, baseY - 2, PLAYFIELD_W, 18);
    // River shimmer
    ctx.strokeStyle = 'rgba(78, 160, 216, 0.55)';
    ctx.lineWidth = 1;
    const t = performance.now() / 80;
    for (let yy = baseY + 2; yy < baseY + 14; yy += 4) {
      ctx.beginPath();
      const wob = Math.sin((yy + t) / 14) * 6;
      for (let xx = 0; xx < PLAYFIELD_W; xx += 30) {
        if (xx === 0) ctx.moveTo(xx, yy + wob);
        else ctx.lineTo(xx, yy + Math.sin((xx + yy + t) / 11) * 1.5);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCTATrain(ctx: CanvasRenderingContext2D, now: number) {
    ctx.save();
    // Elevated track at y=58 across the backbox.
    const trackY = 56;
    ctx.strokeStyle = '#2a3450';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, trackY + 4);
    ctx.lineTo(PLAYFIELD_W, trackY + 4);
    ctx.stroke();
    // Rail ties / supports
    ctx.strokeStyle = '#1a2236';
    ctx.lineWidth = 1;
    for (let xx = 8; xx < PLAYFIELD_W; xx += 18) {
      ctx.beginPath();
      ctx.moveTo(xx, trackY);
      ctx.lineTo(xx, trackY + 16);
      ctx.stroke();
    }

    // Train animation — moves left to right, wraps every 14s
    const period = 14000;
    const t = (now % period) / period;
    const totalLen = PLAYFIELD_W + 200;
    const trainX = -150 + t * totalLen;
    const carW = 38;
    const carH = 14;
    const cars = 3;
    for (let i = 0; i < cars; i++) {
      const x = trainX + i * (carW + 4);
      ctx.fillStyle = '#5a6278';
      ctx.fillRect(x, trackY - carH, carW, carH);
      // Window strip
      ctx.fillStyle = COLOR.WINDOW_LIGHT;
      ctx.fillRect(x + 3, trackY - carH + 3, carW - 6, 4);
      // Side highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(x, trackY - carH, carW, 1);
    }
    ctx.restore();
  }

  private drawPlayfieldFloor(ctx: CanvasRenderingContext2D, _pf: Playfield) {
    // Playfield wood — dark gradient with subtle radial vignette.
    const grad = ctx.createLinearGradient(0, 220, 0, PLAYFIELD_H);
    grad.addColorStop(0, COLOR.PF_DARK);
    grad.addColorStop(0.5, COLOR.PF_MID);
    grad.addColorStop(1, COLOR.PF_DEEP);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 220, PLAYFIELD_W, PLAYFIELD_H - 220);

    // Faint wood-grain noise lines for texture.
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#3a5180';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 20; i++) {
      const yy = 230 + i * 36;
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
      PLAYFIELD_H * 0.55,
      PLAYFIELD_W * 0.35,
      PLAYFIELD_W / 2,
      PLAYFIELD_H * 0.55,
      PLAYFIELD_W * 1.1,
    );
    vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vg.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 220, PLAYFIELD_W, PLAYFIELD_H - 220);
  }

  private drawLanesAndRamps(ctx: CanvasRenderingContext2D, pf: Playfield) {
    pf.leftOrbit.draw(ctx);
    pf.rightOrbit.draw(ctx);
    pf.centerRamp.draw(ctx);
  }

  private drawInserts(ctx: CanvasRenderingContext2D, _pf: Playfield) {
    // Decorative "MULTIBALL" / "MODE" / "JACKPOT" labels printed on the playfield.
    ctx.save();
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(120, 150, 200, 0.35)';
    ctx.textAlign = 'center';
    ctx.fillText('JACKPOT', _pf.playCenter, 195);
    ctx.fillText('MULTIBALL', _pf.playCenter, 568);
    ctx.fillText('MODE', _pf.scoop.x, _pf.scoop.y - 50);
    ctx.fillText('SPINNER', 78, 510);
    ctx.fillText('LAKE MICHIGAN', 78, 528);
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
        // Apron wood — warm brown gradient (drawn very subtly since outer
        // walls fall outside the visible canvas anyway).
        ctx.fillStyle = '#1a1410';
        ctx.fill();
      } else {
        // Polished metal rail with shadow + highlight.
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#0a1020';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = COLOR.METAL_MID;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Inner highlight
        ctx.strokeStyle = 'rgba(220, 230, 245, 0.3)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── HUD ─────────────────────────────────────────────────────────────────

  private drawHUD(
    ctx: CanvasRenderingContext2D,
    score: number,
    ballsRemaining: number,
    pf: Playfield,
    state: GameState,
    multiballActive: boolean,
    modeMsLeft: number,
  ) {
    ctx.save();
    // Top translucent banner
    ctx.fillStyle = 'rgba(2, 4, 12, 0.78)';
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

    // Score (right side, big amber)
    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLOR.NEON_AMBER;
    ctx.font = 'bold 20px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(score.toLocaleString(), PLAYFIELD_W - 12, 14);

    // Ball + status
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLOR.TEXT_DIM;
    ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`BALL ${Math.max(1, ballsRemaining)} / 3`, 12, 42);

    if (multiballActive) {
      ctx.shadowColor = COLOR.NEON_AMBER;
      ctx.shadowBlur = 12;
      ctx.fillStyle = COLOR.NEON_AMBER;
      ctx.font = 'bold 11px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★ MULTIBALL ★', PLAYFIELD_W / 2, 42);
    } else if (modeMsLeft > 0) {
      ctx.shadowColor = COLOR.INSERT_CYAN;
      ctx.shadowBlur = 10;
      ctx.fillStyle = COLOR.INSERT_CYAN;
      ctx.font = 'bold 11px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`MODE ${(modeMsLeft / 1000).toFixed(0)}s`, PLAYFIELD_W / 2, 42);
    }

    // CHICAGO progress strip (right of HUD)
    const lit = pf.bank.litMask();
    const startX = 230;
    const cellW = 20;
    for (let i = 0; i < CHICAGO.length; i++) {
      const x = startX + i * (cellW + 3);
      ctx.shadowBlur = lit[i] ? 14 : 0;
      ctx.shadowColor = COLOR.NEON_CYAN;
      ctx.strokeStyle = lit[i] ? COLOR.NEON_CYAN : 'rgba(63, 240, 255, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, 33, cellW, 18);
      ctx.fillStyle = lit[i] ? COLOR.NEON_CYAN : 'rgba(63, 240, 255, 0.32)';
      ctx.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CHICAGO[i], x + cellW / 2, 42);
    }

    // Hint
    if (state === GameState.PLAYING) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = COLOR.TEXT_DIM;
      ctx.font = '10px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(IS_TOUCH ? 'TAP SIDES TO FLIP' : 'Z / ⁄ FLIPPERS', PLAYFIELD_W - 12, 42);
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
      const offset = (1 - t.ttl / t.total) * -16;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = t.color;
      ctx.globalAlpha = a;
      ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(t.text, PLAYFIELD_W / 2, 600 + i * 28 + offset);
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

  private drawGameOver(ctx: CanvasRenderingContext2D, score: number) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = COLOR.NEON_PINK;
    ctx.shadowBlur = 22;
    ctx.fillStyle = COLOR.NEON_PINK;
    ctx.font = 'bold 52px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('GAME OVER', PLAYFIELD_W / 2, 420);
    ctx.shadowColor = COLOR.NEON_AMBER;
    ctx.shadowBlur = 16;
    ctx.fillStyle = COLOR.NEON_AMBER;
    ctx.font = 'bold 28px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(score.toLocaleString(), PLAYFIELD_W / 2, 480);
    const blink = Math.sin(performance.now() / 300) > 0;
    if (blink) {
      ctx.shadowColor = COLOR.NEON_CYAN;
      ctx.shadowBlur = 14;
      ctx.fillStyle = COLOR.NEON_CYAN;
      ctx.font = 'bold 16px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(IS_TOUCH ? 'TAP TO RETURN TO TITLE' : 'PRESS ENTER FOR TITLE', PLAYFIELD_W / 2, 560);
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
    if (IS_TOUCH) msg = holding ? 'RELEASE TO LAUNCH' : 'TAP & HOLD TO PULL PLUNGER';
    else msg = holding ? 'RELEASE SPACE TO LAUNCH' : 'HOLD SPACE TO PULL PLUNGER';
    ctx.fillText(msg, PLAYFIELD_W / 2, PLAYFIELD_H - 40);
    ctx.restore();
  }
}
