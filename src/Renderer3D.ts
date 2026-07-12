import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import Matter from 'matter-js';
import { Playfield, PLAYFIELD_TOP } from './scene/Playfield';
import { Renderer, HudInfo } from './Renderer';
import { Dmd } from './Dmd';
import { drawCapone, decoStar } from './Graphics';
import { GameState } from './types';
import {
  PLAYFIELD_W,
  PLAYFIELD_H,
  BALL_RADIUS,
  FLIPPER_LEN,
  FLIPPER_HEIGHT,
  CHICAGO,
  BOSS_HP,
  COLOR,
} from './constants';

interface Toast {
  text: string;
  color: string;
  ttl: number;
  total: number;
}

interface Pt {
  x: number;
  y: number;
}

/** World mapping: 3D x = playfield x, 3D z = playfield y, 3D y = height
 *  above the wood. One unit = one 2D pixel, so all layout numbers carry
 *  over directly from the physics. */
const toV3 = (p: Pt, h = 0) => new THREE.Vector3(p.x, h, p.y);

/** 3D presentation of the same 2D machine: the matter.js simulation is
 *  untouched — this renderer builds a Three.js table from the Playfield's
 *  bodies and syncs the dynamic ones every frame, viewed down-table like a
 *  player standing at the lockdown bar. */
export class Renderer3D {
  private three: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private overlay: CanvasRenderingContext2D;

  // Reuse the 2D painters for the floor texture + overlay art.
  private painter = new Renderer();
  private dmd = new Dmd();
  private dmdCanvas = document.createElement('canvas');
  private dmdTexture: THREE.CanvasTexture;

  private toasts: Toast[] = [];
  private shakeMs = 0;
  private shakeAmp = 0;
  private flashJackpot = 0;

  private built = false;
  private ballMeshes = new Map<Matter.Body, THREE.Mesh>();
  private ballPool: THREE.Mesh[] = [];
  private flipperGroups: { group: THREE.Group; pf: 'left' | 'right' }[] = [];
  private spinnerMesh: THREE.Mesh | null = null;
  private captiveMesh: THREE.Mesh | null = null;
  private dropMeshes: THREE.Mesh[] = [];
  private standupMats: THREE.MeshStandardMaterial[] = [];
  private bumperCapMats: THREE.MeshStandardMaterial[] = [];
  private slingMats: THREE.MeshStandardMaterial[] = [];
  private beanMesh: THREE.Mesh | null = null;
  private lamps: {
    mesh: THREE.Mesh;
    mat: THREE.MeshStandardMaterial;
    kind:
      | { t: 'rollover'; i: number }
      | { t: 'chicago'; i: number }
      | { t: 'tour'; i: number }
      | { t: 'kickback' }
      | { t: 'mystery' }
      | { t: 'loop'; i: number };
  }[] = [];
  private floodlights: THREE.SpotLight[] = [];

