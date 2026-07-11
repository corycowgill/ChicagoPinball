export enum GameState {
  TITLE = 'TITLE',
  READY = 'READY',
  PLAYING = 'PLAYING',
  BALL_DRAINED = 'BALL_DRAINED',
  GAME_OVER = 'GAME_OVER',
}

export type ScoreEventKind =
  | 'pop-bumper'
  | 'bean'
  | 'slingshot'
  | 'drop-target'
  | 'standup'
  | 'spinner'
  | 'skill-shot'
  | 'lane'
  | 'loop'
  | 'ramp'
  | 'scoop'
  | 'lake-bonus'
  | 'captive'
  | 'lock'
  | 'multiball-jackpot'
  | 'mode-shot'
  | 'super-jackpot';

export interface ScoreEvent {
  kind: ScoreEventKind;
  points: number;
  x?: number;
  y?: number;
  letter?: string;
}

export interface Drawable {
  draw(ctx: CanvasRenderingContext2D): void;
}
