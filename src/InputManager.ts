type Key =
  | 'leftFlipper'
  | 'rightFlipper'
  | 'plunger'
  | 'enter';

const KEY_MAP: Record<string, Key> = {
  KeyZ: 'leftFlipper',
  ArrowLeft: 'leftFlipper',
  ShiftLeft: 'leftFlipper',
  Slash: 'rightFlipper',
  ArrowRight: 'rightFlipper',
  ShiftRight: 'rightFlipper',
  Space: 'plunger',
  Enter: 'enter',
  NumpadEnter: 'enter',
};

export class InputManager {
  private held = new Set<Key>();
  private pressedThisFrame = new Set<Key>();
  private releasedThisFrame = new Set<Key>();

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    target.addEventListener('keyup', (e) => this.onKeyUp(e as KeyboardEvent));
    // Drop input when window loses focus to avoid stuck flippers.
    window.addEventListener('blur', () => this.held.clear());
  }

  private onKeyDown(e: KeyboardEvent) {
    const k = KEY_MAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (!this.held.has(k)) {
      this.pressedThisFrame.add(k);
    }
    this.held.add(k);
  }

  private onKeyUp(e: KeyboardEvent) {
    const k = KEY_MAP[e.code];
    if (!k) return;
    e.preventDefault();
    this.held.delete(k);
    this.releasedThisFrame.add(k);
  }

  isDown(key: Key): boolean {
    return this.held.has(key);
  }

  wasPressed(key: Key): boolean {
    return this.pressedThisFrame.has(key);
  }

  wasReleased(key: Key): boolean {
    return this.releasedThisFrame.has(key);
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
  }
}
