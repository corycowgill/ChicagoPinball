import Matter from 'matter-js';
import { Physics } from './Physics';
import { Playfield } from './scene/Playfield';
import { Renderer, HudInfo } from './Renderer';
import { InputManager, VirtualKey } from './InputManager';
import { Sound } from './Sound';
import { GameState, ScoreEvent } from './types';
import {
  STARTING_BALLS,
  COLOR,
  PLAYFIELD_W,
  POINTS,
  BALL_SAVE_MS,
  BONUS_UNIT,
  MAX_BONUS_X,
  COMBO_WINDOW_MS,
  BOSS_HP,
  BOSS_MS,
  TOUR_STOP_MS,
  TILT_LIMIT,
  TILT_DECAY_PER_S,
  REPLAY_SCORE,
  MAX_PLAYERS,
} from './constants';

const HIGH_SCORE_KEY = 'chicago-pinball-high-score';

/** Per-player game state (alternating play, Stern-style). */
interface PlayerState {
  score: number;
  extraBalls: number;
  spelledChicago: boolean;
  hadMultiball: boolean;
  bossLit: boolean;
  replayAwarded: boolean;
}

function newPlayer(): PlayerState {
  return {
    score: 0,
    extraBalls: 0,
    spelledChicago: false,
    hadMultiball: false,
    bossLit: false,
    replayAwarded: false,
  };
}

/** How many end-of-ball bonus units each scoring event banks. */
const BONUS_UNITS: Partial<Record<ScoreEvent['kind'], number>> = {
  'pop-bumper': 1,
  bean: 2,
  'drop-target': 2,
  standup: 1,
  ramp: 3,
  loop: 3,
  scoop: 5,
  'lake-bonus': 3,
  captive: 2,
  lock: 5,
  lane: 1,
  'skill-shot': 2,
};

/** The City Tour itinerary: each stop is one specific shot, in order. */
export interface TourStop {
  name: string;
  kind: ScoreEvent['kind'];
  letter?: string;
}
const TOUR_STOPS: TourStop[] = [
  { name: 'WILLIS TOWER', kind: 'ramp', letter: 'L' },
  { name: 'RIDE THE L', kind: 'ramp', letter: 'R' },
  { name: 'NAVY PIER', kind: 'loop' },
  { name: 'THE BEAN', kind: 'bean' },
  { name: 'WRIGLEY FIELD', kind: 'captive' },
];

/** Damage each scoring event deals to Capone during the SHOWDOWN. */
const BOSS_DAMAGE: Partial<Record<ScoreEvent['kind'], number>> = {
  bean: 6,
  ramp: 10,
  loop: 10,
  scoop: 10,
  'lake-bonus': 8,
  captive: 8,
  'drop-target': 2,
  standup: 2,
  'pop-bumper': 1,
};

export class Game {
  private physics!: Physics;
  /** Public for headless tests to read body angles. */
  playfield!: Playfield;
  private renderer = new Renderer();
  private input = new InputManager();
  private sound = new Sound();

  private state: GameState = GameState.TITLE;
  private players: PlayerState[] = [newPlayer()];
  private current = 0;
  /** 1-based ball number, shared by all players (alternating play). */
  private ballNumber = 1;
  /** Set when the drained ball was bought back by an extra ball. */
  private shootAgain = false;
  /** Match sequence result, computed at game over. */
  private matchNumber = 0;
  private matched = false;
  private respawnTimer = 0;
  private highScore = loadHighScore();

  private get cur(): PlayerState {
    return this.players[this.current];
  }
  private get score(): number {
    return this.cur.score;
  }
  private set score(v: number) {
    this.cur.score = v;
  }
  private get bossLit(): boolean {
    return this.cur.bossLit;
  }
  private set bossLit(v: boolean) {
    this.cur.bossLit = v;
  }
  private get spelledChicago(): boolean {
    return this.cur.spelledChicago;
  }
  private set spelledChicago(v: boolean) {
    this.cur.spelledChicago = v;
  }
  private get hadMultiball(): boolean {
    return this.cur.hadMultiball;
  }
  private set hadMultiball(v: boolean) {
    this.cur.hadMultiball = v;
  }

