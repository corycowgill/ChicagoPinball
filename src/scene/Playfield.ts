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
  BALL_RADIUS,
  POINTS,
  SCOOP_HOLD_MS,
  PLUNGER_MIN_LAUNCH,
  PLUNGER_LAUNCH_RANGE,
  FLIPPER_DEAD_BOUNCE,
  FLIPPER_ROLL_DAMP,
} from '../constants';
import { ScoreEvent } from '../types';
import { PlayfieldLayout } from '../layout/types';
import { DEFAULT_LAYOUT } from '../layout/default';
import { ResolvedLayout, resolveLayout } from '../layout/resolve';
import { buildPlayfield, WallDef } from '../layout/build';

export interface PlayfieldEvents {
  onScore: (e: ScoreEvent) => void;
  onDrain: (ball: Matter.Body) => void;
  onLockComplete: () => void;
  onScoopMode: () => void;
  /** All three top lanes lit (they reset immediately) — advance bonus X. */
  onLanesComplete: () => void;
  /** Ball entered the LEFT outlane just above the drain — the Game decides
   *  whether the kickback is lit and fires it via fireKickback(). */
  onLeftOutlane: (ball: Matter.Body) => void;
  /** Ball entered the RIGHT outlane — the Game decides whether the EL
   *  EXPRESS is lit and fires it via fireExpress(). */
  onRightOutlane: (ball: Matter.Body) => void;
}

interface Pt {
  x: number;
  y: number;
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
  balls: Ball[];
  leftFlipper: Flipper;
  rightFlipper: Flipper;
  plunger: Plunger;
  popBumpers: PopBumper[];
  bean: Bean;
  slingshots: Slingshot[];
  bank: ChicagoBank;
  spinner: Spinner;
  leftRamp: Ramp;
  rightRamp: Ramp;
  cityTourScoop: Scoop;
  lakeMichiganScoop: Scoop;
  captive: CaptiveBall;
  rollovers: Rollover[];
  standups: StandupTarget[];

  walls: WallDef[];
  postPositions: { x: number; y: number; r?: number }[];
  private resolved: ResolvedLayout;
  drainSensor: Matter.Body;

  /** Shooter lane + play area geometry, all derived from the layout frame. */
  get laneInnerX() { return this.resolved.frame.laneInnerX; }
  get laneOuterX() { return this.resolved.frame.laneOuterX; }
  get launchX() { return this.resolved.frame.launchX; }
  get playRight() { return this.resolved.frame.playRight; }
  get playCenter() { return this.resolved.frame.playCenter; }

  /** Flipper geometry. Tip-to-tip gap ≈ 39 px — wider than the ball (22),
   *  so the centre drain is real, like an actual machine. */
  get flipperY() { return this.resolved.frame.flipperY; }
  get flipperGap() { return this.resolved.frame.flipperGap; }

  /** Skill-shot rollover lanes (x centres, top of the playfield). */
  get rolloverXs() { return this.resolved.frame.rolloverXs; }
  get rolloverY() { return this.resolved.frame.rolloverY; }

  private transits: Transit[] = [];
  /** ms until an auto-plunge fires for a freshly served ball. */
  private autoLaunchMs = 0;
  private clockMs = 0;
  private lastCaptiveScoreAt = -1000;
  private lastLeftLoopAt = -1000;
  private lastRightLoopAt = -1000;
  private lastKickbackAt = -1000;
  private lastInlaneL = -1000;
  private lastInlaneR = -1000;

  /** Kickback kicker position — READ FROM the left-outlane sensor rather
   *  than repeated as a literal, so the kicker cannot end up inside a wall
   *  when the sensor moves. */
  get kickbackPos() { return this.resolved.kickbackPos; }
  /** EL EXPRESS pickup (right outlane) and its wireform over the shooter
   *  lane divider — shared by fireExpress() and the renderer. */
  get expressPos() { return this.resolved.expressPos; }
  private lastExpressAt = -1000;
  /** True from launch until the first top-lane pass — that pass is the
   *  skill shot; later passes just score/light the lane. */
  private skillShotArmed = false;

  /** Loop-lane entrance arrows — derived from the loop sensors. This used to
   *  be a literal [20, 462] duplicating their x coordinates: two sources of
   *  truth for one fact. */
  get loopArrowXs() { return this.resolved.loopArrowXs; }

  launchRestY: number;

