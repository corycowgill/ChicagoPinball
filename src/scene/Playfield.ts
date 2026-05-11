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
import { Orbit } from '../entities/Orbit';
import { Scoop } from '../entities/Scoop';
import { BallLock } from '../entities/BallLock';
import { CaptiveBall } from '../entities/CaptiveBall';
import { ChicagoBank } from '../entities/ChicagoBank';
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
import { metalPost } from '../Graphics';

export interface PlayfieldEvents {
  onScore: (e: ScoreEvent) => void;
  onDrain: (ball: Matter.Body) => void;
  onLockComplete: () => void;
  onScoopMode: () => void;
}

/** Description of a single static wall with a polygon shape — kept around so
 *  the renderer can outline them with a polished metal look. */
interface WallDef {
  body: Matter.Body;
  /** Outline points in world space. */
  outline: { x: number; y: number }[];
  /** Optional rendered style override. */
  kind?: 'rail' | 'wood' | 'plastic';
}

export class Playfield {
  /** All balls currently in play (1 normally, 2-3 during multiball). */
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
  leftOrbit: Orbit;
  rightOrbit: Orbit;
  scoop: Scoop;
  lock: BallLock;
  captive: CaptiveBall;

  walls: WallDef[] = [];
  postPositions: { x: number; y: number; r?: number }[] = [];
  drainSensor: Matter.Body;

  /** Launch lane geometry. */
  readonly launchX = PLAYFIELD_W - 30;
  readonly launchRestY = PLAYFIELD_H - 80;

  /** Play area excludes the launch lane on the right. */
  readonly playRight = PLAYFIELD_W - 56;
  readonly playCenter = (PLAYFIELD_W - 56) / 2;

  constructor(private physics: Physics, private events: PlayfieldEvents) {
    this.buildWalls();

    // Initial ball
    const initialBall = new Ball(this.launchX, this.launchRestY);
    this.balls.push(initialBall);
    physics.add(initialBall.body);

    // Flippers — pivot offset 104 px from PLAY CENTER (mirror-symmetric layout).
    const flipperY = PLAYFIELD_H - 130;
    const flipperGap = 104;
    this.leftFlipper = new Flipper('left', this.playCenter - flipperGap, flipperY);
    this.rightFlipper = new Flipper('right', this.playCenter + flipperGap, flipperY);
    physics.add(this.leftFlipper.body, this.leftFlipper.pivot);
    physics.add(this.rightFlipper.body, this.rightFlipper.pivot);

    // Slingshots above flippers — mirror-symmetric, lifted clear of flipper rest.
    const slingY = flipperY - 50;
    const slingOuterL = 36;
    const slingOuterR = 2 * this.playCenter - slingOuterL;
    const slingInnerL = this.playCenter - (flipperGap - 12);
    const slingInnerR = 2 * this.playCenter - slingInnerL;
    this.slingshots.push(
      new Slingshot(
        [
          { x: slingOuterL, y: slingY - 70 },
          { x: slingOuterL, y: slingY + 28 },
          { x: slingInnerL, y: slingY + 30 },
        ],
        this.normalize({ x: 0.85, y: -0.5 }),
      ),
    );
    this.slingshots.push(
      new Slingshot(
        [
          { x: slingOuterR, y: slingY - 70 },
          { x: slingOuterR, y: slingY + 28 },
          { x: slingInnerR, y: slingY + 30 },
        ],
        this.normalize({ x: -0.85, y: -0.5 }),
      ),
    );
    for (const s of this.slingshots) physics.add(s.body);

    // The Bean — top of playfield centered on canvas (above lane separator).
    this.bean = new Bean(PLAYFIELD_W / 2, 142, 56);
    physics.add(this.bean.body);

    // Pop bumper cluster — three bumpers in tight triangle on the right of
    // centre, BELOW the bean so they don't overlap. Classic Stern triangle.
    this.popBumpers.push(new PopBumper(385, 268, 22, COLOR.INSERT_AMBER));
    this.popBumpers.push(new PopBumper(335, 308, 22, COLOR.INSERT_RED));
    this.popBumpers.push(new PopBumper(385, 348, 22, COLOR.INSERT_BLUE));
    for (const p of this.popBumpers) physics.add(p.body);

    // Captive ball lane on the LEFT, between the bean and the orbit return.
    this.captive = new CaptiveBall(108, 285, 60);
    physics.add(this.captive.ball, ...this.captive.walls);

    // Center ramp — short vertical "shoot the centre" chute from the inlane
    // gap up to the back of the playfield. Ends BELOW the bean so the two
    // toys read as separate. Rendered as a translucent blue plastic band.
    this.centerRamp = new CenterRamp({
      entry: { x: this.playCenter, y: 560 },
      exit: { x: this.playCenter, y: 410 },
      path: [
        { x: this.playCenter, y: 560 },
        { x: this.playCenter, y: 510 },
        { x: this.playCenter, y: 460 },
        { x: this.playCenter, y: 410 },
      ],
    });
    physics.add(this.centerRamp.entry, this.centerRamp.exit);

    // Left orbit — enters at the top-left of the slingshot, curves around
    // the back of the playfield, exits on the right side near the bean.
    const leftOrbitPath: { x: number; y: number }[] = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      // Big sweeping arc from (32, 600) up around (60, 80) to (490, 90)
      const ang = Math.PI * (1 - t * 0.95);
      const cx = PLAYFIELD_W / 2;
      const cy = 240;
      const rx = PLAYFIELD_W / 2 - 30;
      const ry = 175;
      leftOrbitPath.push({
        x: cx + Math.cos(ang) * rx,
        y: cy - Math.sin(ang) * ry,
      });
    }
    this.leftOrbit = new Orbit({
      entry: { x: 38, y: 560 },
      exit: { x: PLAYFIELD_W - 70, y: 110 },
      path: leftOrbitPath,
      arrowAt: { x: 60, y: 600 },
      arrowAngle: -Math.PI / 2 - 0.18,
      color: COLOR.INSERT_CYAN,
      label: 'left-orbit',
      laneWidth: 32,
    });
    physics.add(this.leftOrbit.entry, this.leftOrbit.exit);

