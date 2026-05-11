import Matter from 'matter-js';
import { COLOR } from '../constants';
import { strokeGuideRail, insertArrow } from '../Graphics';

/** A loop / orbit shot. The ball enters at one end, travels around the back
 *  of the playfield via a curved guide rail, and exits the other end. The
 *  arrow at the entry lights when the orbit shot is "lit" (combos / mode). */
export class Orbit {
  readonly entry: Matter.Body;
  readonly exit: Matter.Body;
  readonly path: { x: number; y: number }[];
  /** Direction of the entry arrow (visual only). */
  readonly arrowAngle: number;
  /** Position the entry arrow is rendered at. */
  readonly arrowAt: { x: number; y: number };
  /** Color of the lit insert. */
  readonly color: string;
  /** External flag for whether the shot is currently lit (set by Game). */
  lit = true;
  /** Lane width (used for the visible rail spacing). */
  readonly laneWidth: number;

  private armed = false;
  private armTimer = 0;
  private flash = 0;

  constructor(opts: {
    entry: { x: number; y: number };
    exit: { x: number; y: number };
    path: { x: number; y: number }[];
    arrowAt: { x: number; y: number };
    arrowAngle: number;
    color?: string;
    label: string;
    laneWidth?: number;
  }) {
    this.path = opts.path;
    this.arrowAt = opts.arrowAt;
    this.arrowAngle = opts.arrowAngle;
    this.color = opts.color ?? COLOR.INSERT_CYAN;
    this.laneWidth = opts.laneWidth ?? 28;
    this.entry = Matter.Bodies.circle(opts.entry.x, opts.entry.y, 14, {
      isStatic: true,
      isSensor: true,
      label: `${opts.label}-entry`,
    });
    this.exit = Matter.Bodies.circle(opts.exit.x, opts.exit.y, 14, {
      isStatic: true,
      isSensor: true,
      label: `${opts.label}-exit`,
    });
  }

  arm() {
    this.armed = true;
    this.armTimer = 2200;
  }

  triggerExit(): boolean {
    if (!this.armed) return false;
    this.armed = false;
    this.armTimer = 0;
    this.flash = 1;
    return true;
  }

  tick(dtMs: number) {
    if (this.armed) {
      this.armTimer -= dtMs;
      if (this.armTimer <= 0) this.armed = false;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 500);
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Rails along the orbit
    strokeGuideRail(ctx, this.path, this.laneWidth);
    // Arrow insert at the entry
    const isLit = this.lit || this.armed || this.flash > 0.05;
    insertArrow(ctx, this.arrowAt.x, this.arrowAt.y, 12, this.arrowAngle, this.color, isLit);
  }
}
