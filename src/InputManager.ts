import { PLAYFIELD_W, PLAYFIELD_H } from './constants';

export type VirtualKey =
  | 'leftFlipper'
  | 'rightFlipper'
  | 'plunger'
  | 'enter'
  | 'mute'
  | 'nudgeLeft'
  | 'nudgeRight'
  | 'pause';

const KEY_MAP: Record<string, VirtualKey> = {
  KeyZ: 'leftFlipper',
  ArrowLeft: 'leftFlipper',
  ShiftLeft: 'leftFlipper',
  Slash: 'rightFlipper',
  ArrowRight: 'rightFlipper',
  ShiftRight: 'rightFlipper',
  Space: 'plunger',
  Enter: 'enter',
  NumpadEnter: 'enter',
  KeyM: 'mute',
  KeyC: 'nudgeLeft',
  KeyN: 'nudgeRight',
  KeyP: 'pause',
  Escape: 'pause',
};

export type TouchKeyResolver = (
  x: number,
  y: number,
) => VirtualKey | null;

export class InputManager {
  private held = new Set<VirtualKey>();
  private pressedThisFrame = new Set<VirtualKey>();
  private releasedThisFrame = new Set<VirtualKey>();
  private pointerKeys = new Map<number, VirtualKey>();

  private canvas: HTMLElement | null = null;
  private resolveTouchKey: TouchKeyResolver | null = null;

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    target.addEventListener('keyup', (e) => this.onKeyUp(e as KeyboardEvent));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.pointerKeys.clear();
    });
  }

  /** Wire pointer (touch + mouse) input on the given canvas. The resolver
   *  decides which virtual key a press at (x, y) maps to, with coordinates
   *  expressed in the playfield's logical 540×960 space. */
  attachPointer(canvas: HTMLElement, resolve: TouchKeyResolver) {
    this.canvas = canvas;
    this.resolveTouchKey = resolve;
    canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Suppress iOS Safari double-tap zoom + long-press callout.
    canvas.addEventListener('gesturestart', (e) => e.preventDefault());
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  private onKeyDown(e: KeyboardEvent) {
    const k = KEY_MAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (!this.held.has(k)) this.pressedThisFrame.add(k);
    this.held.add(k);
  }

  private onKeyUp(e: KeyboardEvent) {
    const k = KEY_MAP[e.code];
    if (!k) return;
    e.preventDefault();
    this.held.delete(k);
    this.releasedThisFrame.add(k);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.canvas || !this.resolveTouchKey) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * PLAYFIELD_W;
    const y = ((e.clientY - rect.top) / rect.height) * PLAYFIELD_H;
    const key = this.resolveTouchKey(x, y);
    if (!key) return;
    // Multi-touch: each pointer remembers the key it activated and only that
    // pointer's release will lift the key (unless another pointer holds it too).
    this.pointerKeys.set(e.pointerId, key);
    if (!this.held.has(key)) this.pressedThisFrame.add(key);
    this.held.add(key);
    // Capture so movement off the canvas still routes to us. Wrap because some
    // browsers throw when called for synthetic / non-current pointers.
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const key = this.pointerKeys.get(e.pointerId);
    if (!key) return;
    this.pointerKeys.delete(e.pointerId);
    // Only release the key if no other pointer is still holding it.
    let stillHeld = false;
    for (const k of this.pointerKeys.values()) {
      if (k === key) {
        stillHeld = true;
        break;
      }
    }
    if (!stillHeld) {
      this.held.delete(key);
      this.releasedThisFrame.add(key);
    }
  };

  isDown(key: VirtualKey): boolean {
    return this.held.has(key);
  }

  wasPressed(key: VirtualKey): boolean {
    return this.pressedThisFrame.has(key);
  }

  wasReleased(key: VirtualKey): boolean {
    return this.releasedThisFrame.has(key);
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
  }
}