  // City Tour + multiball
  /** Index into TOUR_STOPS, or -1 when no tour is running. */
  private tourIdx = -1;
  private tourMsLeft = 0;
  private multiballActive = false;

  // Nudge / tilt
  private tiltHeat = 0;
  private tilted = false;

  // Kickback (left outlane) + Mystery (LAKE scoop)
  private kickbackLit = false;
  private mysteryLit = true;

  // Per-ball progression
  private ballSaveMs = 0;
  private bonusUnits = 0;
  private bonusX = 1;
  private comboCount = 0;
  private lastComboAt = -1e9;
  private timeMs = 0;

  // CAPONE SHOWDOWN (boss battle) — lit/achievement flags live per player.
  private bossActive = false;
  private bossHp = BOSS_HP;
  private bossMsLeft = 0;

  constructor(private ctx: CanvasRenderingContext2D, canvas?: HTMLElement) {
    this.rebuildWorld();
    if (canvas) {
      this.input.attachPointer(canvas, (x, y) => this.resolveTouchKey(x, y));
    }
    // Browsers gate audio behind a user gesture; resume on any interaction.
    window.addEventListener('pointerdown', () => this.sound.unlock());
    window.addEventListener('keydown', () => this.sound.unlock());
  }

  private resolveTouchKey(x: number, y: number): VirtualKey | null {
    if (this.state === GameState.TITLE || this.state === GameState.GAME_OVER) return 'enter';
    if (this.state === GameState.READY) return 'plunger';
    if (this.state === GameState.BALL_DRAINED) return null;
    // PLAYING — touch in the lower-RIGHT corner (over the shooter lane)
    // charges the plunger; everywhere else maps to flippers.
    if (x > PLAYFIELD_W - 70 && y > 600) return 'plunger';
    return x < PLAYFIELD_W / 2 ? 'leftFlipper' : 'rightFlipper';
  }

  private rebuildWorld() {
    this.physics = new Physics();
    this.playfield = new Playfield(this.physics, {
      onScore: (e) => this.handleScore(e),
      onDrain: (b) => this.handleDrain(b),
      onLockComplete: () => this.handleLockComplete(),
      onScoopMode: () => this.startMode(),
      onLanesComplete: () => this.advanceBonusX(),
      onLeftOutlane: (ball) => this.handleLeftOutlane(ball),
    });
  }

  private handleLeftOutlane(ball: Matter.Body) {
    if (this.state !== GameState.PLAYING || this.tilted || !this.kickbackLit) return;
    this.kickbackLit = false; // one shot per light
    this.playfield.fireKickback(ball);
    this.renderer.pushToast('KICKBACK!', COLOR.NEON_GREEN, 1100);
    this.renderer.kick(3);
    this.sound.kickback();
  }

  /** The Mystery wheel behind the LAKE scoop. */
  private awardMystery() {
    this.sound.mystery();
    const options: Array<() => void> = [
      () => {
        this.score += 25000;
        this.renderer.pushToast('MYSTERY: 25,000', COLOR.NEON_AMBER, 1500);
      },
      () => {
        this.advanceBonusX();
        this.renderer.pushToast('MYSTERY: BONUS ADVANCED', COLOR.NEON_GREEN, 1500);
      },
      () => {
        this.ballSaveMs = Math.max(this.ballSaveMs, 10000);
        this.renderer.pushToast('MYSTERY: BALL SAVE', COLOR.NEON_GREEN, 1500);
      },
      () => {
        if (!this.kickbackLit) {
          this.kickbackLit = true;
          this.renderer.pushToast('MYSTERY: KICKBACK LIT', COLOR.NEON_GREEN, 1500);
        } else {
          this.score += 15000;
          this.renderer.pushToast('MYSTERY: 15,000', COLOR.NEON_AMBER, 1500);
        }
      },
      () => {
        if (this.tourIdx >= 0) {
          // Spot the current stop.
          const stop = TOUR_STOPS[this.tourIdx];
          this.handleScore({ kind: stop.kind, points: 0, letter: stop.letter });
          this.renderer.pushToast('MYSTERY: STOP SPOTTED', COLOR.INSERT_CYAN, 1500);
        } else {
          this.score += 10000;
          this.renderer.pushToast('MYSTERY: 10,000', COLOR.NEON_AMBER, 1500);
        }
      },
      () => {
        this.cur.extraBalls++;
        this.renderer.pushToast('MYSTERY: EXTRA BALL', COLOR.NEON_GREEN, 1800);
        this.sound.speak('Extra ball!', true);
      },
    ];
    options[Math.floor(Math.random() * options.length)]();
  }

