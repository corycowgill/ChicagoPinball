/** Can every part actually be added and removed?
 *
 *  The layout editor's delete button used to refuse ten of the nineteen
 *  element kinds, and the refusal was honest: `PlayfieldParts` has no
 *  optional fields, and `Playfield`, `Renderer` and `Renderer3D` dereference
 *  those fields across some sixty call sites. Deleting the captive did not
 *  give you a board without a captive, it gave you a TypeError on the first
 *  frame — and since the editor draws by building the real world, it took the
 *  editor down too. `standIns()` in src/layout/build.ts fixes the cause.
 *
 *  "Fixes" is a claim, and this is what turns it into a measurement. For
 *  every kind on the board: delete all of it, BUILD the real world, and STEP
 *  it. For every entry in the palette: add one, build, step. A part that is
 *  removable in the type system but explodes on frame three is not removable.
 *
 *  Stepping matters as much as building. A stand-in that constructs happily
 *  and then divides by zero in tick() would pass a build-only check, and this
 *  file exists precisely because a build-only assumption was wrong before.
 *
 *  Dev-only. Never imported by the game.
 */
import { Physics } from '../Physics';
import { Playfield, PlayfieldEvents } from '../scene/Playfield';
import { DEFAULT_LAYOUT } from '../layout/default';
import { PALETTE } from '../layout/palette';
import { resolveLayout } from '../layout/resolve';
import { validateLayout } from '../layout/validate';
import { validateRules } from '../layout/feasible';
import { ElementDesc, PlayfieldLayout, StaticDesc } from '../layout/types';

const DT = 1000 / 60;
const STEPS = 240;

const NO_EVENTS: PlayfieldEvents = {
  onScore: () => {},
  onLockComplete: () => {},
  onScoopMode: () => {},
  onLanesComplete: () => {},
  onDrain: () => {},
  onLeftOutlane: () => {},
  onRightOutlane: () => {},
};

function clone(l: PlayfieldLayout): PlayfieldLayout {
  return JSON.parse(JSON.stringify(l)) as PlayfieldLayout;
}

export interface PartResult {
  what: string;
  /** Did the world build and survive STEPS frames? */
  ok: boolean;
  /** The exception message, when it did not. */
  error?: string;
  /** Errors the validator reports for the mutated board — expected for the
   *  machine parts, and the point of allowing the deletion at all. */
  diagnostics: string[];
}

/** Build and run a layout, catching anything it throws. */
function exercise(what: string, layout: PlayfieldLayout): PartResult {
  const diagnostics = (() => {
    try {
      // Both rule sets, and both severities. Geometry alone reports nothing
      // for a deleted Bean or drop bank, and filtering to errors alone hides
      // the captive and the spinner, which feasible.ts rates as warnings. The
      // question this table answers is "what does the editor TELL me when I
      // delete this", so a silent cell has to mean silence.
      return [
        ...new Set(
          [...validateLayout(resolveLayout(layout)), ...validateRules(layout)].map((d) =>
            d.severity === 'error' ? d.rule : `${d.rule}(warn)`,
          ),
        ),
      ];
    } catch (e) {
      return [`validate threw: ${(e as Error).message}`];
    }
  })();
  try {
    const physics = new Physics();
    const pf = new Playfield(physics, NO_EVENTS, layout);
    for (let s = 0; s < STEPS; s++) {
      pf.tick(DT);
      physics.step(DT);
    }
    return { what, ok: true, diagnostics };
  } catch (e) {
    return { what, ok: false, error: (e as Error).message, diagnostics };
  }
}

/** Every element and static kind the shipped board uses, removed entirely. */
export function removals(): PartResult[] {
  const kinds = new Set<string>([
    ...DEFAULT_LAYOUT.statics.map((s) => s.kind),
    ...DEFAULT_LAYOUT.elements.map((e) => e.kind),
  ]);
  return [...kinds].sort().map((kind) => {
    const l = clone(DEFAULT_LAYOUT);
    l.statics = l.statics.filter((s: StaticDesc) => s.kind !== kind);
    l.elements = l.elements.filter((e: ElementDesc) => e.kind !== kind);
    return exercise(`remove every '${kind}'`, l);
  });
}

/** One of everything the palette offers, added to the shipped board. */
export function additions(): PartResult[] {
  return PALETTE.map((item) => {
    const l = clone(DEFAULT_LAYOUT);
    const desc = item.make(`probe-${item.key}`, { x: 240, y: 400 });
    if (item.into === 'statics') l.statics.push(desc as StaticDesc);
    else l.elements.push(desc as ElementDesc);
    return exercise(`add a '${item.key}'`, l);
  });
}

/** The control: a mutation that MUST still throw.
 *
 *  Every row above passing proves nothing on its own — a harness that
 *  swallowed exceptions would report a clean sweep. `ChicagoBank` throws on
 *  any slot count but seven, deliberately and by name, so a six-slot bank is
 *  a known explosion. If this row reports ok, the harness is broken and
 *  every other row in the run is worthless.
 */
export function control(): PartResult {
  const l = clone(DEFAULT_LAYOUT);
  const bank = l.elements.find((e) => e.kind === 'drop-bank');
  if (bank && bank.kind === 'drop-bank') {
    (bank as { slots: unknown[] }).slots = bank.slots.slice(0, 6);
  }
  return exercise('CONTROL: a six-target CHICAGO bank (must throw)', l);
}

export function formatParts(rs: PartResult[]): string {
  return rs
    .map((r) => {
      const head = `  ${r.ok ? 'builds & runs' : 'THREW       '}  ${r.what.padEnd(34)}`;
      const diag = r.diagnostics.length ? `  reports: ${r.diagnostics.join(', ')}` : '';
      return head + diag + (r.error ? `\n                  ${r.error}` : '');
    })
    .join('\n');
}
