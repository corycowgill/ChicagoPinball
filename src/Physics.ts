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
  private activeHandlers = new Map<string, CollisionHandler[]>();
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

    // Also fire `collisionActive` for handlers that need to repeatedly
    // push a resting ball away (pop bumpers, slingshots, the bean) so the
    // ball can't get cradled against a kicker. Routed through the same
    // dispatch but flagged so handlers can choose whether to opt in via
    // their own scoring policy (e.g. only score on collisionStart, only
    // kick on collisionActive).
    Matter.Events.on(this.engine, 'collisionActive', (evt) => {
      for (const pair of evt.pairs) {
        this.dispatchActive(pair.bodyA, pair.bodyB, pair);
        this.dispatchActive(pair.bodyB, pair.bodyA, pair);
      }
    });

    Matter.Events.on(this.engine, 'afterUpdate', () => {
      const queue = this.deferred;
      this.deferred = [];
      for (const fn of queue) fn();
    });
  }

  private dispatch(self: Matter.Body, other: Matter.Body, pair: Matter.Pair) {
    // Balls riding a ramp/shooter transit are ghosts: no scoring, no drains.
    if (inTransit(self) || inTransit(other)) return;
    const list = this.handlers.get(self.label);
    if (!list) return;
    for (const fn of list) fn(self, other, pair);
  }

  private dispatchActive(self: Matter.Body, other: Matter.Body, pair: Matter.Pair) {
    if (inTransit(self) || inTransit(other)) return;
    const list = this.activeHandlers.get(self.label);
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

  /** Register a handler that fires every frame the labelled body is in
   *  contact with another body — used for "always-kick" interactions
   *  like pop bumpers, slingshots and the bean, so a resting ball
   *  doesn't stay cradled against them. */
  onActive(label: string, handler: CollisionHandler) {
    let list = this.activeHandlers.get(label);
    if (!list) {
      list = [];
      this.activeHandlers.set(label, list);
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

/** True while a ball is being carried along a ramp / shooter-lane path by
 *  the transit system (see Playfield.startTransit). */
export function inTransit(body: Matter.Body): boolean {
  return (body as unknown as { $transit?: boolean }).$transit === true;
}

export function setTransit(body: Matter.Body, value: boolean) {
  (body as unknown as { $transit?: boolean }).$transit = value;
}
