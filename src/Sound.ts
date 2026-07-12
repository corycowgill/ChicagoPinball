/** All-synthesized sound effects (WebAudio, no assets). The AudioContext is
 *  created lazily on the first user gesture — browsers block audio before
 *  interaction — and every play call is a no-op until then. */

export type MusicMode =
  | 'off'
  | 'main'
  | 'action'
  | 'baseball'
  | 'football'
  | 'basketball'
  | 'hockey'
  | 'soccer';

/** Per-mode 8-step grooves: bass line + optional lead + hat pattern.
 *  0 = rest. Each sport mode has its own musical identity. */
const GROOVES: Record<Exclude<MusicMode, 'off'>, { bass: number[]; lead: number[]; hat: number[]; bpm: number }> = {
  // Chicago blues shuffle.
  main: { bass: [110, 0, 131, 110, 87, 0, 131, 147], lead: [0, 0, 0, 0, 0, 0, 0, 0], hat: [0, 0, 1, 0, 0, 0, 1, 0], bpm: 120 },
  // Multiball / wizard — driving.
  action: { bass: [110, 110, 165, 110, 175, 110, 165, 147], lead: [440, 0, 440, 0, 523, 0, 440, 392], hat: [1, 0, 1, 0, 1, 0, 1, 1], bpm: 120 },
  // Ballpark organ — major-key bounce.
  baseball: { bass: [131, 0, 165, 0, 196, 0, 165, 0], lead: [523, 659, 784, 659, 523, 0, 659, 0], hat: [0, 0, 1, 0, 0, 0, 1, 0], bpm: 112 },
  // Marching cadence — snare-forward.
  football: { bass: [98, 98, 0, 98, 123, 0, 98, 0], lead: [0, 0, 392, 0, 0, 0, 330, 0], hat: [1, 1, 1, 0, 1, 1, 1, 1], bpm: 116 },
  // Uptempo funk.
  basketball: { bass: [110, 0, 110, 131, 0, 110, 147, 131], lead: [0, 440, 0, 0, 523, 0, 0, 587], hat: [1, 0, 1, 1, 0, 1, 1, 0], bpm: 126 },
  // Arena rock drive.
  hockey: { bass: [82, 82, 82, 98, 82, 82, 110, 98], lead: [330, 0, 0, 392, 0, 0, 440, 0], hat: [1, 0, 1, 0, 1, 0, 1, 0], bpm: 132 },
  // Terrace chant sway.
  soccer: { bass: [87, 0, 0, 110, 0, 0, 131, 0], lead: [349, 0, 440, 0, 523, 440, 0, 349], hat: [0, 0, 1, 0, 0, 0, 1, 0], bpm: 108 },
};

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private musicMode: MusicMode = 'off';
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

  // ── Music — state-driven 8-step grooves: main play, multiball/wizard
  //    action, and one theme per sport mode. ──

  startMusic(mode: Exclude<MusicMode, 'off'>) {
    if (this.musicMode === mode) return;
    this.musicMode = mode;
    this.musicStep = 0;
    this.retuneMusicTimer();
  }

  stopMusic() {
    this.musicMode = 'off';
  }

  /** Each groove carries its own tempo — rebuild the interval to match. */
  private retuneMusicTimer() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.musicMode === 'off') return;
    const bpm = GROOVES[this.musicMode].bpm;
    this.musicTimer = setInterval(() => this.musicTick(), Math.round(30000 / bpm)); // 8th notes
  }

  private musicTick() {
    if (this.musicMode === 'off' || this.muted || !this.ctx) return;
    const groove = GROOVES[this.musicMode];
    const step = this.musicStep++ % 8;
    const bass = groove.bass[step];
    if (bass) this.tone(bass, 210, { type: 'triangle', vol: 0.11 });
    const lead = groove.lead[step];
    if (lead) {
      // Sport leads use a reedy square (organ-adjacent); action doubles up.
      this.tone(lead, 120, { type: 'square', vol: 0.045 });
      if (this.musicMode === 'baseball') this.tone(lead * 2, 100, { type: 'square', vol: 0.02 });
    }
    if (groove.hat[step]) this.noise(28, { vol: 0.05, freq: 6500, q: 1.5 });
    // Football gets its snare on the back beats.
    if (this.musicMode === 'football' && (step === 2 || step === 6)) {
      this.noise(55, { vol: 0.09, freq: 1800, q: 0.9 });
    }
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

  sportShot() {
    this.tone(587, 120, { vol: 0.3 });
    this.tone(880, 200, { vol: 0.3, delayMs: 110 });
  }

  sportComplete() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 220, { vol: 0.28, delayMs: i * 100 }));
    this.crowd(900, 0.22);
  }

  // ── Sport-themed stingers ────────────────────────────────────────────────

  /** Stadium crowd swell — filtered noise with a slow envelope. */
  crowd(durMs = 1200, vol = 0.18) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime;
    const len = Math.floor((durMs / 1000) * this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 950;
    filter.Q.value = 0.4;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + durMs / 2500);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
  }

  /** Ballpark organ sting — "charge!" style triad walk-up. */
  organSting() {
    const notes = [392, 523, 659, 784, 659, 784];
    notes.forEach((f, i) => {
      this.tone(f, i === notes.length - 1 ? 340 : 130, { type: 'square', vol: 0.14, delayMs: i * 120 });
      this.tone(f / 2, i === notes.length - 1 ? 340 : 130, { type: 'square', vol: 0.1, delayMs: i * 120 });
    });
  }

  /** Hockey goal horn — long detuned blast. */
  goalHorn() {
    this.tone(233, 950, { type: 'sawtooth', vol: 0.3 });
    this.tone(238, 950, { type: 'sawtooth', vol: 0.3 });
    this.tone(116, 950, { type: 'square', vol: 0.18 });
    this.crowd(1400, 0.24);
  }

  /** Basketball buzzer + the swish. */
  buzzer() {
    this.tone(310, 550, { type: 'square', vol: 0.28 });
    this.tone(315, 550, { type: 'square', vol: 0.2 });
    this.noise(180, { vol: 0.25, freq: 5200, q: 0.7, delayMs: 560 }); // net swish
  }

  /** Referee whistle — two short chirps. */
  whistle() {
    for (const d of [0, 160]) {
      this.tone(2350, 120, { type: 'square', vol: 0.16, delayMs: d });
      this.tone(2410, 120, { type: 'square', vol: 0.12, delayMs: d });
      this.noise(110, { vol: 0.1, freq: 2400, q: 6, delayMs: d });
    }
  }

  /** The L rattling past the skyline. */
  trainPass() {
    for (let i = 0; i < 6; i++) this.noise(90, { vol: 0.08, freq: 140 + (i % 2) * 60, q: 0.8, delayMs: i * 130 });
    this.tone(660, 200, { type: 'triangle', vol: 0.05, delayMs: 260 }); // crossing bell
    this.tone(660, 200, { type: 'triangle', vol: 0.05, delayMs: 560 });
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
