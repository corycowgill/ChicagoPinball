export const PLAYFIELD_W = 540;
export const PLAYFIELD_H = 960;

export const WALL_THICKNESS = 24;

export const BALL_RADIUS = 11;
// Capped BELOW the flipper-bat thickness (FLIPPER_HEIGHT = 28). A ball at
// 27 px/step crossed a 26 px bat in one step — Matter's discrete
// collision detection saw the ball outside the bat at frame start, outside
// the bat at frame end (on the OTHER side), and registered no overlap. So
// the ball literally tunnelled through the bat. With max speed 22, the
// ball can never traverse the full 28 px bat in one step regardless of
// approach angle.
export const BALL_MAX_SPEED = 22;

export const GRAVITY_Y = 0.95;

export const FLIPPER_LEN = 108;
// Bat thickness must always exceed BALL_MAX_SPEED so Matter's discrete
// collision detection can't miss a fast-moving ball passing through the
// bat in one step. 28 > 22 gives 6 px of safety margin.
export const FLIPPER_HEIGHT = 28;
export const FLIPPER_REST_ANGLE = 0.42;
export const FLIPPER_ACTIVE_ANGLE = -0.42;
// Per-frame radian increments — see Flipper.ts. Tuned so the tip sweeps
// at 0.20 × 108 = 21.6 px/frame — fast enough to send a ball at the cap
// (27 px/frame), still under the bat thickness (26) so no tunneling.
export const FLIPPER_KICK_VEL = 0.20;
export const FLIPPER_RETURN_VEL = 0.11;

export const PLUNGER_MAX_PULL = 110;
export const PLUNGER_KICK = 0.045;

export const STARTING_BALLS = 3;

// Multiball: how many balls to lock before launching multiball mode, and how
// many balls launch when it starts.
export const LOCKS_FOR_MULTIBALL = 3;

// How long the scoop holds the ball before kicking it back into play (ms).
export const SCOOP_HOLD_MS = 900;

// Mode duration after starting from the scoop (ms).
export const MODE_MS = 25000;

export const CHICAGO = ['C', 'H', 'I', 'C', 'A', 'G', 'O'] as const;

export const POINTS = {
  POP_BUMPER: 100,
  BEAN: 250,
  SLINGSHOT: 50,
  DROP_TARGET: 500,
  SPINNER_REV: 25,
  ORBIT_LEFT: 1500,
  ORBIT_RIGHT: 1500,
  CENTER_RAMP: 2500,
  SCOOP: 5000,
  CAPTIVE_BALL: 750,
  LOCK: 5000,
  SUPER_JACKPOT: 50000,
  MULTIBALL_JACKPOT: 7500,
  MODE_SHOT: 3000,
};

// ── Palette ────────────────────────────────────────────────────────────────
export const COLOR = {
  // Playfield base
  PF_DEEP: '#04060e',
  PF_DARK: '#0a1124',
  PF_MID: '#142036',
  PF_HIGHLIGHT: '#1f3158',

  // Backbox / sky
  SKY_TOP: '#0d1a3a',
  SKY_MID: '#1a2d56',
  SKY_GLOW: '#3a5a9a',
  CITY_DARK: '#040810',
  CITY_LIT: '#0f1a2e',
  WINDOW_LIGHT: '#ffd97a',
  WINDOW_DIM: '#a06820',

  // Metal
  METAL_LIGHT: '#dde4ee',
  METAL_MID: '#8e98ad',
  METAL_DARK: '#3a4258',
  METAL_SHADOW: '#0c1020',

  // Inserts (lit decals on the playfield)
  INSERT_RED: '#ff3a4f',
  INSERT_AMBER: '#ffa733',
  INSERT_YELLOW: '#ffe14a',
  INSERT_GREEN: '#5cff9a',
  INSERT_CYAN: '#3ff0ff',
  INSERT_BLUE: '#4a90ff',
  INSERT_PURPLE: '#a26bff',
  INSERT_WHITE: '#f5fbff',

  // Plastics (translucent toy parts)
  PLASTIC_RED: 'rgba(255, 70, 90, 0.85)',
  PLASTIC_BLUE: 'rgba(80, 160, 255, 0.85)',
  PLASTIC_YELLOW: 'rgba(255, 220, 80, 0.9)',
  PLASTIC_WHITE: 'rgba(245, 250, 255, 0.85)',

  // Ball
  BALL_HI: '#ffffff',
  BALL: '#dfe6f0',
  BALL_DARK: '#5e6a85',

  // Specific landmarks
  BEAN_HI: '#f1f5fb',
  BEAN_MID: '#a3b0c6',
  BEAN_LOW: '#3e4a64',
  RIVER_BLUE: '#1f4a7a',
  RIVER_HI: '#4ea0d8',

  // Flipper
  FLIPPER_RED: '#d62a3e',
  FLIPPER_RED_HI: '#ff6075',
  FLIPPER_RED_LOW: '#5e0a18',
  FLIPPER_RUBBER: '#0a0a0a',

  // Text
  TEXT: '#eef3ff',
  TEXT_DIM: '#7d89a8',
  TEXT_GOLD: '#ffd25e',

  // UI / glow
  NEON_PINK: '#ff3a78',
  NEON_CYAN: '#3ff0ff',
  NEON_AMBER: '#ffb547',
  NEON_GREEN: '#5cff9a',
};
