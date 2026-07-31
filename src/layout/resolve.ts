/** Pure derivation: everything the board computes from other numbers.
 *
 *  Kept separate from both the authored layout and the body builder so there
 *  is exactly one place where a derived value is defined. The editor renders
 *  the resolved form and shows derived fields read-only — you cannot drag
 *  `playCenter`, because it isn't a thing you can place.
 */
import { BALL_RADIUS, PLUNGER_HEIGHT } from '../constants';
import { ElementDesc, Frame, PlayfieldLayout, Pt, SensorRole } from './types';

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
  loopArrowXs: number[];
  kickbackPos: Pt;
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
  const sensorPos: Partial<Record<SensorRole, Pt>> = {};
  for (const s of layout.statics) {
    if (s.kind === 'sensor') sensorPos[s.role] = { x: s.x, y: s.y };
  }
  for (const e of layout.elements) {
    if (e.kind === 'sensor') sensorPos[e.role] = { x: e.x, y: e.y };
  }

  const fallback = { x: 0, y: 0 };
  return {
    layout,
    frame,
    sensorPos,
    // Previously a literal [20, 462] that duplicated the loop sensors' own x
    // coordinates — two sources of truth for one fact.
    loopArrowXs: [
      sensorPos['left-loop']?.x ?? 20,
      sensorPos['right-loop']?.x ?? 462,
    ],
    kickbackPos: sensorPos['left-outlane'] ?? fallback,
    expressPos: sensorPos['right-outlane'] ?? fallback,
  };
}
