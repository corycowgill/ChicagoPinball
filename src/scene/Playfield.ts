import Matter from 'matter-js';
import { Physics, setTransit } from '../Physics';
import { Ball } from '../entities/Ball';
import { Flipper } from '../entities/Flipper';
import { Plunger } from '../entities/Plunger';
import { PopBumper } from '../entities/PopBumper';
import { Bean } from '../entities/Bean';
import { Slingshot } from '../entities/Slingshot';
import { Spinner } from '../entities/Spinner';
import { Scoop } from '../entities/Scoop';
import { CaptiveBall } from '../entities/CaptiveBall';
import { ChicagoBank } from '../entities/ChicagoBank';
import { Rollover } from '../entities/Rollover';
import { StandupTarget } from '../entities/StandupTarget';
import { Ramp } from '../entities/Ramp';
import {
  PLAYFIELD_W,
  PLAYFIELD_H,
  WALL_THICKNESS,
  BALL_RADIUS,
  POINTS,
  COLOR,
  SCOOP_HOLD_MS,
  PLUNGER_MIN_LAUNCH,
  PLUNGER_LAUNCH_RANGE,
} from '../constants';
import { ScoreEvent } from '../types';

export interface PlayfieldEvents {
  onScore: (e: ScoreEvent) => void;
  onDrain: (ball: Matter.Body) => void;
  onLockComplete: () => void;
  onScoopMode: () => void;
}

interface Pt {
  x: number;
  y: number;
}

interface WallDef {
  body: Matter.Body;
  outline: Pt[];
  kind?: 'rail' | 'wood' | 'plastic';
}

/** A ball being carried along a fixed path (ramp habitrail / shooter lane).
 *  While in transit the ball is a non-colliding ghost that follows the
 *  drawn rail exactly, so the visuals and the physics agree. */
interface Transit {
  ball: Matter.Body;
  path: Pt[];
  /** Cumulative arc length at each path point. */
  cum: number[];
  total: number;
  dist: number;
  /** px per 60 Hz step. */
  speed: number;
  exitVel: Pt;
}