    // Right orbit — short return on the right side that joins the launch lane.
    const rightOrbitPath: { x: number; y: number }[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      // From (435, 560) curving up-right around (455, 200)
      const cx = 455;
      const cy = 380;
      const rx = 35;
      const ry = 200;
      const ang = Math.PI / 2 - t * (Math.PI / 2);
      rightOrbitPath.push({
        x: cx + Math.cos(ang) * rx,
        y: cy - Math.sin(ang) * ry,
      });
    }
    this.rightOrbit = new Orbit({
      entry: { x: 425, y: 560 },
      exit: { x: 488, y: 200 },
      path: rightOrbitPath,
      arrowAt: { x: 425, y: 600 },
      arrowAngle: -Math.PI / 2 + 0.12,
      color: COLOR.INSERT_BLUE,
      label: 'right-orbit',
      laneWidth: 30,
    });
    physics.add(this.rightOrbit.entry, this.rightOrbit.exit);

    // Spinner — Lake Michigan, in the LEFT inlane below the orbit entry.
    this.spinner = new Spinner(60, 510, 40);
    physics.add(this.spinner.body, this.spinner.pivot, this.spinner.stop);

    // CHICAGO drop-target bank — vertical row, LEFT of the centre ramp,
    // outside the bumper cluster.
    this.bank = new ChicagoBank(physics, {
      x: 175,
      yTop: 410,
      spacing: 24,
    });

    // Scoop on the RIGHT, between the right orbit and the slingshot.
    this.scoop = new Scoop(425, 580, -Math.PI / 2 - 0.4, 18);
    physics.add(this.scoop.sensor);

    // Multiball lock — left of the centre ramp, below the captive ball.
    this.lock = new BallLock(95, 410);
    physics.add(this.lock.sensor);

