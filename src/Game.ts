import { Physics } from './Physics';
import { Playfield } from './scene/Playfield';
import { Renderer } from './Renderer';
import { InputManager, VirtualKey } from './InputManager';
import { GameState, ScoreEvent } from './types';
import { STARTING_BALLS, COLOR, PLAYFIELD_W } from './constants';

export class Game {
  private physics!: Physics;
  private playfield!: Playfield;
  private renderer = new Renderer();
  private input = new InputManager();

  private state: GameState = GameState.TITLE;
  private score = 0;
  private ballsRemaining = STARTING_BALLS;
  /** Brief delay between ball drain and next ball (ms). */
  private respawnTimer = 0;

  constructor(private ctx: CanvasRenderingContext2D, canvas?: HTMLElement) {
    this.rebuildWorld();
    if (canvas) {
      this.input.attachPointer(canvas, (x, y) => this.resolveTouchKey(x, y));
    }
  }

  /** Map a touch/click at playfield-logical (x, y) to a virtual key. The
   *  zone depends on the current state: during TITLE/GAME_OVER any tap
   *  advances; during READY any tap charges the plunger; during PLAYING
   *  the bottom-right corner is the plunger and left/right halves are
   *  the flippers. */
  private resolveTouchKey(x: number, y: number): VirtualKey | null {
    if (this.state === GameState.TITLE || this.state === GameState.GAME_OVER) {
      return 'enter';
    }
    if (this.state === GameState.READY) return 'plunger';
    if (this.state === GameState.BALL_DRAINED) return null;
    // PLAYING — split left/right
    return x < PLAYFIELD_W / 2 ? 'leftFlipper' : 'rightFlipper';
  }

  private rebuildWorld() {
    this.physics = new Physics();
    this.playfield = new Playfield(this.physics, {
      onScore: (e) => this.handleScore(e),
      onDrain: () => this.handleDrain(),
    });
  }

  private handleScore(e: ScoreEvent) {
    if (this.state !== GameState.PLAYING) return;
    this.score += e.points;
    if (e.kind === 'super-jackpot') {
      this.renderer.pushToast('SUPER JACKPOT!', COLOR.NEON_AMBER, 1800);
      this.renderer.triggerJackpotFlash();
    } else if (e.kind === 'loop-ramp') {
      this.renderer.pushToast('THE LOOP +1000', COLOR.NEON_AMBER, 900);
    } else if (e.kind === 'drop-target' && e.letter) {
      this.renderer.pushToast(e.letter, COLOR.NEON_CYAN, 600);
    } else if (e.kind === 'bean') {
      this.renderer.pushToast('THE BEAN', '#9fc4ff', 600);
    }
  }

  private handleDrain() {
    if (this.state !== GameState.PLAYING) return;
    this.state = GameState.BALL_DRAINED;
    this.respawnTimer = 800;
    this.ballsRemaining--;
  }

  update(dtMs: number) {
    // Title and game-over: only listen for Enter to advance.
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

    // Flippers respond in PLAYING and READY (so the player can flip while waiting).
    const allowFlippers =
      this.state === GameState.PLAYING || this.state === GameState.READY;
    this.playfield.setFlippers(
      allowFlippers && this.input.isDown('leftFlipper'),
      allowFlippers && this.input.isDown('rightFlipper'),
    );

    // Plunger
    if (this.state === GameState.READY || this.state === GameState.PLAYING) {
      if (this.input.wasPressed('plunger')) this.playfield.plunger.hold();
      if (this.input.wasReleased('plunger')) {
        const force = this.playfield.plunger.release();
        this.playfield.applyPlungerLaunch(force);
        if (this.state === GameState.READY && force > 0.005) {
          this.state = GameState.PLAYING;
        }
      }
    }

    // Step physics.
    this.physics.step(dtMs);
    this.playfield.tick(dtMs);
    this.renderer.tick(dtMs);

    // Ball drained handling.
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
    );
  }

  private startGame() {
    this.score = 0;
    this.ballsRemaining = STARTING_BALLS;
    this.rebuildWorld();
    this.state = GameState.READY;
  }
}