/** Vertical zoning of the playfield (the canvas itself is 540×960). */
export const BACKBOX_BOTTOM = 60;
export const HUD_BOTTOM = 130;
export const PLAYFIELD_TOP = 200; // start of the playable surface proper

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
  leftRamp: Ramp;
  rightRamp: Ramp;
  cityTourScoop: Scoop;
  lakeMichiganScoop: Scoop;
  captive: CaptiveBall;
  rollovers: Rollover[] = [];
  standups: StandupTarget[] = [];

  walls: WallDef[] = [];
  postPositions: { x: number; y: number; r?: number }[] = [];
  drainSensor: Matter.Body;

  /** Shooter lane geometry — vertical strip on the right side. */
  readonly laneInnerX = PLAYFIELD_W - 60; // 480
  readonly laneOuterX = PLAYFIELD_W - 8; // 532
  readonly launchX = (this.laneInnerX + this.laneOuterX) / 2; // 506

  /** Effective play-area (excludes the shooter lane). */
  readonly playRight = this.laneInnerX;
  readonly playCenter = this.playRight / 2; // 240

  /** Flipper geometry. Tip-to-tip gap ≈ 39 px — wider than the ball (22),
   *  so the centre drain is real, like an actual machine. */
  readonly flipperY = PLAYFIELD_H - 200; // 760
  readonly flipperGap = 118;

  /** Skill-shot rollover lanes (x centres, top of the playfield). */
  readonly rolloverXs = [190, 240, 290];
  readonly rolloverY = 226;

  private transits: Transit[] = [];
  /** ms until an auto-plunge fires for a freshly served ball. */
  private autoLaunchMs = 0;
  private clockMs = 0;
  private lastCaptiveScoreAt = -1000;

  launchRestY: number;

  constructor(private physics: Physics, private events: PlayfieldEvents) {
    this.buildWalls();

    // ── PLUNGER + initial ball resting on its head ──
    const plungerW = this.laneOuterX - this.laneInnerX - 4;
    this.plunger = new Plunger(this.launchX, PLAYFIELD_H - 60, plungerW);
    physics.add(this.plunger.body);
    // Rest the ball exactly on the plunger head (no initial overlap jitter).
    this.launchRestY = PLAYFIELD_H - 60 - this.plunger.height / 2 - BALL_RADIUS;

    const initialBall = new Ball(this.launchX, this.launchRestY);
    this.balls.push(initialBall);
    physics.add(initialBall.body);

    // ── FLIPPERS ──
    this.leftFlipper = new Flipper('left', this.playCenter - this.flipperGap, this.flipperY);
    this.rightFlipper = new Flipper('right', this.playCenter + this.flipperGap, this.flipperY);
    physics.add(this.leftFlipper.body, this.leftFlipper.pivot);
    physics.add(this.rightFlipper.body, this.rightFlipper.pivot);

    // ── SLINGSHOTS — compact triangles above the flippers. The vertical
    //    outer edge doubles as the inlane's inner wall. ──
    const slingTopY = 650;
    const slingBotY = 720;
    const slingOuterL = 84;
    const slingInnerL = 148;
    const slingOuterR = this.playRight - slingOuterL;
    const slingInnerR = this.playRight - slingInnerL;
    this.slingshots.push(
      new Slingshot(
        [
          { x: slingOuterL, y: slingTopY },
          { x: slingOuterL, y: slingBotY },
          { x: slingInnerL, y: slingBotY + 4 },
        ],
        norm({ x: 0.72, y: -0.69 }),
      ),
      new Slingshot(
        [
          { x: slingOuterR, y: slingTopY },
          { x: slingOuterR, y: slingBotY },
          { x: slingInnerR, y: slingBotY + 4 },
        ],
        norm({ x: -0.72, y: -0.69 }),
      ),
    );
    for (const s of this.slingshots) physics.add(s.body);

    // ── SKILL-SHOT ROLLOVERS — three real lanes with guide walls (built in
    //    buildWalls). Values: 10K / 25K / 10K; lane picked by plunger power. ──
    const rolloverLetters = ['10K', '25K', '10K'];
    for (let i = 0; i < 3; i++) {
      const r = new Rollover(this.rolloverXs[i], this.rolloverY, rolloverLetters[i], i);
      this.rollovers.push(r);
      physics.add(r.sensor);
    }

    // ── THE BEAN — chrome dome below the rollover lanes; multiball lock. ──
    this.bean = new Bean(this.playCenter, 300, 24);
    physics.add(this.bean.body);

    // ── POP BUMPERS — triangle below the Bean. ──
    this.popBumpers.push(new PopBumper(this.playCenter - 55, 355, 19, COLOR.INSERT_AMBER));
    this.popBumpers.push(new PopBumper(this.playCenter + 55, 355, 19, COLOR.INSERT_RED));
    this.popBumpers.push(new PopBumper(this.playCenter, 408, 19, COLOR.INSERT_BLUE));
    for (const p of this.popBumpers) physics.add(p.body);

    // ── SPORTS TEAM STANDUPS — flanking the bumper cluster, angled inward. ──
    this.standups.push(
      new StandupTarget({ x: 126, y: 316, angle: 0.5, color: COLOR.INSERT_YELLOW, id: 'cubs', width: 34, height: 11 }),
      new StandupTarget({ x: 114, y: 388, angle: 0.72, color: COLOR.INSERT_AMBER, id: 'bears', width: 34, height: 11 }),
      new StandupTarget({ x: this.playRight - 126, y: 316, angle: -0.5, color: COLOR.INSERT_RED, id: 'bulls', width: 34, height: 11 }),
      new StandupTarget({ x: this.playRight - 114, y: 388, angle: -0.72, color: COLOR.INSERT_PURPLE, id: 'sox', width: 34, height: 11 }),
    );
    for (const s of this.standups) physics.add(s.body);

    // ── CHICAGO DROP TARGETS — two angled banks flanking the centre lane:
    //    "CHI" up the left diagonal, "CAGO" down the right diagonal. The
    //    centre of the playfield stays open (the old single horizontal row
    //    was an impassable wall — 10 px gaps vs a 22 px ball). ──
    this.bank = new ChicagoBank(physics, [
      // C-H-I: left bank, bottom → top, facing the right flipper.
      { x: 152, y: 468, angle: -0.8 },
      { x: 178, y: 441, angle: -0.8 },
      { x: 204, y: 414, angle: -0.8 },
      // C-A-G-O: right bank, top → bottom, facing the left flipper.
      { x: 276, y: 414, angle: 0.8 },
      { x: 302, y: 441, angle: 0.8 },
      { x: 328, y: 468, angle: 0.8 },
      { x: 354, y: 495, angle: 0.8 },
    ]);

    // ── LEFT RAMP — Willis Tower (orange). Mouth mid-left (a right-flipper
    //    shot), plate climbs the left side, habitrail crosses the top and
    //    drops the ball into the RIGHT inlane. ──
    this.leftRamp = new Ramp({
      plate: [
        { x: 150, y: 560 },
        { x: 110, y: 495 },
        { x: 88, y: 410 },
        { x: 84, y: 320 },
        { x: 106, y: 255 },
        { x: 150, y: 222 },
        { x: 195, y: 208 },
      ],
      habitrail: [
        { x: 195, y: 208 },
        { x: 258, y: 192 },
        { x: 336, y: 200 },
        { x: 404, y: 232 },
        { x: 459, y: 300 },
        { x: 459, y: 580 },
        { x: 434, y: 618 },
        { x: 417, y: 640 },
      ],
      exitVel: { x: 0.4, y: 6 },
      color: COLOR.INSERT_AMBER,
      arrowAngle: -Math.PI / 2 - 0.45,
      label: 'left-ramp',
      themeText: 'WILLIS',
    });
    physics.add(this.leftRamp.entry);

    // ── RIGHT RAMP — CTA Loop (cyan). Mirror image, returns to LEFT inlane
    //    (straight over the spinner). ──
    this.rightRamp = new Ramp({
      plate: [
        { x: 330, y: 560 },
        { x: 370, y: 495 },
        { x: 392, y: 410 },
        { x: 396, y: 320 },
        { x: 374, y: 255 },
        { x: 330, y: 222 },
        { x: 285, y: 208 },
      ],
      habitrail: [
        { x: 285, y: 208 },
        { x: 222, y: 192 },
        { x: 144, y: 200 },
        { x: 76, y: 232 },
        { x: 21, y: 300 },
        { x: 21, y: 580 },
        { x: 46, y: 618 },
        { x: 63, y: 640 },
      ],
      exitVel: { x: -0.4, y: 6 },
      color: COLOR.INSERT_CYAN,
      arrowAngle: -Math.PI / 2 + 0.45,
      label: 'right-ramp',
      themeText: 'CTA',
    });
    physics.add(this.rightRamp.entry);

    // ── LAKE MICHIGAN SCOOP — saucer up the left side. ──
    this.lakeMichiganScoop = new Scoop(80, 540, -Math.PI / 2 + 0.35, 15);
    (this.lakeMichiganScoop.sensor as Matter.Body).label = 'lake-scoop';
    physics.add(this.lakeMichiganScoop.sensor);

    // ── CITY TOUR SCOOP — mode-start saucer up the right side. ──
    this.cityTourScoop = new Scoop(this.playRight - 80, 545, -Math.PI / 2 - 0.35, 15);
    physics.add(this.cityTourScoop.sensor);

    // ── CAPTIVE BALL — vertical lane on the far right; a left-flipper shot
    //    straight up the right edge strikes it through the stop posts. ──
    this.captive = new CaptiveBall(430, 494);
    physics.add(this.captive.ball, this.captive.tether, ...this.captive.walls);

    // ── SPINNER — sits across the LEFT INLANE, so every right-ramp return
    //    (and any inlane pass) spins it. ──
    this.spinner = new Spinner(63, 678, 34);
    physics.add(this.spinner.body, this.spinner.pivot, this.spinner.stop);

    // ── DRAIN sensor (across the play area only). ──
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
      for (const b of this.balls) {
        if ((b.body as unknown as { $transit?: boolean }).$transit) continue;
        b.capVelocity();
        b.unstickIfStalled();
      }
      const revs = this.spinner.collectRevolutions();
      if (revs > 0) {
        this.events.onScore({ kind: 'spinner', points: POINTS.SPINNER_REV * revs });
      }
    });
    physics.afterUpdate(() => {
      this.leftFlipper.enforce();
      this.rightFlipper.enforce();
    });

    this.wireCollisions();
  }

  // ── Collision routing ────────────────────────────────────────────────────

  private wireCollisions() {
    const physics = this.physics;

    physics.on('bean', (_s, o) => {
      if (o.label !== 'ball') return;
      this.bean.pop(o);
      this.events.onScore({ kind: 'bean', points: POINTS.BEAN });
      // The Bean is the multiball lock: every Nth hit captures the ball.
      if (this.bean.registerHit()) {
        this.events.onScore({ kind: 'lock', points: POINTS.LOCK });
        const ball = this.balls.find((b) => b.body === o);
        if (ball) {
          this.removeBall(ball.body);
          this.physics.defer(() => this.events.onLockComplete());
        }
      }
    });
    // Keep pushing the ball away if it tries to rest against the bean.
    physics.onActive('bean', (_s, o) => {
      if (o.label !== 'ball') return;
      this.bean.pop(o);
    });

    physics.on('pop-bumper', (self, o) => {
      if (o.label !== 'ball') return;
      this.popBumpers.find((p) => p.body === self)?.pop(o);
      this.events.onScore({ kind: 'pop-bumper', points: POINTS.POP_BUMPER });
    });
    physics.onActive('pop-bumper', (self, o) => {
      if (o.label !== 'ball') return;
      // Only re-kick slow balls (don't double-fire a clean bounce).
      if (Math.hypot(o.velocity.x, o.velocity.y) > 4) return;
      this.popBumpers.find((p) => p.body === self)?.pop(o);
    });

    physics.on('slingshot', (self, o) => {
      if (o.label !== 'ball') return;
      this.slingshots.find((sl) => sl.body === self)?.pop(o);
      this.events.onScore({ kind: 'slingshot', points: POINTS.SLINGSHOT });
    });
    physics.onActive('slingshot', (self, o) => {
      if (o.label !== 'ball') return;
      if (Math.hypot(o.velocity.x, o.velocity.y) > 4) return;
      this.slingshots.find((sl) => sl.body === self)?.pop(o);
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
          const points = r.letter === '25K' ? POINTS.SKILL_SHOT_CENTER : POINTS.SKILL_SHOT_SIDE;
          this.events.onScore({ kind: 'skill-shot', points });
        }
      });
    }

    for (const s of this.standups) {
      physics.on(s.label, (_self, o) => {
        if (o.label !== 'ball') return;
        s.hit();
        this.events.onScore({ kind: 'standup', points: POINTS.STANDUP });
      });
    }

    // Ramp mouths: a ball entering with enough upward speed rides the
    // drawn plate + habitrail all the way to the opposite inlane.
    const rampEntry = (ramp: Ramp) => (_s: Matter.Body, o: Matter.Body) => {
      if (o.label !== 'ball') return;
      if (!ramp.canMake(o)) return;
      ramp.flashNow();
      this.events.onScore({ kind: 'ramp', points: POINTS.RAMP });
      this.physics.defer(() => this.startTransit(o, ramp.fullPath, 12, ramp.exitVel));
    };
    physics.on('left-ramp-entry', rampEntry(this.leftRamp));
    physics.on('right-ramp-entry', rampEntry(this.rightRamp));

    physics.on('captive-ball', (_s, o) => {
      if (o.label !== 'ball') return;
      // Require a real impact and rate-limit so a resting contact can't
      // farm points.
      const rel = Math.hypot(o.velocity.x - this.captive.ball.velocity.x, o.velocity.y - this.captive.ball.velocity.y);
      if (rel < 2) return;
      if (this.clockMs - this.lastCaptiveScoreAt < 350) return;
      this.lastCaptiveScoreAt = this.clockMs;
      this.captive.pulseFlash();
      this.events.onScore({ kind: 'captive', points: POINTS.CAPTIVE_BALL });
    });

    physics.on('scoop', (_s, o) => {
      if (o.label !== 'ball') return;
      if (this.cityTourScoop.capture(o)) {
        this.events.onScore({ kind: 'scoop', points: POINTS.SCOOP });
        this.events.onScoopMode();
      }
    });
    physics.on('lake-scoop', (_s, o) => {
      if (o.label !== 'ball') return;
      if (this.lakeMichiganScoop.capture(o)) {
        this.events.onScore({ kind: 'lake-bonus', points: 1500 });
      }
    });

    physics.on('drain', (_s, o) => {
      if (o.label === 'ball') this.events.onDrain(o);
    });

    // Shooter-lane exit: the launched ball rides the visible wireform over
    // the back of the playfield and drops into a skill-shot lane chosen by
    // how hard the plunger was pulled (arrival speed at the lane top).
    physics.on('launch-exit', (_s, o) => {
      if (o.label !== 'ball') return;
      if (o.velocity.y >= 0) return; // only upward-moving balls
      const arrivalSpeed = -o.velocity.y;
      const laneIdx = arrivalSpeed > 8 ? 0 : arrivalSpeed > 4.5 ? 1 : 2;
      const path = this.shooterPath(this.rolloverXs[laneIdx]);
      this.physics.defer(() => this.startTransit(o, path, 10, { x: 0, y: 3.5 }));
    });
  }

  /** The wireform from the top of the shooter lane, across the back panel,
   *  down into the chosen skill lane. Also drawn by the Renderer. */
  shooterPath(laneX: number): Pt[] {
    return [
      { x: this.launchX, y: 172 },
      { x: 496, y: 152 },
      { x: 430, y: 142 },
      { x: 340, y: 140 },
      { x: laneX + 22, y: 148 },
      { x: laneX, y: 164 },
      { x: laneX, y: 186 },
    ];
  }

  // ── Ball transit (ramp / shooter path following) ─────────────────────────

  private startTransit(ball: Matter.Body, path: Pt[], speed: number, exitVel: Pt) {
    if ((ball as unknown as { $transit?: boolean }).$transit) return;
    const cum: number[] = [0];
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      cum.push(total);
    }
    setTransit(ball, true);
    ball.isSensor = true;
    Matter.Body.setVelocity(ball, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(ball, 0);
    Matter.Body.setPosition(ball, { x: path[0].x, y: path[0].y });
    this.transits.push({ ball, path, cum, total, dist: 0, speed, exitVel });
  }

  private tickTransits(dtMs: number) {
    for (let i = this.transits.length - 1; i >= 0; i--) {
      const t = this.transits[i];
      t.dist += t.speed * (dtMs / (1000 / 60));
      if (t.dist >= t.total) {
        const end = t.path[t.path.length - 1];
        Matter.Body.setPosition(t.ball, { x: end.x, y: end.y });
        t.ball.isSensor = false;
        setTransit(t.ball, false);
        Matter.Body.setVelocity(t.ball, { x: t.exitVel.x, y: t.exitVel.y });
        this.transits.splice(i, 1);
        continue;
      }
      // Sample the polyline at arc length t.dist.
      let seg = 1;
      while (seg < t.cum.length - 1 && t.cum[seg] < t.dist) seg++;
      const a = t.path[seg - 1];
      const b = t.path[seg];
      const segLen = t.cum[seg] - t.cum[seg - 1] || 1;
      const f = (t.dist - t.cum[seg - 1]) / segLen;
      Matter.Body.setPosition(t.ball, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      Matter.Body.setVelocity(t.ball, { x: 0, y: 0 });
    }
  }

  // ── Walls / static geometry ──────────────────────────────────────────────

  private addWall(body: Matter.Body, kind: WallDef['kind'] = 'rail') {
    this.physics.add(body);
    this.walls.push({ body, outline: polyOf(body), kind });
  }

  private rail(x1: number, y1: number, x2: number, y2: number, thickness = 6) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const body = Matter.Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len, thickness, {
      isStatic: true,
      angle: Math.atan2(dy, dx),
      label: 'wall',
      chamfer: { radius: Math.min(3, thickness / 2 - 0.1) },
    });
    this.addWall(body, 'rail');
  }

  private buildWalls() {
    const t = WALL_THICKNESS;
    const W = PLAYFIELD_W;
    const H = PLAYFIELD_H;

    // Outer cabinet walls.
    for (const w of [
      Matter.Bodies.rectangle(W / 2, -t / 2, W, t, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(W / 2, H + t / 2, W, t, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(-t / 2, H / 2, t, H, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(W + t / 2, H / 2, t, H, { isStatic: true, label: 'wall' }),
    ]) {
      this.physics.add(w);
      this.walls.push({ body: w, outline: [], kind: 'wood' });
    }

    // ── SHOOTER LANE ──
    // Inner wall separating the lane from the playfield.
    this.rail(this.laneInnerX, 176, this.laneInnerX, H - 32, 6);
    // Exit sensor at the top of the lane: a ball that clears it starts the
    // wireform transit into a skill lane; a weak plunge never reaches it and
    // rolls back onto the plunger.
    const launchExitSensor = Matter.Bodies.rectangle(
      this.launchX,
      172,
      this.laneOuterX - this.laneInnerX,
      8,
      { isStatic: true, isSensor: true, label: 'launch-exit' },
    );
    this.physics.add(launchExitSensor);

    // Back wall across the top of the play area (the shooter lane stays open).
    this.rail(6, 172, this.laneInnerX - 4, 172, 6);

    // Rounded top corners: diagonals deflecting edge shots toward the lanes.
    this.rail(6, 250, 148, 180, 6);
    this.rail(this.playRight - 6, 250, this.playRight - 148, 180, 6);

    // ── ROLLOVER LANE GUIDES — four short rails making three real lanes. ──
    for (const gx of [165, 215, 265, 315]) {
      this.rail(gx, 202, gx, 248, 5);
      this.postPositions.push({ x: gx, y: 250, r: 4 });
    }

    // ── BOTTOM GEOMETRY — proper inlanes and outlanes.
    //
    //   wall │ outlane │ rail │ inlane │ slingshot …flippers… │ (mirror)
    //         x<42        42     42-84    84+
    //
    // Each side is one L-shaped guide: a vertical rail splitting outlane
    // from inlane, then a diagonal return that feeds the flipper. Balls in
    // the outlane (outside the rail) drain; balls in the inlane roll down
    // the diagonal onto the flipper.
    const railX = 42;
    const railTop = 608;
    const railBot = 740;

    // The return diagonals MUST stop short of the flipper root: the bat is a
    // dynamic body, and a static rail overlapping its swept volume jams the
    // swing solid (the collision solver cancels the rotation every step).
    // Ending ~18 px from the pivot leaves a gap far smaller than the ball.
    this.rail(railX, railTop, railX, railBot, 6);
    this.rail(railX, railBot, 104, 750, 6);
    // Right side (mirror; the shooter-lane wall is the outer boundary).
    const rRailX = this.playRight - railX; // 438
    this.rail(rRailX, railTop, rRailX, railBot, 6);
    this.rail(rRailX, railBot, this.playRight - 104, 750, 6);

    // Decorative posts that make the lane mouths readable.
    this.postPositions.push(
      { x: railX, y: railTop - 8, r: 5 },
      { x: rRailX, y: railTop - 8, r: 5 },
      { x: 84, y: 644, r: 5 },
      { x: this.playRight - 84, y: 644, r: 5 },
    );
  }

  // ── Ball management ──────────────────────────────────────────────────────

  hasBall(body: Matter.Body): boolean {
    return this.balls.some((b) => b.body === body);
  }

  resetBall() {
    if (this.balls.length === 0) {
      const b = new Ball(this.launchX, this.launchRestY);
      this.balls.push(b);
      this.physics.add(b.body);
    } else {
      this.balls[0].setPosition(this.launchX, this.launchRestY);
    }
    // New ball in play: skill-shot lanes re-arm.
    for (const r of this.rollovers) r.reset();
  }

  /** Serve a fresh ball onto the plunger. With `autoLaunch` (used while a
   *  game is in progress, e.g. after a Bean lock) the machine plunges it
   *  itself after a beat. */
  serveBall(autoLaunch = false): Ball {
    const b = new Ball(this.launchX, this.launchRestY);
    this.balls.push(b);
    this.physics.add(b.body);
    if (autoLaunch) this.autoLaunchMs = 700;
    return b;
  }

  /** Remove a ball from play. The array shrinks immediately (so callers can
   *  count remaining balls synchronously); the physics body is removed
   *  after the current step. */
  removeBall(ball: Matter.Body) {
    this.balls = this.balls.filter((b) => b.body !== ball);
    this.transits = this.transits.filter((t) => t.ball !== ball);
    this.physics.defer(() => this.physics.remove(ball));
  }

  isBallInLaunchLane(ball: Matter.Body): boolean {
    return ball.position.x > this.laneInnerX - BALL_RADIUS;
  }

  setFlippers(left: boolean, right: boolean) {
    this.leftFlipper.setActive(left);
    this.rightFlipper.setActive(right);
  }

  /** Launch whichever ball is sitting in the shooter lane. `pull` is the
   *  plunger pull fraction (0..1); a weak pull won't clear the lane. */
  applyPlungerLaunch(pull: number) {
    if (pull <= 0) return;
    const lane = this.balls.find((b) => this.isBallInLaunchLane(b.body));
    if (!lane) return;
    Matter.Body.setVelocity(lane.body, {
      x: 0,
      y: -(PLUNGER_MIN_LAUNCH + pull * PLUNGER_LAUNCH_RANGE),
    });
  }

  tick(dtMs: number) {
    this.clockMs += dtMs;
    this.tickTransits(dtMs);

    if (this.autoLaunchMs > 0) {
      this.autoLaunchMs -= dtMs;
      if (this.autoLaunchMs <= 0) this.applyPlungerLaunch(0.95);
    }

    this.bean.tick(dtMs);
    for (const p of this.popBumpers) p.tick(dtMs);
    for (const s of this.slingshots) s.tick(dtMs);
    for (const r of this.rollovers) r.tick(dtMs);
    for (const s of this.standups) s.tick(dtMs);
    this.leftRamp.tick(dtMs);
    this.rightRamp.tick(dtMs);
    this.bank.tick(dtMs);
    this.plunger.tick(dtMs);
    this.captive.tick(dtMs);
    this.cityTourScoop.tick(dtMs, SCOOP_HOLD_MS);
    this.lakeMichiganScoop.tick(dtMs, SCOOP_HOLD_MS);
  }

  /** Start multiball: spawn the locked balls fanned out around the Bean. */
  releaseLocks(): number {
    const count = this.bean.locked;
    this.bean.releaseLocks();
    const spreadX = [-70, 0, 70];
    for (let i = 0; i < count; i++) {
      const b = this.serveBall();
      Matter.Body.setPosition(b.body, {
        x: this.bean.cx + (spreadX[i] ?? 0),
        y: spreadX[i] === 0 ? this.bean.cy - this.bean.radius - 14 : 270,
      });
      Matter.Body.setVelocity(b.body, { x: (spreadX[i] ?? 0) / 24, y: 3 });
      Matter.Body.setAngularVelocity(b.body, 0);
    }
    return count;
  }
}

function norm(v: Pt): Pt {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

function polyOf(body: Matter.Body): Pt[] {
  return body.vertices.map((v) => ({ x: v.x, y: v.y }));
}
