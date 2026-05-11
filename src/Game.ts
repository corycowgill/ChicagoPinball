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

  private resolveTouchKey(x: number, _y: number): VirtualKey | null {
    if (this.state === GameState.TITLE || this.state === GameState.GAME_OVER) return 'enter';
    if (this.state === GameState.READY) return 'plunger';
    if (this.state === GameState.BALL_DRAINED) return null;
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
    // Mode bonus: every shot during a mode pays a flat bonus on top.
    if (this.modeMsLeft > 0 && this.isModeShot(e.kind)) {
      pts += POINTS.MODE_SHOT;
      this.modeShots++;
    }
    // Multiball jackpot: ramp / orbit / scoop hits during multiball pay big.
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
      case 'left-orbit':
        this.renderer.pushToast('LEFT ORBIT', COLOR.INSERT_CYAN, 700);
        break;
      case 'right-orbit':
        this.renderer.pushToast('RIGHT ORBIT', COLOR.INSERT_BLUE, 700);
        break;
      case 'center-ramp':
        this.renderer.pushToast('CENTER RAMP', COLOR.INSERT_BLUE, 700);
        break;
      case 'scoop':
        this.renderer.pushToast('MODE START', COLOR.INSERT_AMBER, 1100);
        break;
      case 'lock':
        this.renderer.pushToast('BALL LOCKED', COLOR.INSERT_RED, 900);
        break;
      case 'captive':
        this.renderer.pushToast('CAPTIVE BALL', COLOR.NEON_GREEN, 600);
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
    return (
      kind === 'left-orbit' ||
      kind === 'right-orbit' ||
      kind === 'center-ramp' ||
      kind === 'scoop' ||
      kind === 'captive' ||
      kind === 'lock'
    );
  }

  private isJackpotShot(kind: ScoreEvent['kind']) {
    return (
      kind === 'left-orbit' || kind === 'right-orbit' || kind === 'center-ramp' || kind === 'scoop'
    );
  }

  private startMode() {
    this.modeMsLeft = MODE_MS;
    this.modeShots = 0;
    this.renderer.pushToast('CITY TOUR MODE', COLOR.INSERT_CYAN, 1400);
  }

  private handleLockComplete() {
    if (this.playfield.bean.locked >= 3) {
      // Multiball start — release all locked balls back into play.
      this.multiballActive = true;
      const released = this.playfield.releaseLocks();
      this.renderer.pushToast(`MULTIBALL × ${released + 1}`, COLOR.NEON_AMBER, 1600);
      this.renderer.triggerJackpotFlash();
    } else {
      // Lock progress feedback + serve a fresh ball.
      this.renderer.pushToast(`LOCK ${this.playfield.bean.locked} / 3`, COLOR.INSERT_RED, 900);
      this.playfield.serveBall();
    }
  }

  private handleDrain(ball: Matter.Body) {
    if (this.state !== GameState.PLAYING) return;
    // Remove the drained ball.
    this.playfield.removeBall(ball);

    // If multiball: when only 1 ball remains, multiball ends — but the
    // remaining ball stays in play.
    if (this.multiballActive) {
      // Use a deferred check after removal completes.
      setTimeout(() => {
        if (this.playfield.balls.length <= 1) {
          this.multiballActive = false;
          this.renderer.pushToast('MULTIBALL OVER', COLOR.TEXT_DIM, 900);
        }
      }, 30);
      return;
    }

    // Normal drain: lose a ball, trigger BALL_DRAINED state.
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
        const force = this.playfield.plunger.release();
        this.playfield.applyPlungerLaunch(force);
        if (this.state === GameState.READY && force > 0.005) this.state = GameState.PLAYING;
      }
    }

    this.physics.step(dtMs);
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
