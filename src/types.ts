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

// ── The five sports attractions and their modes ────────────────────────────

export type SportId = 'baseball' | 'football' | 'basketball' | 'hockey' | 'soccer';

export interface SportDef {
  id: SportId;
  /** Attraction name, e.g. BASEBALL. */
  sport: string;
  /** Mode name, e.g. GRAND SLAM. */
  mode: string;
  /** The physical shot that starts and advances the mode. */
  kind: ScoreEventKind;
  letter?: 'L' | 'R';
  /** Shots (including the starting one) needed to complete the mode. */
  goal: number;
  /** Human name of the shot, for DMD hints. */
  shotName: string;
}

/** Order matters: it is the insert / stadium-banner order everywhere. */
export const SPORTS: SportDef[] = [
  { id: 'baseball', sport: 'BASEBALL', mode: 'GRAND SLAM', kind: 'ramp', letter: 'L', goal: 3, shotName: 'LEFT RAMP' },
  { id: 'football', sport: 'FOOTBALL', mode: 'TOUCHDOWN DRIVE', kind: 'loop', letter: 'L', goal: 3, shotName: 'LEFT ORBIT' },
  { id: 'basketball', sport: 'BASKETBALL', mode: 'THREE-POINT SHOWDOWN', kind: 'ramp', letter: 'R', goal: 3, shotName: 'RIGHT RAMP' },
  { id: 'hockey', sport: 'HOCKEY', mode: 'SLAP SHOT', kind: 'loop', letter: 'R', goal: 3, shotName: 'RIGHT ORBIT' },
  { id: 'soccer', sport: 'SOCCER', mode: 'PENALTY KICK', kind: 'scoop', goal: 2, shotName: 'THE SCOOP' },
];
