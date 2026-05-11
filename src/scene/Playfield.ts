import Matter from 'matter-js';
import { Physics } from '../Physics';
import { Ball } from '../entities/Ball';
import { Flipper } from '../entities/Flipper';
import { Plunger } from '../entities/Plunger';
import { PopBumper } from '../entities/PopBumper';
import { Bean } from '../entities/Bean';
import { Slingshot } from '../entities/Slingshot';
import { Spinner } from '../entities/Spinner';
import { CenterRamp } from '../entities/CenterRamp';
import { Scoop } from '../entities/Scoop';
import { BallLock } from '../entities/BallLock';
import { CaptiveBall } from '../entities/CaptiveBall';
import { ChicagoBank } from '../entities/ChicagoBank';
import { Rollover } from '../entities/Rollover';
import { StandupTarget } from '../entities/StandupTarget';
import {
  PLAYFIELD_W,
  PLAYFIELD_H,
  WALL_THICKNESS,
  BALL_RADIUS,
  POINTS,
  COLOR,
  SCOOP_HOLD_MS,
} from '../constants';
import { ScoreEvent } from '../types';

export interface PlayfieldEvents {
  onScore: (e: ScoreEvent) => void;
  onDrain: (ball: Matter.Body) => void;
  onLockComplete: () => void;
  onScoopMode: () => void;
}

interface WallDef {
  body: Matter.Body;
  outline: { x: number; y: number }[];
  kind?: 'rail' | 'wood' | 'plastic';
}

/** Playfield Y zones (after the backbox + HUD band):
 *    PLAYFIELD_TOP=190  ─ start of actual playfield
 *    190-260            ─ rollover lanes
 *    260-360            ─ Bean + pop-bumper cluster + standup targets
 *    360-540            ─ captive ball, lock, drop targets, center ramp
 *    540-640            ─ spinner, scoop, ramp throat
 *    640-740            ─ slingshots, inlanes
 *    740-880            ─ flippers
 *    880-960            ─ drain
 */
export const PLAYFIELD_TOP = 190;

export class Playfield {
  balls: Ball[] = [];
  leftFlipper: Flipper;
  rightFlipper: Flipper;
  plunger: Plunger;
  popBumpers: PopBumper[] = [];
  bean: Bean;
  slingshots: Slingshot[] = [];
  bank: ChicagoBank;
  spinner: Spinner;
  centerRamp: CenterRamp;
  scoop: Scoop;
  lock: BallLock;
  captive: CaptiveBall;
  rollovers: Rollover[] = [];
  standups: StandupTarget[] = [];

  walls: WallDef[] = [];
  postPositions: { x: number; y: number; r?: number }[] = [];
  drainSensor: Matter.Body;

  /** Decorative habitrail polylines drawn on top of the playfield — these
   *  are the chrome wireforms that visibly attach to the lock subway and the
   *  ramp exit (they aren't physics colliders; the ball travels invisibly
   *  along the rail through scripted teleports / sensors). Keeping the rails
   *  short and clearly anchored avoids the "wires-floating-in-space" look. */
  habitrails: { points: { x: number; y: number }[]; tone: 'chrome' | 'plastic' }[] = [];

  readonly launchX = PLAYFIELD_W - 30;
  readonly launchRestY = PLAYFIELD_H - 80;

  readonly playRight = PLAYFIELD_W - 56;
  readonly playCenter = (PLAYFIELD_W - 56) / 2;

