import Matter from 'matter-js';
import { CHICAGO, POINTS } from '../constants';
import { DropTarget } from './DropTarget';
import { Physics } from '../Physics';

export class ChicagoBank {
  readonly targets: DropTarget[];
  /** Index of the next not-yet-hit letter required to spell CHICAGO in order. */
  private nextIdx = 0;
  /** Mask of letters knocked down (any order). */
  private knocked = 0;
  /** When all 7 letters knocked, queue a reset after this delay (ms). */
  private resetTimer = 0;
  private orderBonusActive = true;

  constructor(private physics: Physics, opts: { x: number; yTop: number; spacing: number }) {
    this.targets = [];
    for (let i = 0; i < CHICAGO.length; i++) {
      const t = new DropTarget(`${CHICAGO[i]}_${i}`, opts.x, opts.yTop + i * opts.spacing);
      // override the label to include unique id, but keep visible letter
      (t as any).visibleLetter = CHICAGO[i];
      this.targets.push(t);
    }
    for (const t of this.targets) {
      physics.add(t.body);
      // Customize the draw label
      const visible = (t as any).visibleLetter;
      t.draw = ((orig) =>
        function (this: DropTarget, ctx: CanvasRenderingContext2D) {
          const saved = (this as any).letter;
          (this as any).letter = visible;
          orig.call(this, ctx);
          (this as any).letter = saved;
        })(t.draw) as any;
    }
  }

  /** Returns score awarded (or 0 if no-op). */
  onHit(targetBody: Matter.Body): { points: number; superJackpot: boolean; letter: string } {
    const target = (targetBody as any).$dropTarget as DropTarget | undefined;
    if (!target || target.hit) return { points: 0, superJackpot: false, letter: '' };
    target.hit = true;
    const idx = this.targets.indexOf(target);
    this.knocked |= 1 << idx;

    let points = POINTS.DROP_TARGET;
    if (this.orderBonusActive && idx === this.nextIdx) {
      points += 250; // in-order bonus
      this.nextIdx++;
    } else {
      this.orderBonusActive = false;
    }

    // Defer body removal until after current physics step.
    this.physics.defer(() => {
      this.physics.remove(target.body);
    });

    let superJackpot = false;
    if (this.knocked === (1 << this.targets.length) - 1) {
      superJackpot = true;
      points += POINTS.SUPER_JACKPOT;
      this.resetTimer = 1500;
    }

    return { points, superJackpot, letter: (target as any).visibleLetter };
  }

  tick(dtMs: number) {
    if (this.resetTimer > 0) {
      this.resetTimer -= dtMs;
      if (this.resetTimer <= 0) this.reset();
    }
  }

  reset() {
    for (const t of this.targets) {
      if (t.hit) {
        t.reset();
        Matter.Body.setPosition(t.body, { x: t.home.x, y: t.home.y });
        Matter.Body.setAngle(t.body, t.home.angle);
        this.physics.add(t.body);
      }
    }
    this.knocked = 0;
    this.nextIdx = 0;
    this.orderBonusActive = true;
    this.resetTimer = 0;
  }

  litMask(): boolean[] {
    return this.targets.map((t) => t.hit);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const t of this.targets) t.draw(ctx);
  }
}
