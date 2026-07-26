import Matter from 'matter-js';
import { Physics } from './Physics';
import { Playfield } from './scene/Playfield';
import { HudInfo } from './Renderer';
import { InputManager, VirtualKey } from './InputManager';
import { Sound } from './Sound';
import { GameState, ScoreEvent, SPORTS, SportId } from './types';
import {
  STARTING_BALLS,
  COLOR,
  PLAYFIELD_W,
  POINTS,
  BALL_SAVE_MS,
  BONUS_UNIT,
  MAX_BONUS_X,
  COMBO_WINDOW_MS,
  CAPTIVE_SPOT_MS,
  RAMP_BOOST_MS,
  RAMP_BOOST_MULT,
  COMBO_MASTER_CHAIN,
  COMBO_MASTER_AWARD,
  BOSS_HP,
  BOSS_MS,
  MB_JACKPOT_BASE,
  MB_JACKPOT_STEP,
  MB_JACKPOTS_FOR_SUPER,
  MB_SUPER_MULT,
  SUPER_SKILL_MS,
  CHICAGO_SUPER_STEP,
  STATUS_HOLD_MS,
  SPORT_MODE_MS,
  CROSSTOWN_MS,
  TRAIN_PERIOD_MS,
  TRAIN_LAP_MS,
  EXPRESS_FARE_HITS,
  HURRYUP_START,
  HURRYUP_FLOOR,
  HURRYUP_DECAY_PER_S,
  TILT_LIMIT,
  TILT_DECAY_PER_S,
  REPLAY_SCORE,
  MAX_PLAYERS,
} from './constants';

const HIGH_SCORE_KEY = 'chicago-pinball-high-score';
const INITIALS_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Per-player game state (alternating play, Stern-style). */
interface PlayerState {
  score: number;
  extraBalls: number;
  spelledChicago: boolean;
  hadMultiball: boolean;
  bossLit: boolean;
  replayAwarded: boolean;
  /** One flag per entry in SPORTS — the Crosstown ladder. */
  sportsDone: boolean[];
  crosstownDone: boolean;
  /** Bonus X carried into this player's next ball (0 = none). */
  heldBonusX: number;
  /** How many times this player has spelled CHICAGO (escalates the super). */
  chicagoCompletions: number;
  /** Longest combo chain this player has strung together this game. */
  bestCombo: number;
}

function newPlayer(): PlayerState {
  return {
    score: 0,
    extraBalls: 0,
    spelledChicago: false,
    hadMultiball: false,
    bossLit: false,
    replayAwarded: false,
    sportsDone: SPORTS.map(() => false),
    crosstownDone: false,
    heldBonusX: 0,
    chicagoCompletions: 0,
    bestCombo: 0,
  };
}

/** What the Game needs from a renderer (implemented by Renderer3D). */
export interface GameRenderer {
  pushToast(text: string, color?: string, ttl?: number): void;
  triggerJackpotFlash(): void;
  kick(amp: number): void;
  /** Attraction feedback: goal lights, bat swings, net flashes. */
  sportEvent(sportIdx: number, type: 'start' | 'hit' | 'complete'): void;
  tick(dtMs: number): void;
  draw(pf: Playfield, hud: HudInfo): void;
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
  inlane: 1,
};

