import Matter from 'matter-js';
import {
  FLIPPER_LEN,
  FLIPPER_HEIGHT,
  FLIPPER_REST_ANGLE,
  FLIPPER_ACTIVE_ANGLE,
  FLIPPER_KICK_VEL,
  FLIPPER_RETURN_VEL,
  PHYSICS_SUBSTEPS,
  COLOR,
} from '../constants';

export type FlipperSide = 'left' | 'right';

export interface FlipperOpts {
  /** Bat length (default FLIPPER_LEN). */
  len?: number;
  /** Bat thickness (default FLIPPER_HEIGHT). Keep it well above the
   *  per-substep ball motion (BALL_MAX_SPEED / PHYSICS_SUBSTEPS) or fast
   *  balls can step through the bat. */
  height?: number;
  /** RAW angles (already side-adjusted) overriding the standard pair. */
  restAngle?: number;
  activeAngle?: number;
}

export class Flipper {
  readonly body: Matter.Body;
  readonly pivot: Matter.Constraint;
  /** Bat dimensions — the 3D renderer reads these. */
  readonly len: number;
  readonly height: number;
  private active = false;
  private restAngle: number;
  private activeAngle: number;
  private side: FlipperSide;
  private pivotX: number;
  private pivotY: number;
  /** Per-step rotation rate for kick / return. */
  private readonly kickStep = FLIPPER_KICK_VEL;
  private readonly returnStep = FLIPPER_RETURN_VEL;

  /** pivotX/pivotY is the world-space hinge point. */
  constructor(side: FlipperSide, pivotX: number, pivotY: number, opts: FlipperOpts = {}) {
    this.side = side;
    this.pivotX = pivotX;
    this.pivotY = pivotY;
    this.len = opts.len ?? FLIPPER_LEN;
    this.height = opts.height ?? FLIPPER_HEIGHT;
    this.restAngle =
      opts.restAngle ?? (side === 'left' ? FLIPPER_REST_ANGLE : Math.PI - FLIPPER_REST_ANGLE);
    this.activeAngle =
      opts.activeAngle ??
      (side === 'left' ? FLIPPER_ACTIVE_ANGLE : Math.PI - FLIPPER_ACTIVE_ANGLE);

    // Place body so its LEFT end (local x = -half) sits on the pivot when at restAngle.
    const half = this.len / 2;
    const px = pivotX + Math.cos(this.restAngle) * half;
    const py = pivotY + Math.sin(this.restAngle) * half;

    this.body = Matter.Bodies.rectangle(px, py, this.len, this.height, {
      density: 0.12,
      frictionAir: 0.02,
      friction: 0.1,
      restitution: 0.2,
      chamfer: { radius: this.height / 2 },
      label: side === 'left' ? 'flipper-left' : 'flipper-right',
    });
    // Gravity does act on the bat (matter-js has no per-body gravity
    // scale), but enforce() re-anchors the position and zeroes velocity
    // after every step, so the per-step drift never accumulates.
    Matter.Body.setAngle(this.body, this.restAngle);

    // The pivot constraint is still useful as a backup for ball-vs-flipper
    // collision response (so the constraint solver knows the flipper has a
    // hinge), but with the kinematic enforcement below it normally has nothing
    // to correct.
    this.pivot = Matter.Constraint.create({
      pointA: { x: pivotX, y: pivotY },
      bodyB: this.body,
      // Constraint.create snapshots angleB = the body's CURRENT angle, so
      // pointB must be the pivot offset in the already-rotated frame — the
      // raw local (-half, 0) pins a point up to ~105 px from the real pivot
      // (worst on the right bat, whose rest angle is π−0.42). The rigid
      // constraint then dragged the bat's collision vertices toward that
      // bogus anchor every step BEFORE collision detection, while enforce()
      // re-anchored the pose afterwards: the bat drew in one place and
      // collided in another (balls sailed through where it was drawn).
      pointB: {
        x: -half * Math.cos(this.restAngle),
        y: -half * Math.sin(this.restAngle),
      },
      stiffness: 1,
      length: 0,
      damping: 0.1,
      // Position-only pin. With the default (0), the constraint also applies
      // a torque correction every solver iteration, which fights the driven
      // rotation and reduces the swing to ~3% of its commanded speed — the
      // flippers looked alive but had no power. 1 disables the torque term.
      // (Missing from @types/matter-js, hence the cast.)
      angularStiffness: 1,
    } as Matter.IConstraintDefinition & { angularStiffness: number });
  }

  setActive(v: boolean) {
    this.active = v;
  }

