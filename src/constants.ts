export const PLAYFIELD_W = 540;
export const PLAYFIELD_H = 960;

export const WALL_THICKNESS = 24;

export const BALL_RADIUS = 11;
// Capped BELOW the flipper-bat thickness (FLIPPER_HEIGHT = 28) so Matter's
// discrete collision detection can never step a ball fully through the bat
// in a single frame (which reads as the ball "tunnelling" through the
// flipper).
export const BALL_MAX_SPEED = 22;

export const GRAVITY_Y = 0.95;

// Physics substeps per 60 Hz frame. Matter has no continuous collision
// detection: at full speed a falling ball and a sweeping flipper bat close
// at ~44 px per 16.6 ms step — more than the bat is thick — so the ball
// could skip clean over the bat between steps. Substepping cuts per-step
// motion to a third. NOTE: velocities read straight off bodies are in
// px-per-substep units under substepping; always read via
// Matter.Body.getVelocity (normalized to px per 16.6 ms) instead.
export const PHYSICS_SUBSTEPS = 3;

// Bat length + rest angle set the drain gap: tips sit at
// playCenter ± (118 − LEN·cos(REST)) → a 32 px surface gap between resting
// bats, ~1.5 ball widths, so a dead-centre ball drains like it should
// (108 / 0.42 sealed the middle — the gap was 10.8 px, under one ball).
export const FLIPPER_LEN = 98;
// Bat thickness must always exceed BALL_MAX_SPEED — see above.
export const FLIPPER_HEIGHT = 28;
export const FLIPPER_REST_ANGLE = 0.46;
export const FLIPPER_ACTIVE_ANGLE = -0.42;
// Per-frame radian increments — see Flipper.ts. Tuned so the tip sweeps at
// 0.20 × 98 = 19.6 px/frame, fast enough to send a ball near the speed cap
// while staying under the bat thickness (no tunnelling).
export const FLIPPER_KICK_VEL = 0.2;
export const FLIPPER_RETURN_VEL = 0.11;

// Flipper rubber, applied to a PARKED bat only (held up, or at rest) — a
// bat mid-sweep is never damped, so flip power is unchanged. The ball's
// velocity is split in the bat's frame: the component INTO the bat is the
// bounce and is mostly absorbed, while the component ALONG the bat is
// rolling and is only lightly slowed. That split is what lets a held bat
// cradle (gravity walks the ball down into the crook and holds it) while a
// resting bat still lets it roll off the tip. Damping the whole vector
// does neither: uniformly it glues the ball to the bat, and with a speed
// floor it preserves enough of the inbound direction to coast off the tip.
export const FLIPPER_DEAD_BOUNCE = 0.28;
export const FLIPPER_ROLL_DAMP = 0.94;

// Launch speed = PLUNGER_MIN_LAUNCH + pull × PLUNGER_LAUNCH_RANGE (px/step).
// A weak pull doesn't clear the shooter lane and rolls back to the plunger;
// the arrival speed at the top of the lane picks the skill-shot lane.
export const PLUNGER_MIN_LAUNCH = 12;
export const PLUNGER_LAUNCH_RANGE = 10;

export const STARTING_BALLS = 3;

// Multiball: how many balls to lock (via the Bean) before multiball starts.
export const LOCKS_FOR_MULTIBALL = 3;

// How long the scoop holds the ball before kicking it back into play (ms).
export const SCOOP_HOLD_MS = 900;

// Sports modes: each mode gives this long to finish its shots; the
// Crosstown Championship mini-wizard gets a longer clock.
export const SPORT_MODE_MS = 30000;
export const CROSSTOWN_MS = 60000;

// The elevated train does one lap past the skyline every cycle; the lap
// itself takes TRAIN_LAP_MS at the start of each period.
export const TRAIN_PERIOD_MS = 26000;
export const TRAIN_LAP_MS = 9000;

// EL EXPRESS — the right-outlane rescue. Pop bumper hits pay the fare;
// once lit, a ball dropping into the right outlane rides the Express
// wireform back to the shooter lane instead of draining.
export const EXPRESS_FARE_HITS = 12;

// Hurry-up finale: the LAST required shot of every sport mode is worth a
// countdown value — banked the moment the shot is made.
export const HURRYUP_START = 60000;
export const HURRYUP_FLOOR = 12000;
export const HURRYUP_DECAY_PER_S = 1600;

// Nudge / tilt: each nudge adds 1 heat; heat decays per second; exceeding
// the limit tilts — flippers dead and bonus forfeited for the ball.
export const TILT_LIMIT = 3;
export const TILT_DECAY_PER_S = 0.35;

