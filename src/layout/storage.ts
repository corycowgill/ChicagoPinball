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

// ── The board library ──────────────────────────────────────────────────────
//
// One saved layout was enough while the editor was the only thing reading it.
// A title screen that lets you PICK a board needs a list, and it needs the
// choice to be explicit: the first version of this simply preferred whatever
// was in storage, so saving a board in the editor silently replaced the game
// for good and `?stock` in the URL was the only way back. That is a trap, not
// a feature. The selection below is a separate key that the player sets.

export const LIBRARY_KEY = 'chicago-pinball-boards';
export const SELECTED_KEY = 'chicago-pinball-board';

/** The shipped board. Reserved: never stored, always offered, always first. */
export const STOCK_ID = 'stock';
/** The editor's live draft. Reserved so "Play this board" has a stable slot. */
export const DRAFT_ID = 'working';

export interface BoardEntry {
  id: string;
  name: string;
  savedAt: string;
}

type Library = Record<string, LayoutFile>;

function readLibrary(): Library {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LIBRARY_KEY);
  } catch {
    return {};
  }
  let lib: Library = {};
  if (raw) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === 'object') lib = v as Library;
    } catch {
      // A corrupt library must not cost the player their other boards' worth
      // of confidence in the game booting. Start empty; the migration below
      // still recovers the single legacy slot.
      lib = {};
    }
  }
  // Migrate the pre-library single slot. Only ever runs once, because the
  // write below puts it in the library and the legacy key is then ignored.
  if (!lib[DRAFT_ID]) {
    const legacy = loadFromStorage();
    if (legacy) {
      lib[DRAFT_ID] = legacy;
      writeLibrary(lib);
    }
  }
  return lib;
}

function writeLibrary(lib: Library): boolean {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}

/** Every saved board, newest first. The stock board is NOT in here — it has no
 *  stored form, and callers add it themselves so it cannot be deleted. */
export function listBoards(): BoardEntry[] {
  const lib = readLibrary();
  return Object.entries(lib)
    .map(([id, f]) => ({ id, name: f.name || id, savedAt: f.savedAt || '' }))
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
}

export function loadBoard(id: string): LayoutFile | null {
  if (id === STOCK_ID) return null;
  return readLibrary()[id] ?? null;
}

export function saveBoard(id: string, layout: PlayfieldLayout, name: string): boolean {
  const lib = readLibrary();
  lib[id] = toFile(layout, name, new Date().toISOString());
  return writeLibrary(lib);
}

export function deleteBoard(id: string): boolean {
  const lib = readLibrary();
  if (!lib[id]) return false;
  delete lib[id];
  return writeLibrary(lib);
}

/** Which board the player chose at the title screen. Defaults to stock — a
 *  board only becomes the one you play because you picked it. */
export function selectedBoardId(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) || STOCK_ID;
  } catch {
    return STOCK_ID;
  }
}

export function setSelectedBoardId(id: string) {
  try {
    localStorage.setItem(SELECTED_KEY, id);
  } catch {
    /* the choice just will not survive a reload */
  }
}

/** Picking a different board on the title screen has to reload, and the
 *  player pressed START, not REFRESH — so the intent to start rides across in
 *  sessionStorage and is consumed exactly once. sessionStorage rather than
 *  localStorage: reopening the game tomorrow should land on the title screen,
 *  not drop you into a live ball. */
const AUTOSTART_KEY = 'chicago-pinball-autostart';

export function armAutostart() {
  try {
    sessionStorage.setItem(AUTOSTART_KEY, '1');
  } catch {
    /* the swap still works, it just lands on the title screen */
  }
}

export function takeAutostart(): boolean {
  try {
    const on = sessionStorage.getItem(AUTOSTART_KEY) === '1';
    sessionStorage.removeItem(AUTOSTART_KEY);
    return on;
  } catch {
    return false;
  }
}

/** A fresh id for a named save, unique within the library. */
export function uniqueBoardId(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'board';
  const lib = readLibrary();
  if (!lib[base] && base !== STOCK_ID && base !== DRAFT_ID) return base;
  for (let i = 2; ; i++) if (!lib[`${base}-${i}`]) return `${base}-${i}`;
}

/** A deep copy. Layouts are pure data, so this is both correct and the
 *  cheapest way to snapshot one for undo. */
export function cloneLayout(l: PlayfieldLayout): PlayfieldLayout {
  return JSON.parse(JSON.stringify(l)) as PlayfieldLayout;
}