  /** Move the bat by setting ANGULAR VELOCITY rather than teleporting the
   *  body's position. Letting Matter integrate the motion means a ball in
   *  the bat's swept area gets collision-checked during the step (Matter's
   *  discrete detector sees the bat AS IT MOVES THROUGH the ball's
   *  position). The previous setPosition/setAngle approach teleported the
   *  bat between frames — a ball mid-step could find itself with no bat
   *  beside it at frame end, and Matter would record no collision (this
   *  was the "balls go through the flippers" bug).
   *
   *  Drift correction is in `enforce()`. */
  tick() {
    const target = this.active ? this.activeAngle : this.restAngle;
    const speed = this.active ? this.kickStep : this.returnStep;
    const diff = target - this.body.angle;
    if (Math.abs(diff) < 1e-3) {
      // At target — hold still.
      Matter.Body.setAngularVelocity(this.body, 0);
      Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    } else {
      // Angular velocity is per 16.6 ms; each substep rotates w/SUBSTEPS, so
      // command exactly what's needed near the target to land on it instead
      // of overshooting (enforce clamps any residue).
      const w = Math.sign(diff) * Math.min(speed, Math.abs(diff) * PHYSICS_SUBSTEPS);
      Matter.Body.setAngularVelocity(this.body, w);
      // The bat rotates about the PIVOT, not its own centre of mass — so the
      // centre must also translate (v = ω × r). Without this, Matter resolves
      // ball contacts as if the bat were spinning in place: the effective
      // lever arm is halved at the tip and the surface near the root moves
      // the WRONG way, which made resting-ball flips powerless.
      const rx = this.body.position.x - this.pivotX;
      const ry = this.body.position.y - this.pivotY;
      Matter.Body.setVelocity(this.body, { x: -w * ry, y: w * rx });
    }
  }

  /** Run after the physics step. The pivot constraint keeps the bat anchored
   *  but gravity + ball collisions can drift the angle past the valid range
   *  and the position off the constraint anchor by a fraction of a pixel.
   *  When the bat is near its target angle (within 0.05 rad ≈ 3°), snap to
   *  exact target so it doesn't visibly settle at a tilted-by-gravity rest.
   *  Otherwise clamp to the valid [rest, active] range. */
  enforce() {
    const target = this.active ? this.activeAngle : this.restAngle;
    const diff = target - this.body.angle;
    const half = this.len / 2;
    // Snap-to-target window: only absorbs the tiny residue left by ball
    // impacts nudging the held bat. Kept SMALL (tip motion 0.03 × 108 ≈
    // 3 px) because the snap is a teleport that bypasses collision — a
    // wide window was one of the ways balls slipped through the bat.
    if (Math.abs(diff) < 0.03) {
      Matter.Body.setAngle(this.body, target);
      Matter.Body.setPosition(this.body, {
        x: this.pivotX + Math.cos(target) * half,
        y: this.pivotY + Math.sin(target) * half,
      });
      Matter.Body.setAngularVelocity(this.body, 0);
      Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    } else {
      // Mid-swing — clamp to the valid range and re-anchor position to
      // the expected location.
      const lo = Math.min(this.restAngle, this.activeAngle);
      const hi = Math.max(this.restAngle, this.activeAngle);
      let a = this.body.angle;
      if (a < lo) { Matter.Body.setAngle(this.body, lo); a = lo; }
      else if (a > hi) { Matter.Body.setAngle(this.body, hi); a = hi; }
      Matter.Body.setPosition(this.body, {
        x: this.pivotX + Math.cos(a) * half,
        y: this.pivotY + Math.sin(a) * half,
      });
      Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const a = this.body.angle;
    const cx = this.body.position.x;
    const cy = this.body.position.y;
    const half = this.len / 2;
    const h = this.height;

    // Drop shadow under the flipper bat.
    ctx.save();
    ctx.translate(cx + 1.5, cy + 4);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    drawFlipperShape(ctx, half, h);
    ctx.fill();
    ctx.restore();

    // Flipper bat — red plastic body with metallic gradient.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, COLOR.FLIPPER_RED_HI);
    grad.addColorStop(0.45, COLOR.FLIPPER_RED);
    grad.addColorStop(1, COLOR.FLIPPER_RED_LOW);
    ctx.fillStyle = grad;
    ctx.beginPath();
    drawFlipperShape(ctx, half, h);
    ctx.fill();

    // Glossy highlight stripe along the top edge of the bat.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(-half + 8, -h / 2 + 2, this.len - 18, 1.6);
    // Brass pinstripe — matches the deco trim across the board.
    ctx.fillStyle = 'rgba(217, 164, 65, 0.6)';
    ctx.fillRect(-half + 8, -h / 2 + 5, this.len - 22, 1);

    // Black rubber strip along the leading (striking) face.
    ctx.fillStyle = COLOR.FLIPPER_RUBBER;
    ctx.beginPath();
    ctx.moveTo(-half + 4, h / 2);
    ctx.lineTo(half - 6, h / 2 - 2);
    ctx.lineTo(half - 6, h / 2 - 5);
    ctx.lineTo(-half + 4, h / 2 - 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Pivot stud — chrome cap at the hinge for a finished look.
    const px = this.pivot.pointA.x;
    const py = this.pivot.pointA.y;
    ctx.save();
    const studGrad = ctx.createRadialGradient(px - 2, py - 2, 0, px, py, 6);
    studGrad.addColorStop(0, COLOR.METAL_LIGHT);
    studGrad.addColorStop(0.6, COLOR.METAL_MID);
    studGrad.addColorStop(1, COLOR.METAL_DARK);
    ctx.fillStyle = studGrad;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(px - 1.5, py - 2, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
    ctx.restore();
  }
}

/** Tapered flipper bat outline — wider at the pivot end, narrower at the
 *  tip, with a rounded tip. Drawn in the body's local frame (axis along +x). */
function drawFlipperShape(ctx: CanvasRenderingContext2D, half: number, h: number) {
  const tipR = h / 2 - 2;
  ctx.beginPath();
  ctx.moveTo(-half, -h / 2);
  ctx.lineTo(half - tipR, -h / 2 + 1);
  ctx.arc(half - tipR, 0, tipR, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-half, h / 2);
  ctx.arc(-half + 0, 0, h / 2, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
}
