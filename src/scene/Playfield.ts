import Matter from 'matter-js';
import { Physics } from '../Physics';
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

/** Vertical zoning of the playfield (the canvas itself is 540×960). */
export const BACKBOX_BOTTOM = 60;
export const HUD_BOTTOM = 130;
export const PLAYFIELD_TOP = 200;       // start of actual playable surface

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

  /** Decorative chrome wireforms drawn on top of the playfield (NOT physics
   *  colliders — the ball travels these via teleport from ramp.tryMake). */
  habitrails: { points: { x: number; y: number }[]; tone: 'chrome' }[] = [];

  /** Plunger lane geometry — vertical strip on the right side of the
   *  playfield, with a curved deflector at the top arcing the launched
   *  ball into the playfield. */
  readonly laneInnerX = PLAYFIELD_W - 60;
  readonly laneOuterX = PLAYFIELD_W - 8;
  readonly launchX = (PLAYFIELD_W - 60 + PLAYFIELD_W - 8) / 2;
  readonly launchRestY = PLAYFIELD_H - 70;

  /** Effective play-area horizontal centre (excludes the launch lane). */
  readonly playRight = PLAYFIELD_W - 60;
  readonly playCenter = (PLAYFIELD_W - 60) / 2;

  /** Flipper geometry — promoted to class level so buildWalls can place
   *  the inlane / outlane diagonals to meet the flipper base cleanly. */
  readonly flipperY = PLAYFIELD_H - 200;
  readonly flipperGap = 105;

  constructor(private physics: Physics, private events: PlayfieldEvents) {
    this.buildWalls();

    // Initial ball — sits on the plunger.
    const initialBall = new Ball(this.launchX, this.launchRestY);
    this.balls.push(initialBall);
    physics.add(initialBall.body);

    // ── FLIPPERS — bigger bats, RAISED higher up the playfield, tighter
    //    drain. Pivots are 105 px from the play centre, giving a tip-to-tip
    //    gap of about 11 px (tight enough to make a missed shot recoverable
    //    on a cradle). ──
    const flipperY = this.flipperY;
    const flipperGap = this.flipperGap;
    this.leftFlipper = new Flipper('left', this.playCenter - flipperGap, flipperY);
    this.rightFlipper = new Flipper('right', this.playCenter + flipperGap, flipperY);
    physics.add(this.leftFlipper.body, this.leftFlipper.pivot);
    physics.add(this.rightFlipper.body, this.rightFlipper.pivot);

    // ── SLINGSHOTS — moved INWARD so there's room for a real outlane on
    //    the outside and a real inlane channel between the slingshot and
    //    the outlane wall. The hypotenuse (live edge) faces the inlane on
    //    the inside; the slingshot's vertical outer edge is the inlane's
    //    inner wall.
    const slingY = flipperY - 64;
    const slingOuterL = 70;
    const slingOuterR = 2 * this.playCenter - slingOuterL;
    const slingInnerL = this.playCenter - (flipperGap - 22); // = 152
    const slingInnerR = 2 * this.playCenter - slingInnerL;
    this.slingshots.push(
      new Slingshot(
        [
          { x: slingOuterL, y: slingY - 60 },     // top-outer
          { x: slingOuterL, y: slingY + 26 },     // bottom-outer (against inlane)
          { x: slingInnerL, y: slingY + 28 },     // bottom-inner (next to flipper pivot)
        ],
        norm({ x: 0.85, y: -0.55 }),               // live edge faces upper-right
      ),
    );
    this.slingshots.push(
      new Slingshot(
        [
          { x: slingOuterR, y: slingY - 60 },
          { x: slingOuterR, y: slingY + 26 },
          { x: slingInnerR, y: slingY + 28 },
        ],
        norm({ x: -0.85, y: -0.55 }),
      ),
    );
    for (const s of this.slingshots) physics.add(s.body);

    // ── SKILL-SHOT ROLLOVERS at the top — 3 lanes labeled with point values. ──
    const rolloverY = 220;
    const rolloverXs = [120, this.playCenter, this.playRight - 120];
    const rolloverLetters = ['10K', '25K', '10K'];
    for (let i = 0; i < 3; i++) {
      const r = new Rollover(rolloverXs[i], rolloverY, rolloverLetters[i], i);
      this.rollovers.push(r);
      physics.add(r.sensor);
    }

    // ── THE BEAN — smaller chrome dome at upper-centre (the user's
    //    feedback: shrink so it stops blocking flow). ──
    this.bean = new Bean(this.playCenter, 280, 26);
    physics.add(this.bean.body, this.bean.lockSensor);

    // ── POP BUMPERS — triangle BELOW the Bean. Previously positioned so
    //    the upper bumpers overlapped the Bean's collision body (Bean at
    //    y=280-306, bumpers at y=298-342); a ball squeezed between them
    //    could get cradled. Now placed clear of the Bean (y=340) and the
    //    lock saucer below it (y=313).
    this.popBumpers.push(new PopBumper(this.playCenter - 80, 360, 22, COLOR.INSERT_AMBER));
    this.popBumpers.push(new PopBumper(this.playCenter + 80, 360, 22, COLOR.INSERT_RED));
    this.popBumpers.push(new PopBumper(this.playCenter, 410, 22, COLOR.INSERT_BLUE));
    for (const p of this.popBumpers) physics.add(p.body);

    // ── SPORTS TEAM STANDUPS — 2-banks INSIDE the ramp curves (between the
    //    raised ramps and the pop-bumper cluster), so the ramp visuals don't
    //    cover them. Each pair of targets is the team's "bank" — complete
    //    both for the team bonus.
    this.standups.push(new StandupTarget({
      x: 145, y: 310, angle: 0.55, color: COLOR.INSERT_YELLOW, id: 'cubs',
      width: 38, height: 12,
    }));
    this.standups.push(new StandupTarget({
      x: 135, y: 390, angle: 0.6, color: COLOR.INSERT_AMBER, id: 'bears',
      width: 38, height: 12,
    }));
    this.standups.push(new StandupTarget({
      x: this.playRight - 145, y: 310, angle: -0.55, color: COLOR.INSERT_RED, id: 'bulls',
      width: 38, height: 12,
    }));
    this.standups.push(new StandupTarget({
      x: this.playRight - 135, y: 390, angle: -0.6, color: COLOR.INSERT_PURPLE, id: 'sox',
      width: 38, height: 12,
    }));
    for (const s of this.standups) physics.add(s.body);

    // ── CHICAGO DROP-TARGET BANK — single horizontal row across mid-playfield. ──
    // (The HUD CHICAGO strip mirrors progress; this bank is the only physical
    // hit target — no duplication.)
    this.bank = new ChicagoBank(physics, {
      x: this.playCenter,
      yTop: 470,
      spacing: 0,                       // not used in horizontal mode
      horizontal: true,
      letterSpacing: 38,
    });

    // ── LEFT RAMP — Willis Tower (orange). Entry near the right flipper, the
    //    plate curves up the LEFT side of the playfield, exits at the
    //    upper-left, and a chrome habitrail returns the ball to the RIGHT
    //    inlane area.
    this.leftRamp = new Ramp({
      entry: { x: 200, y: 600 },
      exit: { x: this.playCenter + 80, y: 250 },
      plate: [
        { x: 200, y: 600 },
        { x: 130, y: 530 },
        { x: 80,  y: 430 },
        { x: 70,  y: 320 },
        { x: 110, y: 240 },
        { x: 200, y: 220 },
        { x: this.playCenter, y: 220 },
        { x: this.playCenter + 80, y: 250 },
      ],
      habitrail: [
        { x: this.playCenter + 80, y: 250 },
        { x: this.playRight - 40, y: 320 },
        { x: this.playRight - 40, y: 600 },
        { x: this.playRight - 70, y: flipperY - 80 },
      ],
      returnVel: { x: -2, y: 8 },
      color: COLOR.INSERT_AMBER,
      arrowAt: { x: 200, y: 640 },
      arrowAngle: -Math.PI / 2 - 0.45,
      label: 'left-ramp',
      themeText: 'WILLIS',
      minSpeed: 6,
    });
    physics.add(this.leftRamp.entry, this.leftRamp.exit);

    // ── RIGHT RAMP — CTA Loop (cyan). Entry near the left flipper, plate
    //    curves up the RIGHT side, exits at upper-right, habitrail returns
    //    to LEFT inlane.
    this.rightRamp = new Ramp({
      entry: { x: this.playCenter + 60, y: 600 },
      exit: { x: this.playCenter - 80, y: 250 },
      plate: [
        { x: this.playCenter + 60, y: 600 },
        { x: this.playCenter + 130, y: 530 },
        { x: this.playRight - 80, y: 440 },
        { x: this.playRight - 60, y: 330 },
        { x: this.playRight - 100, y: 240 },
        { x: this.playCenter + 90, y: 220 },
        { x: this.playCenter, y: 220 },
        { x: this.playCenter - 80, y: 250 },
      ],
      habitrail: [
        { x: this.playCenter - 80, y: 250 },
        { x: 40, y: 320 },
        { x: 40, y: 600 },
        { x: 70, y: flipperY - 80 },
      ],
      returnVel: { x: 2, y: 8 },
      color: COLOR.INSERT_CYAN,
      arrowAt: { x: this.playCenter + 60, y: 640 },
      arrowAngle: -Math.PI / 2 + 0.45,
      label: 'right-ramp',
      themeText: 'CTA',
      minSpeed: 6,
    });
    physics.add(this.rightRamp.entry, this.rightRamp.exit);

    // ── LAKE MICHIGAN SCOOP — saucer on the LEFT (water-themed). ──
    this.lakeMichiganScoop = new Scoop(80, 540, -Math.PI / 2 + 0.3, 16);
    // Override label so the collision routes here separately from CITY TOUR.
    (this.lakeMichiganScoop.sensor as Matter.Body).label = 'lake-scoop';
    physics.add(this.lakeMichiganScoop.sensor);

    // ── CITY TOUR SCOOP — mode-start saucer on the RIGHT. ──
    this.cityTourScoop = new Scoop(this.playRight - 80, 540, -Math.PI / 2 - 0.3, 18);
    physics.add(this.cityTourScoop.sensor);

    // ── CAPTIVE BALL lane — placed in the upper-right zone, between the
    //    bumper triangle and the right ramp. A left-flipper shot aimed
    //    sharply up-right reaches it cleanly (the classic Stern captive
    //    line). Previously at playRight-80 = 400 it was sitting at the
    //    far edge where reaching it required more horizontal speed than
    //    a flipper kick provides; pulled inward to 360 so a moderate
    //    angle off the left flipper can make the shot.
    this.captive = new CaptiveBall(360, 430, 50);
    physics.add(this.captive.ball, ...this.captive.walls);

    // ── SPINNER — far-left inlane, classic spinner blade. ──
    this.spinner = new Spinner(50, 660, 32);
    physics.add(this.spinner.body, this.spinner.pivot, this.spinner.stop);

    // ── PLUNGER ──
    const plungerCx = (this.laneInnerX + this.laneOuterX) / 2;
    const plungerW = this.laneOuterX - this.laneInnerX - 4;
    this.plunger = new Plunger(plungerCx, PLAYFIELD_H - 60, plungerW);
    physics.add(this.plunger.body);

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

    // ── Collision routing ──
    physics.on('bean', (_s, o) => {
      if (o.label !== 'ball') return;
      this.bean.pop(o);
      this.events.onScore({ kind: 'bean', points: POINTS.BEAN });
      // Bean as multiball-lock toy: every Nth bean hit also fires a LOCK.
      // The dedicated `bean-lock` sensor below the dome is unreachable
      // because the dome's collision body blocks it, so we drive locks off
      // of bean-hit count instead.
      if (this.bean.registerHit()) {
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
    // Active-contact handler: keep pushing the ball away if it tries to
    // rest against the bean. No score award (score only on first contact).
    physics.onActive('bean', (_s, o) => {
      if (o.label !== 'ball') return;
      this.bean.pop(o);
    });
    // (Legacy 'bean-lock' sensor handler removed — locks fire via
    // registerHit() in the 'bean' handler above.)
    physics.on('pop-bumper', (self, o) => {
      if (o.label !== 'ball') return;
      const b = this.popBumpers.find((p) => p.body === self);
      if (b) b.pop(o);
      this.events.onScore({ kind: 'pop-bumper', points: POINTS.POP_BUMPER });
    });
    physics.onActive('pop-bumper', (self, o) => {
      if (o.label !== 'ball') return;
      // Only re-kick if the ball is going slowly (so we don't double-fire
      // on a normal high-speed bounce).
      const v = Math.hypot(o.velocity.x, o.velocity.y);
      if (v > 4) return;
      const b = this.popBumpers.find((p) => p.body === self);
      if (b) b.pop(o);
    });
    physics.on('slingshot', (self, o) => {
      if (o.label !== 'ball') return;
      const s = this.slingshots.find((sl) => sl.body === self);
      if (s) s.pop(o);
      this.events.onScore({ kind: 'slingshot', points: POINTS.SLINGSHOT });
    });
    physics.onActive('slingshot', (self, o) => {
      if (o.label !== 'ball') return;
      const v = Math.hypot(o.velocity.x, o.velocity.y);
      if (v > 4) return;
      const s = this.slingshots.find((sl) => sl.body === self);
      if (s) s.pop(o);
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
          // Skill-shot value matches the on-playfield label (10K / 25K / 10K).
          const points = r.letter === '25K' ? 25000 : 10000;
          this.events.onScore({ kind: 'skill-shot', points });
        }
      });
    }
    for (const s of this.standups) {
      physics.on(s.label, (_self, o) => {
        if (o.label !== 'ball') return;
        s.hit();
        this.events.onScore({ kind: 'pop-bumper', points: 300 });
      });
    }

    // RAMP make logic — entering the entry sensor with sufficient upward
    // velocity teleports the ball to the exit & gives it the return velocity.
    physics.on('left-ramp-entry', (_s, o) => {
      if (o.label !== 'ball') return;
      if (this.leftRamp.tryMake(o))
        this.events.onScore({ kind: 'center-ramp', points: POINTS.CENTER_RAMP });
    });
    physics.on('right-ramp-entry', (_s, o) => {
      if (o.label !== 'ball') return;
      if (this.rightRamp.tryMake(o))
        this.events.onScore({ kind: 'center-ramp', points: POINTS.CENTER_RAMP });
    });

    physics.on('captive-ball', (_s, o) => {
      if (o.label !== 'ball') return;
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

    // Launch-exit teleport: ball going UP through the launch-exit sensor is
    // teleported to the upper playfield, just below the rollover lanes,
    // with a tiny downward velocity so it naturally falls into the bumper
    // cluster. This is the "shooter habitrail dump point" — visually
    // matched by the chrome rail above.
    physics.on('launch-exit', (_s, o) => {
      if (o.label !== 'ball') return;
      if (o.velocity.y >= 0) return; // only upward-moving balls
      this.physics.defer(() => {
        // Drop the ball just ABOVE the LEFT skill-shot rollover lane
        // (x=120) with a tiny rightward bias so it falls through the
        // rollover sensor (10K skill shot) and then drifts toward the
        // bumper triangle in the upper playfield. The horizontal bias
        // is small enough that the ball still passes through the
        // rollover but big enough that it doesn't fall straight down
        // past everything to the slingshot.
        Matter.Body.setPosition(o, { x: 120, y: PLAYFIELD_TOP });
        Matter.Body.setVelocity(o, { x: 1.5, y: 4 });
        Matter.Body.setAngularVelocity(o, 0);
      });
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

    // Outer cabinet walls.
    for (const w of [
      Matter.Bodies.rectangle(W / 2, -t / 2, W, t, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(W / 2, H + t / 2, W, t, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(-t / 2, H / 2, t, H, { isStatic: true, label: 'wall' }),
      Matter.Bodies.rectangle(W + t / 2, H / 2, t, H, { isStatic: true, label: 'wall' }),
    ]) {
      this.addWall(w, [], 'wood');
    }

    // ── SHOOTER LANE walls ──
    // Inner wall (separates the shooter lane from the playfield), runs from
    // PLAYFIELD_TOP all the way down to just above the plunger.
    const laneWallY1 = PLAYFIELD_TOP + 4;
    const laneWallY2 = H - 32;
    {
      const cy = (laneWallY1 + laneWallY2) / 2;
      const len = laneWallY2 - laneWallY1;
      const wall = Matter.Bodies.rectangle(this.laneInnerX, cy, 6, len, {
        isStatic: true, label: 'wall',
      });
      this.addWall(wall, polyOf(wall), 'rail');
    }
    // Shooter-lane EXIT sensor — when the ball clears the top of the lane
    // moving upward, it's teleported into the upper playfield (a "shooter
    // habitrail" on a real Stern table feeds the ball over the back of the
    // playfield and dumps it at the top of one of the lanes). This is more
    // reliable than a reflective wall because the launched ball's apex
    // depends on plunger power and per-step velocity capping; a sensor
    // always fires regardless.
    const launchExitSensor = Matter.Bodies.rectangle(
      this.launchX,
      PLAYFIELD_TOP - 40,        // y = 160 — above the lane wall top
      this.laneOuterX - this.laneInnerX,
      8,
      { isStatic: true, isSensor: true, label: 'launch-exit' },
    );
    this.physics.add(launchExitSensor);

    // Visible CHROME HABITRAIL drawn over the apron — purely cosmetic, but
    // shows the player the path the launched ball takes. Stored in
    // `habitrails[]` so the renderer picks it up.
    this.habitrails.push({
      points: [
        { x: this.launchX, y: PLAYFIELD_TOP - 40 },
        { x: this.launchX - 30, y: HUD_BOTTOM + 30 },
        { x: this.playCenter + 80, y: HUD_BOTTOM + 14 },
        { x: this.playCenter, y: HUD_BOTTOM + 12 },
        { x: this.playCenter - 90, y: HUD_BOTTOM + 22 },
        { x: 80, y: PLAYFIELD_TOP - 16 },
      ],
      tone: 'chrome',
    });
    // Apron-side back wall — a short metal rail along the LEFT half of the
    // playfield top that defines the upper playfield boundary on that side.
    // The right half is intentionally OPEN so the launched ball can flow
    // across the top from the shooter habitrail down into the playfield.
    {
      const fromX = 6;
      const toX = this.playCenter - 70;
      const cx = (fromX + toX) / 2;
      const div = Matter.Bodies.rectangle(cx, PLAYFIELD_TOP - 2, toX - fromX, 6, {
        isStatic: true, label: 'wall',
      });
      this.addWall(div, polyOf(div), 'rail');
    }

    // ── BOTTOM PLAYFIELD GEOMETRY ──
    //
    // After several attempts at 2-channel inlane/outlane structures (which
    // kept producing wedge bugs because 2D top-down pinball has no
    // playfield friction — balls bounce in narrow channels forever), the
    // bottom is now SIMPLIFIED to the essentials:
    //
    //   * Slingshot triangle (already created above) — its vertical OUTER
    //     edge serves as the visual + physical "inlane wall"
    //   * A single angled DEFLECTOR rail per side, anchored at the
    //     slingshot's bottom-outer corner, sloping DOWN-IN to a point
    //     above the flipper pivot. This catches a ball falling outside
    //     the slingshot and redirects it onto the flipper bat.
    //   * Open space outside the slingshot (between slingshot and the
    //     cabinet wall) acts as the outlane — ball drains naturally.
    //
    // No vertical outlane walls and no inlane channel — the ball can
    // always escape sideways, which prevents the corner-trap bug.

    const slingBotInnerL = this.playCenter - (this.flipperGap - 22);   // = 152
    const slingBotInnerR = 2 * this.playCenter - slingBotInnerL;       // = 328
    const slingBotY = this.flipperY - 64 + 28;                         // = 724

    {
      // LEFT deflector: from slingshot bottom-INNER corner DOWN-IN toward
      // the left flipper pivot. Ball coming off the slingshot's live edge
      // gets a controlled drop onto the flipper bat top.
      const x1 = slingBotInnerL - 2;
      const y1 = slingBotY + 2;
      const x2 = this.playCenter - this.flipperGap + 4;
      const y2 = this.flipperY - 16;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const w = Matter.Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len, 6, {
        isStatic: true, angle: Math.atan2(dy, dx), label: 'wall',
      });
      this.addWall(w, polyOf(w), 'rail');
    }
    {
      // RIGHT deflector: mirror.
      const x1 = slingBotInnerR + 2;
      const y1 = slingBotY + 2;
      const x2 = this.playCenter + this.flipperGap - 4;
      const y2 = this.flipperY - 16;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const w = Matter.Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len, 6, {
        isStatic: true, angle: Math.atan2(dy, dx), label: 'wall',
      });
      this.addWall(w, polyOf(w), 'rail');
    }

    // ── Decorative metal posts at the slingshot corners and flipper
    //    pivots. These are the visible chrome posts that hold the rubbers
    //    in place on a real playfield, and they help the player read the
    //    flipper / slingshot geometry. ──
    this.postPositions = [
      { x: 70, y: this.flipperY - 28 },                                 // left slingshot top-outer
      { x: this.playRight - 70, y: this.flipperY - 28 },                // right slingshot top-outer
      { x: this.playCenter - this.flipperGap, y: this.flipperY - 6 },   // left flipper pivot
      { x: this.playCenter + this.flipperGap, y: this.flipperY - 6 },   // right flipper pivot
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
    return ball.position.x > this.laneInnerX - BALL_RADIUS;
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
    this.leftRamp.tick(dtMs);
    this.rightRamp.tick(dtMs);
    this.bank.tick(dtMs);
    this.plunger.tick(dtMs);
    this.captive.tick(dtMs);
    this.cityTourScoop.tick(dtMs, SCOOP_HOLD_MS);
    this.lakeMichiganScoop.tick(dtMs, SCOOP_HOLD_MS);
  }

  releaseLocks(): number {
    const count = this.bean.locked;
    this.bean.releaseLocks();
    // Multiball balls spawn AT THE BEAN (their visual home) and fan out
    // across the upper playfield with downward velocity. Previously they
    // all spawned stacked at the plunger, which produced clipping and
    // both balls would funnel into the same launch-exit sensor — second
    // ball teleported onto the first. Spreading them spatially means
    // they immediately drop into different play zones.
    const spreadX = [-70, 0, +70];
    const spreadVx = [-3, 0, +3];
    for (let i = 0; i < count; i++) {
      const b = this.serveBall();
      Matter.Body.setPosition(b.body, {
        x: this.bean.cx + (spreadX[i] ?? 0),
        y: this.bean.cy + this.bean.radius + 24,
      });
      Matter.Body.setVelocity(b.body, {
        x: spreadVx[i] ?? 0,
        y: 4,
      });
      Matter.Body.setAngularVelocity(b.body, 0);
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
