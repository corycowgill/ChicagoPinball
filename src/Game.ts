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
  MODE_MS,
  POINTS,
  BALL_SAVE_MS,
  BONUS_UNIT,
  MAX_BONUS_X,
  COMBO_WINDOW_MS,
  BOSS_HP,
  BOSS_MS,
} from './constants';

const HIGH_SCORE_KEY = 'chicago-pinball-high-score';

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
  private score = 0;
  private ballsRemaining = STARTING_BALLS;
  private respawnTimer = 0;
  private highScore = loadHighScore();

  // Mode + multiball
  private modeMsLeft = 0;
  private multiballActive = false;

  // Per-ball progression
  private ballSaveMs = 0;
  private bonusUnits = 0;
  private bonusX = 1;
  private comboCount = 0;
  private lastComboAt = -1e9;
  private timeMs = 0;

  // CAPONE SHOWDOWN (boss battle)
  private bossLit = false;
  private bossActive = false;
  private bossHp = BOSS_HP;
  private bossMsLeft = 0;
  private spelledChicago = false;
  private hadMultiball = false;

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
    });
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

    // Mode bonus: every major shot during a mode pays a flat bonus on top.
    if (this.modeMsLeft > 0 && this.isModeShot(e.kind)) {
      pts += POINTS.MODE_SHOT;
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
        else if (!this.bossLit) this.renderer.pushToast('CITY TOUR MODE', COLOR.INSERT_AMBER, 1100);
        this.sound.scoop();
        break;
      case 'lake-bonus':
        this.renderer.pushToast('LAKE BONUS', COLOR.RIVER_HI, 900);
        this.sound.scoop();
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
      case 'standup':
        this.sound.standup();
        break;
      case 'spinner':
        this.sound.spinner();
        break;
      default:
        break;
    }
  }

  private isModeShot(kind: ScoreEvent['kind']) {
    return kind === 'ramp' || kind === 'loop' || kind === 'scoop' || kind === 'captive' || kind === 'lock';
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
    this.modeMsLeft = MODE_MS;
    this.renderer.pushToast('CITY TOUR MODE', COLOR.INSERT_CYAN, 1400);
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
    this.modeMsLeft = 0;
    // Two-ball brawl: serve a second ball.
    this.playfield.serveBall(true);
    this.renderer.pushToast('CAPONE SHOWDOWN!', COLOR.INSERT_RED, 2000);
    this.renderer.triggerJackpotFlash();
    this.renderer.kick(4);
    this.sound.bossStart();
  }

  private bossDefeat() {
    this.bossActive = false;
    this.spelledChicago = false;
    this.hadMultiball = false;
    this.score += POINTS.BOSS_DEFEAT;
    this.ballSaveMs = 10000; // victory lap
    this.renderer.pushToast('CAPONE DEFEATED!', COLOR.NEON_AMBER, 2200);
    this.renderer.pushToast(`+${POINTS.BOSS_DEFEAT.toLocaleString()}`, COLOR.NEON_AMBER, 2200);
    this.renderer.triggerJackpotFlash();
    this.renderer.kick(6);
    this.sound.bossDefeat();
  }

  private bossFail() {
    this.bossActive = false;
    this.spelledChicago = false;
    this.hadMultiball = false;
    this.renderer.pushToast('CAPONE GOT AWAY…', COLOR.TEXT_DIM, 1600);
    this.sound.bossFail();
  }

  private handleLockComplete() {
    if (this.playfield.bean.locked >= 3) {
      // Multiball start — the locked balls fan out from the Bean.
      this.multiballActive = true;
      const released = this.playfield.releaseLocks();
      this.renderer.pushToast(`MULTIBALL × ${released}`, COLOR.NEON_AMBER, 1600);
      this.renderer.triggerJackpotFlash();
      this.sound.multiball();
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
    if (bonus > 0) {
      this.score += bonus;
      const xText = this.bonusX > 1 ? `  ×${this.bonusX}` : '';
      this.renderer.pushToast(`BONUS ${bonus.toLocaleString()}${xText}`, COLOR.NEON_AMBER, 1600);
      this.sound.bonusCount();
    }
    this.state = GameState.BALL_DRAINED;
    this.respawnTimer = bonus > 0 ? 1700 : 900;
    this.ballsRemaining--;
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

    const allowFlippers = this.state === GameState.PLAYING || this.state === GameState.READY;
    this.playfield.setFlippers(
      allowFlippers && this.input.isDown('leftFlipper'),
      allowFlippers && this.input.isDown('rightFlipper'),
    );
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

    if (this.modeMsLeft > 0) this.modeMsLeft = Math.max(0, this.modeMsLeft - dtMs);
    if (this.state === GameState.PLAYING && this.ballSaveMs > 0) {
      this.ballSaveMs = Math.max(0, this.ballSaveMs - dtMs);
    }
    if (this.bossActive && this.state === GameState.PLAYING) {
      this.bossMsLeft -= dtMs;
      if (this.bossMsLeft <= 0) this.bossFail();
    }

    if (this.state === GameState.BALL_DRAINED) {
      this.respawnTimer -= dtMs;
      if (this.respawnTimer <= 0) {
        if (this.ballsRemaining <= 0) {
          this.endGame();
        } else {
          this.startNextBall();
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
    this.modeMsLeft = 0;
    this.state = GameState.READY;
  }

  private endGame() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      saveHighScore(this.highScore);
      this.renderer.pushToast('NEW HIGH SCORE!', COLOR.NEON_AMBER, 2200);
    }
    this.sound.gameOver();
    this.state = GameState.GAME_OVER;
  }

  draw() {
    const hud: HudInfo = {
      state: this.state,
      score: this.score,
      ballsRemaining: this.ballsRemaining,
      plungerHolding: this.playfield.plunger.isHolding(),
      multiball: this.multiballActive,
      modeMsLeft: this.modeMsLeft,
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
    this.score = 0;
    this.ballsRemaining = STARTING_BALLS;
    this.modeMsLeft = 0;
    this.multiballActive = false;
    this.ballSaveMs = 0;
    this.bonusUnits = 0;
    this.bonusX = 1;
    this.comboCount = 0;
    this.lastComboAt = -1e9;
    this.bossLit = false;
    this.bossActive = false;
    this.bossHp = BOSS_HP;
    this.bossMsLeft = 0;
    this.spelledChicago = false;
    this.hadMultiball = false;
    this.rebuildWorld();
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
