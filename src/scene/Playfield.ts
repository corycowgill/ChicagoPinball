import Matter from 'matter-js';
import { Physics } from '../Physics';
import { Ball } from '../entities/Ball';
import { Flipper } from '../entities/Flipper';
import { Plunger } from '../entities/Plunger';
import { PopBumper } from '../entities/PopBumper';
import { Bean } from '../entities/Bean';
import { Slingshot } from '../entities/Slingshot';
import { Spinner } from '../entities/Spinner';
import { Ramp } from '../entities/Ramp';
import { ChicagoBank } from '../entities/ChicagoBank';
import {
  PLAYFIELD_W,
  PLAYFIELD_H,
  WALL_THICKNESS,
  BALL_RADIUS,
  POINTS,
  COLOR,
} from '../constants';
import { ScoreEvent } from '../types';

export interface PlayfieldEvents {
  onScore: (e: ScoreEvent) => void;
  onDrain: () => void;
}

export class Playfield {
  ball: Ball;
  leftFlipper: Flipper;
  rightFlipper: Flipper;
  plunger: Plunger;
  popBumpers: PopBumper[] = [];
  bean: Bean;
  slingshots: Slingshot[] = [];
  bank: ChicagoBank;
  spinner: Spinner;
  ramp: Ramp;
  /** Wall segments so we can draw outlines too. */
  wallVerts: { x: number; y: number }[][] = [];
  /** Drain sensor (bottom of playfield). */
  drainSensor: Matter.Body;
  /** The launch lane geometry (x of plunger, y of resting ball, etc.). */
  readonly launchX = PLAYFIELD_W - 27;
  readonly launchRestY = PLAYFIELD_H - 90;

