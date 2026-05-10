export const PLAYFIELD_W = 540;
export const PLAYFIELD_H = 960;

export const WALL_THICKNESS = 24;

export const BALL_RADIUS = 11;
export const BALL_MAX_SPEED = 22;

export const GRAVITY_Y = 0.9;

export const FLIPPER_LEN = 92;
export const FLIPPER_HEIGHT = 16;
export const FLIPPER_REST_ANGLE = 0.42;        // ~24 deg below horizontal
export const FLIPPER_ACTIVE_ANGLE = -0.42;     // ~24 deg above horizontal
export const FLIPPER_KICK_VEL = 0.85;          // angular velocity on activate
export const FLIPPER_RETURN_VEL = 0.45;

export const PLUNGER_MAX_PULL = 110;
export const PLUNGER_KICK = 0.045;             // force when fully released

export const POINTS = {
  POP_BUMPER: 100,
  BEAN: 250,
  SLINGSHOT: 50,
  DROP_TARGET: 500,
  SPINNER_REV: 10,
  LOOP_RAMP: 1000,
  SUPER_JACKPOT: 25000,
};

export const STARTING_BALLS = 3;

export const CHICAGO = ['C', 'H', 'I', 'C', 'A', 'G', 'O'] as const;

// Palette
export const COLOR = {
  BG_TOP: '#0a1430',
  BG_BOTTOM: '#02030a',
  PLAYFIELD_FRAME: '#1a2746',
  NEON_CYAN: '#3ff0ff',
  NEON_PINK: '#ff3a78',
  NEON_AMBER: '#ffb547',
  NEON_GREEN: '#5cff9a',
  NEON_PURPLE: '#a26bff',
  STAR: '#ffd25e',
  BALL: '#e8eef9',
  BALL_HIGHLIGHT: '#ffffff',
  BEAN: '#cfd9e8',
  BEAN_DARK: '#5b6883',
  FLIPPER: '#f44056',
  SKYLINE: '#0d172e',
  WATER: '#1d3a64',
  WATER_HIGHLIGHT: '#3fa1d4',
  TARGET_HIT: '#1a2030',
  TEXT: '#e8efff',
  TEXT_DIM: '#7d89a8',
};
