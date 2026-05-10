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
    const verts = this.body.vertices;
    ctx.save();
    ctx.shadowColor = COLOR.FLIPPER;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COLOR.FLIPPER;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
    ctx.fill();

    // Bright inner stripe along the flipper axis
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.55;
    const a = this.body.angle;
    const cx = this.body.position.x;
    const cy = this.body.position.y;
    const halfLen = FLIPPER_LEN / 2 - 6;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * halfLen, cy - Math.sin(a) * halfLen);
    ctx.lineTo(cx + Math.cos(a) * halfLen, cy + Math.sin(a) * halfLen);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Pivot stud — makes the hinge visible and reads as symmetric.
    const px = this.pivot.pointA.x;
    const py = this.pivot.pointA.y;
    ctx.fillStyle = '#1a2030';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}