  constructor(private physics: Physics, private events: PlayfieldEvents) {
    this.buildWalls();

    this.ball = new Ball(this.launchX, this.launchRestY);
    physics.add(this.ball.body);

    // Flippers — pivot offset 102 px from center gives a tip gap of ~36 px,
    // wider than the 22 px ball so a missed ball drains cleanly.
    const flipperY = PLAYFIELD_H - 130;
    const flipperGap = 102;
    this.leftFlipper = new Flipper('left', PLAYFIELD_W / 2 - flipperGap, flipperY);
    this.rightFlipper = new Flipper('right', PLAYFIELD_W / 2 + flipperGap, flipperY);
    physics.add(this.leftFlipper.body, this.leftFlipper.pivot);
    physics.add(this.rightFlipper.body, this.rightFlipper.pivot);

    // Slingshots above flippers
    const slingY = flipperY - 18;
    this.slingshots.push(
      new Slingshot(
        [
          { x: 70, y: slingY - 70 },
          { x: 70, y: slingY + 28 },
          { x: 152, y: slingY + 30 },
        ],
        this.normalize({ x: 0.85, y: -0.5 }),
      ),
    );
    this.slingshots.push(
      new Slingshot(
        [
          { x: PLAYFIELD_W - 70, y: slingY - 70 },
          { x: PLAYFIELD_W - 70, y: slingY + 28 },
          { x: PLAYFIELD_W - 152, y: slingY + 30 },
        ],
        this.normalize({ x: -0.85, y: -0.5 }),
      ),
    );
    for (const s of this.slingshots) physics.add(s.body);

    // The Bean — top-center
    this.bean = new Bean(PLAYFIELD_W / 2, 130, 56);
    physics.add(this.bean.body);

    // Pop bumpers — three skyline towers
    this.popBumpers.push(new PopBumper(120, 240, 22, COLOR.NEON_AMBER));
    this.popBumpers.push(new PopBumper(PLAYFIELD_W - 120, 240, 22, COLOR.NEON_PURPLE));
    this.popBumpers.push(new PopBumper(PLAYFIELD_W / 2, 320, 24, COLOR.NEON_GREEN));
    for (const p of this.popBumpers) physics.add(p.body);

    // CHICAGO drop targets — vertical bank near center
    this.bank = new ChicagoBank(physics, {
      x: PLAYFIELD_W / 2,
      yTop: 400,
      spacing: 32,
    });

    // Spinner — Lake Michigan (left side)
    this.spinner = new Spinner(70, 470, 50);
    physics.add(this.spinner.body, this.spinner.pivot, this.spinner.stop);

    // Loop ramp — entry near bottom-left guide, exit at top-left feeder
    this.ramp = new Ramp({
      entry: { x: 110, y: PLAYFIELD_H - 240 },
      exit: { x: 60, y: 200 },
      path: [
        { x: 110, y: PLAYFIELD_H - 240 },
        { x: 50, y: PLAYFIELD_H - 360 },
        { x: 30, y: PLAYFIELD_H - 540 },
        { x: 30, y: 360 },
        { x: 60, y: 200 },
      ],
    });
    physics.add(this.ramp.entry, this.ramp.exit);

    // Plunger — wide enough to span almost the full lane so a falling ball
    // can't slip past it on either side.
    const laneInnerX = PLAYFIELD_W - 56 + 3; // right edge of separator wall
    const laneOuterX = PLAYFIELD_W - 1;      // just inside outer wall
    const plungerCx = (laneInnerX + laneOuterX) / 2;
    const plungerW = laneOuterX - laneInnerX - 4;
    this.plunger = new Plunger(plungerCx, PLAYFIELD_H - 60, plungerW);
    physics.add(this.plunger.body);

    // Drain sensor (full width thin strip just below flippers)
    this.drainSensor = Matter.Bodies.rectangle(
      PLAYFIELD_W / 2,
      PLAYFIELD_H - 4,
      PLAYFIELD_W - 70,
      6,
      { isStatic: true, isSensor: true, label: 'drain' },
    );
    physics.add(this.drainSensor);

    // Per-step ticks for flipper clamps + ball cap.
    physics.beforeUpdate(() => {
      this.leftFlipper.tick();
      this.rightFlipper.tick();
      this.ball.capVelocity();
      // Spinner reward
      const revs = this.spinner.collectRevolutions();
      if (revs > 0) {
        this.events.onScore({ kind: 'spinner', points: POINTS.SPINNER_REV * revs });
      }
    });

    // Collision routing
    physics.on('bean', (_self, other) => {
      if (other.label === 'ball') {
        this.bean.pop(other);
        this.events.onScore({ kind: 'bean', points: POINTS.BEAN });
      }
    });
    physics.on('pop-bumper', (self, other) => {
      if (other.label !== 'ball') return;
      const bumper = this.popBumpers.find((b) => b.body === self);
      if (bumper) bumper.pop(other);
      this.events.onScore({ kind: 'pop-bumper', points: POINTS.POP_BUMPER });
    });
    physics.on('slingshot', (self, other) => {
      if (other.label !== 'ball') return;
      const sling = this.slingshots.find((s) => s.body === self);
      if (sling) sling.pop(other);
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
    physics.on('ramp-entry', (_self, other) => {
      if (other.label === 'ball') this.ramp.arm();
    });
    physics.on('ramp-exit', (_self, other) => {
      if (other.label !== 'ball') return;
      if (this.ramp.triggerExit()) {
        this.events.onScore({ kind: 'loop-ramp', points: POINTS.LOOP_RAMP });
      }
    });
    physics.on('drain', (_self, other) => {
      if (other.label === 'ball') this.events.onDrain();
    });
  }

  private normalize(v: { x: number; y: number }) {
    const m = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / m, y: v.y / m };
  }

  private buildWalls() {
    const t = WALL_THICKNESS;
    const W = PLAYFIELD_W;
    const H = PLAYFIELD_H;

    const walls: Matter.Body[] = [];
    // Outer perimeter
    walls.push(Matter.Bodies.rectangle(W / 2, -t / 2, W, t, { isStatic: true, label: 'wall' }));
    walls.push(
      Matter.Bodies.rectangle(W / 2, H + t / 2, W, t, { isStatic: true, label: 'wall' }),
    );
    walls.push(Matter.Bodies.rectangle(-t / 2, H / 2, t, H, { isStatic: true, label: 'wall' }));
    walls.push(
      Matter.Bodies.rectangle(W + t / 2, H / 2, t, H, { isStatic: true, label: 'wall' }),
    );

    // Launch lane wall (vertical separator). Extends from near the top down
    // to just above the right inlane.
    const laneX = W - 56;
    const laneTop = 170;
    const laneBottom = H - 60;
    walls.push(
      Matter.Bodies.rectangle(
        laneX,
        (laneTop + laneBottom) / 2,
        6,
        laneBottom - laneTop,
        { isStatic: true, label: 'wall' },
      ),
    );

    // Launch-lane top deflector: slopes from upper-LEFT to lower-RIGHT
    // (in screen coords, y increases downward). A ball travelling up the
    // lane hits the underside and is reflected leftward into the playfield.
    // Going the other way (upper-right to lower-left) would just push the
    // ball back into the corner — the bug we're fixing.
    const defLeft = { x: laneX - 38, y: laneTop - 80 };
    const defRight = { x: W + 4, y: laneTop - 4 };
    const defDx = defRight.x - defLeft.x;
    const defDy = defRight.y - defLeft.y;
    const defLen = Math.hypot(defDx, defDy);
    walls.push(
      Matter.Bodies.rectangle(
        (defLeft.x + defRight.x) / 2,
        (defLeft.y + defRight.y) / 2,
        defLen,
        8,
        {
          isStatic: true,
          angle: Math.atan2(defDy, defDx),
          label: 'wall',
        },
      ),
    );

    // Bottom angled drains (inlanes)
    const drainAngle = 0.32;
    walls.push(
      Matter.Bodies.rectangle(80, H - 200, 12, 200, {
        isStatic: true,
        angle: drainAngle,
        label: 'wall',
      }),
    );
    walls.push(
      Matter.Bodies.rectangle(W - 80 - 60, H - 200, 12, 200, {
        isStatic: true,
        angle: -drainAngle,
        label: 'wall',
      }),
    );

    // Bottom outlanes (the small rails outside the slingshots)
    walls.push(
      Matter.Bodies.rectangle(40, H - 240, 8, 180, {
        isStatic: true,
        label: 'wall',
      }),
    );
    walls.push(
      Matter.Bodies.rectangle(W - 40 - 60, H - 240, 8, 180, {
        isStatic: true,
        label: 'wall',
      }),
    );

    for (const w of walls) {
      this.physics.add(w);
      this.wallVerts.push(w.vertices.map((v) => ({ x: v.x, y: v.y })));
    }
  }

  resetBall() {
    this.ball.setPosition(this.launchX, this.launchRestY);
  }

  isBallInLaunchLane(): boolean {
    return this.ball.body.position.x > PLAYFIELD_W - 56 - BALL_RADIUS;
  }

  setFlippers(left: boolean, right: boolean) {
    this.leftFlipper.setActive(left);
    this.rightFlipper.setActive(right);
  }

  /** Apply plunger kick to ball if it's resting on top of the plunger. */
  applyPlungerLaunch(forceMag: number) {
    if (!this.isBallInLaunchLane()) return;
    if (forceMag <= 0) return;
    Matter.Body.setVelocity(this.ball.body, {
      x: 0,
      y: -Math.min(28, 8 + forceMag * 600),
    });
  }

  tick(dtMs: number) {
    this.bean.tick(dtMs);
    for (const p of this.popBumpers) p.tick(dtMs);
    for (const s of this.slingshots) s.tick(dtMs);
    this.ramp.tick(dtMs);
    this.bank.tick(dtMs);
    this.plunger.tick(dtMs);
  }
}
