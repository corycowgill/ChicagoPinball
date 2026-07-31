/** Layout -> physics bodies.
 *
 *  One ordered switch per array. This is the only place bodies are created,
 *  and it walks `statics` then `elements` in array order because Matter's
 *  float results depend on insertion order.
 *
 *  It must reproduce the old hand-written constructor body for body, which is
 *  checked by diffing two worlds in `src/dev/snapshot.ts` — not by eye.
 */
import Matter from 'matter-js';
import { Physics } from '../Physics';
import { Ball } from '../entities/Ball';
import { Flipper } from '../entities/Flipper';
import { Plunger } from '../entities/Plunger';
import { PopBumper } from '../entities/PopBumper';
import { Bean } from '../entities/Bean';
import { Slingshot } from '../entities/Slingshot';
import { Spinner } from '../entities/Spinner';
import { Scoop } from '../entities/Scoop';
import { CaptiveBall } from '../entities/CaptiveBall';
import { ChicagoBank } from '../entities/ChicagoBank';
import { Rollover } from '../entities/Rollover';
import { StandupTarget } from '../entities/StandupTarget';
import { Ramp } from '../entities/Ramp';
import { ResolvedLayout } from './resolve';
import { Pt, StaticDesc } from './types';

export interface WallDef {
  body: Matter.Body;
  outline: Pt[];
  kind?: 'rail' | 'wood' | 'plastic';
}

/** Everything the Playfield needs to hold on to after construction. */
export interface PlayfieldParts {
  balls: Ball[];
  leftFlipper: Flipper;
  rightFlipper: Flipper;
  plunger: Plunger;
  popBumpers: PopBumper[];
  bean: Bean;
  slingshots: Slingshot[];
  bank: ChicagoBank;
  spinner: Spinner;
  leftRamp: Ramp;
  rightRamp: Ramp;
  cityTourScoop: Scoop;
  lakeMichiganScoop: Scoop;
  captive: CaptiveBall;
  rollovers: Rollover[];
  standups: StandupTarget[];
  walls: WallDef[];
  postPositions: { x: number; y: number; r?: number }[];
  drainSensor: Matter.Body;
}

export function norm(v: Pt): Pt {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

export function polyOf(body: Matter.Body): Pt[] {
  return body.vertices.map((v) => ({ x: v.x, y: v.y }));
}

/** A rail is a segment: a rotated rectangle. The chamfer radius is a FORMULA
 *  of thickness, not a constant — it changes the vertex count, and therefore
 *  contact behaviour, so it must not be flattened to a literal. */
export function railBody(a: Pt, b: Pt, thickness: number): Matter.Body {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return Matter.Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len, thickness, {
    isStatic: true,
    angle: Math.atan2(dy, dx),
    label: 'wall',
    chamfer: { radius: Math.min(3, thickness / 2 - 0.1) },
  });
}

