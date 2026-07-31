/** Getting a layout in and out of the browser.
 *
 *  A layout is plain data by construction — no functions, no class instances,
 *  no cycles — so JSON round-trips it exactly. That is a property worth
 *  protecting: it is why the editor can hand a board to the game by writing it
 *  to storage and letting the game read it back, with no shared objects and no
 *  chance of the two views drifting.
 *
 *  The one thing JSON cannot carry is intent about WHICH layout this is, so
 *  the envelope adds a version and the game refuses anything it does not
 *  recognise rather than half-loading it.
 */
import { PlayfieldLayout } from './types';

export const LAYOUT_KEY = 'chicago-pinball-layout';
/** Bumped when the schema changes shape in a way an old file cannot satisfy. */
export const LAYOUT_FORMAT = 1;

export interface LayoutFile {
  format: number;
  name: string;
  savedAt: string;
  /** FNV-1a over the layout's canonical JSON. Not security — a layout file is
   *  the user's own data and there is nothing to defend against. It catches
   *  the boring failure: a file truncated by a copy-paste, or hand-edited into
   *  something the author no longer remembers changing. Mismatches WARN and
   *  load anyway, because hand-editing a layout is a legitimate thing to do. */
  checksum?: string;
  layout: PlayfieldLayout;
}

/** FNV-1a, the same hash the determinism oracles use — stable across engines
 *  and dependency-free. */
export function checksumOf(layout: PlayfieldLayout): string {
  const s = JSON.stringify(layout);
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function toFile(layout: PlayfieldLayout, name: string, savedAt: string): LayoutFile {
  return { format: LAYOUT_FORMAT, name, savedAt, checksum: checksumOf(layout), layout };
}

export function serialize(layout: PlayfieldLayout, name: string, savedAt: string): string {
  return JSON.stringify(toFile(layout, name, savedAt), null, 2);
}

/** Parse, or explain. Returns a string on failure rather than throwing,
 *  because every caller here is a UI that wants to show the reason. */
export function parseLayoutFile(text: string): LayoutFile | string {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return `not JSON: ${e instanceof Error ? e.message : String(e)}`;
  }
  const f = v as Partial<LayoutFile>;
  if (!f || typeof f !== 'object') return 'not an object';
  if (f.format !== LAYOUT_FORMAT) {
    return `format ${String(f.format)}, expected ${LAYOUT_FORMAT}`;
  }
  const l = f.layout as PlayfieldLayout | undefined;
  if (!l || !l.frame || !Array.isArray(l.statics) || !Array.isArray(l.elements)) {
    return 'missing frame / statics / elements';
  }
  return {
    format: f.format,
    name: f.name ?? 'untitled',
    savedAt: f.savedAt ?? '',
    checksum: f.checksum,
    layout: l,
  };
}

/** null when the file carries no checksum (nothing to check) or it matches;
 *  otherwise the mismatch, for the caller to show. */
export function checksumComplaint(file: LayoutFile): string | null {
  if (!file.checksum) return null;
  const actual = checksumOf(file.layout);
  return actual === file.checksum
    ? null
    : `checksum ${actual} does not match the recorded ${file.checksum} — the file was edited after it was saved`;
}

export function saveToStorage(layout: PlayfieldLayout, name: string): boolean {
  try {
    localStorage.setItem(LAYOUT_KEY, serialize(layout, name, new Date().toISOString()));
    return true;
  } catch {
    // Private-mode Safari and a full quota both land here. The editor stays
    // usable; only the round-trip through storage is lost.
    return false;
  }
}

export function loadFromStorage(): LayoutFile | null {
  let text: string | null = null;
  try {
    text = localStorage.getItem(LAYOUT_KEY);
  } catch {
    return null;
  }
  if (!text) return null;
  const r = parseLayoutFile(text);
  return typeof r === 'string' ? null : r;
}

export function clearStorage() {
  try {
    localStorage.removeItem(LAYOUT_KEY);
  } catch {
    /* nothing to do */
  }
}

/** A deep copy. Layouts are pure data, so this is both correct and the
 *  cheapest way to snapshot one for undo. */
export function cloneLayout(l: PlayfieldLayout): PlayfieldLayout {
  return JSON.parse(JSON.stringify(l)) as PlayfieldLayout;
}
