/** Do the DMD clips actually draw anything, and do they move?
 *
 *  A blank clip and no clip look exactly the same on screen: the panel shows
 *  whatever the fallback text pass put there, and nobody notices that the
 *  animation never ran. A frozen clip is worse — it looks deliberate. Neither
 *  shows up in a screenshot unless you happen to catch the right frame, and
 *  neither shows up in a build.
 *
 *  This runs entirely on the dot buffer. `Dmd` keeps its drawing and its
 *  blitting separate — `render()` is the only method that touches a canvas —
 *  so every clip can be stepped headless under Node with no DOM at all, and
 *  the result is an exact integer rather than a judgement about a picture.
 *
 *  Dev-only. Never imported by the game.
 */
import { Dmd, DmdClip } from '../Dmd';
import { ALL_CLIPS } from '../DmdClips';

/** Frames sampled across each clip's duration. Enough to catch a clip that
 *  only draws during a window, without turning the report into a wall. */
const SAMPLES = 12;

export interface ClipReport {
  id: string;
  ms: number;
  /** Lit dots at each sampled frame. */
  dots: number[];
  /** No frame lit a single dot — the clip is a no-op. */
  blank: boolean;
  /** Every frame identical — drawn once and never animated. */
  frozen: boolean;
  /** Most dots any one frame lit, as a rough density check: a clip that
   *  lights three dots is technically drawing and still invisible. */
  peak: number;
}

/** Step one clip and count. The Dmd is cleared between frames so each count
 *  is the clip's own contribution and not an accumulation. */
export function inspect(clip: DmdClip): ClipReport {
  const d = new Dmd();
  const dots: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (clip.ms * i) / (SAMPLES - 1);
    d.clear();
    clip.draw(d, t);
    dots.push(d.litCount());
  }
  const uniq = new Set(dots);
  return {
    id: clip.id,
    ms: clip.ms,
    dots,
    blank: dots.every((n) => n === 0),
    // A clip whose dot COUNT never changes may still be moving something —
    // a ball sliding across keeps the same count. So the frozen test needs
    // the buffer itself, not the count; see `signatures` below.
    frozen: uniq.size === 1 && signatures(clip).size === 1,
    peak: Math.max(...dots),
  };
}

/** Distinct buffer contents across the sampled frames.
 *
 *  Counting lit dots is not enough to detect a frozen clip: a puck sliding
 *  from one side to the other lights the same number of dots at every frame.
 *  Hashing the buffer catches motion that the count cannot see. */
function signatures(clip: DmdClip): Set<string> {
  const d = new Dmd();
  const out = new Set<string>();
  for (let i = 0; i < SAMPLES; i++) {
    d.clear();
    clip.draw(d, (clip.ms * i) / (SAMPLES - 1));
    out.add(d.signature());
  }
  return out;
}

export function inspectAll(): ClipReport[] {
  return ALL_CLIPS.map(inspect);
}

/** The controls. A check that cannot fail reads as coverage while providing
 *  none, so the blank detector is shown to fire and an empty panel is shown
 *  to read zero — every run, not once when it was written. */
export function controls(): { emptyPanelDots: number; blankClipCaught: boolean } {
  const d = new Dmd();
  d.clear();
  const blank: DmdClip = { id: 'control-blank', ms: 100, draw: () => {} };
  return { emptyPanelDots: d.litCount(), blankClipCaught: inspect(blank).blank };
}

export function formatClips(rs: ClipReport[]): string {
  return rs
    .map((r) => {
      const flag = r.blank ? '  BLANK — draws nothing' : r.frozen ? '  FROZEN — never moves' : '';
      return (
        `  ${r.id.padEnd(12)} ${String(r.ms).padStart(4)}ms  peak ${String(r.peak).padStart(3)} dots  ` +
        `frames [${r.dots.join(' ')}]${flag}`
      );
    })
    .join('\n');
}