  constructor(private physics: Physics, private events: PlayfieldEvents) {
    this.buildWalls();

    const initialBall = new Ball(this.launchX, this.launchRestY);
    this.balls.push(initialBall);
    physics.add(initialBall.body);

    // ── Flippers — bigger bats, gap of ~30 px (a bit over a ball-width). ──
    const flipperY = PLAYFIELD_H - 145;
    const flipperGap = 113;
    this.leftFlipper = new Flipper('left', this.playCenter - flipperGap, flipperY);
    this.rightFlipper = new Flipper('right', this.playCenter + flipperGap, flipperY);
    physics.add(this.leftFlipper.body, this.leftFlipper.pivot);
    physics.add(this.rightFlipper.body, this.rightFlipper.pivot);

    // ── Slingshots — sit just above the flippers, mirror-symmetric. ──
    const slingY = flipperY - 60;
    const slingOuterL = 38;
    const slingOuterR = 2 * this.playCenter - slingOuterL;
    const slingInnerL = this.playCenter - (flipperGap - 18);
    const slingInnerR = 2 * this.playCenter - slingInnerL;
    this.slingshots.push(
      new Slingshot(
        [
          { x: slingOuterL, y: slingY - 64 },
          { x: slingOuterL, y: slingY + 26 },
          { x: slingInnerL, y: slingY + 28 },
        ],
        norm({ x: 0.85, y: -0.5 }),
      ),
    );
    this.slingshots.push(
      new Slingshot(
        [
          { x: slingOuterR, y: slingY - 64 },
          { x: slingOuterR, y: slingY + 26 },
          { x: slingInnerR, y: slingY + 28 },
        ],
        norm({ x: -0.85, y: -0.5 }),
      ),
    );
    for (const s of this.slingshots) physics.add(s.body);

    // ── Top rollover lanes (5 lanes for skill shot + bonus advance). ──
    const rolloverY = 215;
    const rolloverLetters = ['C', 'H', 'I', 'C', 'O'];
    for (let i = 0; i < 5; i++) {
      const x = 70 + i * ((this.playRight - 140) / 4);
      const r = new Rollover(x, rolloverY, rolloverLetters[i]);
      this.rollovers.push(r);
      physics.add(r.sensor);
    }

    // ── The Bean — small chrome dome upper-centre, just below rollovers. ──
    this.bean = new Bean(this.playCenter, 256, 28);
    physics.add(this.bean.body);

    // ── Pop bumpers — tight triangle BELOW the bean. ──
    this.popBumpers.push(new PopBumper(this.playCenter - 56, 320, 20, COLOR.INSERT_AMBER));
    this.popBumpers.push(new PopBumper(this.playCenter + 56, 320, 20, COLOR.INSERT_RED));
    this.popBumpers.push(new PopBumper(this.playCenter, 366, 20, COLOR.INSERT_BLUE));
    for (const p of this.popBumpers) physics.add(p.body);

    // ── Standup targets flanking the upper playfield. Sports-team themed:
    //    Cubs (yellow), Bears (orange-amber), Bulls (red), Sox (purple). ──
    this.standups.push(new StandupTarget({ x: 48, y: 280, angle: 0.5, color: COLOR.INSERT_YELLOW, id: 'cubs' }));
    this.standups.push(new StandupTarget({ x: 56, y: 340, angle: 0.6, color: COLOR.INSERT_AMBER, id: 'bears' }));
    this.standups.push(new StandupTarget({ x: this.playRight - 48, y: 280, angle: -0.5, color: COLOR.INSERT_RED, id: 'bulls' }));
    this.standups.push(new StandupTarget({ x: this.playRight - 56, y: 340, angle: -0.6, color: COLOR.INSERT_PURPLE, id: 'sox' }));
    for (const s of this.standups) physics.add(s.body);

    // ── Captive ball lane on the LEFT (below the standups). ──
    this.captive = new CaptiveBall(95, 430, 54);
    physics.add(this.captive.ball, ...this.captive.walls);

    // ── Multiball lock — saucer at the END of a short feeder lane. The
    //    rail visibly leads from the upper playfield into the lock.
    this.lock = new BallLock(70, 530);
    physics.add(this.lock.sensor);
    this.habitrails.push({
      points: [
        { x: 110, y: 470 },
        { x: 92, y: 495 },
        { x: 76, y: 520 },
      ],
      tone: 'chrome',
    });

    // ── CHICAGO drop-target bank — vertical, LEFT of centre. ──
    this.bank = new ChicagoBank(physics, {
      x: 170,
      yTop: 440,
      spacing: 22,
    });

    // ── Centre ramp — short translucent chute up the middle, ends well
    //    BELOW the bumpers. Visually reads as "shoot the ball into the
    //    centre tunnel". A short habitrail curves the ball off-screen back
    //    toward the right inlane.
    this.centerRamp = new CenterRamp({
      entry: { x: this.playCenter, y: 600 },
      exit: { x: this.playCenter, y: 420 },
      path: [
        { x: this.playCenter, y: 600 },
        { x: this.playCenter, y: 550 },
        { x: this.playCenter, y: 500 },
        { x: this.playCenter, y: 450 },
        { x: this.playCenter, y: 420 },
      ],
    });
    physics.add(this.centerRamp.entry, this.centerRamp.exit);
    // Short return habitrail — ramp exit curves up-right and disappears
    // behind the standup target row.
    this.habitrails.push({
      points: [
        { x: this.playCenter + 4, y: 420 },
        { x: this.playCenter + 50, y: 410 },
        { x: this.playCenter + 110, y: 380 },
      ],
      tone: 'chrome',
    });

    // ── Scoop — saucer on the RIGHT just inside the right inlane, fed by
    //    a visible short rail from above. Mode start.
    this.scoop = new Scoop(this.playRight - 70, 580, -Math.PI / 2 - 0.3, 18);
    physics.add(this.scoop.sensor);
    this.habitrails.push({
      points: [
        { x: this.playRight - 100, y: 520 },
        { x: this.playRight - 85, y: 550 },
        { x: this.playRight - 70, y: 580 },
      ],
      tone: 'chrome',
    });

    // ── Spinner — Lake Michigan, far-left inlane above the slingshot.
    this.spinner = new Spinner(54, 620, 36);
    physics.add(this.spinner.body, this.spinner.pivot, this.spinner.stop);

    // ── Plunger ──
    const laneInnerX = PLAYFIELD_W - 56 + 3;
    const laneOuterX = PLAYFIELD_W - 1;
    const plungerCx = (laneInnerX + laneOuterX) / 2;
    const plungerW = laneOuterX - laneInnerX - 4;
    this.plunger = new Plunger(plungerCx, PLAYFIELD_H - 60, plungerW);
    physics.add(this.plunger.body);

    // ── Drain sensor at the bottom — only across the play area. ──
    this.drainSensor = Matter.Bodies.rectangle(
      this.playCenter,
      PLAYFIELD_H - 4,
      this.playRight - 12,
      6,
      { isStatic: true, isSensor: true, label: 'drain' },
    );
    physics.add(this.drainSensor);

    // ── Per-step ticks ──
    physics.beforeUpdate(() => {
      this.leftFlipper.tick();
      this.rightFlipper.tick();
      for (const b of this.balls) b.capVelocity();
      const revs = this.spinner.collectRevolutions();
      if (revs > 0) {
        this.events.onScore({ kind: 'spinner', points: POINTS.SPINNER_REV * revs });
      }
    });
    physics.afterUpdate(() => {
      this.leftFlipper.enforce();
      this.rightFlipper.enforce();
    });

    // ── Collision routing ──
    physics.on('bean', (_s, o) => {
      if (o.label !== 'ball') return;
      this.bean.pop(o);
      this.events.onScore({ kind: 'bean', points: POINTS.BEAN });
    });
    physics.on('pop-bumper', (self, o) => {
      if (o.label !== 'ball') return;
      const b = this.popBumpers.find((p) => p.body === self);
      if (b) b.pop(o);
      this.events.onScore({ kind: 'pop-bumper', points: POINTS.POP_BUMPER });
    });
    physics.on('slingshot', (self, o) => {
      if (o.label !== 'ball') return;
      const s = this.slingshots.find((sl) => sl.body === self);
      if (s) s.pop(o);
      this.events.onScore({ kind: 'slingshot', points: POINTS.SLINGSHOT });
    });
    for (const t of this.bank.targets) {
      physics.on(t.body.label, (self, o) => {
        if (o.label !== 'ball') return;
        const r = this.bank.onHit(self);
        if (r.points > 0) {
          this.events.onScore({
            kind: r.superJackpot ? 'super-jackpot' : 'drop-target',
            points: r.points,
            letter: r.letter,
          });
        }
      });
    }
    for (const r of this.rollovers) {
      physics.on(r.label, (_s, o) => {
        if (o.label !== 'ball') return;
        if (!r.lit) {
          r.trigger();
          this.events.onScore({ kind: 'spinner', points: 100 });
        }
      });
    }
    for (const s of this.standups) {
      physics.on(s.label, (_self, o) => {
        if (o.label !== 'ball') return;
        s.hit();
        this.events.onScore({ kind: 'pop-bumper', points: 250 });
      });
    }
    physics.on('centerramp-entry', (_s, o) => {
      if (o.label === 'ball') this.centerRamp.arm();
    });
    physics.on('centerramp-exit', (_s, o) => {
      if (o.label !== 'ball') return;
      if (this.centerRamp.triggerExit())
        this.events.onScore({ kind: 'center-ramp', points: POINTS.CENTER_RAMP });
    });
    physics.on('captive-ball', (_s, o) => {
      if (o.label !== 'ball') return;
      this.captive.pulseFlash();
      this.events.onScore({ kind: 'captive', points: POINTS.CAPTIVE_BALL });
    });
    physics.on('scoop', (_s, o) => {
      if (o.label !== 'ball') return;
      if (this.scoop.capture(o)) {
        this.events.onScore({ kind: 'scoop', points: POINTS.SCOOP });
        this.events.onScoopMode();
      }
    });
    physics.on('lock', (_s, o) => {
      if (o.label !== 'ball') return;
      if (this.lock.tryLock(o)) {
        this.events.onScore({ kind: 'lock', points: POINTS.LOCK });
        const ball = this.balls.find((b) => b.body === o);
        if (ball) {
          this.physics.defer(() => {
            this.physics.remove(ball.body);
            this.balls = this.balls.filter((b) => b !== ball);
            this.events.onLockComplete();
          });
        }
      }
    });
    physics.on('drain', (_s, o) => {
      if (o.label === 'ball') this.events.onDrain(o);
    });
  }

