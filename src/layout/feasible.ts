/** Can the RULES be played on this board?
 *
 *  `validate.ts` asks geometric questions: does this fit, is that in the way.
 *  This asks a different one, and it is the question an editor makes urgent —
 *  the rules engine is keyed entirely by collision label and score-event kind,
 *  so it does not know or care what the board looks like. Delete the left
 *  ramp and nothing throws, nothing warns, and nothing looks wrong. BASEBALL
 *  simply never starts, and the player never learns why.
 *
 *  Every rule below is the same shape: a mode or feature the game ships,
 *  the element that produces its scoring event, and what breaks without it.
 *  The mapping is transcribed from Playfield's collision wiring, so if a shot
 *  is rewired this must be rewired with it — the alternative is inspecting the
 *  handler table at runtime, which would report what is *bound* rather than
 *  what is *reachable*, and every handler is bound whether or not a body
 *  exists to trigger it.
 *
 *  Dev/editor only.
 */
import { SPORTS, ScoreEventKind } from '../types';
import { Diagnostic } from './validate';
import { ElementDesc, PlayfieldLayout, SensorRole } from './types';

/** Does the layout contain something that can raise this scoring event? */
function producerOf(
  layout: PlayfieldLayout,
  kind: ScoreEventKind,
  letter?: string,
): { ok: boolean; want: string } {
  const els = layout.elements;
  const sensorRoles = new Set<SensorRole>();
  for (const s of [...layout.statics, ...els]) if (s.kind === 'sensor') sensorRoles.add(s.role);
  const has = (pred: (e: ElementDesc) => boolean) => els.some(pred);

  switch (kind) {
    case 'ramp': {
      const label = letter === 'R' ? 'right-ramp' : 'left-ramp';
      return { ok: has((e) => e.kind === 'ramp' && e.label === label), want: `a ${label}` };
    }
    case 'loop': {
      const role: SensorRole = letter === 'R' ? 'right-loop' : 'left-loop';
      return { ok: sensorRoles.has(role), want: `a '${role}' sensor` };
    }
    case 'scoop':
      return {
        ok: has((e) => e.kind === 'scoop' && e.label === 'scoop'),
        want: "a scoop labelled 'scoop'",
      };
    case 'lake-bonus':
      return {
        ok: has((e) => e.kind === 'scoop' && e.label === 'lake-scoop'),
        want: "a scoop labelled 'lake-scoop'",
      };
    case 'captive':
      return { ok: has((e) => e.kind === 'captive'), want: 'a captive ball' };
    case 'bean':
    case 'lock':
      return { ok: has((e) => e.kind === 'bean'), want: 'the Bean' };
    case 'spinner':
      return { ok: has((e) => e.kind === 'spinner'), want: 'a spinner' };
    case 'drop-target':
      return { ok: has((e) => e.kind === 'drop-bank'), want: 'the CHICAGO bank' };
    case 'standup':
      return { ok: has((e) => e.kind === 'standup'), want: 'a standup target' };
    case 'pop-bumper':
      return { ok: has((e) => e.kind === 'pop-bumper'), want: 'a pop bumper' };
    case 'slingshot':
      return { ok: has((e) => e.kind === 'slingshot'), want: 'a slingshot' };
    case 'lane':
      return { ok: has((e) => e.kind === 'rollover'), want: 'rollover lanes' };
    case 'inlane':
      return {
        ok: sensorRoles.has('inlane-left') || sensorRoles.has('inlane-right'),
        want: 'an inlane sensor',
      };
    case 'skill-shot':
      return { ok: sensorRoles.has('launch-exit'), want: "a 'launch-exit' sensor" };
    default:
      return { ok: true, want: '' };
  }
}

export function validateRules(layout: PlayfieldLayout): Diagnostic[] {
  const out: Diagnostic[] = [];
  const sensorRoles = new Set<SensorRole>();
  for (const s of [...layout.statics, ...layout.elements]) {
    if (s.kind === 'sensor') sensorRoles.add(s.role);
  }

  // ── The five sports modes ────────────────────────────────────────────────
  for (const sp of SPORTS) {
    const { ok, want } = producerOf(layout, sp.kind, sp.letter);
    if (!ok) {
      out.push({
        severity: 'error',
        rule: 'mode-unreachable',
        message: `${sp.sport} starts on the ${sp.shotName}, which needs ${want} — without one, ${sp.mode} can never start`,
        elementIds: [sp.id],
      });
    }
  }

  // Every mode needs `goal` hits on the SAME shot, so a mode whose shot is
  // present but unmakeable is a different (and worse) failure than one that is
  // missing — the shot rules in validate.ts cover that half.

  // ── Named features, in the order a player meets them ─────────────────────
  const feature = (
    ok: boolean,
    rule: string,
    message: string,
    ids: string[] = [],
    severity: 'error' | 'warn' = 'warn',
  ) => {
    if (!ok) out.push({ severity, rule, message, elementIds: ids });
  };

  feature(
    producerOf(layout, 'lane').ok,
    'feature-unreachable',
    'no rollover lanes — the top-lane set never completes, so Bonus X can never advance past 1x',
  );
  feature(
    producerOf(layout, 'skill-shot').ok,
    'feature-unreachable',
    "no 'launch-exit' sensor — the skill shot and super skill shot can never be scored",
  );
  feature(
    producerOf(layout, 'drop-target').ok,
    'feature-unreachable',
    'no CHICAGO bank — the letter set, its escalating value and the HUD strip all go dead',
    [],
    'error',
  );
  feature(
    producerOf(layout, 'lock').ok,
    'feature-unreachable',
    'no Bean — there is no multiball lock, so multiball can never be lit',
    [],
    'error',
  );
  feature(
    sensorRoles.has('left-outlane'),
    'feature-unreachable',
    'no left outlane — the kickback has nowhere to fire from',
  );
  feature(
    sensorRoles.has('right-outlane'),
    'feature-unreachable',
    'no right outlane — the EL EXPRESS rescue can never trigger',
  );
  feature(
    producerOf(layout, 'captive').ok,
    'feature-unreachable',
    'no captive ball — CHICAGO letters lose their spotting shot',
  );
  feature(
    producerOf(layout, 'spinner').ok,
    'feature-unreachable',
    'no spinner — the growing spinner value never scores',
  );
  feature(
    producerOf(layout, 'lake-bonus').ok,
    'feature-unreachable',
    "no 'lake-scoop' — Mystery awards can never be collected",
  );

  // ── The wizard mode's requirements ───────────────────────────────────────
  // CAPONE SHOWDOWN takes damage from most shots, but the modes that light it
  // are the five sports. If any of those is unreachable the wizard mode is too,
  // and saying so once is clearer than making the player infer it.
  const deadModes = SPORTS.filter((sp) => !producerOf(layout, sp.kind, sp.letter).ok);
  if (deadModes.length) {
    out.push({
      severity: 'error',
      rule: 'wizard-unreachable',
      message: `CROSSTOWN CHAMPIONSHIP needs all five sports completed; ${deadModes
        .map((m) => m.sport)
        .join(', ')} cannot start, so the wizard mode is unreachable`,
      elementIds: deadModes.map((m) => m.id),
    });
  }

  return out;
}