// Ball save: a drain within this window after launch serves a fresh ball
// instead of costing one (once per launch).
export const BALL_SAVE_MS = 9000;

// End-of-ball bonus: units collected during the ball × unit value × the
// bonus multiplier (advanced by completing the top lanes; lane-change on
// the flipper buttons).
export const BONUS_UNIT = 1000;
export const MAX_BONUS_X = 5;

// Combo: chaining ramp / scoop / captive shots within this window pays
// COMBO × chain length on top.
export const COMBO_WINDOW_MS = 4000;

// WINDY CITY SHOWDOWN final wizard mode: lit by winning the Crosstown
// Championship, started at the scoop. Two-ball, timed; shots deal
// damage; deplete the rival's bar to take the title.
export const BOSS_HP = 60;
export const BOSS_MS = 45000;

// Lake Shore Multiball economy: jackpots at the ramps / orbits / scoop
// escalate; every N jackpots light the SUPER at the Bean, which pays a
// multiple of the current value and raises it for the next cycle.
export const MB_JACKPOT_BASE = 15000;
export const MB_JACKPOT_STEP = 5000;
export const MB_JACKPOTS_FOR_SUPER = 3;
export const MB_SUPER_MULT = 3;

// Each CHICAGO completion after the first pays this much MORE than the
// last, so re-spelling the bank stays worth the shots.
export const CHICAGO_SUPER_STEP = 25000;

// A solid captive-ball strike spots the next CHICAGO letter, at most
// this often — the drop banks alone can't spell it inside three balls.
export const CAPTIVE_SPOT_MS = 2500;

// 2X / 3X PLAYFIELD — the orbits charge it. Every LOOPS_FOR_PF_X loops
// steps the multiplier up (and refreshes the clock), and while it runs
// every playfield shot pays that multiple. Measured: the best plunge was
// worth 65,000 — 26 ramps — so the playfield needed a way to out-earn a
// guaranteed award instead of the plunge being most of a game's score.
export const LOOPS_FOR_PF_X = 3;
export const PF_X_MAX = 3;
export const PF_X_MS = 22000;

// The spinner sits on the right-ramp return and pays per revolution. At a
// flat 25 a rev the longest rip on the board paid less than a slingshot;
// each CHICAGO completion now adds this much to the per-rev value.
export const SPINNER_STEP = 250;

// Inlane rollovers light the ramp that the receiving flipper can shoot,
// for this long — the return feeds the shot, like a real machine.
export const RAMP_BOOST_MS = 6000;
export const RAMP_BOOST_MULT = 2;

// Combos: chaining ramp / orbit / scoop / captive shots. Reaching this
// chain length pays the COMBO MASTER award (once per chain).
export const COMBO_MASTER_CHAIN = 6;
export const COMBO_MASTER_AWARD = 75000;

// Status report: hold BOTH flippers this long to see full progress.
export const STATUS_HOLD_MS = 1200;

// Super skill shot: after the skill-shot lanes, the Bean pays big for a
// few seconds — reward for a full-plunge follow-through.
export const SUPER_SKILL_MS = 4000;

// Replay: first time a player crosses this score they're awarded an extra
// ball, with the knocker. Once per player per game.
export const REPLAY_SCORE = 500000;

export const MAX_PLAYERS = 4;

export const CHICAGO = ['C', 'H', 'I', 'C', 'A', 'G', 'O'] as const;

export const POINTS = {
  POP_BUMPER: 100,
  BEAN: 250,
  SLINGSHOT: 50,
  DROP_TARGET: 500,
  STANDUP: 300,
  SPINNER_REV: 25,
  RAMP: 2500,
  SCOOP: 5000,
  // The captive is a precise rip up a narrow lane — it was paying less
  // than a lane rollover for the hardest shot on the machine.
  CAPTIVE_BALL: 3000,
  LOCK: 5000,
  SUPER_JACKPOT: 50000,
  SUPER_SKILL: 40000,
  SKILL_SHOT_SIDE: 10000,
  SKILL_SHOT_CENTER: 25000,
  LANE: 2000,
  INLANE: 750,
  COMBO: 1500,
  LOOP: 3000,
  BOSS_DEFEAT: 250000,
  SPORT_SHOT: 15000,
  SPORT_COMPLETE: 75000,
  CROSSTOWN_SHOT: 25000,
  CROSSTOWN_COMPLETE: 200000,
  CITY_LIGHTS: 40000,
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

  // Committed identity palette — the Chicago flag plus brass deco trim.
  // Title/headline chrome uses these; toy lamp colors stay functional.
  FLAG_BLUE: '#7fd1e8',
  FLAG_RED: '#e6293e',
  BRASS: '#d9a441',
};
