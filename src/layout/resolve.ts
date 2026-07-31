/** Pure derivation: everything the board computes from other numbers.
 *
 *  Kept separate from both the authored layout and the body builder so there
 *  is exactly one place where a derived value is defined. The editor renders
 *  the resolved form and shows derived fields read-only — you cannot drag
 *  `playCenter`, because it isn't a thing you can place.
 */
import { BALL_RADIUS, PLUNGER_HEIGHT } from '../constants';
import { ElementDesc, Frame, PlayfieldLayout, Pt, SensorDesc, SensorRole } from './types';

export interface ResolvedFrame extends Frame {
  /** Right edge of the play area proper — the shooter lane is outside it. */
  playRight: number;
  playCenter: number;
  launchX: number;
  plungerWidth: number;
  /** Where a ball sits on the plunger head. Derived from PLUNGER_HEIGHT so it
   *  can be known without constructing the plunger. */
  launchRestY: number;
  plungerY: number;
}

export interface ResolvedLayout {
  layout: PlayfieldLayout;
  frame: ResolvedFrame;
  /** Sensor centres by role — the single source of truth for positions that
   *  used to be duplicated as loose literals (loop arrow x's, kicker spots). */
  sensorPos: Partial<Record<SensorRole, Pt>>;
  /** The sensor descriptors themselves, by role — needed by anything that
   *  wants more than a position (the kickback wants its impulse). */
  sensors: Partial<Record<SensorRole, SensorDesc>>;
  loopArrowXs: number[];
  kickbackPos: Pt;
  /** Impulse the left-outlane kicker applies, authored on that sensor. */
  kickbackImpulse: { vx: number; vy: number; riseY: number };
  expressPos: Pt;
}

function find<K extends ElementDesc['kind']>(
  layout: PlayfieldLayout,
  kind: K,
): Extract<ElementDesc, { kind: K }> | undefined {
  return layout.elements.find((e) => e.kind === kind) as
    | Extract<ElementDesc, { kind: K }>
    | undefined;
}

export function resolveLayout(layout: PlayfieldLayout): ResolvedLayout {
  const f = layout.frame;
  const playRight = f.laneInnerX;
  const launchX = (f.laneInnerX + f.laneOuterX) / 2;
  const plunger = find(layout, 'plunger');
  const plungerY = plunger ? plunger.y : f.height - 60;

  const frame: ResolvedFrame = {
    ...f,
    playRight,
    playCenter: playRight / 2,
    launchX,
    plungerY,
    plungerWidth: f.laneOuterX - f.laneInnerX - 4,
    launchRestY: plungerY - PLUNGER_HEIGHT / 2 - BALL_RADIUS,
  };

  // Sensors can be declared in either array; collect both.
  const sensors: Partial<Record<SensorRole, SensorDesc>> = {};
  const sensorPos: Partial<Record<SensorRole, Pt>> = {};
  for (const s of [...layout.statics, ...layout.elements]) {
    if (s.kind !== 'sensor') continue;
    sensors[s.role] = s;
    sensorPos[s.role] = { x: s.x, y: s.y };
  }

  const fallback = { x: 0, y: 0 };
  return {
    layout,
    frame,
    sensorPos,
    sensors,
    // Previously a literal [20, 462] that duplicated the loop sensors' own x
    // coordinates — two sources of truth for one fact.
    loopArrowXs: [
      sensorPos['left-loop']?.x ?? 20,
      sensorPos['right-loop']?.x ?? 462,
    ],
    kickbackPos: sensorPos['left-outlane'] ?? fallback,
    kickbackImpulse: sensors['left-outlane']?.kicker ?? { vx: 0.6, vy: -21, riseY: -6 },
    expressPos: sensorPos['right-outlane'] ?? fallback,
  };
}
