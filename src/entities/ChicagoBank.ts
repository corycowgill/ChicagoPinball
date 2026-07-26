import Matter from 'matter-js';
import { CHICAGO, POINTS } from '../constants';
import { DropTarget } from './DropTarget';
import { Physics } from '../Physics';

export interface BankSlot {
  x: number;
  y: number;
  angle: number;
}

/** The seven CHICAGO drop targets, laid out across two angled banks
 *  ("CHI" on the left, "CAGO" on the right) so the centre of the playfield
 *  stays open. Slot order must follow the CHICAGO spelling — the HUD strip
 *  and the in-order bonus both index by letter position. */
export class ChicagoBank {
  readonly targets: DropTarget[] = [];
  private byBody = new Map<Matter.Body, DropTarget>();
  /** Index of the next not-yet-hit letter required to spell CHICAGO in order. */
  private nextIdx = 0;
  /** Mask of letters knocked down (any order). */
  private knocked = 0;
  /** When all 7 letters knocked, queue a reset after this delay (ms). */
  private resetTimer = 0;
  private orderBonusActive = true;

  constructor(private physics: Physics, slots: BankSlot[]) {
    if (slots.length !== CHICAGO.length) {
      throw new Error(`ChicagoBank needs ${CHICAGO.length} slots, got ${slots.length}`);
    }
    for (let i = 0; i < CHICAGO.length; i++) {
      const s = slots[i];
      const t = new DropTarget(`${CHICAGO[i]}${i}`, CHICAGO[i], s.x, s.y, s.angle);
      this.targets.push(t);
      this.byBody.set(t.body, t);
      physics.add(t.body);
    }
  }

  /** Returns score awarded (or 0 if no-op). */
  onHit(targetBody: Matter.Body): { points: number; superJackpot: boolean; letter: string } {
    const target = this.byBody.get(targetBody);
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

    // Defer body removal until after the current physics step.
    this.physics.defer(() => {
      this.physics.remove(target.body);
    });

    let superJackpot = false;
    if (this.knocked === (1 << this.targets.length) - 1) {
      superJackpot = true;
      points += POINTS.SUPER_JACKPOT;
      this.resetTimer = 1500;
    }

    return { points, superJackpot, letter: target.letter };
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

  /** Spot the next standing letter — awarded by the captive-ball shot, so
   *  CHICAGO is reachable in a game without living on the drop banks.
   *  Returns the letter spotted (and whether that completed the set), or
   *  null when every target is already down. */
  spotLetter(): { letter: string; completed: boolean } | null {
    const target = this.targets.find((t) => !t.hit);
    if (!target) return null;
    target.hit = true;
    const idx = this.targets.indexOf(target);
    this.knocked |= 1 << idx;
    this.orderBonusActive = false;
    this.physics.defer(() => {
      this.physics.remove(target.body);
    });
    const completed = this.knocked === (1 << this.targets.length) - 1;
    if (completed) this.resetTimer = 1500;
    return { letter: target.letter, completed };
  }

  litMask(): boolean[] {
    return this.targets.map((t) => t.hit);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const t of this.targets) t.draw(ctx);
  }
}