    // Plunger
    const laneInnerX = PLAYFIELD_W - 56 + 3;
    const laneOuterX = PLAYFIELD_W - 1;
    const plungerCx = (laneInnerX + laneOuterX) / 2;
    const plungerW = laneOuterX - laneInnerX - 4;
    this.plunger = new Plunger(plungerCx, PLAYFIELD_H - 60, plungerW);
    physics.add(this.plunger.body);

    // Drain sensor at the bottom — only across the play area, not the lane.
    this.drainSensor = Matter.Bodies.rectangle(
      this.playCenter,
      PLAYFIELD_H - 4,
      this.playRight - 12,
      6,
      { isStatic: true, isSensor: true, label: 'drain' },
    );
    physics.add(this.drainSensor);

    // Per-step ticks.
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

    // ── Collision handlers ────────────────────────────────────────────────
    physics.on('bean', (_self, other) => {
      if (other.label !== 'ball') return;
      this.bean.pop(other);
      this.events.onScore({ kind: 'bean', points: POINTS.BEAN });
    });
    physics.on('pop-bumper', (self, other) => {
      if (other.label !== 'ball') return;
      const b = this.popBumpers.find((p) => p.body === self);
      if (b) b.pop(other);
      this.events.onScore({ kind: 'pop-bumper', points: POINTS.POP_BUMPER });
    });
    physics.on('slingshot', (self, other) => {
      if (other.label !== 'ball') return;
      const s = this.slingshots.find((sl) => sl.body === self);
      if (s) s.pop(other);
      this.events.onScore({ kind: 'slingshot', points: POINTS.SLINGSHOT });
    });
    for (const t of this.bank.targets) {
      physics.on(t.body.label, (self, other) => {
        if (other.label !== 'ball') return;
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
    physics.on('left-orbit-entry', (_s, o) => {
      if (o.label === 'ball') this.leftOrbit.arm();
    });
    physics.on('left-orbit-exit', (_s, o) => {
      if (o.label !== 'ball') return;
      if (this.leftOrbit.triggerExit())
        this.events.onScore({ kind: 'left-orbit', points: POINTS.ORBIT_LEFT });
    });
    physics.on('right-orbit-entry', (_s, o) => {
      if (o.label === 'ball') this.rightOrbit.arm();
    });
    physics.on('right-orbit-exit', (_s, o) => {
      if (o.label !== 'ball') return;
      if (this.rightOrbit.triggerExit())
        this.events.onScore({ kind: 'right-orbit', points: POINTS.ORBIT_RIGHT });
    });
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
          // Remove the locked ball from play.
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

  private normalize(v: { x: number; y: number }) {
    const m = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / m, y: v.y / m };
  }

  private addWall(body: Matter.Body, outline: { x: number; y: number }[], kind: WallDef['kind'] = 'rail') {
    this.physics.add(body);
    this.walls.push({ body, outline, kind });
  }

  private buildWalls() {
    const t = WALL_THICKNESS;
    const W = PLAYFIELD_W;
    const H = PLAYFIELD_H;

    // Outer perimeter (top, bottom, left, right) — drawn as the wood apron.
    this.addWall(
      Matter.Bodies.rectangle(W / 2, -t / 2, W, t, { isStatic: true, label: 'wall' }),
      [],
      'wood',
    );
    this.addWall(
      Matter.Bodies.rectangle(W / 2, H + t / 2, W, t, { isStatic: true, label: 'wall' }),
      [],
      'wood',
    );
    this.addWall(
      Matter.Bodies.rectangle(-t / 2, H / 2, t, H, { isStatic: true, label: 'wall' }),
      [],
      'wood',
    );
    this.addWall(
      Matter.Bodies.rectangle(W + t / 2, H / 2, t, H, { isStatic: true, label: 'wall' }),
      [],
      'wood',
    );

    // Launch lane separator — vertical wall on right, leaves a gap at top
    // for the ball to enter the playfield, and at bottom for the plunger.
    const laneX = W - 56;
    const laneTop = 180;
    const laneBottom = H - 50;
    const laneWall = Matter.Bodies.rectangle(
      laneX,
      (laneTop + laneBottom) / 2,
      6,
      laneBottom - laneTop,
      { isStatic: true, label: 'wall' },
    );
    this.addWall(laneWall, polyOf(laneWall), 'rail');

    // Lane top deflector — angled wall that pushes a launched ball leftward
    // into the playfield; also blocks re-entry from the playfield side.
    const defLeft = { x: laneX - 38, y: laneTop - 80 };
    const defRight = { x: W + 4, y: laneTop - 4 };
    const defDx = defRight.x - defLeft.x;
    const defDy = defRight.y - defLeft.y;
    const defLen = Math.hypot(defDx, defDy);
    const defBody = Matter.Bodies.rectangle(
      (defLeft.x + defRight.x) / 2,
      (defLeft.y + defRight.y) / 2,
      defLen,
      8,
      {
        isStatic: true,
        angle: Math.atan2(defDy, defDx),
        label: 'wall',
      },
    );
    this.addWall(defBody, polyOf(defBody), 'rail');

    // Inlane diagonal walls — funnel a ball from the slingshots toward the
    // flipper tips. Mirror-symmetric about the play centre.
    const drainAngle = 0.45;
    const inlaneLen = 150;
    const inlaneCx = 96;
    const inlaneCxRight = laneX - inlaneCx;
    const inlaneCy = H - 195;
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

    // Outlane outer rails — short verticals just inside the outer wall, in
    // line with the slingshots; create the narrow drain channel down each
    // side of the slingshots.
    const outlaneCx = 22;
    const outlaneCxRight = laneX - outlaneCx;
    const lOutlane = Matter.Bodies.rectangle(outlaneCx, H - 240, 6, 180, {
      isStatic: true,
      label: 'wall',
    });
    const rOutlane = Matter.Bodies.rectangle(outlaneCxRight, H - 240, 6, 180, {
      isStatic: true,
      label: 'wall',
    });
    this.addWall(lOutlane, polyOf(lOutlane), 'rail');
    this.addWall(rOutlane, polyOf(rOutlane), 'rail');

    // Decorative metal post markers — visible chrome posts at key lane junctions.
    this.postPositions = [
      { x: 36, y: H - 240 + 90 + 4 }, // bottom-left outlane
      { x: laneX - 36, y: H - 240 + 90 + 4 },
      { x: 22, y: H - 240 - 90 - 4 }, // top-left outlane
      { x: laneX - 22, y: H - 240 - 90 - 4 },
      { x: 35, y: 600 }, // left orbit entry post
      { x: laneX - 35, y: 600 }, // right orbit entry post
      { x: this.playCenter - 18, y: 540 }, // center ramp throat posts
      { x: this.playCenter + 18, y: 540 },
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

  /** Add a fresh ball at the plunger (used when releasing locks during multiball). */
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
    this.centerRamp.tick(dtMs);
    this.leftOrbit.tick(dtMs);
    this.rightOrbit.tick(dtMs);
    this.bank.tick(dtMs);
    this.plunger.tick(dtMs);
    this.captive.tick(dtMs);

    // Scoop kick-out
    const kicked = this.scoop.tick(dtMs, SCOOP_HOLD_MS);
    if (kicked) {
      // already kicked — no further action needed
      void kicked;
    }
  }

  /** Used by Game on multiball start to release any locked balls back into play. */
  releaseLocks(): number {
    const count = this.lock.locked;
    this.lock.release();
    for (let i = 0; i < count; i++) {
      const b = this.serveBall();
      // Stagger a tiny offset so they don't all spawn on top of each other.
      Matter.Body.setPosition(b.body, { x: this.launchX, y: this.launchRestY - i * 22 });
      Matter.Body.setVelocity(b.body, { x: 0, y: -20 - i * 2 });
    }
    return count;
  }
}

/** Snapshot a body's vertices as an outline polygon. */
function polyOf(body: Matter.Body): { x: number; y: number }[] {
  return body.vertices.map((v) => ({ x: v.x, y: v.y }));
}