  constructor(glCanvas: HTMLCanvasElement, uiCanvas: HTMLCanvasElement) {
    this.three = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
    this.three.setSize(540, 960, false);
    this.three.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.three.shadowMap.enabled = true;
    this.three.shadowMap.type = THREE.PCFSoftShadowMap;
    this.three.toneMapping = THREE.ACESFilmicToneMapping;
    this.three.toneMappingExposure = 1.1;

    this.overlay = uiCanvas.getContext('2d')!;
    this.overlay.scale(2, 2); // ui canvas is 1080×1920 for crisp text

    // Player's-eye view down the table (the reference photo's framing).
    this.camera = new THREE.PerspectiveCamera(45, 540 / 960, 10, 4000);
    this.camera.position.set(PLAYFIELD_W / 2, 680, PLAYFIELD_H + 350);
    this.camera.lookAt(PLAYFIELD_W / 2, -30, 500);

    this.scene.background = new THREE.Color('#04050c');
    this.scene.fog = new THREE.Fog('#04050c', 1800, 3200);

    // Lighting: soft ambient + a cool key + warm floodlights from the
    // marquee corners, echoing the reference.
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.5));
    const key = new THREE.DirectionalLight(0xcfe0ff, 0.55);
    key.position.set(PLAYFIELD_W / 2, 900, 700);
    key.target.position.set(PLAYFIELD_W / 2, 0, 450);
    this.scene.add(key, key.target);
    for (const fx of [40, PLAYFIELD_W - 40]) {
      const spot = new THREE.SpotLight(0xffe7c0, 230000, 0, 0.55, 0.55, 1.8);
      spot.position.set(fx, 330, 40);
      spot.target.position.set(PLAYFIELD_W / 2, 0, 560);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      this.scene.add(spot, spot.target);
      this.floodlights.push(spot);
    }
    // Warm GI over the bumper nest, cool over the flippers.
    const gi1 = new THREE.PointLight(0xffc880, 12000, 380, 1.9);
    gi1.position.set(PLAYFIELD_W / 2 - 30, 90, 380);
    const gi2 = new THREE.PointLight(0x96c8ff, 10000, 360, 1.9);
    gi2.position.set(PLAYFIELD_W / 2, 100, 760);
    this.scene.add(gi1, gi2);

    // Environment for the chrome (bright room so the ball/Bean reflect).
    const pmrem = new THREE.PMREMGenerator(this.three);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;

    this.dmdCanvas.width = 1064;
    this.dmdCanvas.height = 132;
    this.dmdTexture = new THREE.CanvasTexture(this.dmdCanvas);
    this.dmdTexture.colorSpace = THREE.SRGBColorSpace;
  }

  // ── Game-facing interface (same as the 2D renderer) ─────────────────────

  pushToast(text: string, color = COLOR.NEON_AMBER, ttl = 1400) {
    this.toasts.push({ text, color, ttl, total: ttl });
  }

  triggerJackpotFlash() {
    this.flashJackpot = 1500;
  }

  kick(amp: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeMs = 90;
  }

  tick(dtMs: number) {
    for (const t of this.toasts) t.ttl -= dtMs;
    this.toasts = this.toasts.filter((t) => t.ttl > 0);
    if (this.flashJackpot > 0) this.flashJackpot -= dtMs;
    if (this.shakeMs > 0) {
      this.shakeMs -= dtMs;
      if (this.shakeMs <= 0) this.shakeAmp = 0;
    }
  }

  // ── Static table construction ────────────────────────────────────────────

  private buildTable(pf: Playfield) {
    this.built = true;

    // Floor — the painted playfield art as a texture.
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = PLAYFIELD_W * 2;
    floorCanvas.height = PLAYFIELD_H * 2;
    const fctx = floorCanvas.getContext('2d')!;
    fctx.scale(2, 2);
    this.painter.drawTopApron(fctx, pf);
    this.painter.drawPlayfieldFloor(fctx);
    this.painter.drawFloorArt(fctx, pf);
    this.painter.drawLakePool(fctx, pf);
    this.painter.drawPlayfieldDecals(fctx, pf);
    this.painter.drawStandupLabels(fctx, pf);
    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.colorSpace = THREE.SRGBColorSpace;
    floorTex.anisotropy = 4;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAYFIELD_W, PLAYFIELD_H),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(PLAYFIELD_W / 2, 0, PLAYFIELD_H / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Cabinet side walls (wood).
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.8 });
    for (const sx of [-8, PLAYFIELD_W + 8]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(16, 90, PLAYFIELD_H + 40), woodMat);
      side.position.set(sx, 30, PLAYFIELD_H / 2);
      this.scene.add(side);
    }
    const backWood = new THREE.Mesh(new THREE.BoxGeometry(PLAYFIELD_W + 48, 90, 16), woodMat);
    backWood.position.set(PLAYFIELD_W / 2, 30, 122);
    this.scene.add(backWood);

    // Rails / posts / walls from the physics bodies.
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xb8c2d4,
      metalness: 0.9,
      roughness: 0.28,
    });
    for (const w of pf.walls) {
      if (w.kind === 'wood' || w.outline.length === 0) continue;
      const body = w.body;
      const radius = (body as unknown as { circleRadius?: number }).circleRadius;
      if (radius) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 26, 16), railMat);
        post.position.set(body.position.x, 13, body.position.y);
        post.castShadow = true;
        this.scene.add(post);
        continue;
      }
      const v = w.outline;
      if (v.length < 4) continue;
      const len = Math.hypot(v[1].x - v[0].x, v[1].y - v[0].y);
      const thick = Math.hypot(v[2].x - v[1].x, v[2].y - v[1].y);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 22, thick), railMat);
      rail.position.set(body.position.x, 11, body.position.y);
      rail.rotation.y = -Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x);
      rail.castShadow = true;
      this.scene.add(rail);
    }
    for (const p of pf.postPositions) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(p.r ?? 5, (p.r ?? 5) + 1, 20, 14),
        railMat,
      );
      post.position.set(p.x, 10, p.y);
      post.castShadow = true;
      this.scene.add(post);
    }

    // Slingshots — white flag-plastic prisms.
    for (const s of pf.slingshots) {
      const shape = new THREE.Shape();
      shape.moveTo(s.verts[0].x, s.verts[0].y);
      shape.lineTo(s.verts[1].x, s.verts[1].y);
      shape.lineTo(s.verts[2].x, s.verts[2].y);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 22, bevelEnabled: false });
      const mat = new THREE.MeshStandardMaterial({
        color: 0xe8eef6,
        roughness: 0.35,
        emissive: 0xe6293e,
        emissiveIntensity: 0,
      });
      this.slingMats.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = 22;
      mesh.castShadow = true;
      this.scene.add(mesh);
    }

    // Pop bumpers: chrome base + lit cap.
    for (const b of pf.popBumpers) {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(b.radius, b.radius + 2, 14, 24),
        railMat,
      );
      base.position.set(b.body.position.x, 7, b.body.position.y);
      base.castShadow = true;
      const capMat = new THREE.MeshStandardMaterial({
        color: 0xfff4e0,
        roughness: 0.3,
        emissive: new THREE.Color('#ff9b30'),
        emissiveIntensity: 0.35,
      });
      this.bumperCapMats.push(capMat);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(b.radius - 2, 24, 16), capMat);
      cap.scale.y = 0.62;
      cap.position.set(b.body.position.x, 16, b.body.position.y);
      cap.castShadow = true;
      this.scene.add(base, cap);
    }

    // The Bean — squashed chrome sphere (Cloud Gate).
    const bean = new THREE.Mesh(
      new THREE.SphereGeometry(pf.bean.radius + 6, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0xf2f5fa, metalness: 1, roughness: 0.06 }),
    );
    bean.scale.set(1.25, 0.8, 1);
    bean.position.set(pf.bean.cx, 20, pf.bean.cy);
    bean.castShadow = true;
    this.beanMesh = bean;
    this.scene.add(bean);

    // Ramps: translucent plastic tubes climbing, chrome return rails down.
    const rampFor = (plate: Pt[], rail: Pt[], color: string) => {
      const plateCurve = new THREE.CatmullRomCurve3(
        plate.map((p, i) => toV3(p, 2 + (26 * Math.min(1, i / (plate.length - 2) + 0.1))))
      );
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(plateCurve, 40, 11, 10, false),
        new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity: 0.45,
          roughness: 0.25,
          transmission: 0.4,
        }),
      );
      this.scene.add(tube);
      const railCurve = new THREE.CatmullRomCurve3(
        rail.map((p, i) => toV3(p, 28 - 26 * Math.pow(i / (rail.length - 1), 1.6))),
      );
      const wire = new THREE.Mesh(new THREE.TubeGeometry(railCurve, 44, 2.2, 8, false), railMat);
      this.scene.add(wire);
    };
    rampFor(pf.leftRamp.plate, pf.leftRamp.habitrail, COLOR.INSERT_AMBER);
    rampFor(pf.rightRamp.plate, pf.rightRamp.habitrail, COLOR.INSERT_CYAN);
    // Shooter wireform.
    const shooter = new THREE.CatmullRomCurve3(
      pf.shooterPath(pf.rolloverXs[1]).map((p, i, arr) => toV3(p, 26 - 22 * (i / (arr.length - 1)))),
    );
    this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(shooter, 30, 2.2, 8, false), railMat));

    // Scoops: dark hole + metal ring.
    for (const sc of [pf.lakeMichiganScoop, pf.cityTourScoop]) {
      const hole = new THREE.Mesh(
        new THREE.CircleGeometry(15, 24),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
      );
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(sc.x, 0.6, sc.y);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 2.4, 10, 28), railMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sc.x, 2, sc.y);
      this.scene.add(hole, ring);
    }

    // Drop targets.
    const dropMat = new THREE.MeshStandardMaterial({
      color: 0x9ff2ff,
      emissive: new THREE.Color('#1fb8d4'),
      emissiveIntensity: 0.5,
    });
    for (const t of pf.bank.targets) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(28, 26, 7), dropMat);
      mesh.position.set(t.home.x, 13, t.home.y);
      mesh.rotation.y = -t.home.angle;
      mesh.castShadow = true;
      this.dropMeshes.push(mesh);
      this.scene.add(mesh);
    }

    // Standups.
    for (const s of pf.standups) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(s.color),
        emissive: new THREE.Color(s.color),
        emissiveIntensity: 0.25,
      });
      this.standupMats.push(mat);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, 20, 6), mat);
      mesh.position.set(s.body.position.x, 10, s.body.position.y);
      mesh.rotation.y = -s.angle;
      mesh.castShadow = true;
      this.scene.add(mesh);
    }

    // Captive lane ball + spinner blade.
    this.captiveMesh = this.makeBallMesh(10);
    this.scene.add(this.captiveMesh);
    const spinner = new THREE.Mesh(
      new THREE.BoxGeometry(pf.spinner.length, 14, 1.6),
      new THREE.MeshStandardMaterial({ color: 0xd8e0ec, metalness: 0.85, roughness: 0.3 }),
    );
    spinner.position.set(pf.spinner.cx, 9, pf.spinner.cy);
    this.spinnerMesh = spinner;
    this.scene.add(spinner);

    // Flippers.
    for (const side of ['left', 'right'] as const) {
      const f = side === 'left' ? pf.leftFlipper : pf.rightFlipper;
      const pivot = f.pivot.pointA;
      const group = new THREE.Group();
      group.position.set(pivot.x, 9, pivot.y);
      const bat = new THREE.Mesh(
        new THREE.CapsuleGeometry(FLIPPER_HEIGHT / 2, FLIPPER_LEN - FLIPPER_HEIGHT, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0xd62a3e, roughness: 0.4 }),
      );
      bat.rotation.z = Math.PI / 2;
      bat.position.x = FLIPPER_LEN / 2 - 4;
      bat.castShadow = true;
      group.add(bat);
      this.flipperGroups.push({ group, pf: side });
      this.scene.add(group);
    }

    // Plunger.
    const plunger = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 9, 30, 12),
      new THREE.MeshStandardMaterial({ color: 0xd62a3e, roughness: 0.4 }),
    );
    plunger.position.set(pf.plunger.body.position.x, 10, pf.plunger.body.position.y);
    this.scene.add(plunger);

    // Apron.
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(PLAYFIELD_W, 26, 66),
      new THREE.MeshStandardMaterial({ color: 0x6a1220, roughness: 0.5 }),
    );
    apron.position.set(PLAYFIELD_W / 2 - 30, 12, PLAYFIELD_H - 30);
    apron.scale.x = (PLAYFIELD_W - 60) / PLAYFIELD_W;
    this.scene.add(apron);

    // Backbox: marquee panel + DMD panel.
    const marqueeCanvas = document.createElement('canvas');
    marqueeCanvas.width = 1080;
    marqueeCanvas.height = 240;
    this.paintMarquee(marqueeCanvas.getContext('2d')!);
    const marqueeTex = new THREE.CanvasTexture(marqueeCanvas);
    marqueeTex.colorSpace = THREE.SRGBColorSpace;
    const marquee = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAYFIELD_W + 40, 130),
      new THREE.MeshBasicMaterial({ map: marqueeTex }),
    );
    marquee.position.set(PLAYFIELD_W / 2, 160, 108);
    this.scene.add(marquee);
    const dmdPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAYFIELD_W - 8, 66),
      new THREE.MeshBasicMaterial({ map: this.dmdTexture }),
    );
    dmdPanel.position.set(PLAYFIELD_W / 2, 62, 112);
    dmdPanel.rotation.x = -0.18;
    this.scene.add(dmdPanel);

    // Lamp inserts — real emissive discs on the wood.
    const lamp = (
      x: number,
      z: number,
      r: number,
      color: string,
      kind: Renderer3D['lamps'][number]['kind'],
    ) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x223048,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.1,
      });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.6, 16), mat);
      mesh.position.set(x, 1, z);
      this.scene.add(mesh);
      this.lamps.push({ mesh, mat, kind });
    };
    pf.rollovers.forEach((r, i) => lamp(r.x, r.y, 8, '#5cff9a', { t: 'rollover', i }));
    for (let i = 0; i < CHICAGO.length; i++) {
      lamp(PLAYFIELD_W / 2 - ((CHICAGO.length - 1) * 26) / 2 + i * 26, 152, 8, '#e6293e', {
        t: 'chicago',
        i,
      });
    }
    for (let i = 0; i < 5; i++) {
      lamp(PLAYFIELD_W / 2 - 42, 642 + i * 15, 5, '#e6293e', { t: 'tour', i });
    }
    lamp(pf.kickbackPos.x, pf.kickbackPos.y - 8, 6, '#5cff9a', { t: 'kickback' });
    lamp(pf.lakeMichiganScoop.x, pf.lakeMichiganScoop.y - 34, 7, '#4ea0d8', { t: 'mystery' });
    pf.loopArrowXs.forEach((x, i) => lamp(x, 590, 8, '#7fd1e8', { t: 'loop', i }));
  }

  private makeBallMesh(r = BALL_RADIUS): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0xf5f8ff, metalness: 1, roughness: 0.08 }),
    );
    mesh.castShadow = true;
    return mesh;
  }

  private paintMarquee(ctx: CanvasRenderingContext2D) {
    ctx.scale(2, 2);
    const W = 540;
    const H = 120;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1a3a');
    g.addColorStop(1, '#060a18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Star sprinkle.
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.15 + ((i * 37) % 10) / 25})`;
      ctx.fillRect(((i * 97) % 540), ((i * 61) % 40) + (i % 2 ? 82 : 2), 1.4, 1.4);
    }
    const mx = W / 2;
    ctx.fillStyle = '#0a0d18';
    ctx.beginPath();
    ctx.roundRect(mx - 150, 18, 300, 84, 8);
    ctx.fill();
    ctx.strokeStyle = COLOR.BRASS;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '4px';
    ctx.shadowColor = COLOR.FLAG_RED;
    ctx.shadowBlur = 16;
    ctx.fillStyle = COLOR.FLAG_RED;
    ctx.font = 'bold 32px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('WINDY CITY', mx + 2, 44);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,240,240,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeText('WINDY CITY', mx + 2, 44);
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '9px';
    ctx.shadowColor = COLOR.FLAG_BLUE;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COLOR.FLAG_BLUE;
    ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('SHOWDOWN', mx + 4, 80);
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '0px';
    ctx.shadowBlur = 0;
    decoStar(ctx, mx - 172, 60, 13, COLOR.FLAG_RED);
    decoStar(ctx, mx + 172, 60, 13, COLOR.FLAG_RED);
  }

  // ── Per-frame sync + render ──────────────────────────────────────────────

  draw(pf: Playfield, hud: HudInfo) {
    if (!this.built) this.buildTable(pf);

    // Balls: pool meshes against live bodies.
    const seen = new Set<Matter.Body>();
    for (const b of pf.balls) {
      seen.add(b.body);
      let mesh = this.ballMeshes.get(b.body);
      if (!mesh) {
        mesh = this.ballPool.pop() ?? this.makeBallMesh();
        this.ballMeshes.set(b.body, mesh);
        this.scene.add(mesh);
      }
      const transit = (b.body as unknown as { $transit?: boolean }).$transit;
      mesh.position.set(b.body.position.x, transit ? 30 : BALL_RADIUS, b.body.position.y);
    }
    for (const [body, mesh] of this.ballMeshes) {
      if (!seen.has(body)) {
        this.scene.remove(mesh);
        this.ballPool.push(mesh);
        this.ballMeshes.delete(body);
      }
    }

    // Flippers / spinner / captive.
    for (const f of this.flipperGroups) {
      const flip = f.pf === 'left' ? pf.leftFlipper : pf.rightFlipper;
      f.group.rotation.y = -flip.body.angle;
    }
    if (this.spinnerMesh) this.spinnerMesh.rotation.x = pf.spinner.body.angle;
    if (this.captiveMesh) {
      this.captiveMesh.position.set(pf.captive.ball.position.x, 10, pf.captive.ball.position.y);
    }

    // Drop targets sink when hit.
    pf.bank.targets.forEach((t, i) => {
      this.dropMeshes[i].position.y = t.hit ? -12 : 13;
    });
    // Standups glow while lit.
    pf.standups.forEach((s, i) => {
      this.standupMats[i].emissiveIntensity = s.lit ? 1.4 : 0.25;
    });
    // Bumper + sling flashes.
    pf.popBumpers.forEach((b, i) => {
      this.bumperCapMats[i].emissiveIntensity = 0.35 + b.flashLevel * 2.2;
    });
    pf.slingshots.forEach((s, i) => {
      this.slingMats[i].emissiveIntensity = s.flashLevel * 1.6;
    });
    if (this.beanMesh) {
      const s = 1 + pf.bean.flashLevel * 0.08;
      this.beanMesh.scale.set(1.25 * s, 0.8 * s, s);
    }

    // Lamps.
    const blink = Math.sin(performance.now() / 180) > -0.2;
    for (const l of this.lamps) {
      let on = false;
      const k = l.kind;
      if (k.t === 'rollover') on = pf.rollovers[k.i].lit;
      else if (k.t === 'chicago') on = pf.bank.litMask()[k.i];
      else if (k.t === 'tour') on = hud.tourIdx > k.i || (hud.tourIdx === k.i && blink);
      else if (k.t === 'kickback') on = hud.kickbackLit && blink;
      else if (k.t === 'mystery') on = hud.mysteryLit;
      else if (k.t === 'loop')
        on = (hud.multiball || hud.bossActive || hud.tourKind === 'loop') && blink;
      l.mat.emissiveIntensity = on ? 2.2 : 0.1;
    }

    // Camera shake.
    const baseX = PLAYFIELD_W / 2;
    if (this.shakeMs > 0 && this.shakeAmp > 0) {
      this.camera.position.x = baseX + (Math.random() - 0.5) * 2 * this.shakeAmp;
      this.camera.position.y = 640 + (Math.random() - 0.5) * this.shakeAmp;
    } else {
      this.camera.position.x = baseX;
      this.camera.position.y = 640;
    }

    // DMD texture.
    this.composeDmd(hud);
    const dctx = this.dmdCanvas.getContext('2d')!;
    dctx.setTransform(2, 0, 0, 2, 0, 0);
    dctx.clearRect(0, 0, 532, 66);
    this.dmd.render(dctx, 0, 0, 532, 66);
    this.dmdTexture.needsUpdate = true;

    this.three.render(this.scene, this.camera);
    this.drawOverlay(pf, hud);
  }

  /** Same display logic as the 2D renderer's HUD band. */
  private composeDmd(hud: HudInfo) {
    const d = this.dmd;
    d.clear();
    if (hud.state === GameState.TITLE || hud.state === GameState.GAME_OVER) {
      d.centerText(hud.state === GameState.TITLE ? 'CHICAGO PINBALL' : 'GAME OVER', 1);
      const msgs =
        hud.state === GameState.TITLE
          ? ['THE WINDY CITY', hud.highScore > 0 ? `HIGH SCORE ${hud.highScore.toLocaleString()}` : 'FREE PLAY', 'PRESS ENTER']
          : [`FINAL ${Math.max(...hud.playerScores).toLocaleString()}`, hud.matched ? 'MATCH!' : 'PRESS ENTER'];
      d.centerText(msgs[Math.floor(performance.now() / 2200) % msgs.length], 10);
      return;
    }
    const playerTag = hud.playerScores.length > 1 ? `P${hud.currentPlayer + 1} ` : '';
    const ebTag = hud.extraBalls > 0 ? ` +${hud.extraBalls}EB` : '';
    d.text(`${playerTag}BALL ${Math.min(3, hud.ballNumber)}${ebTag}`, 2, 1);
    d.rightText(hud.score.toLocaleString(), 1);
    const latest = this.toasts[this.toasts.length - 1];
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    if (latest && latest.total - latest.ttl < 2400) {
      if (latest.total - latest.ttl < 350 || blink || latest.total - latest.ttl > 900) {
        d.centerText(latest.text, 10);
      }
    } else if (hud.bossActive) {
      d.capone(2, 8);
      d.bar(17, 11, 74, 5, Math.max(0, hud.bossHp) / BOSS_HP);
      d.rightText(`${Math.max(0, Math.ceil(hud.bossMsLeft / 1000))}S`, 10);
    } else if (hud.tourName) {
      d.centerText(`TOUR: ${hud.tourName} ${Math.max(0, Math.ceil(hud.tourMsLeft / 1000))}S`, 10);
    } else if (hud.multiball) {
      if (blink) d.centerText('MULTIBALL', 10);
    } else if (hud.tilted) {
      if (blink) d.centerText('TILT', 10);
    } else if (hud.tiltHeat >= 2) {
      d.centerText('CAREFUL!', 10);
    } else if (hud.bossLit && hud.state === GameState.PLAYING) {
      if (blink) d.centerText('SHOWDOWN AT THE SCOOP', 10);
    } else if (hud.playerScores.length > 1) {
      const strip = hud.playerScores
        .map((s, i) => `${i === hud.currentPlayer ? '*' : ''}P${i + 1} ${s >= 10000 ? Math.floor(s / 1000) + 'K' : s}`)
        .join('  ');
      d.centerText(strip, 10);
    } else if (hud.bonusX > 1) {
      d.centerText(`BONUS X${hud.bonusX}`, 10);
    }
  }

  /** 2D overlay: title / game over / ready hints / TILT — crisp text on
   *  top of the GL frame. */
  private drawOverlay(pf: Playfield, hud: HudInfo) {
    const ctx = this.overlay;
    ctx.clearRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this.flashJackpot > 0) {
      const a = Math.min(0.35, (this.flashJackpot / 1500) * 0.35);
      ctx.fillStyle = `rgba(255, 215, 100, ${a})`;
      ctx.fillRect(0, 0, PLAYFIELD_W, PLAYFIELD_H);
    }

    if (hud.state === GameState.TITLE) {
      ctx.fillStyle = 'rgba(2, 4, 10, 0.55)';
      ctx.fillRect(0, 130, PLAYFIELD_W, PLAYFIELD_H - 130);
      ctx.strokeStyle = COLOR.BRASS;
      ctx.lineWidth = 1.5;
      for (const y of [332, 338, 452, 458]) {
        ctx.beginPath();
        ctx.moveTo(y > 400 ? 120 : 80, y);
        ctx.lineTo(PLAYFIELD_W - (y > 400 ? 120 : 80), y);
        ctx.stroke();
      }
      (ctx as unknown as { letterSpacing?: string }).letterSpacing = '10px';
      ctx.shadowColor = COLOR.FLAG_RED;
      ctx.shadowBlur = 26;
      ctx.fillStyle = COLOR.FLAG_RED;
      ctx.font = 'bold 60px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('CHICAGO', PLAYFIELD_W / 2 + 5, 386);
      ctx.shadowBlur = 0;
      (ctx as unknown as { letterSpacing?: string }).letterSpacing = '6px';
      ctx.fillStyle = COLOR.FLAG_BLUE;
      ctx.font = 'bold 18px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('THE WINDY CITY PINBALL', PLAYFIELD_W / 2 + 3, 432);
      (ctx as unknown as { letterSpacing?: string }).letterSpacing = '0px';
      ctx.fillStyle = COLOR.TEXT;
      ctx.font = '13px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('LOCK 3 BALLS · SPELL CHICAGO · BEAT CAPONE', PLAYFIELD_W / 2, 486);
      if (hud.highScore > 0) {
        ctx.fillStyle = COLOR.TEXT_GOLD;
        ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText(`HIGH SCORE  ${hud.highScore.toLocaleString()}`, PLAYFIELD_W / 2, 522);
      }
      if (Math.sin(performance.now() / 300) > 0) {
        ctx.shadowColor = COLOR.NEON_AMBER;
        ctx.shadowBlur = 14;
        ctx.fillStyle = COLOR.NEON_AMBER;
        ctx.font = 'bold 18px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('PRESS ENTER TO START', PLAYFIELD_W / 2, 590);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = COLOR.TEXT_DIM;
      ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('Z / ⁄ flippers · SPACE plunger · C/N nudge · M mute', PLAYFIELD_W / 2, 630);
      drawCapone(ctx, PLAYFIELD_W / 2, 762, 1.05, 0.95);
      return;
    }

    if (hud.state === GameState.GAME_OVER) {
      ctx.fillStyle = 'rgba(2, 4, 10, 0.68)';
      ctx.fillRect(0, 130, PLAYFIELD_W, PLAYFIELD_H - 130);
      ctx.shadowColor = COLOR.NEON_PINK;
      ctx.shadowBlur = 22;
      ctx.fillStyle = COLOR.NEON_PINK;
      ctx.font = 'bold 52px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('GAME OVER', PLAYFIELD_W / 2, 400);
      ctx.shadowBlur = 8;
      const best = Math.max(...hud.playerScores);
      for (let i = 0; i < hud.playerScores.length; i++) {
        const s = hud.playerScores[i];
        ctx.fillStyle = s === best ? COLOR.NEON_AMBER : COLOR.TEXT_DIM;
        ctx.font = `bold ${hud.playerScores.length > 1 ? 22 : 28}px "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText(
          hud.playerScores.length > 1 ? `P${i + 1}   ${s.toLocaleString()}` : s.toLocaleString(),
          PLAYFIELD_W / 2,
          452 + i * 30,
        );
      }
      const after = 452 + hud.playerScores.length * 30 + 8;
      ctx.fillStyle = hud.matched ? COLOR.NEON_GREEN : COLOR.TEXT_DIM;
      ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(
        `MATCH  ${String(hud.matchNumber).padStart(2, '0')}${hud.matched ? ' — WELL PLAYED!' : ''}`,
        PLAYFIELD_W / 2,
        after + 26,
      );
      if (Math.sin(performance.now() / 300) > 0) {
        ctx.fillStyle = COLOR.NEON_CYAN;
        ctx.font = 'bold 16px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('PRESS ENTER FOR TITLE', PLAYFIELD_W / 2, after + 62);
      }
      return;
    }

    if (hud.state === GameState.READY) {
      ctx.shadowColor = COLOR.NEON_CYAN;
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(
        hud.plungerHolding ? 'RELEASE SPACE TO LAUNCH' : 'HOLD SPACE TO PULL PLUNGER',
        PLAYFIELD_W / 2,
        870,
      );
      ctx.shadowBlur = 0;
      if (hud.playerScores.length > 1) {
        ctx.fillStyle = COLOR.NEON_CYAN;
        ctx.font = 'bold 16px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText(`PLAYER ${hud.currentPlayer + 1}`, PLAYFIELD_W / 2, 845);
      }
    }

    if (hud.tilted) {
      ctx.shadowColor = COLOR.INSERT_RED;
      ctx.shadowBlur = 26;
      ctx.fillStyle = COLOR.INSERT_RED;
      ctx.font = 'bold 54px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('TILT', PLAYFIELD_W / 2, 520);
      ctx.shadowBlur = 0;
    }
    void pf;
  }
}
