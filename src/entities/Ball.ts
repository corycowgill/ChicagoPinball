import Matter from 'matter-js';
import { BALL_RADIUS, BALL_MAX_SPEED, PHYSICS_SUBSTEPS, COLOR } from '../constants';

export class Ball {
  readonly body: Matter.Body;
  /** Recent positions for the motion trail (newest last). */
  private trail: { x: number; y: number }[] = [];
  /** Number of consecutive frames the ball has been near-stationary;
   *  used by the anti-stuck nudge in tick(). */
  private stuckFrames = 0;

  constructor(x: number, y: number) {
    this.body = Matter.Bodies.circle(x, y, BALL_RADIUS, {
      // Restitution lowered (was 0.42) so the ball settles instead of
      // bouncing forever in the bottom playfield. 2D top-down pinball
      // has no playfield friction, so a bouncy ball wedges in corners
      // (the source of the right-inlane wedge bug).
      restitution: 0.22,
      friction: 0.005,
      // More air drag (was 0.0008) so the ball loses kinetic energy
      // gradually as it bounces around — feels like real playfield
      // friction.
      frictionAir: 0.0014,
      density: 0.0024,
      label: 'ball',
      slop: 0.01,
    });
  }

  /** Test/probe helper: set the ball's velocity through Matter properly
   *  (direct writes to body.velocity are ignored by the integrator). */
  setVelocity(vx: number, vy: number) {
    Matter.Body.setVelocity(this.body, { x: vx, y: vy });
    Matter.Body.setAngularVelocity(this.body, 0);
  }

  capVelocity() {
    const v = Matter.Body.getVelocity(this.body);
    const mag = Math.hypot(v.x, v.y);
    if (mag > BALL_MAX_SPEED) {
      const s = BALL_MAX_SPEED / mag;
      Matter.Body.setVelocity(this.body, { x: v.x * s, y: v.y * s });
    }
  }

  /** Anti-stuck: 2D top-down pinball without playfield friction can get a
   *  ball cradled against a curved surface (a slingshot corner, a bumper
   *  edge, the bean) where gravity alone won't dislodge it. After ~1 s of
   *  near-zero velocity, set the ball's velocity directly to nudge it
   *  toward the bottom of the playfield. setVelocity is used instead of
   *  applyForce because Matter forces are scaled by 1/mass and would need
   *  to be huge to noticeably move the ball. */
  unstickIfStalled() {
    const v = Matter.Body.getVelocity(this.body);
    const mag = Math.hypot(v.x, v.y);
    // Threshold raised so brief contact pauses don't trigger; trigger
    // window shortened so the ball doesn't sit visibly idle for a full
    // second when it does get cradled. Counter ticks once per SUBSTEP.
    if (mag < 0.6) {
      this.stuckFrames++;
      if (this.stuckFrames > 30 * PHYSICS_SUBSTEPS) {
        // Direction bias: nudge AWAY from the closer side of centre so
        // the ball moves into open play.
        const sign = this.body.position.x < 240 ? +1 : -1;
        Matter.Body.setVelocity(this.body, { x: sign * 4, y: 6 });
        Matter.Body.setAngularVelocity(this.body, 0);
        this.stuckFrames = 0;
      }
    } else {
      this.stuckFrames = 0;
    }
  }

  setPosition(x: number, y: number) {
    Matter.Body.setPosition(this.body, { x, y });
    Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(this.body, 0);
    this.trail.length = 0;
  }

  /** Record the current position for the motion trail (once per frame). */
  pushTrail() {
    this.trail.push({ x: this.body.position.x, y: this.body.position.y });
    if (this.trail.length > 6) this.trail.shift();
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y } = this.body.position;
    const r = BALL_RADIUS;

    // Motion trail — fading ghosts along recent positions. Invisible when
    // slow (the points overlap the ball), a comet streak at speed.
    ctx.save();
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      const f = (i + 1) / this.trail.length;
      ctx.globalAlpha = f * 0.16;
      ctx.fillStyle = '#cfe0ff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (0.35 + 0.5 * f), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Ground shadow (more elliptical = ball is closer to playfield)
    ctx.save();
    const sh = ctx.createRadialGradient(x + 1, y + r * 0.7, 0, x + 1, y + r * 0.7, r * 1.4);
    sh.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    sh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(x + 1.5, y + r * 0.85, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Chrome ball
    ctx.save();
    const grad = ctx.createRadialGradient(x - r * 0.4, y - r * 0.55, 1, x, y, r);
    grad.addColorStop(0, COLOR.BALL_HI);
    grad.addColorStop(0.45, COLOR.BALL);
    grad.addColorStop(0.85, '#7a849c');
    grad.addColorStop(1, COLOR.BALL_DARK);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Specular pip
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y - r * 0.5, r * 0.22, r * 0.13, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Faint reflection-line at the equator
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.05, r * 0.85, r * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
