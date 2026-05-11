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
  /** Authoritative angle. The body's `angle` is forced to this value every
   *  beforeUpdate AND afterUpdate so neither gravity nor constraint impulse
   *  resolution can move it off. */
  private currentAngle: number;
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
    this.currentAngle = this.restAngle;

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

  /** Snap the body to the authoritative angle/position with consistent
   *  velocity bookkeeping. Called from both beforeUpdate and afterUpdate. */
  private commit(angularVel: number) {
    const half = FLIPPER_LEN / 2;
    const px = this.pivotX + Math.cos(this.currentAngle) * half;
    const py = this.pivotY + Math.sin(this.currentAngle) * half;
    // Order matters: setPosition / setAngle update vertices but not *Prev.
    // Then setVelocity / setAngularVelocity update *Prev so Verlet integration
    // reproduces the requested velocities (rather than computing phantom ones
    // from the difference between the snapped pose and the last frame's pose).
    Matter.Body.setPosition(this.body, { x: px, y: py });
    Matter.Body.setAngle(this.body, this.currentAngle);
    // Linear velocity at the body's centre = ω × r, where r is body-centre
    // relative to pivot. Needed so a ball hit during a flip gets the right
    // tangential impulse.
    const rx = px - this.pivotX;
    const ry = py - this.pivotY;
    Matter.Body.setVelocity(this.body, { x: -angularVel * ry, y: angularVel * rx });
    Matter.Body.setAngularVelocity(this.body, angularVel);
  }

  /** Step the authoritative angle toward its current target by at most one
   *  per-frame increment, and write the resulting kinematic state to the body. */
  tick() {
    const target = this.active ? this.activeAngle : this.restAngle;
    const step = this.active ? this.kickStep : this.returnStep;
    const diff = target - this.currentAngle;
    let angularVel = 0;
    if (Math.abs(diff) <= step) {
      this.currentAngle = target;
    } else {
      const dir = Math.sign(diff);
      this.currentAngle += dir * step;
      angularVel = dir * step;
    }
    this.commit(angularVel);
  }

  /** Re-apply the authoritative pose after the engine integrates, so any
   *  drift from gravity or contact resolution during the step is undone before
   *  the frame is rendered. */
  enforce() {
    // Same target as last beforeUpdate — angle has already been advanced. Just
    // re-pin the body to it without further angular advancement.
    const angularVel = this.currentAngle === (this.active ? this.activeAngle : this.restAngle)
      ? 0
      : (this.active ? this.kickStep : this.returnStep) * Math.sign(
          (this.active ? this.activeAngle : this.restAngle) - this.currentAngle,
        );
    this.commit(angularVel);
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