  private advanceBonusX() {
    if (this.state !== GameState.PLAYING) return;
    this.bonusX = Math.min(MAX_BONUS_X, this.bonusX + 1);
    this.renderer.pushToast(`BONUS ×${this.bonusX}`, COLOR.NEON_GREEN, 1200);
    this.sound.combo(this.bonusX);
  }

  private handleScore(e: ScoreEvent) {
    if (this.state !== GameState.PLAYING) return;
    let pts = e.points;

    // Bank end-of-ball bonus units.
    this.bonusUnits = Math.min(99, this.bonusUnits + (BONUS_UNITS[e.kind] ?? 0));

    // Combo: chained ramp / loop / scoop / captive shots inside the window.
    if (e.kind === 'ramp' || e.kind === 'loop' || e.kind === 'scoop' || e.kind === 'captive') {
      if (this.timeMs - this.lastComboAt < COMBO_WINDOW_MS) {
        this.comboCount++;
        const comboPts = this.comboCount * POINTS.COMBO;
        pts += comboPts;
        this.renderer.pushToast(`COMBO ×${this.comboCount + 1} +${comboPts.toLocaleString()}`, COLOR.NEON_PINK, 900);
        this.sound.combo(this.comboCount);
      } else {
        this.comboCount = 0;
      }
      this.lastComboAt = this.timeMs;
    }

    // City Tour: hitting the CURRENT stop's shot advances the itinerary.
    if (this.tourIdx >= 0) {
      const stop = TOUR_STOPS[this.tourIdx];
      if (e.kind === stop.kind && (!stop.letter || stop.letter === e.letter)) {
        pts += POINTS.TOUR_STOP;
        this.tourIdx++;
        if (this.tourIdx >= TOUR_STOPS.length) {
          this.tourIdx = -1;
          this.score += POINTS.TOUR_COMPLETE;
          this.cur.extraBalls++;
          this.renderer.pushToast('TOUR COMPLETE!', COLOR.NEON_AMBER, 2000);
          this.renderer.pushToast('EXTRA BALL', COLOR.NEON_GREEN, 2000);
          this.renderer.triggerJackpotFlash();
          this.sound.tourComplete();
          this.sound.speak('Tour complete! Extra ball!', true);
        } else {
          this.tourMsLeft = TOUR_STOP_MS;
          this.renderer.pushToast(`✓ ${stop.name} +${POINTS.TOUR_STOP.toLocaleString()}`, COLOR.INSERT_CYAN, 1300);
          this.renderer.pushToast(`NEXT: ${TOUR_STOPS[this.tourIdx].name}`, COLOR.TEXT_DIM, 1300);
          this.sound.tourStop();
        }
      }
    }
    // Multiball jackpot: ramp / scoop hits during multiball pay big.
    if (this.multiballActive && this.isJackpotShot(e.kind)) {
      pts += POINTS.MULTIBALL_JACKPOT;
      this.renderer.pushToast('JACKPOT +' + POINTS.MULTIBALL_JACKPOT.toLocaleString(), COLOR.NEON_AMBER, 900);
      this.sound.jackpot();
    }

    // Boss battle: every hit chips at Capone.
    if (this.bossActive) {
      const dmg = BOSS_DAMAGE[e.kind] ?? 0;
      if (dmg > 0) {
        this.bossHp = Math.max(0, this.bossHp - dmg);
        this.renderer.kick(1.5);
        this.sound.bossHit();
        if (this.bossHp <= 0) this.bossDefeat();
      }
    }
    this.score += pts;
    this.checkReplay();

    switch (e.kind) {
      case 'super-jackpot':
        this.renderer.pushToast('SUPER JACKPOT!', COLOR.NEON_AMBER, 1800);
        this.renderer.triggerJackpotFlash();
        this.renderer.kick(5);
        this.sound.jackpot();
        this.spelledChicago = true;
        this.maybeLightBoss();
        break;
      case 'skill-shot':
        this.renderer.pushToast(`SKILL SHOT +${e.points.toLocaleString()}`, COLOR.NEON_AMBER, 1200);
        this.sound.rollover();
        break;
      case 'lane':
        this.sound.rollover();
        break;
      case 'ramp':
        this.renderer.pushToast('RAMP +' + e.points.toLocaleString(), COLOR.INSERT_BLUE, 700);
        this.sound.ramp();
        break;
      case 'loop':
        this.renderer.pushToast('LOOP +' + e.points.toLocaleString(), COLOR.INSERT_PURPLE, 700);
        this.sound.ramp();
        break;
      case 'scoop':
        if (this.bossActive) this.renderer.pushToast('DIRECT HIT!', COLOR.INSERT_RED, 900);
        this.sound.scoop();
        break;
      case 'lake-bonus':
        if (this.mysteryLit) {
          this.mysteryLit = false;
          this.awardMystery();
        } else {
          this.renderer.pushToast('LAKE BONUS', COLOR.RIVER_HI, 900);
          this.sound.scoop();
        }
        break;
      case 'lock':
        this.renderer.pushToast('BALL LOCKED', COLOR.INSERT_RED, 900);
        this.sound.lock();
        break;
      case 'captive':
        this.renderer.pushToast('CAPTIVE +' + e.points.toLocaleString(), COLOR.NEON_GREEN, 600);
        this.sound.captive();
        break;
      case 'drop-target':
        if (e.letter) this.renderer.pushToast(e.letter, COLOR.NEON_CYAN, 600);
        this.sound.dropTarget();
        break;
      case 'bean':
        this.renderer.pushToast('THE BEAN', '#9fc4ff', 600);
        this.renderer.kick(2.5);
        this.sound.bean();
        break;
      case 'pop-bumper':
        this.renderer.kick(2);
        this.sound.bumper();
        break;
      case 'slingshot':
        this.renderer.kick(2.5);
        this.sound.sling();
        break;
      case 'standup': {
        this.sound.standup();
        // Team pairs: CUBS+BEARS light the kickback, BULLS+SOX relight Mystery.
        const target = this.playfield.standups.find((s) => s.label === `standup-${e.letter}`);
        if (target) target.lit = true;
        const litOf = (id: string) =>
          this.playfield.standups.find((s) => s.label === `standup-${id}`)?.lit ?? false;
        const unlight = (ids: string[]) => {
          for (const id of ids) {
            const s = this.playfield.standups.find((t) => t.label === `standup-${id}`);
            if (s) s.lit = false;
          }
        };
        if (litOf('cubs') && litOf('bears') && !this.kickbackLit) {
          unlight(['cubs', 'bears']);
          this.kickbackLit = true;
          this.renderer.pushToast('KICKBACK LIT', COLOR.NEON_GREEN, 1300);
          this.sound.rollover();
        }
        if (litOf('bulls') && litOf('sox') && !this.mysteryLit) {
          unlight(['bulls', 'sox']);
          this.mysteryLit = true;
          this.renderer.pushToast('MYSTERY LIT AT THE LAKE', COLOR.RIVER_HI, 1300);
          this.sound.rollover();
        }
        break;
      }
      case 'spinner':
        this.sound.spinner();
        break;
      default:
        break;
    }
  }

