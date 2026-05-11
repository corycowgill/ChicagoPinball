import Matter from 'matter-js';
import {
  FLIPPER_LEN,
  FLIPPER_HEIGHT,
  FLIPPER_REST_ANGLE,
  FLIPPER_ACTIVE_ANGLE,
  FLIPPER_KICK_VEL,
  FLIPPER_RETURN_VEL,
  COLOR,
} from '../constants';

export type FlipperSide = 'left' | 'right';

export class Flipper {
  readonly body: Matter.Body;
  readonly pivot: Matter.Constraint;
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
  constructor(side: FlipperSide, pivotX: number, pivotY: number) {
    this.side = side;
    this.pivotX = pivotX;
    this.pivotY = pivotY;
    this.restAngle = side === 'left' ? FLIPPER_REST_ANGLE : Math.PI - FLIPPER_REST_ANGLE;
    this.activeAngle = side === 'left' ? FLIPPER_ACTIVE_ANGLE : Math.PI - FLIPPER_ACTIVE_ANGLE;

    // Place body so its LEFT end (local x = -half) sits on the pivot when at restAngle.
    const half = FLIPPER_LEN / 2;
    const px = pivotX + Math.cos(this.restAngle) * half;
    const py = pivotY + Math.sin(this.restAngle) * half;

    this.body = Matter.Bodies.rectangle(px, py, FLIPPER_LEN, FLIPPER_HEIGHT, {
      density: 0.12,
      frictionAir: 0.02,
      friction: 0.1,
      restitution: 0.2,
      chamfer: { radius: FLIPPER_HEIGHT / 2 },
      label: side === 'left' ? 'flipper-left' : 'flipper-right',
    });
    Matter.Body.setAngle(this.body, this.restAngle);

    // The pivot constraint is still useful as a backup for ball-vs-flipper
    // collision response (so the constraint solver knows the flipper has a
    // hinge), but with the kinematic enforcement below it normally has nothing
    // to correct.
    this.pivot = Matter.Constraint.create({
      pointA: { x: pivotX, y: pivotY },
      bodyB: this.body,
      pointB: { x: -half, y: 0 },
      stiffness: 1,
      length: 0,
      damping: 0.1,
    });
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
    if (Math.abs(diff) < speed * 0.5) {
      // Within one step of target — hold still.
      Matter.Body.setAngularVelocity(this.body, 0);
    } else {
      Matter.Body.setAngularVelocity(this.body, Math.sign(diff) * speed);
    }
  }

  /** Run after the physics step. The pivot constraint keeps the bat anchored
   *  but gravity + ball collisions can drift the angle past the valid range
   *  and the position off the constraint anchor by a fraction of a pixel.
   *  Clamp aggressively to the rest/active range, and snap position back
   *  ONLY if drift exceeds a threshold (otherwise we'd be teleporting every
   *  frame, which is exactly the bug we just fixed). */
  enforce() {
    const lo = Math.min(this.restAngle, this.activeAngle);
    const hi = Math.max(this.restAngle, this.activeAngle);
    if (this.body.angle < lo) {
      Matter.Body.setAngle(this.body, lo);
      Matter.Body.setAngularVelocity(this.body, 0);
    } else if (this.body.angle > hi) {
      Matter.Body.setAngle(this.body, hi);
      Matter.Body.setAngularVelocity(this.body, 0);
    }
    // Position drift correction — only snap if > 3 px off the expected
    // anchor point. The constraint + the integrator should keep drift to
    // sub-pixel under normal play; only a hard ball collision could push
    // the bat enough to warrant a snap, and at that point it's safe
    // because the ball has already had its impulse applied.
    const half = FLIPPER_LEN / 2;
    const expectedX = this.pivotX + Math.cos(this.body.angle) * half;
    const expectedY = this.pivotY + Math.sin(this.body.angle) * half;
    const dx = expectedX - this.body.position.x;
    const dy = expectedY - this.body.position.y;
    if (dx * dx + dy * dy > 9 /* 3 px squared */) {
      Matter.Body.setPosition(this.body, { x: expectedX, y: expectedY });
      Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const a = this.body.angle;
    const cx = this.body.position.x;
    const cy = this.body.position.y;
    const half = FLIPPER_LEN / 2;
    const h = FLIPPER_HEIGHT;

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
    ctx.fillRect(-half + 8, -h / 2 + 2, FLIPPER_LEN - 18, 1.6);

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
