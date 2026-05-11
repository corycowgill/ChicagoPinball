import Matter from 'matter-js';
import { GRAVITY_Y } from './constants';

export type CollisionHandler = (
  self: Matter.Body,
  other: Matter.Body,
  pair: Matter.Pair,
) => void;

export class Physics {
  readonly engine: Matter.Engine;
  readonly world: Matter.World;
  private handlers = new Map<string, CollisionHandler[]>();
  private deferred: Array<() => void> = [];

  constructor() {
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: GRAVITY_Y, scale: 0.001 },
      // Higher iterations help fast-moving balls vs kinematic flippers —
      // each step does more position correction passes so a ball can't
      // tunnel through a flipper bat that's been teleported between frames.
      positionIterations: 20,
      velocityIterations: 16,
      constraintIterations: 6,
      enableSleeping: false,
    });
    this.world = this.engine.world;

    Matter.Events.on(this.engine, 'collisionStart', (evt) => {
      for (const pair of evt.pairs) {
        this.dispatch(pair.bodyA, pair.bodyB, pair);
        this.dispatch(pair.bodyB, pair.bodyA, pair);
      }
    });

    Matter.Events.on(this.engine, 'afterUpdate', () => {
      const queue = this.deferred;
      this.deferred = [];
      for (const fn of queue) fn();
    });
  }

  private dispatch(self: Matter.Body, other: Matter.Body, pair: Matter.Pair) {
    const list = this.handlers.get(self.label);
    if (!list) return;
    for (const fn of list) fn(self, other, pair);
  }

  add(...bodies: (Matter.Body | Matter.Constraint | Matter.Composite)[]) {
    Matter.Composite.add(this.world, bodies as any);
  }

  remove(body: Matter.Body | Matter.Constraint | Matter.Composite) {
    Matter.Composite.remove(this.world, body as any);
  }

  on(label: string, handler: CollisionHandler) {
    let list = this.handlers.get(label);
    if (!list) {
      list = [];
      this.handlers.set(label, list);
    }
    list.push(handler);
  }

  /** Defer a mutation until after the current physics step finishes. */
  defer(fn: () => void) {
    this.deferred.push(fn);
  }

  step(dtMs: number) {
    Matter.Engine.update(this.engine, dtMs);
  }

  beforeUpdate(handler: () => void) {
    Matter.Events.on(this.engine, 'beforeUpdate', handler);
  }

  afterUpdate(handler: () => void) {
    Matter.Events.on(this.engine, 'afterUpdate', handler);
  }
}