  private isJackpotShot(kind: ScoreEvent['kind']) {
    return kind === 'ramp' || kind === 'loop' || kind === 'scoop';
  }

  /** MODE scoop routing: boss fight if SHOWDOWN is lit, City Tour otherwise. */
  private startMode() {
    if (this.bossActive) return; // scoop hits during the fight just deal damage
    if (this.bossLit) {
      this.startBoss();
      return;
    }
    if (this.tourIdx >= 0) return; // tour already running
    this.tourIdx = 0;
    this.tourMsLeft = TOUR_STOP_MS;
    this.renderer.pushToast('CITY TOUR!', COLOR.INSERT_CYAN, 1400);
    this.renderer.pushToast(`FIRST STOP: ${TOUR_STOPS[0].name}`, COLOR.TEXT_DIM, 1400);
  }

  private maybeLightBoss() {
    if (this.bossActive || this.bossLit) return;
    if (!this.spelledChicago && !this.hadMultiball) return;
    this.bossLit = true;
    this.renderer.pushToast('SHOWDOWN LIT AT THE SCOOP', COLOR.INSERT_RED, 1800);
    this.sound.lock();
  }

  private startBoss() {
    this.bossLit = false;
    this.bossActive = true;
    this.bossHp = BOSS_HP;
    this.bossMsLeft = BOSS_MS;
    this.tourIdx = -1; // the tour yields to the showdown
    // Two-ball brawl: serve a second ball.
    this.playfield.serveBall(true);
    this.renderer.pushToast('CAPONE SHOWDOWN!', COLOR.INSERT_RED, 2000);
    this.renderer.triggerJackpotFlash();
    this.renderer.kick(4);
    this.sound.bossStart();
    this.sound.speak('Capone showdown!', true);
    this.sound.startMusic('action');
  }

