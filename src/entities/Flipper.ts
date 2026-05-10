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

  /** pivotX/pivotY is the world-space hinge point. */
  constructor(side: FlipperSide, pivotX: number, pivotY: number) {
    this.side = side;
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

  /** Called every physics step (in beforeUpdate) to enforce angle clamp + kick. */
  tick() {
    const angle = this.body.angle;
    const target = this.active ? this.activeAngle : this.restAngle;

    if (this.side === 'left') {
      if (this.active) {
        if (angle > target) {
          // Need to rotate up (negative angle direction).
          Matter.Body.setAngularVelocity(this.body, -FLIPPER_KICK_VEL);
        } else {
          Matter.Body.setAngularVelocity(this.body, 0);
          Matter.Body.setAngle(this.body, target);
        }
      } else {
        if (angle < target) {
          Matter.Body.setAngularVelocity(this.body, FLIPPER_RETURN_VEL);
        } else {
          Matter.Body.setAngularVelocity(this.body, 0);
          Matter.Body.setAngle(this.body, target);
        }
      }
    } else {
      // Right flipper rotates the opposite way; its "active" angle has higher numeric value.
      if (this.active) {
        if (angle < target) {
          Matter.Body.setAngularVelocity(this.body, FLIPPER_KICK_VEL);
        } else {
          Matter.Body.setAngularVelocity(this.body, 0);
          Matter.Body.setAngle(this.body, target);
        }
      } else {
        if (angle > target) {
          Matter.Body.setAngularVelocity(this.body, -FLIPPER_RETURN_VEL);
        } else {
          Matter.Body.setAngularVelocity(this.body, 0);
          Matter.Body.setAngle(this.body, target);
        }
      }
    }
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
    // bright stripe
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    const a = this.body.angle;
    const cx = this.body.position.x;
    const cy = this.body.position.y;
    const halfLen = FLIPPER_LEN / 2 - 6;
    ctx.moveTo(cx - Math.cos(a) * halfLen, cy - Math.sin(a) * halfLen);
    ctx.lineTo(cx + Math.cos(a) * halfLen, cy + Math.sin(a) * halfLen);
    ctx.stroke();
    ctx.restore();
  }
}
