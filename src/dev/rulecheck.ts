/** Do the layout rules actually fire?
 *
 *  A validator that reports "clean" on every input is worse than no validator,
 *  because "clean" then reads as coverage. The shipped board passes, which
 *  proves nothing on its own — a `return []` would pass too.
 *
 *  So each rule gets a mutation that must break it, and the check asserts the
 *  expected rule id appears. This is the same discipline the world snapshot
 *  and the replay digest were held to: an oracle is only worth its silence if
 *  it has been seen to speak.
 *
 *  Dev-only.
 */
import { DEFAULT_LAYOUT } from '../layout/default';
import { resolveLayout } from '../layout/resolve';
import { validateLayout } from '../layout/validate';
import { ElementDesc, PlayfieldLayout, StaticDesc } from '../layout/types';

type Mutate = (l: PlayfieldLayout) => PlayfieldLayout;

/** Structural clone deep enough that a mutation cannot leak into the shipped
 *  DEFAULT_LAYOUT — the rules read nested points, so a shallow copy is not
 *  enough and a leak would silently poison every later case. */
function clone(l: PlayfieldLayout): PlayfieldLayout {
  return JSON.parse(JSON.stringify(l)) as PlayfieldLayout;
}

const mapStatic = (id: string, fn: (s: any) => void): Mutate => (l) => {
  const c = clone(l);
  const s = c.statics.find((x: StaticDesc) => x.id === id);
  if (!s) throw new Error(`rulecheck: no static '${id}' — the fixture is stale`);
  fn(s);
  return c;
};

const mapElement = (id: string, fn: (e: any) => void): Mutate => (l) => {
  const c = clone(l);
  const e = c.elements.find((x: ElementDesc) => x.id === id);
  if (!e) throw new Error(`rulecheck: no element '${id}' — the fixture is stale`);
  fn(e);
  return c;
};

export interface RuleCase {
  rule: string;
  what: string;
  mutate: Mutate;
}

export const CASES: RuleCase[] = [
  {
    rule: 'sensor-arity',
    what: 'delete the drain — the handler bound to that label can never fire',
    mutate: (l) => {
      const c = clone(l);
      c.elements = c.elements.filter((e) => e.kind !== 'drain');
      return c;
    },
  },
  {
    rule: 'sensor-arity',
    what: 'two left-loop sensors — collision dispatch is keyed by label',
    mutate: (l) => {
      const c = clone(l);
      const s = c.elements.find((e) => e.kind === 'sensor' && e.role === 'left-loop')!;
      c.elements.push({ ...(s as any), id: 'left-loop-dupe' });
      return c;
    },
  },
  {
    rule: 'drop-bank-size',
    what: 'a 6-target CHICAGO bank — ChicagoBank throws on anything but 7',
    mutate: mapElement('chicago-bank', (e) => e.slots.pop()),
  },
  {
    rule: 'ramp-join',
    what: 'habitrail starts 20px from where the plate ends — the ball teleports',
    mutate: mapElement('ramp-left', (e) => {
      e.habitrail[0] = { x: e.habitrail[0].x + 20, y: e.habitrail[0].y };
    }),
  },
  {
    rule: 'flipper-sweep',
    what: 'a post dropped onto the left flipper pivot — the bat jams solid',
    mutate: (l) => {
      const c = clone(l);
      c.statics.push({
        kind: 'post',
        id: 'jammer',
        x: c.frame.laneInnerX / 2 - c.frame.flipperGap + 20,
        y: c.frame.flipperY + 6,
        r: 6,
      });
      return c;
    },
  },
  {
    rule: 'corridor-blocked',
    what: 'the soccer leg pushed back into the captive approach',
    mutate: mapStatic('soccer-post-s', (s) => {
      s.x = 400;
    }),
  },
  {
    rule: 'shot-line-blocked',
    what: 'a fat post planted on the left flipper -> left ramp line',
    mutate: (l) => {
      const c = clone(l);
      const ramp = c.elements.find((e) => e.id === 'ramp-left') as any;
      const pivot = { x: c.frame.laneInnerX / 2 - c.frame.flipperGap, y: c.frame.flipperY };
      c.statics.push({
        kind: 'post',
        id: 'blocker',
        x: (pivot.x + ramp.plate[0].x) / 2,
        y: (pivot.y + ramp.plate[0].y) / 2,
        r: 24,
      });
      return c;
    },
  },
  {
    rule: 'shot-line-narrowed',
    what: 'the centre pedestal grown 12px — every line past it tightens',
    mutate: mapStatic('stadium-pedestal', (s) => {
      s.r += 12;
    }),
  },
  {
    rule: 'captive-channel',
    what: 'the captive lane slid against the shooter wall',
    mutate: mapElement('captive', (e) => {
      e.x = 452;
    }),
  },
  {
    rule: 'kicker-placement',
    what: 'the left-outlane kicker pushed off the left edge of the board',
    mutate: mapElement('left-outlane', (e) => {
      e.x = -30;
    }),
  },
];

export interface CaseResult {
  rule: string;
  what: string;
  fired: boolean;
  /** Every rule the mutation tripped, so a case that fires for the wrong
   *  reason is visible rather than silently counted as a pass. */
  got: string[];
}

export function runRuleChecks(): CaseResult[] {
  return CASES.map((c) => {
    const got = validateLayout(resolveLayout(c.mutate(DEFAULT_LAYOUT))).map((d) => d.rule);
    return { rule: c.rule, what: c.what, fired: got.includes(c.rule), got: [...new Set(got)] };
  });
}

/** The control: the shipped board must still be clean. Without this, a rule
 *  that fires on everything would pass every case above. */
export function baselineClean(): string[] {
  return validateLayout(resolveLayout(DEFAULT_LAYOUT)).map((d) => d.rule);
}