  private bossDefeat() {
    this.bossActive = false;
    this.spelledChicago = false;
    this.hadMultiball = false;
    this.score += POINTS.BOSS_DEFEAT;
    this.cur.extraBalls++;
    this.ballSaveMs = 10000; // victory lap
    this.renderer.pushToast('CAPONE DEFEATED!', COLOR.NEON_AMBER, 2200);
    this.renderer.pushToast('EXTRA BALL', COLOR.NEON_GREEN, 2200);
    this.renderer.triggerJackpotFlash();
    this.renderer.kick(6);
    this.sound.bossDefeat();
    this.sound.speak('Capone is down! Extra ball!', true);
    this.sound.startMusic('main');
    this.checkReplay();
  }

  private bossFail() {
    this.bossActive = false;
    this.spelledChicago = false;
    this.hadMultiball = false;
    this.renderer.pushToast('CAPONE GOT AWAY…', COLOR.TEXT_DIM, 1600);
    this.sound.bossFail();
    this.sound.speak('He got away…');
    this.sound.startMusic('main');
  }

  /** Replay: first crossing of the threshold pays an extra ball + knocker. */
  private checkReplay() {
    if (this.cur.replayAwarded || this.score < REPLAY_SCORE) return;
    this.cur.replayAwarded = true;
    this.cur.extraBalls++;
    this.renderer.pushToast(`REPLAY AT ${REPLAY_SCORE.toLocaleString()} — EXTRA BALL`, COLOR.NEON_AMBER, 2000);
    this.sound.knocker();
    this.sound.speak('Replay!', true);
  }