  private addWall(body: Matter.Body, outline: { x: number; y: number }[], kind: WallDef['kind'] = 'rail') {
    this.physics.add(body);
    this.walls.push({ body, outline, kind });
  }

  private buildWalls() {
    const t = WALL_THICKNESS;
    const W = PLAYFIELD_W;
    const H = PLAYFIELD_H;

    // Outer perimeter (apron / cabinet)
    for (const w of [
      Matter.Bodies.rectangle(W / 2, -t / 2, W, t, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(W / 2, H + t / 2, W, t, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(-t / 2, H / 2, t, H, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(W + t / 2, H / 2, t, H, { isStatic: true, label: 'wall' }),
    ]) {
      this.addWall(w, [], 'wood');
    }

    // Backbox / playfield divider — a thin polished metal rail across the
    // top of the playfield at y = PLAYFIELD_TOP, with a centred opening for
    // the ball to enter from above (used by the launch lane).
    const dividerY = PLAYFIELD_TOP;
    const gapX = this.playCenter;
    const gapW = 86;
    // Left half of divider
    {
      const len = gapX - gapW / 2 - 6;
      const cx = (6 + gapX - gapW / 2) / 2;
      const div = Matter.Bodies.rectangle(cx, dividerY, len, 6, {
        isStatic: true,
        label: 'wall',
      });
      this.addWall(div, polyOf(div), 'rail');
    }
    {
      const fromX = gapX + gapW / 2;
      const toX = this.playRight - 6;
      const len = toX - fromX;
      const cx = (fromX + toX) / 2;
      const div = Matter.Bodies.rectangle(cx, dividerY, len, 6, {
        isStatic: true,
        label: 'wall',
      });
      this.addWall(div, polyOf(div), 'rail');
    }

    // Launch lane separator
    const laneX = W - 56;
    const laneTop = 110;
    const laneBottom = H - 50;
    const laneWall = Matter.Bodies.rectangle(
      laneX,
      (laneTop + laneBottom) / 2,
      6,
      laneBottom - laneTop,
      { isStatic: true, label: 'wall' },
    );
    this.addWall(laneWall, polyOf(laneWall), 'rail');

    // Lane top deflector (under the divider) that funnels a launched ball
    // leftward into the playfield.
    const defLeft = { x: laneX - 32, y: dividerY };
    const defRight = { x: W + 4, y: laneTop - 4 };
    const defDx = defRight.x - defLeft.x;
    const defDy = defRight.y - defLeft.y;
    const defLen = Math.hypot(defDx, defDy);
    const defBody = Matter.Bodies.rectangle(
      (defLeft.x + defRight.x) / 2,
      (defLeft.y + defRight.y) / 2,
      defLen,
      8,
      { isStatic: true, angle: Math.atan2(defDy, defDx), label: 'wall' },
    );
    this.addWall(defBody, polyOf(defBody), 'rail');

    // Inlane diagonals — funnel the ball from the slingshots toward the
    // flipper tips. Steeper angle for a tighter inlane geometry.
    const drainAngle = 0.5;
    const inlaneLen = 170;
    const inlaneCx = 90;
    const inlaneCxRight = laneX - inlaneCx;
    const inlaneCy = H - 220;
    const lInlane = Matter.Bodies.rectangle(inlaneCx, inlaneCy, 8, inlaneLen, {
      isStatic: true,
      angle: drainAngle,
      label: 'wall',
    });
    const rInlane = Matter.Bodies.rectangle(inlaneCxRight, inlaneCy, 8, inlaneLen, {
      isStatic: true,
      angle: -drainAngle,
      label: 'wall',
    });
    this.addWall(lInlane, polyOf(lInlane), 'rail');
    this.addWall(rInlane, polyOf(rInlane), 'rail');

    // Outlane outer rails — short verticals just inside the outer wall.
    const outlaneCx = 22;
    const outlaneCxRight = laneX - outlaneCx;
    const lOutlane = Matter.Bodies.rectangle(outlaneCx, H - 270, 6, 200, {
      isStatic: true,
      label: 'wall',
    });
    const rOutlane = Matter.Bodies.rectangle(outlaneCxRight, H - 270, 6, 200, {
      isStatic: true,
      label: 'wall',
    });
    this.addWall(lOutlane, polyOf(lOutlane), 'rail');
    this.addWall(rOutlane, polyOf(rOutlane), 'rail');

    // Decorative metal posts at lane junctions
    this.postPositions = [
      { x: 36, y: H - 270 + 100 + 4 },
      { x: laneX - 36, y: H - 270 + 100 + 4 },
      { x: 22, y: H - 270 - 100 - 4 },
      { x: laneX - 22, y: H - 270 - 100 - 4 },
      { x: this.playCenter - 22, y: 590 }, // ramp throat
      { x: this.playCenter + 22, y: 590 },
      { x: 92, y: 480 }, // lock feeder posts
      { x: this.playRight - 90, y: 540 }, // scoop feeder
    ];
  }

  resetBall() {
    if (this.balls.length === 0) {
      const b = new Ball(this.launchX, this.launchRestY);
      this.balls.push(b);
      this.physics.add(b.body);
    } else {
      this.balls[0].setPosition(this.launchX, this.launchRestY);
    }
  }

  serveBall(): Ball {
    const b = new Ball(this.launchX, this.launchRestY);
    this.balls.push(b);
    this.physics.add(b.body);
    return b;
  }

  removeBall(ball: Matter.Body) {
    this.physics.defer(() => {
      this.physics.remove(ball);
      this.balls = this.balls.filter((b) => b.body !== ball);
    });
  }

  isBallInLaunchLane(ball: Matter.Body): boolean {
    return ball.position.x > PLAYFIELD_W - 56 - BALL_RADIUS;
  }

  setFlippers(left: boolean, right: boolean) {
    this.leftFlipper.setActive(left);
    this.rightFlipper.setActive(right);
  }

  applyPlungerLaunch(forceMag: number) {
    const lane = this.balls.find((b) => this.isBallInLaunchLane(b.body));
    if (!lane) return;
    if (forceMag <= 0) return;
    Matter.Body.setVelocity(lane.body, {
      x: 0,
      y: -Math.min(28, 8 + forceMag * 600),
    });
  }

  tick(dtMs: number) {
    this.bean.tick(dtMs);
    for (const p of this.popBumpers) p.tick(dtMs);
    for (const s of this.slingshots) s.tick(dtMs);
    for (const r of this.rollovers) r.tick(dtMs);
    for (const s of this.standups) s.tick(dtMs);
    this.centerRamp.tick(dtMs);
    this.bank.tick(dtMs);
    this.plunger.tick(dtMs);
    this.captive.tick(dtMs);
    const kicked = this.scoop.tick(dtMs, SCOOP_HOLD_MS);
    void kicked;
  }

  releaseLocks(): number {
    const count = this.lock.locked;
    this.lock.release();
    for (let i = 0; i < count; i++) {
      const b = this.serveBall();
      Matter.Body.setPosition(b.body, { x: this.launchX, y: this.launchRestY - i * 22 });
      Matter.Body.setVelocity(b.body, { x: 0, y: -20 - i * 2 });
    }
    return count;
  }
}

function norm(v: { x: number; y: number }) {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

function polyOf(body: Matter.Body): { x: number; y: number }[] {
  return body.vertices.map((v) => ({ x: v.x, y: v.y }));
}