export function buildPlayfield(physics: Physics, resolved: ResolvedLayout): PlayfieldParts {
  const { frame, layout } = resolved;
  const walls: WallDef[] = [];
  const postPositions: { x: number; y: number; r?: number }[] = [];

  const addWall = (body: Matter.Body, kind: WallDef['kind'] = 'rail') => {
    physics.add(body);
    walls.push({ body, outline: polyOf(body), kind });
  };

  // ── Statics, in order ────────────────────────────────────────────────────
  for (const s of layout.statics as StaticDesc[]) {
    switch (s.kind) {
      case 'cabinet-wall': {
        // Deliberately NOT addWall: the outer box is pushed with an empty
        // outline so the renderer's wall pass skips it.
        const body = Matter.Bodies.rectangle(s.cx, s.cy, s.w, s.h, {
          isStatic: true,
          label: 'wall',
        });
        physics.add(body);
        walls.push({ body, outline: [], kind: 'wood' });
        break;
      }
      case 'rail':
        addWall(railBody(s.a, s.b, s.thickness), s.skin ?? 'rail');
        break;
      case 'post':
        addWall(
          Matter.Bodies.circle(s.x, s.y, s.r, {
            isStatic: true,
            label: 'wall',
            ...(s.restitution !== undefined ? { restitution: s.restitution } : {}),
          }),
          s.skin ?? 'rail',
        );
        break;
      case 'deco-post':
        postPositions.push({ x: s.x, y: s.y, r: s.r });
        break;
      case 'sensor':
        physics.add(
          Matter.Bodies.rectangle(s.x, s.y, s.w, s.h, {
            isStatic: true,
            isSensor: true,
            label: s.role,
          }),
        );
        break;
    }
  }

  // ── Elements, in order ───────────────────────────────────────────────────
  const parts: Partial<PlayfieldParts> = {
    balls: [],
    popBumpers: [],
    slingshots: [],
    rollovers: [],
    standups: [],
  };

  for (const e of layout.elements) {
    switch (e.kind) {
      case 'plunger': {
        const p = new Plunger(frame.launchX, e.y, frame.plungerWidth);
        physics.add(p.body);
        parts.plunger = p;
        break;
      }
      case 'ball-spawn': {
        const b = new Ball(frame.launchX, frame.launchRestY);
        parts.balls!.push(b);
        physics.add(b.body);
        break;
      }
      case 'flipper': {
        const pivotX =
          e.side === 'left'
            ? frame.playCenter - frame.flipperGap
            : frame.playCenter + frame.flipperGap;
        const f = new Flipper(e.side, pivotX, frame.flipperY, e.opts);
        physics.add(f.body, f.pivot);
        if (e.side === 'left') parts.leftFlipper = f;
        else parts.rightFlipper = f;
        break;
      }
      case 'slingshot': {
        // Normalise here, never in the data — see types.ts.
        const s = new Slingshot(e.verts, norm(e.normal));
        parts.slingshots!.push(s);
        physics.add(s.body);
        break;
      }
      case 'rollover': {
        const r = new Rollover(e.x, e.y, e.letter, e.idx);
        parts.rollovers!.push(r);
        physics.add(r.sensor);
        break;
      }
      case 'bean': {
        const b = new Bean(e.x, e.y, e.radius);
        physics.add(b.body);
        parts.bean = b;
        break;
      }
      case 'pop-bumper': {
        const p = new PopBumper(e.x, e.y, e.radius, e.color);
        parts.popBumpers!.push(p);
        physics.add(p.body);
        break;
      }
      case 'standup': {
        const s = new StandupTarget({
          x: e.x,
          y: e.y,
          angle: e.angle,
          color: e.color,
          id: e.targetId,
          width: e.width,
          height: e.height,
        });
        parts.standups!.push(s);
        physics.add(s.body);
        break;
      }
      case 'drop-bank':
        parts.bank = new ChicagoBank(physics, e.slots.map((s) => ({ x: s.x, y: s.y, angle: s.angle })));
        break;
      case 'ramp': {
        // Snap the join so plate/habitrail can never disagree: the transit
        // path is plate + habitrail.slice(1), and a mismatch would teleport
        // the ball mid-flight.
        const habitrail = e.habitrail.map((p, i) =>
          i === 0 ? { ...e.plate[e.plate.length - 1] } : p,
        );
        const r = new Ramp({
          plate: e.plate,
          habitrail,
          exitVel: e.exitVel,
          color: e.color,
          arrowAngle: e.arrowAngle,
          label: e.label,
          themeText: e.themeText,
          ...(e.minSpeed !== undefined ? { minSpeed: e.minSpeed } : {}),
        });
        physics.add(r.entry);
        if (e.label === 'left-ramp') parts.leftRamp = r;
        else parts.rightRamp = r;
        break;
      }
      case 'scoop': {
        const s = new Scoop(e.x, e.y, e.kickAngle, e.kickSpeed, e.label);
        physics.add(s.sensor);
        if (e.label === 'lake-scoop') parts.lakeMichiganScoop = s;
        else parts.cityTourScoop = s;
        break;
      }
      case 'captive': {
        const c = new CaptiveBall(e.x, e.y);
        physics.add(c.ball, c.tether, ...c.walls);
        parts.captive = c;
        break;
      }
      case 'spinner': {
        const s = new Spinner(e.cx, e.cy, e.length);
        physics.add(s.body, s.pivot, s.stop);
        parts.spinner = s;
        break;
      }
      case 'sensor':
        physics.add(
          Matter.Bodies.rectangle(e.x, e.y, e.w, e.h, {
            isStatic: true,
            isSensor: true,
            label: e.role,
          }),
        );
        break;
      case 'drain': {
        const d = Matter.Bodies.rectangle(
          frame.playCenter,
          e.y,
          frame.playRight - e.inset,
          e.h,
          { isStatic: true, isSensor: true, label: 'drain' },
        );
        physics.add(d);
        parts.drainSensor = d;
        break;
      }
    }
  }

  return { ...(parts as PlayfieldParts), walls, postPositions };
}