  private handleLockComplete() {
    if (this.playfield.bean.locked >= 3) {
      // Multiball start — the locked balls fan out from the Bean.
      this.multiballActive = true;
      const released = this.playfield.releaseLocks();
      this.renderer.pushToast(`MULTIBALL × ${released}`, COLOR.NEON_AMBER, 1600);
      this.renderer.triggerJackpotFlash();
      this.sound.multiball();
      this.sound.speak('Multiball!', true);
      this.sound.startMusic('action');
      this.hadMultiball = true;
      this.maybeLightBoss();
    } else {
      // Lock progress feedback + auto-serve a fresh ball.
      this.renderer.pushToast(`LOCK ${this.playfield.bean.locked} / 3`, COLOR.INSERT_RED, 900);
      this.playfield.serveBall(true);
    }
  }

  private handleDrain(ball: Matter.Body) {
    if (this.state !== GameState.PLAYING) return;
    if (!this.playfield.hasBall(ball)) return; // already handled
    // removeBall shrinks the ball list synchronously, so the counts below
    // are exact even when several balls drain on the same frame.
    this.playfield.removeBall(ball);
    const left = this.playfield.balls.length;

    if (left >= 2) return; // multiball continues

    if (left === 1) {
      if (this.multiballActive) {
        this.multiballActive = false;
        this.renderer.pushToast('MULTIBALL OVER', COLOR.TEXT_DIM, 900);
        if (!this.bossActive) this.sound.startMusic('main');
      }
      return;
    }

    // Last ball headed out — ball save?
    if (this.ballSaveMs > 0) {
      this.ballSaveMs = 0; // one save per launch
      this.multiballActive = false;
      this.playfield.serveBall(true);
      this.renderer.pushToast('BALL SAVED', COLOR.NEON_GREEN, 1200);
      this.sound.ballSave();
      this.sound.speak('Ball saved');
      return;
    }

    // Ball over: pay the end-of-ball bonus, then respawn / game over.
    this.multiballActive = false;
    if (this.bossActive) {
      // The fight ends with the ball, but SHOWDOWN relights for a retry.
      this.bossActive = false;
      this.bossLit = true;
    }
    this.sound.drain();
    this.renderer.kick(4);
    const bonus = this.bonusUnits * BONUS_UNIT * this.bonusX;
    if (this.tilted) {
      // Tilting forfeits the bonus — the classic price.
      this.renderer.pushToast('BONUS LOST — TILT', COLOR.INSERT_RED, 1500);
    } else if (bonus > 0) {
      this.score += bonus;
      const xText = this.bonusX > 1 ? `  ×${this.bonusX}` : '';
      this.renderer.pushToast(`BONUS ${bonus.toLocaleString()}${xText}`, COLOR.NEON_AMBER, 1600);
      this.sound.bonusCount();
    }
    // Extra ball buys the same player another go at the same ball number.
    if (this.cur.extraBalls > 0) {
      this.cur.extraBalls--;
      this.shootAgain = true;
      this.renderer.pushToast('SHOOT AGAIN', COLOR.NEON_GREEN, 1600);
      this.sound.speak('Shoot again!');
    }
    this.state = GameState.BALL_DRAINED;
    this.respawnTimer = bonus > 0 ? 1700 : 900;
  }