  constructor(
    private physics: Physics,
    private events: PlayfieldEvents,
    layout: PlayfieldLayout = DEFAULT_LAYOUT,
  ) {
    // The board is DATA now. Everything below this constructor — collision
    // routing, transit, ball management, kickback/express, nudge, lane
    // rotation — is unchanged, because it is entirely label-keyed and
    // position-agnostic. That is what made this refactor safe.
    this.resolved = resolveLayout(layout);
    const parts = buildPlayfield(physics, this.resolved);

    this.balls = parts.balls;
    this.leftFlipper = parts.leftFlipper;
    this.rightFlipper = parts.rightFlipper;
    this.plunger = parts.plunger;
    this.popBumpers = parts.popBumpers;
    this.bean = parts.bean;
    this.slingshots = parts.slingshots;
    this.bank = parts.bank;
    this.spinner = parts.spinner;
    this.leftRamp = parts.leftRamp;
    this.rightRamp = parts.rightRamp;
    this.cityTourScoop = parts.cityTourScoop;
    this.lakeMichiganScoop = parts.lakeMichiganScoop;
    this.captive = parts.captive;
    this.rollovers = parts.rollovers;
    this.standups = parts.standups;
    this.walls = parts.walls;
    this.postPositions = parts.postPositions;
    this.drainSensor = parts.drainSensor;
    this.launchRestY = this.resolved.frame.launchRestY;

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

    // ── Flipper rubber: the cradle ──────────────────────────────────────
    // Real flipper rubber deadens a ball so it walks down the bat and sits
    // in the crook, which is how a player traps and aims. Matter combines
    // restitution with MAX, so the ball's own 0.22 wins no matter what the
    // bat declares — the rebound has to be taken out after the solver runs.
    // Only a PARKED bat absorbs; a bat mid-sweep is untouched, so flip
    // power is exactly what it was.
    // Split the ball's velocity in the bat's frame and treat the two halves
    // differently, which is what rubber actually does: it absorbs the
    // impact but it does not grab. Damping the whole vector instead either
    // glues the ball to a resting bat or (with a speed floor) preserves
    // enough of the inbound direction to coast it off the tip.
    const deaden = (f: Flipper) => (_s: Matter.Body, o: Matter.Body) => {
      if (o.label !== 'ball' || f.swinging) return;
      const v = Matter.Body.getVelocity(o);
      const tx = Math.cos(f.body.angle);
      const ty = Math.sin(f.body.angle);
      const vt = v.x * tx + v.y * ty; // along the bat — rolling
      const vn = -v.x * ty + v.y * tx; // into the bat — the bounce
      const t = vt * FLIPPER_ROLL_DAMP;
      const n = vn * FLIPPER_DEAD_BOUNCE;
      Matter.Body.setVelocity(o, { x: tx * t - ty * n, y: ty * t + tx * n });
    };
    for (const f of [this.leftFlipper, this.rightFlipper]) {
      const label = f.body.label;
      physics.on(label, deaden(f)); // kill the rebound at impact
      physics.onActive(label, deaden(f)); // keep it dead while it settles
    }

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
      const v = Matter.Body.getVelocity(o);
      if (Math.hypot(v.x, v.y) > 4) return;
      this.popBumpers.find((p) => p.body === self)?.pop(o);
    });

    physics.on('slingshot', (self, o) => {
      if (o.label !== 'ball') return;
      this.slingshots.find((sl) => sl.body === self)?.pop(o);
      this.events.onScore({ kind: 'slingshot', points: POINTS.SLINGSHOT });
    });
    physics.onActive('slingshot', (self, o) => {
      if (o.label !== 'ball') return;
      const v = Matter.Body.getVelocity(o);
      if (Math.hypot(v.x, v.y) > 4) return;
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
        if (r.lit) return;
        r.trigger();
        if (this.skillShotArmed) {
          // First lane pass after a launch is the skill shot.
          this.skillShotArmed = false;
          const points = r.letter === '25K' ? POINTS.SKILL_SHOT_CENTER : POINTS.SKILL_SHOT_SIDE;
          this.events.onScore({ kind: 'skill-shot', points });
        } else {
          this.events.onScore({ kind: 'lane', points: POINTS.LANE });
        }
        // Completing the set relights the lanes and advances bonus X.
        if (this.rollovers.every((rr) => rr.lit)) {
          for (const rr of this.rollovers) rr.reset();
          this.events.onLanesComplete();
        }
      });
    }

    for (const s of this.standups) {
      physics.on(s.label, (_self, o) => {
        if (o.label !== 'ball') return;
        s.hit();
        // letter carries the team id ("standup-cubs" → "cubs") for the
        // pair-completion awards.
        this.events.onScore({ kind: 'standup', points: POINTS.STANDUP, letter: s.label.slice(8) });
      });
    }

    // Ramp mouths: a ball entering with enough upward speed rides the
    // drawn plate + habitrail all the way to the opposite inlane. `letter`
    // carries which ramp for shot-specific rules (sport modes).
    const rampEntry = (ramp: Ramp, side: 'L' | 'R') => (_s: Matter.Body, o: Matter.Body) => {
      if (o.label !== 'ball') return;
      if (!ramp.canMake(o)) {
        // FLAP REJECT — a soft upward shot doesn't sail through the mouth
        // into the dead corridor under the plate (where it noodled around
        // invisibly for seconds and read as "the ramp trapped my ball").
        // It clunks off the hinged flap and rolls straight back down
        // toward the flippers, like a real ramp. Descending balls (the
        // funnel's return flow through the throat) pass untouched.
        const v = Matter.Body.getVelocity(o);
        if (v.y < -1) {
          this.physics.defer(() => {
            Matter.Body.setVelocity(o, { x: v.x * 0.25, y: Math.max(3.5, -v.y * 0.45) });
            Matter.Body.setAngularVelocity(o, 0);
          });
          ramp.flashNow(); // the flap visibly rattles
        }
        return;
      }
      ramp.flashNow();
      this.events.onScore({ kind: 'ramp', points: POINTS.RAMP, letter: side });
      this.physics.defer(() => this.startTransit(o, ramp.fullPath, 12, ramp.exitVel));
    };
    physics.on('left-ramp-entry', rampEntry(this.leftRamp, 'L'));
    physics.on('right-ramp-entry', rampEntry(this.rightRamp, 'R'));

    // Spinner rip: the blade is a sensor — the ball passes at full speed
    // and the blade spins up proportionally (revolutions score in tick()).
    physics.on('spinner', (_s, o) => {
      if (o.label !== 'ball') return;
      const v = Matter.Body.getVelocity(o);
      this.spinner.rip(Math.hypot(v.x, v.y));
    });

    physics.on('captive-ball', (_s, o) => {
      if (o.label !== 'ball') return;
      // Require a real impact and rate-limit so a resting contact can't
      // farm points.
      const vo = Matter.Body.getVelocity(o);
      const vc = Matter.Body.getVelocity(this.captive.ball);
      const rel = Math.hypot(vo.x - vc.x, vo.y - vc.y);
      if (rel < 2) return;
      if (this.clockMs - this.lastCaptiveScoreAt < 350) return;
      this.lastCaptiveScoreAt = this.clockMs;
      this.captive.pulseFlash();
      this.events.onScore({ kind: 'captive', points: POINTS.CAPTIVE_BALL });
    });

    physics.on('scoop', (_s, o) => {
      if (o.label !== 'ball') return;
      // Fast balls skip over the hole (like a real scoop) — this is what
      // keeps the captive shot makeable: the MODE scoop's capture circle
      // shadows the left-flipper→captive corridor, so a ripped shot passes
      // over it while a controlled shot sinks and starts a mode.
      const speed = Matter.Body.getVelocity(o);
      if (Math.hypot(speed.x, speed.y) > 16) return;
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

    // Loop lanes: award an upward pass (rate-limited so channel rattle
    // can't double-score).
    const loopHandler = (side: 'left' | 'right') => (_s: Matter.Body, o: Matter.Body) => {
      if (o.label !== 'ball') return;
      if (Matter.Body.getVelocity(o).y > -4) return; // only fast upward passes
      const last = side === 'left' ? this.lastLeftLoopAt : this.lastRightLoopAt;
      if (this.clockMs - last < 1200) return;
      if (side === 'left') this.lastLeftLoopAt = this.clockMs;
      else this.lastRightLoopAt = this.clockMs;
      this.events.onScore({ kind: 'loop', points: POINTS.LOOP, letter: side === 'left' ? 'L' : 'R' });
    };
    physics.on('left-loop', loopHandler('left'));
    physics.on('right-loop', loopHandler('right'));

    physics.on('drain', (_s, o) => {
      if (o.label === 'ball') this.events.onDrain(o);
    });

    // Left outlane, just above the drain — kickback territory.
    physics.on('left-outlane', (_s, o) => {
      if (o.label !== 'ball') return;
      if (Matter.Body.getVelocity(o).y <= 0) return; // falling balls only
      if (this.clockMs - this.lastKickbackAt < 800) return;
      this.events.onLeftOutlane(o);
    });

    // Inlane returns — rate-limited so a resting ball can't farm them.
    const inlane = (side: 'L' | 'R') => (_s: Matter.Body, o: Matter.Body) => {
      if (o.label !== 'ball') return;
      const last = side === 'L' ? this.lastInlaneL : this.lastInlaneR;
      if (this.clockMs - last < 900) return;
      if (side === 'L') this.lastInlaneL = this.clockMs;
      else this.lastInlaneR = this.clockMs;
      this.events.onScore({ kind: 'inlane', points: POINTS.INLANE, letter: side });
    };
    physics.on('inlane-left', inlane('L'));
    physics.on('inlane-right', inlane('R'));

    // Right outlane — EL EXPRESS territory.
    physics.on('right-outlane', (_s, o) => {
      if (o.label !== 'ball') return;
      if (Matter.Body.getVelocity(o).y <= 0) return; // falling balls only
      if (this.clockMs - this.lastExpressAt < 1000) return;
      this.events.onRightOutlane(o);
    });

    // Shooter-lane exit: the launched ball rides the visible wireform over
    // the back of the playfield and drops into a skill-shot lane chosen by
    // how hard the plunger was pulled (arrival speed at the lane top).
    physics.on('launch-exit', (_s, o) => {
      if (o.label !== 'ball') return;
      const v = Matter.Body.getVelocity(o);
      if (v.y >= 0) return; // only upward-moving balls
      const arrivalSpeed = -v.y;
      const laneIdx = arrivalSpeed > 8 ? 0 : arrivalSpeed > 4.5 ? 1 : 2;
      const path = this.shooterPath(this.rolloverXs[laneIdx]);
      this.skillShotArmed = true;
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

  /** Fire the kickback: rocket the ball back up the left outlane channel. */
  fireKickback(ball: Matter.Body) {
    this.lastKickbackAt = this.clockMs;
    this.physics.defer(() => {
      Matter.Body.setPosition(ball, { x: this.kickbackPos.x, y: this.kickbackPos.y - 6 });
      Matter.Body.setVelocity(ball, { x: 0.6, y: -21 });
      Matter.Body.setAngularVelocity(ball, 0);
    });
  }

  /** The EL EXPRESS wireform: right outlane, over the shooter-lane divider,
   *  down onto the plunger. Also drawn by the renderer. */
  expressPath(): Pt[] {
    return [
      { x: this.expressPos.x, y: this.expressPos.y },
      { x: 468, y: 848 },
      { x: 488, y: 826 },
      { x: this.launchX, y: 844 },
      { x: this.launchX, y: this.launchRestY - 26 },
    ];
  }

  /** Ride the Express: carry the outlane ball back to the shooter lane. */
  fireExpress(ball: Matter.Body) {
    this.lastExpressAt = this.clockMs;
    this.physics.defer(() => this.startTransit(ball, this.expressPath(), 8, { x: 0, y: 2 }));
  }

  /** Nudge: shove every live ball. `dir` −1 = from the left (push right),
   *  +1 = from the right (push left). Physical feel, tilt policing is the
   *  Game's job. */
  nudge(dir: -1 | 1) {
    for (const b of this.balls) {
      if ((b.body as unknown as { $transit?: boolean }).$transit) continue;
      const v = Matter.Body.getVelocity(b.body);
      Matter.Body.setVelocity(b.body, { x: v.x + dir * -2.4, y: v.y - 2.2 });
    }
  }

  /** Classic lane change: flipper buttons rotate which top lanes are lit. */
  rotateLanes(dir: 1 | -1) {
    const lit = this.rollovers.map((r) => r.lit);
    if (!lit.some(Boolean) || lit.every(Boolean)) return;
    const n = lit.length;
    for (let i = 0; i < n; i++) {
      this.rollovers[i].lit = lit[(i - dir + n) % n];
    }
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
    for (const b of this.balls) b.pushTrail();

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