/** Damage each scoring event deals to the rival during the SHOWDOWN. */
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
  private highScore = loadHighScore().score;
  private highScoreInitials = loadHighScore().initials;
  // Arcade initials entry at game over (new high score only).
  private enteringInitials = false;
  private initialsChars = [0, 0, 0];
  private initialsPos = 0;

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

  // Sports modes + Crosstown Championship + multiball
  /** Index into SPORTS, or -1 when no sport mode is running. */
  private activeSport = -1;
  private sportHits = 0;
  private sportMsLeft = 0;
  private crosstownActive = false;
  /** Sport indices still to be shot during the Crosstown Championship. */
  private crosstownLeft: number[] = [];
  private crosstownMsLeft = 0;
  private multiballActive = false;
  // Lake Shore Multiball jackpot cycle.
  private mbJackpotValue = MB_JACKPOT_BASE;
  private mbJackpots = 0;
  private mbSuperLit = false;
  // Super skill shot: Bean pays big for a beat after the skill shot.
  private superSkillMs = 0;
  // City Lights: complete both standup team pairs in one ball.
  private pairCubsBears = false;
  private pairBullsSox = false;
  private cityLightsAwarded = false;
  // The L runs a lap past the skyline on a fixed schedule.
  private lastTrainCycle = -1;

  // Nudge / tilt
  private tiltHeat = 0;
  private tilted = false;

  // Kickback (left outlane) + Mystery (LAKE scoop)
  private kickbackLit = false;
  private mysteryLit = true;
  // EL EXPRESS (right outlane): pop bumpers pay the fare.
  private expressLit = false;
  private elFare = 0;
  // Hurry-up finale: >0 while the last shot of a sport mode is pending.
  private hurryUpValue = 0;
  // Inlane → lit ramp: ms left on each ramp's doubled value.
  private rampBoostL = 0;
  private rampBoostR = 0;
  /** Last time a captive strike spotted a CHICAGO letter. */
  private lastCaptiveSpotAt = -1e9;

  // Status report: both flippers held opens the progress panel.
  private statusHoldMs = 0;
  private statusOpen = false;

  /** Paused (P / Esc) — the whole machine freezes, including every timer. */
  private paused = false;
  /** COMBO MASTER already paid for the current chain. */
  private comboMasterPaid = false;

  // End-of-ball bonus ceremony (DMD count-up while BALL_DRAINED).
  private ceremonyTotal = 0;
  private ceremonyDuration = 0;
  private ceremonyTickAccum = 0;

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

  constructor(private renderer: GameRenderer, canvas?: HTMLElement) {
    this.rebuildWorld();
    if (canvas) {
      this.input.attachPointer(canvas, (x, y) => this.resolveTouchKey(x, y));
    }
    // Browsers gate audio behind a user gesture; resume on any interaction.
    window.addEventListener('pointerdown', () => this.sound.unlock());
    window.addEventListener('keydown', () => this.sound.unlock());
  }

  private resolveTouchKey(x: number, y: number): VirtualKey | null {
    // While paused: the panel's lower band resumes, the sides are the
    // volume control. Without this there was NO touch path out of pause.
    if (this.paused) {
      if (y > 560 && y < 640 && x > 60 && x < PLAYFIELD_W - 60) return 'pause';
      return x < PLAYFIELD_W / 2 ? 'leftFlipper' : 'rightFlipper';
    }
    // Pause button — top-left corner, over the backbox where no shot
    // lives, so it can't be hit by a stray flipper tap.
    if (
      x < 64 &&
      y < 170 &&
      (this.state === GameState.PLAYING ||
        this.state === GameState.READY ||
        this.state === GameState.BALL_DRAINED)
    ) {
      return 'pause';
    }
    if (this.state === GameState.GAME_OVER && this.enteringInitials) {
      // Letter entry: side thirds cycle, middle locks the letter in.
      if (x < PLAYFIELD_W / 3) return 'leftFlipper';
      if (x > (2 * PLAYFIELD_W) / 3) return 'rightFlipper';
      return 'enter';
    }
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
      onRightOutlane: (ball) => this.handleRightOutlane(ball),
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

  private handleRightOutlane(ball: Matter.Body) {
    if (this.state !== GameState.PLAYING || this.tilted || !this.expressLit) return;
    this.expressLit = false; // one ride per fare
    this.playfield.fireExpress(ball);
    this.renderer.pushToast('EL EXPRESS — BACK TO THE LANE', COLOR.NEON_CYAN, 1500);
    this.renderer.kick(2);
    this.sound.trainPass();
    this.sound.speak('All aboard!');
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
        if (!this.expressLit) {
          this.expressLit = true;
          this.renderer.pushToast('MYSTERY: EL EXPRESS LIT', COLOR.NEON_CYAN, 1500);
        } else {
          this.score += 15000;
          this.renderer.pushToast('MYSTERY: 15,000', COLOR.NEON_AMBER, 1500);
        }
      },
      () => {
        if (this.activeSport >= 0) {
          // Spot one shot of the running sport mode.
          const sport = SPORTS[this.activeSport];
          this.handleScore({ kind: sport.kind, points: 0, letter: sport.letter });
          this.renderer.pushToast('MYSTERY: SHOT SPOTTED', COLOR.INSERT_CYAN, 1500);
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
    if (this.bonusX >= MAX_BONUS_X) {
      // Already maxed: completing the lanes again HOLDS the multiplier
      // for this player's next ball — lane-change stays worth playing.
      if (this.cur.heldBonusX < MAX_BONUS_X) {
        this.cur.heldBonusX = this.bonusX;
        this.renderer.pushToast(`BONUS ×${this.bonusX} HELD`, COLOR.NEON_AMBER, 1600);
        this.sound.lock();
        this.sound.speak('Bonus held!');
      }
      return;
    }
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
        const chain = this.comboCount + 1;
        const comboPts = this.comboCount * POINTS.COMBO;
        pts += comboPts;
        if (chain > this.cur.bestCombo) this.cur.bestCombo = chain;
        this.renderer.pushToast(`COMBO ×${chain} +${comboPts.toLocaleString()}`, COLOR.NEON_PINK, 900);
        this.sound.combo(this.comboCount);
        if (chain === 4) this.sound.speak('Combo!', true);
        // Stringing a long chain is the hardest thing on the board — pay it.
        if (chain >= COMBO_MASTER_CHAIN && !this.comboMasterPaid) {
          this.comboMasterPaid = true;
          pts += COMBO_MASTER_AWARD;
          this.renderer.pushToast(
            `COMBO MASTER +${COMBO_MASTER_AWARD.toLocaleString()}`,
            COLOR.NEON_AMBER,
            2000,
          );
          this.renderer.triggerJackpotFlash();
          this.renderer.kick(5);
          this.sound.jackpot();
          this.sound.crowd(1400, 0.24);
          this.sound.speak('Combo master!', true);
        }
      } else {
        this.comboCount = 0;
        this.comboMasterPaid = false;
      }
      this.lastComboAt = this.timeMs;
    }

    // A lit ramp (fed by the opposite inlane) pays double.
    if (e.kind === 'ramp') {
      const boost = e.letter === 'L' ? this.rampBoostL : this.rampBoostR;
      if (boost > 0) {
        if (e.letter === 'L') this.rampBoostL = 0;
        else this.rampBoostR = 0;
        const extra = e.points * (RAMP_BOOST_MULT - 1);
        pts += extra;
        this.renderer.pushToast(`LIT RAMP ×${RAMP_BOOST_MULT}`, COLOR.NEON_GREEN, 1100);
        this.sound.combo(3);
      }
    }

    // Sports: this shot may advance the Crosstown Championship, advance the
    // running sport mode, or start a fresh one.
    const sportIdx = SPORTS.findIndex(
      (s) => s.kind === e.kind && (!s.letter || s.letter === e.letter),
    );
    if (sportIdx >= 0) pts += this.handleSportShot(sportIdx, e.kind);
    // Lake Shore Multiball: escalating jackpots at the ramps / orbits /
    // scoop; every few light the SUPER at the Bean.
    if (this.multiballActive && this.isJackpotShot(e.kind)) {
      pts += this.mbJackpotValue;
      this.mbJackpots++;
      this.renderer.pushToast(
        `JACKPOT +${this.mbJackpotValue.toLocaleString()}`,
        COLOR.NEON_AMBER,
        900,
      );
      this.sound.jackpot();
      if (!this.mbSuperLit && this.mbJackpots >= MB_JACKPOTS_FOR_SUPER) {
        this.mbSuperLit = true;
        this.renderer.pushToast('SUPER JACKPOT AT THE BEAN', COLOR.INSERT_RED, 1600);
        this.sound.lock();
        this.sound.speak('Super jackpot at the Bean!', true);
      }
    }
    if (this.multiballActive && this.mbSuperLit && e.kind === 'bean') {
      const superV = this.mbJackpotValue * MB_SUPER_MULT;
      pts += superV;
      this.mbSuperLit = false;
      this.mbJackpots = 0;
      this.mbJackpotValue += MB_JACKPOT_STEP;
      this.renderer.pushToast(`SUPER JACKPOT +${superV.toLocaleString()}`, COLOR.NEON_AMBER, 1800);
      this.renderer.triggerJackpotFlash();
      this.renderer.kick(5);
      this.sound.jackpot();
      this.sound.crowd(1200, 0.22);
      this.sound.speak('Super jackpot!', true);
    }
    // Super skill shot: the Bean pays big right after the skill shot.
    if (this.superSkillMs > 0 && e.kind === 'bean') {
      this.superSkillMs = 0;
      pts += POINTS.SUPER_SKILL;
      this.renderer.pushToast(`SUPER SKILL +${POINTS.SUPER_SKILL.toLocaleString()}`, COLOR.NEON_AMBER, 1500);
      this.renderer.triggerJackpotFlash();
      this.sound.jackpot();
      this.sound.speak('Super skill shot!', true);
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
      case 'super-jackpot': {
        // Every re-spell of CHICAGO pays more than the last.
        this.cur.chicagoCompletions++;
        const n = this.cur.chicagoCompletions;
        const extra = (n - 1) * CHICAGO_SUPER_STEP;
        if (extra > 0) this.score += extra;
        this.renderer.pushToast(
          n > 1
            ? `CHICAGO ×${n} SUPER +${(POINTS.SUPER_JACKPOT + extra).toLocaleString()}`
            : 'SUPER JACKPOT!',
          COLOR.NEON_AMBER,
          1800,
        );
        this.renderer.triggerJackpotFlash();
        this.renderer.kick(5);
        this.sound.jackpot();
        this.sound.crowd(1200, 0.2);
        this.spelledChicago = true;
        break;
      }
      case 'skill-shot':
        this.renderer.pushToast(`SKILL SHOT +${e.points.toLocaleString()}`, COLOR.NEON_AMBER, 1200);
        this.renderer.pushToast('SUPER SKILL AT THE BEAN', COLOR.TEXT_DIM, 1200);
        this.superSkillMs = SUPER_SKILL_MS;
        this.sound.rollover();
        break;
      case 'lane':
        this.sound.rollover();
        break;
      case 'inlane': {
        // The return feeds a flipper — light the ramp THAT flipper shoots:
        // left inlane → left flipper → right ramp, and vice versa.
        this.sound.rollover();
        const ramp = e.letter === 'L' ? 'R' : 'L';
        if (ramp === 'L') this.rampBoostL = RAMP_BOOST_MS;
        else this.rampBoostR = RAMP_BOOST_MS;
        this.renderer.pushToast(
          `${ramp === 'L' ? 'LEFT' : 'RIGHT'} RAMP LIT ×${RAMP_BOOST_MULT}`,
          COLOR.NEON_GREEN,
          1100,
        );
        break;
      }
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
      case 'captive': {
        this.renderer.pushToast('CAPTIVE +' + e.points.toLocaleString(), COLOR.NEON_GREEN, 600);
        this.sound.captive();
        // A solid strike SPOTS the next CHICAGO letter. The drop banks
        // alone get hit about once a ball, so the headline shot on the
        // playfield art was unreachable inside a three-ball game.
        if (this.timeMs - this.lastCaptiveSpotAt >= CAPTIVE_SPOT_MS) {
          const spot = this.playfield.bank.spotLetter();
          if (spot) {
            this.lastCaptiveSpotAt = this.timeMs;
            this.renderer.pushToast(`SPOTTED  ${spot.letter}`, COLOR.NEON_CYAN, 1200);
            this.sound.dropTarget();
            if (spot.completed) {
              // Same reward path as knocking the last target down.
              this.handleScore({ kind: 'super-jackpot', points: POINTS.SUPER_JACKPOT });
            }
          }
        }
        break;
      }
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
        // Pop bumpers pay the EL fare; a full fare lights the Express.
        if (!this.expressLit) {
          this.elFare++;
          if (this.elFare >= EXPRESS_FARE_HITS) {
            this.elFare = 0;
            this.expressLit = true;
            this.renderer.pushToast('EL EXPRESS LIT — RIGHT OUTLANE', COLOR.NEON_CYAN, 1600);
            this.sound.rollover();
            this.sound.speak('Express is lit!');
          }
        }
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
          this.pairCubsBears = true;
          this.renderer.pushToast('KICKBACK LIT', COLOR.NEON_GREEN, 1300);
          this.sound.rollover();
        }
        if (litOf('bulls') && litOf('sox') && !this.mysteryLit) {
          unlight(['bulls', 'sox']);
          this.mysteryLit = true;
          this.pairBullsSox = true;
          this.renderer.pushToast('MYSTERY LIT AT THE LAKE', COLOR.RIVER_HI, 1300);
          this.sound.rollover();
        }
        // City Lights: both team pairs completed on the same ball lights
        // every star on the board for a bonus.
        if (this.pairCubsBears && this.pairBullsSox && !this.cityLightsAwarded) {
          this.cityLightsAwarded = true;
          this.score += POINTS.CITY_LIGHTS;
          this.advanceBonusX();
          this.renderer.pushToast(
            `CITY LIGHTS! +${POINTS.CITY_LIGHTS.toLocaleString()}`,
            COLOR.INSERT_CYAN,
            2000,
          );
          this.renderer.triggerJackpotFlash();
          this.sound.jackpot();
          this.sound.speak('City lights!', true);
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

  private get crosstownReady(): boolean {
    return (
      this.cur.sportsDone.every(Boolean) && !this.cur.crosstownDone && !this.crosstownActive
    );
  }

  /** One shot at a sport attraction. Returns bonus points earned. */
  private handleSportShot(sportIdx: number, kind: ScoreEvent['kind']): number {
    const sport = SPORTS[sportIdx];

    // Crosstown Championship: collect each sport's shot once.
    if (this.crosstownActive) {
      const at = this.crosstownLeft.indexOf(sportIdx);
      if (at < 0) return 0;
      this.crosstownLeft.splice(at, 1);
      this.renderer.sportEvent(sportIdx, 'hit');
      this.sportStinger(sport.id);
      if (this.crosstownLeft.length === 0) {
        this.crosstownWin();
      } else {
        this.renderer.pushToast(
          `✓ ${sport.sport} — ${this.crosstownLeft.length} TO GO`,
          COLOR.INSERT_CYAN,
          1300,
        );
      }
      return POINTS.CROSSTOWN_SHOT;
    }

    // Advance the running sport mode.
    if (this.activeSport === sportIdx) {
      this.sportHits++;
      this.sportMsLeft = SPORT_MODE_MS;
      this.renderer.sportEvent(sportIdx, 'hit');
      const pts = POINTS.SPORT_SHOT * this.sportHits;
      if (this.sportHits >= sport.goal) {
        // Bank the hurry-up on the finishing shot.
        const hurry = Math.round(this.hurryUpValue);
        this.hurryUpValue = 0;
        if (hurry > 0) {
          this.renderer.pushToast(`HURRY-UP +${hurry.toLocaleString()}`, COLOR.NEON_AMBER, 1500);
        }
        this.completeSport(sportIdx);
        return pts + hurry + POINTS.SPORT_COMPLETE;
      }
      this.sportStinger(sport.id);
      if (this.sportHits === sport.goal - 1) this.startHurryUp(sportIdx);
      else {
        this.renderer.pushToast(
          `${sport.mode} ${this.sportHits}/${sport.goal} +${pts.toLocaleString()}`,
          COLOR.NEON_AMBER,
          1200,
        );
      }
      return pts;
    }

    // Start a fresh mode — but the scoop defers to a lit wizard mode.
    if (
      this.activeSport < 0 &&
      !this.bossActive &&
      !this.cur.sportsDone[sportIdx] &&
      !(kind === 'scoop' && (this.bossLit || this.crosstownReady))
    ) {
      this.activeSport = sportIdx;
      this.sportHits = 1;
      this.sportMsLeft = SPORT_MODE_MS;
      this.renderer.sportEvent(sportIdx, 'start');
      this.sportStinger(sport.id);
      this.sound.crowd(1000, 0.16);
      this.sound.speak(`${sport.mode.toLowerCase()}!`, true);
      this.renderer.pushToast(`${sport.mode}!`, COLOR.NEON_AMBER, 1600);
      this.syncMusic();
      if (this.sportHits === sport.goal - 1) {
        // Two-shot modes go straight to the finale.
        this.startHurryUp(sportIdx);
      } else {
        this.renderer.pushToast(
          `${sport.goal - 1} MORE: ${sport.shotName}`,
          COLOR.TEXT_DIM,
          1600,
        );
      }
      return POINTS.SPORT_SHOT;
    }
    return 0;
  }

  /** The last required shot becomes a countdown value — shoot it fast. */
  private startHurryUp(sportIdx: number) {
    const sport = SPORTS[sportIdx];
    this.hurryUpValue = HURRYUP_START;
    this.renderer.pushToast(
      `HURRY-UP ${HURRYUP_START.toLocaleString()} — ${sport.shotName}`,
      COLOR.NEON_AMBER,
      1600,
    );
    this.sound.combo(4);
    this.sound.speak('Hurry up!', true);
  }

  private completeSport(sportIdx: number) {
    const sport = SPORTS[sportIdx];
    this.activeSport = -1;
    this.cur.sportsDone[sportIdx] = true;
    this.syncMusic();
    this.renderer.sportEvent(sportIdx, 'complete');
    this.renderer.pushToast(`${sport.sport} COMPLETE!`, COLOR.NEON_AMBER, 2000);
    this.renderer.triggerJackpotFlash();
    this.renderer.kick(4);
    this.sound.sportComplete();
    this.sportStinger(sport.id);
    this.sound.speak(`${sport.sport.toLowerCase()} complete!`, true);
    if (this.crosstownReady) {
      this.renderer.pushToast('CROSSTOWN CHAMPIONSHIP LIT AT THE SCOOP', COLOR.INSERT_RED, 2200);
      this.sound.lock();
      this.sound.speak('Crosstown championship is lit!', true);
    }
  }

  /** One music arbiter: wizard/crosstown/multiball outrank the sport
   *  groove, which outranks the main Chicago shuffle. startMusic no-ops
   *  when the mode is unchanged, so this is safe to call at every
   *  transition. */
  private syncMusic() {
    if (this.bossActive || this.crosstownActive || this.multiballActive) {
      this.sound.startMusic('action');
    } else if (this.activeSport >= 0) {
      this.sound.startMusic(SPORTS[this.activeSport].id);
    } else {
      this.sound.startMusic('main');
    }
  }

  /** The per-sport signature sound. */
  private sportStinger(id: SportId) {
    switch (id) {
      case 'baseball':
        this.sound.organSting();
        break;
      case 'hockey':
        this.sound.goalHorn();
        break;
      case 'basketball':
        this.sound.buzzer();
        break;
      case 'football':
      case 'soccer':
        this.sound.whistle();
        break;
    }
  }

  /** Scoop routing: wizard fight > Crosstown start > (sport handled by the
   *  score event itself). */
  private startMode() {
    if (this.bossActive) return; // scoop hits during the fight just deal damage
    if (this.bossLit) {
      this.startBoss();
      return;
    }
    if (this.crosstownReady) this.startCrosstown();
  }

  private startCrosstown() {
    this.crosstownActive = true;
    this.activeSport = -1;
    // The starting scoop shot counts as soccer — four shots remain.
    this.crosstownLeft = SPORTS.map((_, i) => i).filter((i) => SPORTS[i].kind !== 'scoop');
    this.crosstownMsLeft = CROSSTOWN_MS;
    this.renderer.pushToast('CROSSTOWN CHAMPIONSHIP!', COLOR.INSERT_RED, 2200);
    this.renderer.pushToast('HIT EVERY SPORT SHOT', COLOR.TEXT_DIM, 2200);
    this.renderer.triggerJackpotFlash();
    this.renderer.kick(4);
    this.sound.multiball();
    this.sound.crowd(1600, 0.24);
    this.sound.speak('Crosstown championship! Hit every sport!', true);
    this.syncMusic();
  }

  private crosstownWin() {
    this.crosstownActive = false;
    this.cur.crosstownDone = true;
    this.bossLit = true;
    this.score += POINTS.CROSSTOWN_COMPLETE;
    this.cur.extraBalls++;
    this.renderer.pushToast('CROSSTOWN CHAMPION!', COLOR.NEON_AMBER, 2400);
    this.renderer.pushToast('WINDY CITY SHOWDOWN LIT AT THE SCOOP', COLOR.INSERT_RED, 2400);
    this.renderer.triggerJackpotFlash();
    this.renderer.kick(6);
    this.sound.knocker();
    this.sound.crowd(2000, 0.28);
    this.sound.speak('Crosstown champion! The showdown is lit!', true);
    this.syncMusic();
    this.checkReplay();
  }

  private crosstownFail() {
    this.crosstownActive = false;
    // All five sports stay complete, so the championship relights at the scoop.
    this.renderer.pushToast('CHAMPIONSHIP OVER — RELIT AT THE SCOOP', COLOR.TEXT_DIM, 1600);
    this.sound.bossFail();
    this.syncMusic();
  }

  private startBoss() {
    this.bossLit = false;
    this.bossActive = true;
    this.bossHp = BOSS_HP;
    this.bossMsLeft = BOSS_MS;
    this.activeSport = -1; // any running mode yields to the showdown
    this.crosstownActive = false;
    // Two-ball brawl: serve a second ball.
    this.playfield.serveBall(true);
    this.renderer.pushToast('WINDY CITY SHOWDOWN!', COLOR.INSERT_RED, 2000);
    this.renderer.pushToast('EVERY SHOT SCORES ON THE RIVAL', COLOR.TEXT_DIM, 2000);
    this.renderer.triggerJackpotFlash();
    this.renderer.kick(4);
    this.sound.bossStart();
    this.sound.crowd(1800, 0.26);
    this.sound.speak('Windy city showdown!', true);
    this.syncMusic();
  }

  private bossDefeat() {
    this.bossActive = false;
    // The whole ladder resets so the wizard chain can be climbed again.
    this.cur.sportsDone = SPORTS.map(() => false);
    this.cur.crosstownDone = false;
    this.score += POINTS.BOSS_DEFEAT;
    this.cur.extraBalls++;
    this.ballSaveMs = 10000; // victory lap
    this.renderer.pushToast('CITY CHAMPION!', COLOR.NEON_AMBER, 2200);
    this.renderer.pushToast('EXTRA BALL', COLOR.NEON_GREEN, 2200);
    this.renderer.triggerJackpotFlash();
    this.renderer.kick(6);
    this.sound.bossDefeat();
    this.sound.crowd(2400, 0.3);
    this.sound.speak('City champion! Extra ball!', true);
    this.syncMusic();
    this.checkReplay();
  }

  private bossFail() {
    this.bossActive = false;
    this.bossLit = true; // the title match relights at the scoop
    this.renderer.pushToast('THE TITLE SLIPS AWAY — RELIT AT THE SCOOP', COLOR.TEXT_DIM, 1600);
    this.sound.bossFail();
    this.sound.speak('So close…');
    this.syncMusic();
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
      this.mbJackpotValue = MB_JACKPOT_BASE;
      this.mbJackpots = 0;
      this.mbSuperLit = false;
      const released = this.playfield.releaseLocks();
      this.renderer.pushToast(`LAKE SHORE MULTIBALL × ${released}`, COLOR.NEON_AMBER, 1800);
      this.renderer.triggerJackpotFlash();
      this.renderer.kick(5); // the release burst rocks the cabinet
      this.sound.multiball();
      this.sound.speak('Lake Shore multiball!', true);
      this.syncMusic();
      this.hadMultiball = true;
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
        this.syncMusic();
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
    this.activeSport = -1;
    this.crosstownActive = false; // relights at the scoop — the ladder keeps
    this.sound.drain();
    this.renderer.kick(4);
    const bonus = this.bonusUnits * BONUS_UNIT * this.bonusX;
    this.ceremonyTotal = 0;
    if (this.tilted) {
      // Tilting forfeits the bonus — the classic price.
      this.renderer.pushToast('BONUS LOST — TILT', COLOR.INSERT_RED, 1500);
    } else if (bonus > 0) {
      // Score lands now; the DMD counts it up as a ceremony while the
      // machine gets the next ball ready (tick sounds in update()).
      this.score += bonus;
      this.ceremonyTotal = bonus;
      this.ceremonyDuration = 2200;
      this.ceremonyTickAccum = 0;
    }
    // Extra ball buys the same player another go at the same ball number.
    if (this.cur.extraBalls > 0) {
      this.cur.extraBalls--;
      this.shootAgain = true;
      this.renderer.pushToast('SHOOT AGAIN', COLOR.NEON_GREEN, 1600);
      this.sound.speak('Shoot again!');
    }
    this.state = GameState.BALL_DRAINED;
    this.respawnTimer = bonus > 0 && !this.tilted ? 2600 : 900;
  }

  update(dtMs: number) {
    // ── PAUSE (P / Esc) — only with a ball in play. Freezes physics and
    //    every timer; the flippers double as a volume control while held.
    const canPause =
      this.state === GameState.PLAYING ||
      this.state === GameState.READY ||
      this.state === GameState.BALL_DRAINED;
    if (this.input.wasPressed('pause') && canPause) {
      this.paused = !this.paused;
      if (this.paused) {
        this.sound.stopMusic();
        this.statusOpen = false;
        this.statusHoldMs = 0;
      } else {
        this.syncMusic();
      }
      this.sound.dropTarget();
    }
    if (this.paused) {
      if (this.input.wasPressed('leftFlipper')) this.announceVolume(this.sound.adjustVolume(-0.1));
      if (this.input.wasPressed('rightFlipper')) this.announceVolume(this.sound.adjustVolume(0.1));
      if (this.input.wasPressed('mute')) {
        const muted = this.sound.toggleMute();
        this.renderer.pushToast(muted ? 'SOUND OFF' : 'SOUND ON', COLOR.TEXT_DIM, 800);
      }
      this.input.endFrame();
      return;
    }

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
      if (this.enteringInitials) {
        this.tickInitialsEntry();
      } else if (this.input.wasPressed('enter')) {
        this.state = GameState.TITLE;
      }
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
    // Status report — hold BOTH flippers to see the full progress panel
    // (a real machine's instant info). Flippers keep working underneath.
    if (allowFlippers && this.input.isDown('leftFlipper') && this.input.isDown('rightFlipper')) {
      this.statusHoldMs += dtMs;
      if (!this.statusOpen && this.statusHoldMs >= STATUS_HOLD_MS) {
        this.statusOpen = true;
        this.sound.rollover();
      }
    } else {
      this.statusHoldMs = 0;
      this.statusOpen = false;
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

    if (this.activeSport >= 0 && this.state === GameState.PLAYING) {
      this.sportMsLeft -= dtMs;
      if (this.sportMsLeft <= 0) {
        this.renderer.pushToast(`${SPORTS[this.activeSport].mode} OVER`, COLOR.TEXT_DIM, 1200);
        this.activeSport = -1;
        this.syncMusic();
      }
      // Hurry-up finale counts down to its floor.
      if (this.hurryUpValue > HURRYUP_FLOOR) {
        this.hurryUpValue = Math.max(
          HURRYUP_FLOOR,
          this.hurryUpValue - (HURRYUP_DECAY_PER_S * dtMs) / 1000,
        );
      }
    }
    if (this.activeSport < 0) this.hurryUpValue = 0;
    if (this.crosstownActive && this.state === GameState.PLAYING) {
      this.crosstownMsLeft -= dtMs;
      if (this.crosstownMsLeft <= 0) this.crosstownFail();
    }
    // The L: one lap past the skyline every cycle, with its rattle.
    if (this.state === GameState.PLAYING || this.state === GameState.READY) {
      const cycle = Math.floor(this.timeMs / TRAIN_PERIOD_MS);
      if (cycle !== this.lastTrainCycle) {
        this.lastTrainCycle = cycle;
        this.sound.trainPass();
      }
    }
    if (this.state === GameState.PLAYING && this.ballSaveMs > 0) {
      this.ballSaveMs = Math.max(0, this.ballSaveMs - dtMs);
    }
    if (this.state === GameState.PLAYING && this.superSkillMs > 0) {
      this.superSkillMs = Math.max(0, this.superSkillMs - dtMs);
    }
    if (this.state === GameState.PLAYING) {
      if (this.rampBoostL > 0) this.rampBoostL = Math.max(0, this.rampBoostL - dtMs);
      if (this.rampBoostR > 0) this.rampBoostR = Math.max(0, this.rampBoostR - dtMs);
    }
    if (this.bossActive && this.state === GameState.PLAYING) {
      this.bossMsLeft -= dtMs;
      if (this.bossMsLeft <= 0) this.bossFail();
    }
    // Tilt heat cools off over time.
    if (this.tiltHeat > 0) this.tiltHeat = Math.max(0, this.tiltHeat - (TILT_DECAY_PER_S * dtMs) / 1000);

    if (this.state === GameState.BALL_DRAINED) {
      // Bonus count-up ticks while the ceremony runs.
      if (this.ceremonyTotal > 0) {
        const progress = 1 - Math.max(0, this.respawnTimer - 400) / this.ceremonyDuration;
        if (progress < 1) {
          this.ceremonyTickAccum += dtMs;
          while (this.ceremonyTickAccum > 140) {
            this.ceremonyTickAccum -= 140;
            this.sound.bonusCount();
          }
        }
      }
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

  /** Classic 3-letter entry: flippers cycle the letter, plunger/start
   *  locks it in. Runs inside GAME_OVER when a new high score was set. */
  private tickInitialsEntry() {
    const n = INITIALS_ALPHABET.length;
    if (this.input.wasPressed('leftFlipper')) {
      this.initialsChars[this.initialsPos] = (this.initialsChars[this.initialsPos] + n - 1) % n;
      this.sound.rollover();
    }
    if (this.input.wasPressed('rightFlipper')) {
      this.initialsChars[this.initialsPos] = (this.initialsChars[this.initialsPos] + 1) % n;
      this.sound.rollover();
    }
    if (this.input.wasPressed('enter') || this.input.wasPressed('plunger')) {
      this.initialsPos++;
      this.sound.dropTarget();
      if (this.initialsPos > 2) {
        this.enteringInitials = false;
        this.highScoreInitials = this.initialsChars
          .map((c) => INITIALS_ALPHABET[c])
          .join('');
        saveHighScore(this.highScore, this.highScoreInitials);
        this.renderer.pushToast(`${this.highScoreInitials} — TOP OF THE CITY`, COLOR.NEON_AMBER, 2200);
        this.sound.knocker();
        this.sound.speak(`Nice one, ${this.highScoreInitials.split('').join(' ')}!`, true);
      }
    }
  }

  private announceVolume(v: number) {
    this.renderer.pushToast(`VOLUME ${Math.round(v * 100)}%`, COLOR.NEON_CYAN, 900);
    if (v > 0) this.sound.rollover();
  }

  private startNextBall() {
    this.playfield.resetBall();
    this.bonusUnits = 0;
    // A held multiplier carries into this player's ball, once.
    this.bonusX = this.cur.heldBonusX > 0 ? this.cur.heldBonusX : 1;
    if (this.cur.heldBonusX > 0) {
      this.renderer.pushToast(`BONUS ×${this.bonusX} CARRIED`, COLOR.NEON_AMBER, 1500);
      this.cur.heldBonusX = 0;
    }
    this.comboCount = 0;
    this.comboMasterPaid = false;
    this.lastComboAt = -1e9;
    this.activeSport = -1;
    this.crosstownActive = false;
    this.pairCubsBears = false;
    this.pairBullsSox = false;
    this.cityLightsAwarded = false;
    this.hurryUpValue = 0;
    this.rampBoostL = 0;
    this.rampBoostR = 0;
    this.lastCaptiveSpotAt = -1e9;
    this.expressLit = false;
    this.elFare = 0;
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
      // Saved once the initials are locked in.
      this.enteringInitials = true;
      this.initialsChars = [0, 0, 0];
      this.initialsPos = 0;
      this.renderer.pushToast('NEW HIGH SCORE — ENTER YOUR INITIALS', COLOR.NEON_AMBER, 2600);
      this.sound.speak('New high score! Enter your initials.', true);
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
      activeSport: this.activeSport,
      modeName: this.crosstownActive
        ? 'CROSSTOWN CHAMPIONSHIP'
        : this.activeSport >= 0
          ? SPORTS[this.activeSport].mode
          : null,
      modeKind: this.activeSport >= 0 ? SPORTS[this.activeSport].kind : null,
      modeLetter: this.activeSport >= 0 ? (SPORTS[this.activeSport].letter ?? null) : null,
      modeMsLeft: this.crosstownActive ? this.crosstownMsLeft : this.sportMsLeft,
      modeHits: this.sportHits,
      modeGoal: this.activeSport >= 0 ? SPORTS[this.activeSport].goal : 0,
      sportsDone: [...this.cur.sportsDone],
      crosstownActive: this.crosstownActive,
      crosstownLeft: [...this.crosstownLeft],
      trainPhase:
        this.timeMs % TRAIN_PERIOD_MS < TRAIN_LAP_MS
          ? (this.timeMs % TRAIN_PERIOD_MS) / TRAIN_LAP_MS
          : -1,
      tiltHeat: this.tiltHeat,
      tilted: this.tilted,
      kickbackLit: this.kickbackLit,
      mysteryLit: this.mysteryLit,
      expressLit: this.expressLit,
      statusOpen: this.statusOpen,
      paused: this.paused,
      volume: this.sound.volume,
      muted: this.sound.muted,
      bestCombo: this.cur.bestCombo,
      comboChain: this.timeMs - this.lastComboAt < COMBO_WINDOW_MS ? this.comboCount + 1 : 0,
      heldBonusX: this.cur.heldBonusX,
      elFare: this.elFare,
      elFareNeeded: EXPRESS_FARE_HITS,
      chicagoCompletions: this.cur.chicagoCompletions,
      crosstownDone: this.cur.crosstownDone,
      hurryUpValue: Math.round(this.hurryUpValue),
      comboActive: this.timeMs - this.lastComboAt < COMBO_WINDOW_MS,
      bonusX: this.bonusX,
      ballSaveMs: this.ballSaveMs,
      superSkillMs: this.superSkillMs,
      rampBoostL: this.rampBoostL,
      rampBoostR: this.rampBoostR,
      mbSuperLit: this.mbSuperLit,
      mbJackpotValue: this.mbJackpotValue,
      ceremonyTotal: this.state === GameState.BALL_DRAINED ? this.ceremonyTotal : 0,
      ceremonyProgress:
        this.state === GameState.BALL_DRAINED && this.ceremonyTotal > 0
          ? Math.min(1, 1 - Math.max(0, this.respawnTimer - 400) / this.ceremonyDuration)
          : 0,
      highScore: this.highScore,
      highScoreInitials: this.highScoreInitials,
      enteringInitials: this.enteringInitials,
      initials: this.initialsChars.map((c) => INITIALS_ALPHABET[c]).join(''),
      initialsPos: this.initialsPos,
      bossLit: this.bossLit,
      bossActive: this.bossActive,
      bossHp: this.bossHp,
      bossMsLeft: this.bossMsLeft,
    };
    this.renderer.draw(this.playfield, hud);
  }

  private startGame() {
    this.players = [newPlayer()];
    this.current = 0;
    this.ballNumber = 1;
    this.shootAgain = false;
    this.matchNumber = 0;
    this.matched = false;
    this.activeSport = -1;
    this.crosstownActive = false;
    this.crosstownLeft = [];
    this.pairCubsBears = false;
    this.pairBullsSox = false;
    this.cityLightsAwarded = false;
    this.hurryUpValue = 0;
    this.expressLit = false;
    this.elFare = 0;
    this.lastTrainCycle = -1;
    this.tiltHeat = 0;
    this.tilted = false;
    this.kickbackLit = false;
    this.mysteryLit = true;
    this.multiballActive = false;
    this.ballSaveMs = 0;
    this.bonusUnits = 0;
    this.bonusX = 1;
    this.comboCount = 0;
    this.comboMasterPaid = false;
    this.lastComboAt = -1e9;
    this.paused = false;
    this.bossActive = false;
    this.bossHp = BOSS_HP;
    this.bossMsLeft = 0;
    this.rebuildWorld();
    this.sound.startMusic('main');
    this.state = GameState.READY;
  }
}

function loadHighScore(): { score: number; initials: string } {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    if (!raw) return { score: 0, initials: '' };
    // Older versions stored a bare number.
    if (/^\d+$/.test(raw)) return { score: Number(raw) || 0, initials: '' };
    const parsed = JSON.parse(raw) as { score?: number; initials?: string };
    return { score: parsed.score ?? 0, initials: parsed.initials ?? '' };
  } catch {
    return { score: 0, initials: '' };
  }
}

function saveHighScore(score: number, initials: string) {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify({ score, initials }));
  } catch {
    /* private mode etc. — high score just isn't persisted */
  }
}
