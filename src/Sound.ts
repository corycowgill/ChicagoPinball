/** All-synthesized sound effects (WebAudio, no assets). The AudioContext is
 *  created lazily on the first user gesture — browsers block audio before
 *  interaction — and every play call is a no-op until then. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private musicMode: 'off' | 'main' | 'action' = 'off';
  private musicStep = 0;
  private musicTimer: ReturnType<typeof setInterval> | null = null;

  /** Call from a user-gesture handler (pointerdown / keydown). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* no speech support */
      }
    }
    return this.muted;
  }

  // ── Music — a state-driven 8-step groove (main play vs. multiball/boss). ──

  startMusic(mode: 'main' | 'action') {
    this.musicMode = mode;
    if (!this.musicTimer) {
      this.musicTimer = setInterval(() => this.musicTick(), 250); // 8ths @ 120 BPM
    }
  }

  stopMusic() {
    this.musicMode = 'off';
  }

  private musicTick() {
    if (this.musicMode === 'off' || this.muted || !this.ctx) return;
    const step = this.musicStep++ % 8;
    const MAIN_BASS = [110, 0, 131, 110, 87, 0, 131, 147];
    const ACTION_BASS = [110, 110, 165, 110, 175, 110, 165, 147];
    const bass = (this.musicMode === 'main' ? MAIN_BASS : ACTION_BASS)[step];
    if (bass) this.tone(bass, 210, { type: 'triangle', vol: 0.11 });
    if (this.musicMode === 'action' && step % 2 === 0) {
      this.tone((bass || 110) * 4, 90, { type: 'square', vol: 0.04 });
    }
    if (step % 4 === 2) this.noise(28, { vol: 0.05, freq: 6500, q: 1.5 }); // hat
  }

  /** Announcer callout via speech synthesis. `priority` interrupts. */
  speak(text: string, priority = false) {
    if (this.muted) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      if (synth.speaking) {
        if (!priority) return;
        synth.cancel();
      }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 0.6;
      u.volume = 0.9;
      synth.speak(u);
    } catch {
      /* no speech support */
    }
  }

  /** The replay knocker — a physical THWACK from inside the cabinet. */
  knocker() {
    this.noise(90, { vol: 0.9, freq: 180, q: 0.5 });
    this.tone(70, 130, { type: 'square', vol: 0.4, slideTo: 48 });
  }

  /** One decaying oscillator; `slideTo` bends the pitch over the duration. */
  private tone(
    freq: number,
    durMs: number,
    opts: { type?: OscillatorType; vol?: number; slideTo?: number; delayMs?: number } = {},
  ) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + (opts.delayMs ?? 0) / 1000;
    const t1 = t0 + durMs / 1000;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t1);
    gain.gain.setValueAtTime(opts.vol ?? 0.5, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t1);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t1);
  }

  /** Filtered noise burst — clacks, thuds, whooshes. */
  private noise(
    durMs: number,
    opts: { vol?: number; freq?: number; q?: number; delayMs?: number } = {},
  ) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + (opts.delayMs ?? 0) / 1000;
    const len = Math.max(1, Math.floor((durMs / 1000) * this.ctx.sampleRate));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = opts.freq ?? 2000;
    filter.Q.value = opts.q ?? 1;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(opts.vol ?? 0.4, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
  }

  // ── Effects ──────────────────────────────────────────────────────────────

  flipper() {
    this.noise(35, { vol: 0.5, freq: 900, q: 0.8 });
    this.tone(140, 50, { type: 'square', vol: 0.18, slideTo: 90 });
  }

  bumper() {
    this.tone(520, 90, { type: 'square', vol: 0.3, slideTo: 260 });
    this.noise(40, { vol: 0.3, freq: 3200 });
  }

  sling() {
    this.tone(330, 70, { type: 'square', vol: 0.28, slideTo: 480 });
  }

  bean() {
    // Chrome "gong" — two detuned partials.
    this.tone(392, 260, { vol: 0.3 });
    this.tone(587, 200, { vol: 0.18 });
  }

  spinner() {
    this.tone(1400, 24, { type: 'square', vol: 0.1 });
  }

  rollover() {
    this.tone(880, 110, { vol: 0.28, slideTo: 1320 });
  }

  dropTarget() {
    this.noise(60, { vol: 0.5, freq: 700, q: 1.5 });
    this.tone(220, 80, { type: 'triangle', vol: 0.3, slideTo: 160 });
  }

  standup() {
    this.tone(660, 60, { type: 'triangle', vol: 0.25 });
  }

  captive() {
    this.tone(196, 120, { vol: 0.35 });
    this.noise(40, { vol: 0.35, freq: 1200 });
  }

  launch() {
    this.noise(320, { vol: 0.4, freq: 1500, q: 0.5 });
    this.tone(180, 320, { type: 'sawtooth', vol: 0.12, slideTo: 720 });
  }

  ramp() {
    for (let i = 0; i < 3; i++) this.tone(523 + i * 130, 110, { vol: 0.22, delayMs: i * 55 });
  }

  scoop() {
    this.tone(392, 140, { vol: 0.3 });
    this.tone(523, 160, { vol: 0.3, delayMs: 120 });
    this.tone(659, 220, { vol: 0.3, delayMs: 240 });
  }

  lock() {
    this.tone(262, 130, { type: 'triangle', vol: 0.35 });
    this.tone(392, 130, { type: 'triangle', vol: 0.35, delayMs: 110 });
    this.tone(523, 200, { type: 'triangle', vol: 0.35, delayMs: 220 });
  }

  multiball() {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => this.tone(f, 150, { type: 'square', vol: 0.22, delayMs: i * 90 }));
  }

  jackpot() {
    [659, 831, 988, 1319].forEach((f, i) => this.tone(f, 320, { vol: 0.28, delayMs: i * 40 }));
  }

  combo(n: number) {
    this.tone(660 + n * 110, 120, { type: 'square', vol: 0.24, slideTo: 880 + n * 110 });
  }

  ballSave() {
    this.tone(440, 90, { type: 'square', vol: 0.3 });
    this.tone(660, 140, { type: 'square', vol: 0.3, delayMs: 80 });
  }

  drain() {
    this.tone(160, 400, { type: 'sawtooth', vol: 0.3, slideTo: 55 });
    this.noise(120, { vol: 0.35, freq: 300, q: 0.8 });
  }

  bonusCount() {
    this.tone(740, 60, { type: 'square', vol: 0.2 });
  }

  gameOver() {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 300, { type: 'triangle', vol: 0.3, delayMs: i * 220 }));
  }

  bossStart() {
    // Menacing low walk-up.
    [110, 131, 147, 110].forEach((f, i) => this.tone(f, 260, { type: 'sawtooth', vol: 0.3, delayMs: i * 200 }));
    this.noise(500, { vol: 0.2, freq: 220, q: 0.6, delayMs: 700 });
  }

  bossHit() {
    this.tone(98, 90, { type: 'square', vol: 0.32, slideTo: 65 });
    this.noise(50, { vol: 0.3, freq: 900 });
  }

  bossDefeat() {
    const notes = [523, 659, 784, 1047, 1319, 1568];
    notes.forEach((f, i) => this.tone(f, 260, { vol: 0.28, delayMs: i * 110 }));
    this.noise(600, { vol: 0.25, freq: 3000, q: 0.4, delayMs: 660 });
  }

  bossFail() {
    [196, 175, 147, 110].forEach((f, i) => this.tone(f, 320, { type: 'sawtooth', vol: 0.28, delayMs: i * 240 }));
  }

  nudge() {
    this.noise(70, { vol: 0.4, freq: 240, q: 0.7 });
  }

  tilt() {
    this.tone(220, 500, { type: 'sawtooth', vol: 0.35, slideTo: 210 });
    this.tone(233, 500, { type: 'sawtooth', vol: 0.35 });
  }

  tourStop() {
    this.tone(587, 120, { vol: 0.3 });
    this.tone(880, 200, { vol: 0.3, delayMs: 110 });
  }

  tourComplete() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 220, { vol: 0.28, delayMs: i * 100 }));
  }

  kickback() {
    this.noise(140, { vol: 0.45, freq: 700, q: 0.6 });
    this.tone(180, 240, { type: 'sawtooth', vol: 0.25, slideTo: 880 });
  }

  mystery() {
    // Little question-mark twinkle then the reveal note.
    [784, 988, 784, 988].forEach((f, i) => this.tone(f, 90, { type: 'triangle', vol: 0.22, delayMs: i * 80 }));
    this.tone(1319, 260, { vol: 0.3, delayMs: 360 });
  }
}
