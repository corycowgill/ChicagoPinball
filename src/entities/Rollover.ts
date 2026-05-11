import Matter from 'matter-js';
import { COLOR } from '../constants';
import { insertArrow, insertCircle } from '../Graphics';

/** A rollover lane at the top of the playfield. Each lane is just a sensor;
 *  passing the ball through it lights the lane (used for skill-shot logic
 *  and bonus multiplier increases). Drawn as a backlit arrow centred in a
 *  vertical lane bordered by faint guide lines. */
export class Rollover {
  readonly sensor: Matter.Body;
  readonly label: string;
  /** True once the ball has passed through this lane during the current
   *  ball-in-play. Used to render the insert as lit. */
  lit = false;
  private flash = 0;

  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly letter: string,
    public readonly idx: number = 0,
  ) {
    // Label includes the index so two rollovers with the same display
    // letter (e.g. two "10K" lanes) still have distinct physics labels —
    // otherwise triggering one would light both via shared dispatch.
    this.label = `roll-${letter}-${idx}`;
    this.sensor = Matter.Bodies.rectangle(x, y, 26, 12, {
      isStatic: true,
      isSensor: true,
      label: this.label,
    });
  }

  trigger() {
    if (!this.lit) {
      this.lit = true;
      this.flash = 1;
    }
  }

  reset() {
    this.lit = false;
    this.flash = 0;
  }

  tick(dtMs: number) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs / 350);
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Lit insert arrow pointing DOWN (into the lane from the top).
    insertArrow(ctx, this.x, this.y - 18, 9, Math.PI / 2, COLOR.INSERT_GREEN, this.lit);
    // Letter pip below.
    insertCircle(ctx, this.x, this.y + 10, 7, COLOR.INSERT_GREEN, this.lit);
    ctx.save();
    ctx.fillStyle = this.lit ? '#ffffff' : '#0a0f1a';
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.letter, this.x, this.y + 10);
    ctx.restore();
  }
}
