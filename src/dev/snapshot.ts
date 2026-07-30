/** Bit-exact world snapshot — the correctness oracle for the layout refactor.
 *
 *  The physics path has no RNG, no clock and no DOM, so `new Playfield(...)`
 *  is a pure function of the source. That makes an exact dump of the
 *  constructed world a far stronger check than any gameplay probe: it catches
 *  a reordered body, a changed literal, a lost chamfer, a different
 *  decomposed vertex set or a normalisation drift, instantly and exactly.
 *
 *  Why not the Playwright probes? They were measured at sd 4.3-5.3 total
 *  makes on COMPLETELY UNCHANGED geometry. Detecting a one-shot regression
 *  that way needs on the order of a thousand trials per shot. This diff is
 *  exact and points at the first mismatched body index.
 *
 *  JS prints the shortest round-tripping decimal for a double, so equal
 *  doubles serialise to equal strings — comparing the text compares the
 *  doubles exactly, for free.
 */
import Matter from 'matter-js';
import { Physics } from '../Physics';
import { Playfield, PlayfieldEvents } from '../scene/Playfield';

/** Events that record nothing and do nothing — construction must not depend
 *  on them, and a snapshot must not depend on callback side effects. */
export function noopEvents(): PlayfieldEvents {
  return {
    onScore: () => {},
    onDrain: () => {},
    onLockComplete: () => {},
    onScoopMode: () => {},
    onLanesComplete: () => {},
    onLeftOutlane: () => {},
    onRightOutlane: () => {},
  };
}

const pt = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });

function bodyRecord(b: Matter.Body, index: number) {
  return {
    index,
    label: b.label,
    isStatic: b.isStatic,
    isSensor: b.isSensor,
    position: pt(b.position),
    angle: b.angle,
    vertices: b.vertices.map(pt),
    area: b.area,
    mass: b.mass,
    inverseMass: b.inverseMass,
    inertia: b.inertia,
    restitution: b.restitution,
    friction: b.friction,
    frictionAir: b.frictionAir,
    frictionStatic: b.frictionStatic,
    density: b.density,
    slop: b.slop,
    collisionFilter: {
      category: b.collisionFilter.category,
      mask: b.collisionFilter.mask,
      group: b.collisionFilter.group,
    },
    circleRadius: (b as unknown as { circleRadius?: number }).circleRadius ?? null,
  };
}

/** Build a fresh world and dump everything that could affect simulation. */
export function snapshot(): string {
  const physics = new Physics();
  const pf = new Playfield(physics, noopEvents());

  // Insertion order matters: Matter's broadphase pair order and therefore its
  // float results depend on it. Composite.allBodies preserves it.
  const bodies = Matter.Composite.allBodies(physics.world);
  const index = new Map<Matter.Body, number>();
  bodies.forEach((b, i) => index.set(b, i));

  const constraints = Matter.Composite.allConstraints(physics.world).map((c, i) => ({
    index: i,
    label: c.label,
    pointA: c.pointA ? pt(c.pointA) : null,
    pointB: c.pointB ? pt(c.pointB) : null,
    bodyA: c.bodyA ? (index.get(c.bodyA) ?? -1) : null,
    bodyB: c.bodyB ? (index.get(c.bodyB) ?? -1) : null,
    length: c.length,
    stiffness: c.stiffness,
    damping: c.damping,
    angularStiffness: (c as unknown as { angularStiffness?: number }).angularStiffness ?? null,
  }));

  // The derived/public surface. A body dump alone would miss a broken
  // computed value that only shows up once the ball is in flight.
  const derived = {
    launchRestY: pf.launchRestY,
    playRight: pf.playRight,
    playCenter: pf.playCenter,
    laneInnerX: pf.laneInnerX,
    laneOuterX: pf.laneOuterX,
    launchX: pf.launchX,
    flipperY: pf.flipperY,
    flipperGap: pf.flipperGap,
    rolloverXs: pf.rolloverXs,
    rolloverY: pf.rolloverY,
    loopArrowXs: pf.loopArrowXs,
    kickbackPos: pt(pf.kickbackPos),
    expressPos: pt(pf.expressPos),
    shooterPaths: pf.rolloverXs.map((x) => pf.shooterPath(x).map(pt)),
    expressPath: pf.expressPath().map(pt),
    walls: pf.walls.map((w) => ({ kind: w.kind ?? null, outline: w.outline.map(pt) })),
    postPositions: pf.postPositions.map((p) => ({ x: p.x, y: p.y, r: p.r ?? null })),
    bankTargets: pf.bank.targets.map((t) => ({
      letter: t.letter,
      home: pt(t.home),
      label: t.body.label,
    })),
    ramps: [pf.leftRamp, pf.rightRamp].map((r) => ({
      label: r.label,
      plate: r.plate.map(pt),
      habitrail: r.habitrail.map(pt),
      fullPath: r.fullPath.map(pt),
      exitVel: pt(r.exitVel),
      minSpeed: r.minSpeed,
      arrowAt: pt(r.arrowAt),
      arrowAngle: r.arrowAngle,
      entryLabel: r.entry.label,
    })),
    slingshots: pf.slingshots.map((s) => ({
      verts: s.verts.map(pt),
      normal: pt(s.normal),
      bandA: pt(s.bandA),
      bandB: pt(s.bandB),
      apex: pt(s.apex),
    })),
    captive: {
      x: pf.captive.x,
      y: pf.captive.y,
      posts: pf.captive.posts.map((p) => ({ x: p.x, y: p.y, r: p.r })),
    },
    scoops: [pf.lakeMichiganScoop, pf.cityTourScoop].map((s) => ({
      x: s.x,
      y: s.y,
      label: s.sensor.label,
    })),
    spinner: { cx: pf.spinner.cx, cy: pf.spinner.cy, length: pf.spinner.length },
    standups: pf.standups.map((s) => ({ label: s.body.label, position: pt(s.body.position) })),
    rollovers: pf.rollovers.map((r) => ({ label: r.sensor.label, x: r.x, y: r.y })),
  };

  return JSON.stringify(
    { bodies: bodies.map(bodyRecord), constraints, derived },
    null,
    1,
  );
}