  update(dtMs: number) {
    this.timeMs += dtMs;

    if (this.input.wasPressed('mute')) {
      const muted = this.sound.toggleMute();
      this.renderer.pushToast(muted ? 'SOUND OFF' : 'SOUND ON', COLOR.TEXT_DIM, 800);
    }

    if (this.state === GameState.TITLE) {
      if (this.input.wasPressed('enter')) this.startGame();
      this.renderer.tick(dtMs);
      this.input.endFrame();
      return;
    }
    if (this.state === GameState.GAME_OVER) {
      if (this.input.wasPressed('enter')) this.state = GameState.TITLE;
      this.renderer.tick(dtMs);
      this.input.endFrame();
      return;
    }

    const allowFlippers =
      (this.state === GameState.PLAYING || this.state === GameState.READY) && !this.tilted;
    this.playfield.setFlippers(
      allowFlippers && this.input.isDown('leftFlipper'),
      allowFlippers && this.input.isDown('rightFlipper'),
    );

    // Add players (Stern-style Start button): before player 1's first
    // launch, Enter adds up to four players.
    if (
      this.state === GameState.READY &&
      this.ballNumber === 1 &&
      this.current === 0 &&
      this.players.length < MAX_PLAYERS &&
      this.input.wasPressed('enter')
    ) {
      this.players.push(newPlayer());
      this.renderer.pushToast(`PLAYER ${this.players.length} ADDED`, COLOR.NEON_CYAN, 1300);
      this.sound.rollover();
      this.sound.speak(`${this.players.length} players`);
    }

    // Nudging — physical shove with a tilt penalty for abuse.
    if (this.state === GameState.PLAYING && !this.tilted) {
      const dir = this.input.wasPressed('nudgeLeft') ? -1 : this.input.wasPressed('nudgeRight') ? 1 : 0;
      if (dir !== 0) {
        this.playfield.nudge(dir as -1 | 1);
        this.renderer.kick(3);
        this.sound.nudge();
        this.tiltHeat += 1;
        if (this.tiltHeat > TILT_LIMIT) {
          this.tilted = true;
          this.renderer.pushToast('TILT', COLOR.INSERT_RED, 2500);
          this.sound.tilt();
          this.sound.speak('Tilt!', true);
        }
      }
    }
    if (allowFlippers) {
      // Flipper clack + classic lane change on the press.
      if (this.input.wasPressed('leftFlipper')) {
        this.sound.flipper();
        this.playfield.rotateLanes(-1);
      }
      if (this.input.wasPressed('rightFlipper')) {
        this.sound.flipper();
        this.playfield.rotateLanes(1);
      }
    }

    if (this.state === GameState.READY || this.state === GameState.PLAYING) {
      if (this.input.wasPressed('plunger')) this.playfield.plunger.hold();
      if (this.input.wasReleased('plunger')) {
        const pull = this.playfield.plunger.release();
        this.playfield.applyPlungerLaunch(pull);
        if (pull > 0.1) this.sound.launch();
      }
    }

    this.physics.step(dtMs);

    // READY → PLAYING only once the ball actually leaves the shooter lane
    // (a weak plunge rolls back and the player just plunges again). Arms
    // the ball saver for this ball.
    if (
      this.state === GameState.READY &&
      this.playfield.balls.some((b) => !this.playfield.isBallInLaunchLane(b.body))
    ) {
      this.state = GameState.PLAYING;
      this.ballSaveMs = BALL_SAVE_MS;
    }

    this.playfield.tick(dtMs);
    this.renderer.tick(dtMs);

    if (this.tourIdx >= 0 && this.state === GameState.PLAYING) {
      this.tourMsLeft -= dtMs;
      if (this.tourMsLeft <= 0) {
        this.tourIdx = -1;
        this.renderer.pushToast('TOUR OVER', COLOR.TEXT_DIM, 1200);
      }
    }
    if (this.state === GameState.PLAYING && this.ballSaveMs > 0) {
      this.ballSaveMs = Math.max(0, this.ballSaveMs - dtMs);
    }
    if (this.bossActive && this.state === GameState.PLAYING) {
      this.bossMsLeft -= dtMs;
      if (this.bossMsLeft <= 0) this.bossFail();
    }
    // Tilt heat cools off over time.
    if (this.tiltHeat > 0) this.tiltHeat = Math.max(0, this.tiltHeat - (TILT_DECAY_PER_S * dtMs) / 1000);

    if (this.state === GameState.BALL_DRAINED) {
      this.respawnTimer -= dtMs;
      if (this.respawnTimer <= 0) {
        if (this.shootAgain) {
          // Same player, same ball number.
          this.shootAgain = false;
          this.startNextBall();
        } else {
          // Rotate to the next player; the ball number advances when the
          // rotation wraps back to player 1.
          const next = (this.current + 1) % this.players.length;
          if (next === 0) this.ballNumber++;
          this.current = next;
          if (this.ballNumber > STARTING_BALLS) {
            this.endGame();
          } else {
            if (this.players.length > 1) {
              this.renderer.pushToast(`PLAYER ${this.current + 1}`, COLOR.NEON_CYAN, 1500);
              this.sound.speak(`Player ${this.current + 1}, you're up`);
            }
            this.startNextBall();
          }
        }
      }
    }

    this.input.endFrame();
  }

