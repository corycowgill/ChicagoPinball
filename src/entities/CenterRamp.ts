import Matter from 'matter-js';
import { COLOR } from '../constants';
import { strokePlasticRamp } from '../Graphics';

/** A raised center ramp the ball can travel up. The ramp is represented
 *  visually as a translucent plastic band; physically it has an entry sensor
 *  at the bottom and an exit sensor at the top, with a brief "armed" window
 *  in between to credit a successful traversal. */
export class CenterRamp {
  readonly entry: Matter.Body;
  readonly exit: Matter.Body;
  readonly path: { x: number; y: number }[];
  private armed = false;
  private armTimer = 0;
  private flash = 0;

  constructor(opts: {
    entry: { x: number; y: number };
    exit: { x: number; y: number };
    path: { x: number; y: number }[];
  }) {
    this.entry = Matter.Bodies.circle(opts.entry.x, opts.entry.y, 16, {
      isStatic: true,
      isSensor: true,
      label: 'centerramp-entry',
    });
    this.exit = Matter.Bodies.circle(opts.exit.x, opts.exit.y, 16, {
      isStatic: true,
      isSensor: true,
      label: 'centerramp-exit',
    });
    this.path = opts.path;
  }

  arm() {
    this.armed = true;
    this.armTimer = 1500;
  }

  triggerExit(): boolean {
    if (this.armed) {
      this.armed = false;
      this.armTimer = 0;
      this.flash = 1;
      return true;
    }
    return false;
  }

  tick(dtMs: number) {
    if (this.armed) {
      this.armTimer -= dtMs;
      if (this.armTimer <= 0) this.armed = false;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 600);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const lit = this.armed || this.flash > 0;
    const color = this.flash > 0 ? COLOR.INSERT_AMBER : COLOR.INSERT_BLUE;
    strokePlasticRamp(ctx, this.path, color, 36, lit ? 0.75 : 0.5);
  }
}
