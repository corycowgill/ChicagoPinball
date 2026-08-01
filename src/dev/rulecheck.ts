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
import { validateRules } from '../layout/feasible';
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
    what: 'a post dropped into the right orbit channel',
    mutate: mapStatic('soccer-post-s', (s) => {
      s.x = 462;
      s.y = 420;
    }),
  },
  // The four cases below cover the obstacle classes the clearance rules used
  // to be blind to. They are not hypothetical: the validator called this
  // board clean while a RAIL sat 11.8px inside the left flipper's line to the
  // captive, and while the right flipper's protected corridor to the captive
  // ran through the right slingshot. Each class gets its own mutation,
  // because "rails are handled" was believed for several rounds on the
  // strength of a comment.
  {
    rule: 'corridor-blocked',
    what: 'a plain RAIL laid across the left orbit channel',
    mutate: (l) => {
      const c = clone(l);
      c.statics.push({
        kind: 'rail',
        id: 'blocker-rail',
        a: { x: 4, y: 440 },
        b: { x: 44, y: 440 },
        thickness: 6,
      });
      return c;
    },
  },
  {
    rule: 'corridor-blocked',
    what: 'a DECO POST dropped into the left orbit channel',
    mutate: (l) => {
      const c = clone(l);
      c.statics.push({ kind: 'deco-post', id: 'blocker-deco', x: 20, y: 420, r: 5 });
      return c;
    },
  },
  {
    rule: 'shot-line-blocked',
    what: 'a SLINGSHOT stretched across the left flipper -> lake scoop line',
    mutate: mapElement('sling-left', (e) => {
      e.verts = [
        { x: 84, y: 650 },
        { x: 84, y: 720 },
        { x: 180, y: 560 },
      ];
    }),
  },
  {
    rule: 'shot-line-blocked',
    what: 'a DROP TARGET slid onto the right flipper -> lake scoop line',
    mutate: mapElement('chicago-bank', (e) => {
      e.slots[0] = { x: 200, y: 640, angle: 0 };
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
    // Was "grow the centre pedestal by 12px", and that stopped working the
    // moment the clearance rules learned to see the rest of the board: the
    // pedestal is no longer the tightest thing on any line, so growing it
    // changed no reported number. A narrowing case has to squeeze whatever is
    // ALREADY worst, which here is the funnel post framing each ramp mouth.
    rule: 'shot-line-narrowed',
    what: 'the left ramp funnel post grown 2px — the tightest gate on the board',
    mutate: mapStatic('funnel-l-post-a', (s) => {
      s.r += 2;
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
    rule: 'mode-unreachable',
    what: 'delete the left ramp — BASEBALL starts on it and nothing else does',
    mutate: (l) => {
      const c = clone(l);
      c.elements = c.elements.filter((e) => !(e.kind === 'ramp' && e.label === 'left-ramp'));
      return c;
    },
  },
  {
    rule: 'wizard-unreachable',
    what: 'delete the right-loop sensor — HOCKEY dies, and the wizard with it',
    mutate: (l) => {
      const c = clone(l);
      c.elements = c.elements.filter((e) => !(e.kind === 'sensor' && e.role === 'right-loop'));
      return c;
    },
  },
  {
    rule: 'feature-unreachable',
    what: 'delete the rollover lanes — Bonus X can never advance past 1x',
    mutate: (l) => {
      const c = clone(l);
      c.elements = c.elements.filter((e) => e.kind !== 'rollover');
      return c;
    },
  },
  {
    rule: 'machine-missing',
    what: 'delete the left flipper — the editor allows it now, so something must say so',
    mutate: (l) => {
      const c = clone(l);
      c.elements = c.elements.filter((e) => !(e.kind === 'flipper' && e.side === 'left'));
      return c;
    },
  },
  {
    rule: 'duplicate-part',
    what: 'a second right-ramp — the loader keeps one slot per label and silently drops the rest',
    mutate: (l) => {
      const c = clone(l);
      const r = c.elements.find((e) => e.kind === 'ramp' && e.label === 'right-ramp');
      if (!r) throw new Error('rulecheck: no right-ramp — the fixture is stale');
      c.elements.push({ ...(r as object), id: 'ramp-right-2' } as never);
      return c;
    },
  },
  {
    rule: 'kicker-placement',
    what: 'the left-outlane kicker pushed off the left edge of the board',
    mutate: mapElement('left-outlane', (e) => {
      e.x = -30;
    }),
  },
];

/** A mutation that must produce SILENCE.
 *
 *  Every case above asserts a rule speaks. This asserts one does not, and the
 *  distinction matters more than it sounds: a rule that fires on everything
 *  passes all of the above and is still worthless. The specific risk here is
 *  the one-way gate exemption — corridors and shot lines describe travel UP
 *  the board and a gate is open to a climbing ball, so the two orbit return
 *  gates must not be reported as blocking the lanes they exist to serve. The
 *  physical version of that mistake cost 8/12 orbit entries; make the same
 *  mistake in the rules and the next author "fixes" the gates back out. */
export interface SilentCase {
  rule: string;
  what: string;
  mutate: Mutate;
}

export const SILENT_CASES: SilentCase[] = [
  {
    rule: 'corridor-blocked',
    what: 'the return GATES, which are one-way and sit beside the orbit channels',
    // Identity: the shipped gates already lie against the loop corridors.
    // If the exemption is ever dropped, this fires and the case fails.
    mutate: (l) => clone(l),
  },
  {
    rule: 'corridor-blocked',
    what: 'a one-way gate laid straight ACROSS the left orbit channel',
    mutate: (l) => {
      const c = clone(l);
      c.statics.push({
        kind: 'rail',
        id: 'gate-across',
        a: { x: 4, y: 440 },
        b: { x: 44, y: 440 },
        thickness: 6,
        oneWay: 'down',
      });
      return c;
    },
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
    const mutated = c.mutate(DEFAULT_LAYOUT);
    const got = [
      ...validateLayout(resolveLayout(mutated)),
      ...validateRules(mutated),
    ].map((d) => d.rule);
    return { rule: c.rule, what: c.what, fired: got.includes(c.rule), got: [...new Set(got)] };
  });
}

/** The silent cases, run the same way. `fired` true here is a FAILURE. */
export function runSilentChecks(): CaseResult[] {
  return SILENT_CASES.map((c) => {
    const mutated = c.mutate(DEFAULT_LAYOUT);
    const got = [...validateLayout(resolveLayout(mutated)), ...validateRules(mutated)].map(
      (d) => d.rule,
    );
    return { rule: c.rule, what: c.what, fired: got.includes(c.rule), got: [...new Set(got)] };
  });
}

/** The control: the shipped board must still be clean. Without this, a rule
 *  that fires on everything would pass every case above. */
export function baselineClean(): string[] {
  return [
    ...validateLayout(resolveLayout(DEFAULT_LAYOUT)),
    ...validateRules(DEFAULT_LAYOUT),
  ].map((d) => d.rule);
}