  private startNextBall() {
    this.playfield.resetBall();
    this.bonusUnits = 0;
    this.bonusX = 1;
    this.comboCount = 0;
    this.lastComboAt = -1e9;
    this.tourIdx = -1;
    this.tiltHeat = 0;
    this.tilted = false;
    this.kickbackLit = false;
    this.mysteryLit = true; // one free Mystery per ball
    for (const s of this.playfield.standups) s.lit = false;
    this.state = GameState.READY;
  }

  private endGame() {
    const best = Math.max(...this.players.map((p) => p.score));
    if (best > this.highScore) {
      this.highScore = best;
      saveHighScore(this.highScore);
      this.renderer.pushToast('NEW HIGH SCORE!', COLOR.NEON_AMBER, 2200);
    }
    // Match sequence — last two digits vs a random decade; celebratory
    // knocker on a hit, like the real free-game moment.
    this.matchNumber = Math.floor(Math.random() * 10) * 10;
    this.matched = this.players.some((p) => p.score % 100 === this.matchNumber);
    this.sound.stopMusic();
    this.sound.gameOver();
    if (this.matched) {
      setTimeout(() => {
        this.sound.knocker();
        this.sound.speak('Match! Well played.');
      }, 1200);
    }
    this.state = GameState.GAME_OVER;
  }

  draw() {
    const hud: HudInfo = {
      state: this.state,
      score: this.score,
      ballNumber: this.ballNumber,
      playerScores: this.players.map((p) => p.score),
      currentPlayer: this.current,
      extraBalls: this.cur.extraBalls,
      matchNumber: this.matchNumber,
      matched: this.matched,
      plungerHolding: this.playfield.plunger.isHolding(),
      multiball: this.multiballActive,
      tourName: this.tourIdx >= 0 ? TOUR_STOPS[this.tourIdx].name : null,
      tourKind: this.tourIdx >= 0 ? TOUR_STOPS[this.tourIdx].kind : null,
      tourLetter: this.tourIdx >= 0 ? TOUR_STOPS[this.tourIdx].letter ?? null : null,
      tourMsLeft: this.tourMsLeft,
      tourIdx: this.tourIdx,
      tiltHeat: this.tiltHeat,
      tilted: this.tilted,
      kickbackLit: this.kickbackLit,
      mysteryLit: this.mysteryLit,
      bonusX: this.bonusX,
      ballSaveMs: this.ballSaveMs,
      highScore: this.highScore,
      bossLit: this.bossLit,
      bossActive: this.bossActive,
      bossHp: this.bossHp,
      bossMsLeft: this.bossMsLeft,
    };
    this.renderer.draw(this.ctx, this.playfield, hud);
  }

  private startGame() {
    this.players = [newPlayer()];
    this.current = 0;
    this.ballNumber = 1;
    this.shootAgain = false;
    this.matchNumber = 0;
    this.matched = false;
    this.tourIdx = -1;
    this.tiltHeat = 0;
    this.tilted = false;
    this.kickbackLit = false;
    this.mysteryLit = true;
    this.multiballActive = false;
    this.ballSaveMs = 0;
    this.bonusUnits = 0;
    this.bonusX = 1;
    this.comboCount = 0;
    this.lastComboAt = -1e9;
    this.bossActive = false;
    this.bossHp = BOSS_HP;
    this.bossMsLeft = 0;
    this.rebuildWorld();
    this.sound.startMusic('main');
    this.state = GameState.READY;
  }
}

function loadHighScore(): number {
  try {
    return Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveHighScore(score: number) {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(score));
  } catch {
    /* private mode etc. — high score just isn't persisted */
  }
}
