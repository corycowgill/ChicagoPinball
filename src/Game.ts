import Matter from 'matter-js';
import { Physics } from './Physics';
import { Playfield } from './scene/Playfield';
import { Renderer } from './Renderer';
import { InputManager, VirtualKey } from './InputManager';
import { GameState, ScoreEvent } from './types';
import { STARTING_BALLS, COLOR, PLAYFIELD_W, MODE_MS, POINTS } from './constants';

export class Game {
  private physics!: Physics;
  /** Public for headless tests to read body angles. */
  playfield!: Playfield;
  private renderer = new Renderer();
  private input = new InputManager();

  private state: GameState = GameState.TITLE;
  private score = 0;
  private ballsRemaining = STARTING_BALLS;
  private respawnTimer = 0;

  // Mode + multiball
  private modeMsLeft = 0;
  private multiballActive = false;
  /** Counts shots completed during the current mode for combo bonuses. */
  private modeShots = 0;

  constructor(private ctx: CanvasRenderingContext2D, canvas?: HTMLElement) {
    this.rebuildWorld();
    if (canvas) {
      this.input.attachPointer(canvas, (x, y) => this.resolveTouchKey(x, y));
    }
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
    });
  }

  private handleScore(e: ScoreEvent) {
    if (this.state !== GameState.PLAYING) return;
    let pts = e.points;
    // Mode bonus: every major shot during a mode pays a flat bonus on top.
    if (this.modeMsLeft > 0 && this.isModeShot(e.kind)) {
      pts += POINTS.MODE_SHOT;
      this.modeShots++;
    }
    // Multiball jackpot: ramp / scoop hits during multiball pay big.
    if (this.multiballActive && this.isJackpotShot(e.kind)) {
      pts += POINTS.MULTIBALL_JACKPOT;
      this.renderer.pushToast('JACKPOT +' + POINTS.MULTIBALL_JACKPOT.toLocaleString(), COLOR.NEON_AMBER, 900);
    }
    this.score += pts;

    switch (e.kind) {
      case 'super-jackpot':
        this.renderer.pushToast('SUPER JACKPOT!', COLOR.NEON_AMBER, 1800);
        this.renderer.triggerJackpotFlash();
        break;
      case 'skill-shot':
        this.renderer.pushToast(`SKILL SHOT +${e.points.toLocaleString()}`, COLOR.NEON_AMBER, 1200);
        break;
      case 'ramp':
        this.renderer.pushToast('RAMP +' + e.points.toLocaleString(), COLOR.INSERT_BLUE, 700);
        break;
      case 'scoop':
        this.renderer.pushToast('CITY TOUR MODE', COLOR.INSERT_AMBER, 1100);
        break;
      case 'lake-bonus':
        this.renderer.pushToast('LAKE BONUS', COLOR.RIVER_HI, 900);
        break;
      case 'lock':
        this.renderer.pushToast('BALL LOCKED', COLOR.INSERT_RED, 900);
        break;
      case 'captive':
        this.renderer.pushToast('CAPTIVE +' + e.points.toLocaleString(), COLOR.NEON_GREEN, 600);
        break;
      case 'drop-target':
        if (e.letter) this.renderer.pushToast(e.letter, COLOR.NEON_CYAN, 600);
        break;
      case 'bean':
        this.renderer.pushToast('THE BEAN', '#9fc4ff', 600);
        break;
      default:
        break;
    }
  }

  private isModeShot(kind: ScoreEvent['kind']) {
    return kind === 'ramp' || kind === 'scoop' || kind === 'captive' || kind === 'lock';
  }

  private isJackpotShot(kind: ScoreEvent['kind']) {
    return kind === 'ramp' || kind === 'scoop';
  }

  private startMode() {
    this.modeMsLeft = MODE_MS;
    this.modeShots = 0;
    this.renderer.pushToast('CITY TOUR MODE', COLOR.INSERT_CYAN, 1400);
  }

  private handleLockComplete() {
    if (this.playfield.bean.locked >= 3) {
      // Multiball start — the locked balls fan out from the Bean.
      this.multiballActive = true;
      const released = this.playfield.releaseLocks();
      this.renderer.pushToast(`MULTIBALL × ${released}`, COLOR.NEON_AMBER, 1600);
      this.renderer.triggerJackpotFlash();
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

    // Last ball gone — ball over.
    this.multiballActive = false;
    this.state = GameState.BALL_DRAINED;
    this.respawnTimer = 800;
    this.ballsRemaining--;
  }

  update(dtMs: number) {
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

    if (this.state === GameState.READY || this.state === GameState.PLAYING) {
      if (this.input.wasPressed('plunger')) this.playfield.plunger.hold();
      if (this.input.wasReleased('plunger')) {
        const pull = this.playfield.plunger.release();
        this.playfield.applyPlungerLaunch(pull);
      }
    }

    this.physics.step(dtMs);

    // READY → PLAYING only once the ball actually leaves the shooter lane
    // (a weak plunge rolls back and the player just plunges again).
    if (
      this.state === GameState.READY &&
      this.playfield.balls.some((b) => !this.playfield.isBallInLaunchLane(b.body))
    ) {
      this.state = GameState.PLAYING;
    }
    this.playfield.tick(dtMs);
    this.renderer.tick(dtMs);

    if (this.modeMsLeft > 0) this.modeMsLeft = Math.max(0, this.modeMsLeft - dtMs);

    if (this.state === GameState.BALL_DRAINED) {
      this.respawnTimer -= dtMs;
      if (this.respawnTimer <= 0) {
        if (this.ballsRemaining <= 0) {
          this.state = GameState.GAME_OVER;
        } else {
          this.playfield.resetBall();
          this.state = GameState.READY;
        }
      }
    }

    this.input.endFrame();
  }

  draw() {
    this.renderer.draw(
      this.ctx,
      this.playfield,
      this.state,
      this.score,
      this.ballsRemaining,
      this.playfield.plunger.isHolding(),
      this.multiballActive,
      this.modeMsLeft,
    );
  }

  private startGame() {
    this.score = 0;
    this.ballsRemaining = STARTING_BALLS;
    this.modeMsLeft = 0;
    this.multiballActive = false;
    this.modeShots = 0;
    this.rebuildWorld();
    this.state = GameState.READY;
  }
}
