import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import Matter from 'matter-js';
import { Playfield } from './scene/Playfield';
import { Renderer, HudInfo } from './Renderer';
import { Dmd } from './Dmd';
import { decoStar } from './Graphics';
import { GameState, SPORTS } from './types';
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

/** The dead shelf behind the back wall (z < ~172) where no ball can ever
 *  roll — the skyline, the L and the DMD all live there, layered:
 *  marquee (backbox) → buildings + train → DMD panel → playfield. */
const SKYLINE_Z = 88;

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
  // Motion trails: recent positions per ball + a shared pool of fading
  // ghost spheres (TRAIL_LEN per concurrent ball, laid out per frame).
  private trailHist = new Map<Matter.Body, THREE.Vector3[]>();
  private trailMeshes: THREE.Mesh[] = [];
  private static readonly TRAIL_LEN = 6;
  private flipperGroups: { group: THREE.Group; pf: 'left' | 'right' }[] = [];
  private spinnerMesh: THREE.Mesh | null = null;
  private captiveMesh: THREE.Mesh | null = null;
  private dropMeshes: THREE.Mesh[] = [];
  private standupMats: THREE.MeshStandardMaterial[] = [];
  private bumperCapMats: THREE.MeshStandardMaterial[] = [];
  private slingMats: THREE.MeshStandardMaterial[] = [];
  private beanMesh: THREE.Mesh | null = null;
  private beanMat: THREE.MeshStandardMaterial | null = null;
  private lamps: {
    mesh: THREE.Mesh;
    mat: THREE.MeshStandardMaterial;
    kind:
      | { t: 'rollover'; i: number }
      | { t: 'chicago'; i: number }
      | { t: 'sport'; i: number }
      | { t: 'kickback' }
      | { t: 'mystery' }
      | { t: 'express' }
      | { t: 'lock'; i: number }
      | { t: 'save' }
      | { t: 'loop'; i: number };
  }[] = [];
  private floodlights: THREE.SpotLight[] = [];

  // Impact sparks: a shared pool of tiny emissive motes thrown off by
  // bumper / sling / drop-target hits. Fade by shrinking (no per-particle
  // material, so the pool stays cheap).
  /** One InstancedMesh per spark colour: a bumper storm during multiball
   *  used to cost one draw call per mote (up to 90); now it's one per
   *  colour no matter how many are alive. */
  private sparkGroups = new Map<
    string,
    { mesh: THREE.InstancedMesh; free: number[] }
  >();
  private sparks: {
    color: string;
    idx: number;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    max: number;
  }[] = [];
  /** One geometry shared by every spark (was one per particle). */
  private sparkGeo = new THREE.SphereGeometry(2.2, 6, 4);
  private static readonly SPARKS_PER_COLOR = 48;
  private sparkMatrix = new THREE.Matrix4();
  /** Trail ghost geometries, cached per position in the trail. */
  private trailGeos: THREE.SphereGeometry[] = [];
  /** Static furniture accumulated during build, merged into one mesh per
   *  material at the end — the playfield has ~90 posts/rails/rings and
   *  they were costing ~90 draw calls a frame. */
  private staticChrome: THREE.BufferGeometry[] = [];
  private staticRail: THREE.BufferGeometry[] = [];
  private staticRubber: THREE.BufferGeometry[] = [];
  private prevBumperFlash: number[] = [];
  private prevSlingFlash: number[] = [];
  private prevDropHit: boolean[] = [];

  // Skyline / train / stadium
  private trainCars: THREE.Group[] = [];
  private trainLight: THREE.PointLight | null = null;
  private trainCurve: THREE.Curve<THREE.Vector3> | null = null;
  private stadiumChase: THREE.MeshStandardMaterial[] = [];
  private stadiumBanners: THREE.MeshStandardMaterial[] = [];

  // Sports attraction FX — timers in ms, set by sportEvent().
  private sportFx = SPORTS.map(() => 0);
  private batGroup: THREE.Group | null = null;
  private puckMesh: THREE.Mesh | null = null;
  private hockeyLampMat: THREE.MeshStandardMaterial | null = null;
  private basketNetMat: THREE.MeshStandardMaterial | null = null;
  private footballPostMat: THREE.MeshStandardMaterial | null = null;
  private soccerLampMat: THREE.MeshStandardMaterial | null = null;
  private diamondFlashMat: THREE.MeshStandardMaterial | null = null;

  private readonly quality: 'high' | 'mobile';

  constructor(glCanvas: HTMLCanvasElement, uiCanvas: HTMLCanvasElement) {
    // Mobile GPUs get a lighter renderer: lower pixel ratio, no shadows.
    const coarse =
      typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.quality = coarse ? 'mobile' : 'high';

    this.three = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
    this.three.setSize(540, 960, false);
    this.three.setPixelRatio(
      Math.min(this.quality === 'mobile' ? 1.5 : 2, window.devicePixelRatio || 1),
    );
    this.three.shadowMap.enabled = this.quality === 'high';
    this.three.shadowMap.type = THREE.PCFSoftShadowMap;
    this.three.toneMapping = THREE.ACESFilmicToneMapping;
    this.three.toneMappingExposure = 1.1;

    this.overlay = uiCanvas.getContext('2d')!;
    this.overlay.scale(2, 2); // ui canvas is 1080×1920 for crisp text

    // High, near-top-down view filling the frame: the whole table plus the
    // backbox head, slight perspective. Fixed logical coordinates — CSS
    // scales the canvas, never the physics.
    this.camera = new THREE.PerspectiveCamera(40, 540 / 960, 10, 4000);
    this.camera.position.set(PLAYFIELD_W / 2, 1010, PLAYFIELD_H + 210);
    this.camera.lookAt(PLAYFIELD_W / 2, -20, 495);

    this.scene.background = new THREE.Color('#04050c');
    this.scene.fog = new THREE.Fog('#04050c', 1800, 3200);

    // Lighting: soft ambient + a cool key + warm floodlights from the
    // marquee corners, echoing a showroom machine.
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.5));
    const key = new THREE.DirectionalLight(0xcfe0ff, 0.55);
    key.position.set(PLAYFIELD_W / 2, 900, 700);
    key.target.position.set(PLAYFIELD_W / 2, 0, 450);
    this.scene.add(key, key.target);
    for (const fx of [40, PLAYFIELD_W - 40]) {
      const spot = new THREE.SpotLight(0xffe7c0, 230000, 0, 0.55, 0.55, 1.8);
      spot.position.set(fx, 330, 50); // just in front of the backbox face
      spot.target.position.set(PLAYFIELD_W / 2, 0, 560);
      spot.castShadow = this.quality === 'high';
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

  // ── Game-facing interface ────────────────────────────────────────────────

  pushToast(text: string, color = COLOR.NEON_AMBER, ttl = 1400) {
    this.toasts.push({ text, color, ttl, total: ttl });
  }

  triggerJackpotFlash() {
    this.flashJackpot = 1500;
  }

  kick(amp: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeMs = 90;
    // Haptics on touch devices — pulse length scales with the hit.
    if (this.quality === 'mobile' && typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(Math.min(60, Math.round(amp * 12)));
      } catch {
        /* vibration blocked — fine */
      }
    }
  }

  sportEvent(sportIdx: number, type: 'start' | 'hit' | 'complete') {
    this.sportFx[sportIdx] = type === 'complete' ? 1600 : 900;
  }

  /** Throw a burst of sparks from a playfield point (2D x,z + height). */
  private spawnSparks(x: number, z: number, y: number, color: string, count: number) {
    const cap = Renderer3D.SPARKS_PER_COLOR;
    let group = this.sparkGroups.get(color);
    if (!group) {
      const mesh = new THREE.InstancedMesh(
        this.sparkGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }),
        cap,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      // Park every instance at zero scale until it's claimed.
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, zero);
      this.scene.add(mesh);
      group = { mesh, free: Array.from({ length: cap }, (_, i) => i) };
      this.sparkGroups.set(color, group);
    }
    const n = this.quality === 'mobile' ? Math.ceil(count / 2) : count;
    for (let i = 0; i < n; i++) {
      const idx = group.free.pop();
      if (idx === undefined) return; // this colour is saturated
      const a = Math.random() * Math.PI * 2;
      const speed = 1.6 + Math.random() * 2.6;
      const max = 260 + Math.random() * 220;
      this.sparks.push({
        color,
        idx,
        x,
        y,
        z,
        vx: Math.cos(a) * speed,
        vy: 1.2 + Math.random() * 2.4,
        vz: Math.sin(a) * speed,
        life: max,
        max,
      });
    }
  }

  private tickSparks(dtMs: number) {
    if (this.sparks.length === 0) return;
    const f = dtMs / 16.667;
    const touched = new Set<string>();
    const zero = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      const group = this.sparkGroups.get(p.color)!;
      touched.add(p.color);
      p.life -= dtMs;
      if (p.life <= 0) {
        this.sparkMatrix.makeScale(zero, zero, zero);
        group.mesh.setMatrixAt(p.idx, this.sparkMatrix);
        group.free.push(p.idx);
        this.sparks.splice(i, 1);
        continue;
      }
      p.vy -= 0.32 * f; // gravity pulls the motes back to the wood
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.z += p.vz * f;
      if (p.y < 2) {
        p.y = 2;
        p.vy *= -0.35;
      }
      const s = Math.max(0.05, p.life / p.max);
      this.sparkMatrix.makeScale(s, s, s);
      this.sparkMatrix.setPosition(p.x, p.y, p.z);
      group.mesh.setMatrixAt(p.idx, this.sparkMatrix);
    }
    for (const c of touched) {
      this.sparkGroups.get(c)!.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  tick(dtMs: number) {
    this.tickSparks(dtMs);
    for (const t of this.toasts) t.ttl -= dtMs;
    this.toasts = this.toasts.filter((t) => t.ttl > 0);
    if (this.flashJackpot > 0) this.flashJackpot -= dtMs;
    if (this.shakeMs > 0) {
      this.shakeMs -= dtMs;
      if (this.shakeMs <= 0) this.shakeAmp = 0;
    }
    for (let i = 0; i < this.sportFx.length; i++) {
      if (this.sportFx[i] > 0) this.sportFx[i] = Math.max(0, this.sportFx[i] - dtMs);
    }
  }

  // ── Shared materials ─────────────────────────────────────────────────────

  private railMat = new THREE.MeshStandardMaterial({
    color: 0xb8c2d4,
    metalness: 0.9,
    roughness: 0.28,
  });
  private chromeMat = new THREE.MeshStandardMaterial({
    color: 0xdfe6f2,
    metalness: 1,
    roughness: 0.15,
  });
  private woodMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.8 });
  private rubberMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });

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
    this.paintSportsZones(fctx, pf);
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

    this.buildCabinet();
    this.buildBackbox();
    this.buildSkyline();
    this.buildStadium();
    this.buildWallsAndPosts(pf);
    this.buildToys(pf);
    this.buildRampsAndWireforms(pf);
    this.buildAttractions(pf);
    this.buildLamps(pf);
    // Everything static and chrome collapses into three meshes.
    this.flushStaticGeometry();
    if (new URLSearchParams(location.search).has('debug')) this.buildDebug(pf);
  }

  /** Cabinet: wooden body with visible playfield thickness, brushed side
   *  rails and a chrome lockdown bar at the player end. */
  private buildCabinet() {
    // Playfield board thickness, visible at the drain edge.
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(PLAYFIELD_W, 14, PLAYFIELD_H),
      this.woodMat,
    );
    board.position.set(PLAYFIELD_W / 2, -7.2, PLAYFIELD_H / 2);
    this.scene.add(board);

    for (const sx of [-8, PLAYFIELD_W + 8]) {
      const side = new THREE.Mesh(
        new THREE.BoxGeometry(16, 90, PLAYFIELD_H + 40),
        this.woodMat,
      );
      side.position.set(sx, 30, PLAYFIELD_H / 2);
      this.scene.add(side);
      // Brushed-steel side rail capping the wall.
      const railCap = new THREE.Mesh(
        new THREE.BoxGeometry(15, 5, PLAYFIELD_H + 40),
        this.railMat,
      );
      railCap.position.set(sx, 77, PLAYFIELD_H / 2);
      this.scene.add(railCap);
    }
    // Lockdown bar across the player end.
    const lockdown = new THREE.Mesh(
      new THREE.BoxGeometry(PLAYFIELD_W + 48, 12, 26),
      this.chromeMat,
    );
    lockdown.position.set(PLAYFIELD_W / 2, 36, PLAYFIELD_H + 26);
    this.scene.add(lockdown);
    const front = new THREE.Mesh(new THREE.BoxGeometry(PLAYFIELD_W + 48, 70, 18), this.woodMat);
    front.position.set(PLAYFIELD_W / 2, -2, PLAYFIELD_H + 28);
    this.scene.add(front);
  }

  /** Backbox at the very rear; marquee art on its face. The DMD rides a
   *  speaker panel forward of the skyline so nothing occludes it. */
  private buildBackbox() {
    const backbox = new THREE.Mesh(
      new THREE.BoxGeometry(PLAYFIELD_W + 48, 240, 20),
      this.woodMat,
    );
    backbox.position.set(PLAYFIELD_W / 2, 84, 34);
    this.scene.add(backbox);

    const marqueeCanvas = document.createElement('canvas');
    marqueeCanvas.width = 1080;
    marqueeCanvas.height = 240;
    this.paintMarquee(marqueeCanvas.getContext('2d')!);
    const marqueeTex = new THREE.CanvasTexture(marqueeCanvas);
    marqueeTex.colorSpace = THREE.SRGBColorSpace;
    const marquee = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAYFIELD_W + 40, 132),
      new THREE.MeshBasicMaterial({ map: marqueeTex }),
    );
    // Top edge stays inside the camera frustum (~y 205 at this depth).
    marquee.position.set(PLAYFIELD_W / 2, 136, 44.5);
    this.scene.add(marquee);

    // Speaker-panel wedge carrying the DMD, in front of the skyline.
    const wedge = new THREE.Mesh(
      new THREE.BoxGeometry(PLAYFIELD_W - 4, 12, 16),
      new THREE.MeshStandardMaterial({ color: 0x120b08, roughness: 0.7 }),
    );
    wedge.position.set(PLAYFIELD_W / 2, 5, 121);
    this.scene.add(wedge);
    const dmdPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAYFIELD_W - 20, 64),
      new THREE.MeshBasicMaterial({ map: this.dmdTexture }),
    );
    dmdPanel.position.set(PLAYFIELD_W / 2, 40, 122);
    dmdPanel.rotation.x = -0.12;
    this.scene.add(dmdPanel);
  }

  /** Lit-window texture shared by all the miniature buildings. */
  private makeWindowTexture(seed: number, tint: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 32, 64);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 6; x++) {
        const h = (seed * 761 + x * 137 + y * 31) % 97;
        if (h < 46) {
          ctx.fillStyle = h < 8 ? tint : COLOR.WINDOW_LIGHT;
          ctx.globalAlpha = 0.55 + (h % 5) / 10;
          ctx.fillRect(2 + x * 5, 2 + y * 4, 3, 2);
        }
      }
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** The centerpiece: a modeled downtown on the dead shelf behind the back
   *  wall, ringed by the elevated L track with a running train. */
  private buildSkyline() {
    const group = new THREE.Group();

    // Riverwalk base plate under the towers.
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(360, 6, 66),
      new THREE.MeshStandardMaterial({ color: 0x101826, roughness: 0.9 }),
    );
    base.position.set(PLAYFIELD_W / 2, 3, SKYLINE_Z);
    group.add(base);

    const winTexA = this.makeWindowTexture(1, '#7fd1e8');
    const winTexB = this.makeWindowTexture(2, '#ffb347');
    const buildingMat = (tex: THREE.CanvasTexture) =>
      new THREE.MeshStandardMaterial({
        color: 0x0b1220,
        roughness: 0.6,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.9,
      });

    const towers: Array<[number, number, number, number, number]> = [
      // x, z, w, d, h — front faces stay behind the DMD (z + d/2 ≤ 114).
      [105, 95, 36, 28, 42],
      [158, 82, 34, 26, 58],
      [196, 96, 30, 24, 78],
      [232, 78, 34, 26, 100],
      [312, 76, 32, 26, 88],
      [348, 94, 30, 24, 66],
      [382, 82, 32, 24, 48],
      [435, 96, 34, 26, 44],
    ];
    towers.forEach(([x, z, w, d, h], i) => {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        buildingMat(i % 2 ? winTexA : winTexB),
      );
      b.position.set(x, h / 2 + 4, z);
      group.add(b);
      // Rooftop beacon on the taller towers.
      if (h > 70) {
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(1.6, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xff3a4f }),
        );
        beacon.position.set(x, h + 6, z);
        group.add(beacon);
      }
    });

    // Willis-inspired tower: three stacked tiers + twin antennas.
    const willisMat = buildingMat(winTexA);
    const tiers: Array<[number, number, number]> = [
      [40, 92, 30],
      [28, 116, 22],
      [18, 134, 14],
    ];
    for (const [w, top, d] of tiers) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(w, top, d), willisMat);
      tier.position.set(270, top / 2 + 4, 88);
      group.add(tier);
    }
    // Antennas stop short of the marquee title line behind them.
    for (const ax of [263, 277]) {
      const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.8, 14, 6),
        this.chromeMat,
      );
      antenna.position.set(ax, 141, 88);
      group.add(antenna);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(1.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff3a4f }),
      );
      tip.position.set(ax, 149, 88);
      group.add(tip);
    }

    // ── The elevated L loop around the skyline. ──
    const ellipsePts = (y: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push(
          new THREE.Vector3(270 + Math.cos(a) * 135, y, SKYLINE_Z + Math.sin(a) * 26),
        );
      }
      return pts;
    };
    const track = new THREE.CatmullRomCurve3(ellipsePts(42), true);
    this.trainCurve = track;
    const rail = new THREE.Mesh(new THREE.TubeGeometry(track, 64, 1.4, 6, true), this.railMat);
    group.add(rail);
    // Blue under-lighting beneath the track.
    const glow = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ellipsePts(38), true), 64, 1.1, 6, true),
      new THREE.MeshBasicMaterial({ color: 0x2a6cff }),
    );
    group.add(glow);
    // Trestle legs — instanced, purely in the dead zone.
    const legGeo = new THREE.CylinderGeometry(1.4, 1.4, 42, 6);
    const legs = new THREE.InstancedMesh(legGeo, this.railMat, 12);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 12; i++) {
      const p = track.getPoint(i / 12);
      m.setPosition(p.x, 21, p.z);
      legs.setMatrixAt(i, m);
    }
    group.add(legs);

    // Train cars (positions driven per-frame by hud.trainPhase).
    const carBodyMat = new THREE.MeshStandardMaterial({
      color: 0xb9c2cf,
      metalness: 0.7,
      roughness: 0.35,
    });
    const carWinMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    for (let i = 0; i < 3; i++) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(26, 10, 9), carBodyMat);
      body.position.y = 5;
      car.add(body);
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(26.4, 2.2, 9.4),
        new THREE.MeshStandardMaterial({ color: 0xd62a3e, roughness: 0.5 }),
      );
      stripe.position.y = 2.4;
      car.add(stripe);
      const win = new THREE.Mesh(new THREE.BoxGeometry(22, 3, 9.6), carWinMat);
      win.position.y = 6.4;
      car.add(win);
      car.visible = false;
      this.trainCars.push(car);
      group.add(car);
    }
    this.trainLight = new THREE.PointLight(0x5a9cff, 5000, 160, 2);
    this.trainLight.visible = false;
    group.add(this.trainLight);

    this.scene.add(group);
  }

  /** Raised arena over the flag banner: an oval grandstand ring on chrome
   *  standoffs (with matching physics posts), red/white/blue chase lights
   *  and one lit banner per completed sport. */
  private buildStadium() {
    const cx = PLAYFIELD_W / 2;
    const cz = 600;
    const group = new THREE.Group();

    // Grandstand tiers — two squashed tori.
    const tierMat = new THREE.MeshStandardMaterial({ color: 0x46587a, roughness: 0.5 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(86, 7, 12, 48), tierMat);
    rim.rotation.x = -Math.PI / 2;
    rim.scale.set(1, 0.5, 1);
    rim.position.set(cx, 34, cz);
    group.add(rim);
    const lower = new THREE.Mesh(
      new THREE.TorusGeometry(80, 9, 12, 48),
      new THREE.MeshStandardMaterial({ color: 0x2c3d5c, roughness: 0.65 }),
    );
    lower.rotation.x = -Math.PI / 2;
    lower.scale.set(1, 0.5, 1);
    lower.position.set(cx, 26, cz);
    group.add(lower);

    // Chase lights around the rim.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x223048,
        emissive: new THREE.Color(i % 3 === 0 ? '#e6293e' : i % 3 === 1 ? '#f5fbff' : '#4a90ff'),
        emissiveIntensity: 0.25,
      });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(3.6, 10, 8), mat);
      bulb.position.set(cx + Math.cos(a) * 86, 40, cz + Math.sin(a) * 43);
      this.stadiumChase.push(mat);
      group.add(bulb);
    }

    // Five sport banners on the south face — the Crosstown ladder inserts.
    // Tilted up so the high camera reads them.
    SPORTS.forEach((s, i) => {
      const a = Math.PI * (0.62 + i * 0.19); // fan across the front arc
      const mat = new THREE.MeshStandardMaterial({
        color: 0x1a2436,
        emissive: new THREE.Color(sportColor(s.id)),
        emissiveIntensity: 0.12,
      });
      const banner = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 2.4), mat);
      const bx = cx + Math.cos(a) * 88;
      const bz = cz + Math.sin(a) * 45;
      banner.position.set(bx, 31, bz);
      banner.lookAt(cx, 96, cz);
      this.stadiumBanners.push(mat);
      group.add(banner);
    });

    // Chrome standoffs — the same coordinates carry physics posts in the
    // Playfield, so the ball collides with what it sees.
    for (const [px, pz] of [
      [209, 570],
      [331, 570],
      [209, 630],
      [331, 630],
    ]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, 34, 12), this.chromeMat);
      leg.position.set(px, 17, pz);
      leg.castShadow = true;
      group.add(leg);
    }
    this.scene.add(group);
  }

  /** Rails / posts / walls straight from the physics bodies — with black
   *  rubber rings on the round posts. */
  private buildWallsAndPosts(pf: Playfield) {
    for (const w of pf.walls) {
      if (w.kind === 'wood' || w.outline.length === 0) continue;
      const body = w.body;
      const radius = (body as unknown as { circleRadius?: number }).circleRadius;
      if (radius) {
        this.addStatic(
          this.staticRail,
          new THREE.CylinderGeometry(radius, radius, 26, 16),
          body.position.x,
          13,
          body.position.y,
        );
        this.addRubberRing(radius + 0.6, 2, body.position.x, 12, body.position.y);
        continue;
      }
      const v = w.outline;
      if (v.length < 4) continue;
      const len = Math.hypot(v[1].x - v[0].x, v[1].y - v[0].y);
      const thick = Math.hypot(v[2].x - v[1].x, v[2].y - v[1].y);
      this.addStatic(
        this.staticRail,
        new THREE.BoxGeometry(len, 22, thick),
        body.position.x,
        11,
        body.position.y,
        -Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x),
      );
    }
    for (const p of pf.postPositions) {
      const r = p.r ?? 5;
      this.addStatic(this.staticRail, new THREE.CylinderGeometry(r, r + 1, 20, 14), p.x, 10, p.y);
      this.addRubberRing(r + 0.6, 1.8, p.x, 10, p.y);
    }
  }

  /** Bake one piece of static furniture into a merge bucket. */
  private addStatic(
    bucket: THREE.BufferGeometry[],
    geo: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    rotY = 0,
  ) {
    if (rotY) geo.applyMatrix4(new THREE.Matrix4().makeRotationY(rotY));
    geo.translate(x, y, z);
    bucket.push(geo);
  }

  private addRubberRing(radius: number, tube: number, x: number, y: number, z: number) {
    const geo = new THREE.TorusGeometry(radius, tube, 8, 14);
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    geo.translate(x, y, z);
    this.staticRubber.push(geo);
  }

  /** Collapse every baked bucket into a single mesh per material. */
  private flushStaticGeometry() {
    const buckets: Array<[THREE.BufferGeometry[], THREE.Material]> = [
      [this.staticRail, this.railMat],
      [this.staticChrome, this.chromeMat],
      [this.staticRubber, this.rubberMat],
    ];
    for (const [geos, mat] of buckets) {
      if (geos.length === 0) continue;
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      geos.length = 0;
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  /** Slings, bumpers, Bean, scoops, drops, standups, captive, spinner,
   *  flippers, plunger, apron. */
  private buildToys(pf: Playfield) {
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
        this.railMat,
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

    // The Bean — squashed chrome sphere (Cloud Gate); doubles as the
    // Lake Shore multiball lock.
    this.beanMat = new THREE.MeshStandardMaterial({
      color: 0xf2f5fa,
      metalness: 1,
      roughness: 0.06,
      emissive: new THREE.Color('#ffb547'),
      emissiveIntensity: 0,
    });
    const bean = new THREE.Mesh(new THREE.SphereGeometry(pf.bean.radius + 6, 48, 32), this.beanMat);
    bean.scale.set(1.25, 0.8, 1);
    bean.position.set(pf.bean.cx, 20, pf.bean.cy);
    bean.castShadow = true;
    this.beanMesh = bean;
    this.scene.add(bean);

    // Scoops: dark kickout hole + metal ring.
    for (const sc of [pf.lakeMichiganScoop, pf.cityTourScoop]) {
      const hole = new THREE.Mesh(
        new THREE.CircleGeometry(15, 24),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
      );
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(sc.x, 0.6, sc.y);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 2.4, 10, 28), this.railMat);
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

    // Captive lane: rails, cap and stop posts were physics-only before —
    // invisible walls the ball visibly bounced off. Build them from the
    // same numbers the entity uses.
    {
      const cx = pf.captive.x;
      const cy = pf.captive.y;
      const laneTop = cy - 74;
      const wallLen = 70;
      for (const sx of [cx - 23, cx + 23]) {
        this.addStatic(
          this.staticRail,
          new THREE.BoxGeometry(6, 22, wallLen),
          sx,
          11,
          laneTop + wallLen / 2,
        );
      }
      this.addStatic(this.staticRail, new THREE.BoxGeometry(52, 22, 6), cx, 11, laneTop - 3);
      for (const p of pf.captive.posts) {
        this.addStatic(
          this.staticRail,
          new THREE.CylinderGeometry(p.r, p.r + 1, 20, 12),
          p.x,
          10,
          p.y,
        );
        this.addRubberRing(p.r + 0.6, 1.6, p.x, 10, p.y);
      }
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

    // Flippers — sized off each bat's own dimensions.
    const flipperDefs = [
      { f: pf.leftFlipper, key: 'left' as const, color: 0xd62a3e },
      { f: pf.rightFlipper, key: 'right' as const, color: 0xd62a3e },
    ];
    for (const { f, key, color } of flipperDefs) {
      const pivot = f.pivot.pointA;
      const group = new THREE.Group();
      group.position.set(pivot.x, 9, pivot.y);
      const bat = new THREE.Mesh(
        new THREE.CapsuleGeometry(f.height / 2, f.len - f.height, 6, 12),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4 }),
      );
      bat.rotation.z = Math.PI / 2;
      bat.position.x = f.len / 2 - 4;
      bat.castShadow = true;
      group.add(bat);
      this.flipperGroups.push({ group, pf: key });
      this.scene.add(group);
    }

    // Plunger.
    const plunger = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 9, 30, 12),
      new THREE.MeshStandardMaterial({ color: 0xd62a3e, roughness: 0.4 }),
    );
    plunger.position.set(pf.plunger.body.position.x, 10, pf.plunger.body.position.y);
    this.scene.add(plunger);

    // Apron — painted sloped panel covering the drain (the shooter lane to
    // its right stays open so the ball is visible at rest).
    const apronCanvas = document.createElement('canvas');
    apronCanvas.width = 960;
    apronCanvas.height = 160;
    this.paintApron(apronCanvas.getContext('2d')!);
    const apronTex = new THREE.CanvasTexture(apronCanvas);
    apronTex.colorSpace = THREE.SRGBColorSpace;
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAYFIELD_W - 60, 78),
      new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.55, metalness: 0.1 }),
    );
    apron.rotation.x = -Math.PI / 2 + 0.3;
    apron.position.set(PLAYFIELD_W / 2 - 30, 14, PLAYFIELD_H - 42);
    this.scene.add(apron);
  }

  /** Molded acrylic ramp channels + true chrome wireform returns with
   *  crossbars, support posts and under-ramp LED strips. */
  private buildRampsAndWireforms(pf: Playfield) {
    const rampSpec = [
      { ramp: pf.leftRamp, led: '#ff3a4f' },
      { ramp: pf.rightRamp, led: '#2a6cff' },
    ];
    for (const { ramp, led } of rampSpec) {
      const n = ramp.plate.length;
      const pts = ramp.plate.map((p, i) =>
        toV3(p, 2 + 24 * Math.min(1, i / (n - 2) + 0.08)),
      );
      this.scene.add(this.acrylicChannel(pts, 26, 13));
      // Under-ramp LED strip.
      const ledCurve = new THREE.CatmullRomCurve3(
        pts.map((p) => new THREE.Vector3(p.x, Math.max(1.2, p.y - 3), p.z)),
      );
      this.scene.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(ledCurve, 40, 1.4, 6, false),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(led) }),
        ),
      );
      // Support posts where the channel is high (over quiet floor).
      for (const i of [Math.floor(n * 0.55), n - 2]) {
        const p = pts[i];
        this.addStatic(
          this.staticChrome,
          new THREE.CylinderGeometry(1.6, 1.6, p.y, 8),
          p.x,
          p.y / 2,
          p.z,
        );
      }
      // Wireform return: twin chrome rails + crossbar rings.
      const hn = ramp.habitrail.length;
      // Height profile holds the rail high until the final dive into the
      // inlane, so it clears the upper mini flipper (bat top y 20) where
      // the right-ramp return crosses its channel.
      const railPts = ramp.habitrail.map((p, i) => {
        const t = i / (hn - 1);
        return toV3(p, t < 0.72 ? 28 : 28 - 26 * Math.pow((t - 0.72) / 0.28, 1.15));
      });
      this.scene.add(this.wireform(railPts));
    }

    // Shooter-lane wireform across the back.
    const shooterPts = pf
      .shooterPath(pf.rolloverXs[1])
      .map((p, i, arr) => toV3(p, 26 - 22 * (i / (arr.length - 1))));
    this.scene.add(this.wireform(shooterPts));

    // EL EXPRESS wireform: right outlane up over the shooter-lane divider,
    // down onto the plunger — the rescue ride the Express fare buys.
    const exPts = pf
      .expressPath()
      .map((p, i, arr) => toV3(p, 4 + 24 * Math.sin((i / (arr.length - 1)) * Math.PI)));
    this.scene.add(this.wireform(exPts));
    // Station sign bridges the outlane from the divider rail to the wall,
    // clear above ball height (tops at y 22) so drains pass beneath it.
    const gate = new THREE.Mesh(new THREE.BoxGeometry(44, 14, 4), this.railMat);
    gate.position.set(460, 31, pf.expressPos.y - 14);
    this.scene.add(gate);
  }

  /** Twin parallel chrome tubes with crossbar rings — a real habitrail. */
  private wireform(pts: THREE.Vector3[]): THREE.Group {
    const group = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(pts);
    for (const off of [-3.2, 3.2]) {
      // Sample the base curve and push each point sideways in the xz plane.
      const offsetPts: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const p = curve.getPoint(t);
        const tan = curve.getTangent(t);
        const px = -tan.z;
        const pz = tan.x;
        const len = Math.hypot(px, pz) || 1;
        offsetPts.push(
          new THREE.Vector3(p.x + (px / len) * off, p.y, p.z + (pz / len) * off),
        );
      }
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(offsetPts), 48, 1.4, 6, false),
          this.chromeMat,
        ),
      );
    }
    // Crossbar half-rings every few segments.
    const ringGeo = new THREE.TorusGeometry(4.4, 0.7, 6, 10, Math.PI);
    const count = 9;
    const rings = new THREE.InstancedMesh(ringGeo, this.chromeMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t).normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
      rings.setMatrixAt(i, m);
    }
    void up;
    group.add(rings);
    return group;
  }

  /** Transparent U-channel (floor + two side walls) along a path. */
  private acrylicChannel(pts: THREE.Vector3[], width: number, wallH: number): THREE.Group {
    const group = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(pts);
    const N = 40;
    const half = width / 2;
    const floorPos: number[] = [];
    const leftPos: number[] = [];
    const rightPos: number[] = [];
    let prevL: THREE.Vector3 | null = null;
    let prevR: THREE.Vector3 | null = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      const px = -tan.z;
      const pz = tan.x;
      const len = Math.hypot(px, pz) || 1;
      const L = new THREE.Vector3(p.x + (px / len) * half, p.y, p.z + (pz / len) * half);
      const R = new THREE.Vector3(p.x - (px / len) * half, p.y, p.z - (pz / len) * half);
      if (prevL && prevR) {
        // Floor strip (two triangles).
        floorPos.push(prevL.x, prevL.y, prevL.z, prevR.x, prevR.y, prevR.z, L.x, L.y, L.z);
        floorPos.push(prevR.x, prevR.y, prevR.z, R.x, R.y, R.z, L.x, L.y, L.z);
        // Side walls.
        for (const [arr, a, b] of [
          [leftPos, prevL, L] as const,
          [rightPos, prevR, R] as const,
        ]) {
          arr.push(a.x, a.y, a.z, b.x, b.y, b.z, a.x, a.y + wallH, a.z);
          arr.push(b.x, b.y, b.z, b.x, b.y + wallH, b.z, a.x, a.y + wallH, a.z);
        }
      }
      prevL = L;
      prevR = R;
    }
    const acrylic = new THREE.MeshPhysicalMaterial({
      color: 0xd8ecff,
      transparent: true,
      opacity: 0.28,
      roughness: 0.08,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (const arr of [floorPos, leftPos, rightPos]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      group.add(new THREE.Mesh(geo, acrylic));
    }
    return group;
  }

  /** The five modeled sports attractions, placed at their shots. */
  private buildAttractions(pf: Playfield) {
    this.buildBaseball();
    this.buildHockey();
    this.buildFootball();
    this.buildBasketball(pf);
    this.buildSoccer(pf);
  }

  /** Raised plastic panel on chrome legs. Leg positions are explicit —
   *  they carry matching physics posts in the Playfield, and must stay
   *  clear of the ramp runs beneath the panels. */
  private raisedPanel(
    x: number,
    z: number,
    w: number,
    d: number,
    y: number,
    legs: Array<[number, number]>,
    paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ): THREE.Group {
    const group = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = w * 4;
    c.height = d * 4;
    const ctx = c.getContext('2d')!;
    ctx.scale(4, 4);
    paint(ctx, w, d);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(w, 2.5, d),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }),
    );
    plate.position.set(x, y, z);
    plate.castShadow = true;
    group.add(plate);
    for (const [lx, lz] of legs) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, y, 8), this.chromeMat);
      leg.position.set(lx, y / 2, lz);
      group.add(leg);
    }
    return group;
  }

  /** BASEBALL — miniature diamond panel + swinging bat over the left ramp.
   *  Panel rides at y44 so ramp-transit balls (drawn at y30, r11) clear its
   *  underside; legs avoid the acrylic channel crossing the SW corner. */
  private buildBaseball() {
    const group = this.raisedPanel(136, 264, 62, 52, 44, [[162, 244], [110, 288]], (ctx, w, h) => {
      ctx.fillStyle = '#2e7d3a'; // outfield grass
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c9925a'; // infield dirt
      ctx.beginPath();
      ctx.moveTo(w / 2, h - 6);
      ctx.lineTo(w - 10, h / 2);
      ctx.lineTo(w / 2, 6);
      ctx.lineTo(10, h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#f5fbff';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // Bases.
      ctx.fillStyle = '#f5fbff';
      for (const [bx, by] of [
        [w / 2, h - 8],
        [w - 12, h / 2],
        [w / 2, 8],
        [12, h / 2],
      ]) {
        ctx.fillRect(bx - 2, by - 2, 4, 4);
      }
      ctx.fillStyle = '#c9925a';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    // Swinging bat at home plate.
    const bat = new THREE.Group();
    const stick = new THREE.Mesh(
      new THREE.CapsuleGeometry(1.6, 16, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xc9925a, roughness: 0.5 }),
    );
    stick.rotation.z = Math.PI / 2;
    stick.position.x = 9;
    bat.add(stick);
    bat.position.set(136, 47.5, 284);
    this.batGroup = bat;
    group.add(bat);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xf5fbff, roughness: 0.4 }),
    );
    ball.position.set(136, 47.5, 254);
    group.add(ball);
    // Diamond flash lamp under the panel.
    const flashMat = new THREE.MeshStandardMaterial({
      color: 0x223048,
      emissive: new THREE.Color('#ff3a4f'),
      emissiveIntensity: 0.12,
    });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 8), flashMat);
    flash.position.set(136, 8, 240);
    this.diamondFlashMat = flashMat;
    group.add(flash);
    this.scene.add(group);
  }

  /** HOCKEY — ice panel, goal cage, puck and a real goal light. */
  private buildHockey() {
    const group = this.raisedPanel(404, 260, 62, 50, 44, [[380, 236], [431, 281]], (ctx, w, h) => {
      ctx.fillStyle = '#dcecf8'; // ice
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d33'; // center line + circles
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.strokeStyle = '#36c';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(60,100,160,0.5)';
      ctx.strokeRect(1, 1, w - 2, h - 2);
    });
    // Goal cage: red frame + translucent net.
    const goal = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xd62a3e, roughness: 0.4 });
    for (const [gx, gz] of [
      [-9, 0],
      [9, 0],
    ]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10, 8), frameMat);
      post.position.set(gx, 5, gz);
      goal.add(post);
    }
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 18, 8), frameMat);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.y = 10;
    goal.add(crossbar);
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 10),
      new THREE.MeshStandardMaterial({
        color: 0xf5fbff,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      }),
    );
    net.rotation.x = 0.5;
    net.position.set(0, 5.4, -3.4);
    goal.add(net);
    goal.position.set(404, 45.2, 246);
    group.add(goal);
    // Puck.
    const puck = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 1.6, 14),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.6 }),
    );
    puck.position.set(404, 46.4, 268);
    this.puckMesh = puck;
    group.add(puck);
    // Rotating goal light on a pole behind the cage.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 14, 8), this.chromeMat);
    pole.position.set(422, 51, 242);
    group.add(pole);
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x300a10,
      emissive: new THREE.Color('#ff2030'),
      emissiveIntensity: 0.15,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 8), lampMat);
    dome.position.set(422, 59, 242);
    this.hockeyLampMat = lampMat;
    group.add(dome);
    this.scene.add(group);
  }

  /** FOOTBALL — turf strip up the left orbit with raised goalposts the
   *  return wireform threads through. */
  private buildFootball() {
    const group = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({
      color: 0xf2c744,
      roughness: 0.4,
      emissive: new THREE.Color('#f2c744'),
      emissiveIntensity: 0.1,
    });
    this.footballPostMat = postMat;
    // Single base at the wall, gooseneck out over the lane.
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 40, 8), postMat);
    base.position.set(8, 20, 352);
    group.add(base);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 18, 8), postMat);
    neck.rotation.z = Math.PI / 2;
    neck.position.set(17, 40, 352);
    group.add(neck);
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 30, 8), postMat);
    crossbar.rotation.x = Math.PI / 2;
    crossbar.position.set(26, 40, 352);
    group.add(crossbar);
    for (const uz of [337, 367]) {
      const upright = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 30, 8), postMat);
      upright.position.set(26, 55, uz);
      group.add(upright);
    }
    this.scene.add(group);
  }

  /** BASKETBALL — backboard, rim and net above the shooter-lane divider;
   *  the right-ramp shot "swishes" it. */
  private buildBasketball(pf: Playfield) {
    void pf;
    const group = new THREE.Group();
    // Pole sits inside the shooter-lane divider wall (x 477–483) so lane
    // balls (surfaces reach x 483) never clip it.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 54, 10), this.chromeMat);
    pole.position.set(480, 27, 396);
    group.add(pole);
    // Short arm from the pole to the backboard.
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 8, 8), this.chromeMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(483, 52, 392);
    group.add(arm);
    // Backboard with painted square.
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 72;
    const bctx = c.getContext('2d')!;
    bctx.fillStyle = 'rgba(235,244,255,0.92)';
    bctx.fillRect(0, 0, 96, 72);
    bctx.strokeStyle = '#d62a3e';
    bctx.lineWidth = 5;
    bctx.strokeRect(30, 26, 36, 30);
    bctx.strokeRect(3, 3, 90, 66);
    const btex = new THREE.CanvasTexture(c);
    btex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(24, 18, 1.6),
      new THREE.MeshStandardMaterial({ map: btex, roughness: 0.3 }),
    );
    board.position.set(486, 52, 390);
    board.rotation.y = Math.PI; // faces up-table
    group.add(board);
    // Rim + net.
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(5, 0.8, 8, 18),
      new THREE.MeshStandardMaterial({ color: 0xff6a2a, roughness: 0.35, metalness: 0.4 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(486, 45, 383);
    group.add(rim);
    const netMat = new THREE.MeshStandardMaterial({
      color: 0xf5fbff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      emissive: new THREE.Color('#f5fbff'),
      emissiveIntensity: 0.05,
      wireframe: true,
    });
    this.basketNetMat = netMat;
    const net = new THREE.Mesh(new THREE.CylinderGeometry(5, 3.4, 9, 10, 3, true), netMat);
    net.position.set(486, 40, 383);
    group.add(net);
    this.scene.add(group);
  }

  /** SOCCER — goal frame + net on the WEST side of the MODE scoop, mouth
   *  facing the hole. The east side stays open: it's the captive-lane
   *  approach corridor (posts there deflected the captive shot). */
  private buildSoccer(pf: Playfield) {
    const sx = pf.cityTourScoop.x;
    const sz = pf.cityTourScoop.y;
    const gx = sx - 17; // goal line
    const group = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf5fbff, roughness: 0.35 });
    for (const gz of [sz - 12, sz + 12]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 18, 8), frameMat);
      post.position.set(gx, 9, gz);
      group.add(post);
    }
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 25, 8), frameMat);
    crossbar.rotation.x = Math.PI / 2;
    crossbar.position.set(gx, 18, sz);
    group.add(crossbar);
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 22),
      new THREE.MeshStandardMaterial({
        color: 0xf5fbff,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        wireframe: true,
      }),
    );
    net.rotation.y = Math.PI / 2;
    net.rotation.x = -0.9;
    net.position.set(gx - 8, 10, sz);
    group.add(net);
    // Green goal lamp.
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x0a2a14,
      emissive: new THREE.Color('#5cff9a'),
      emissiveIntensity: 0.15,
    });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.8, 10, 8), lampMat);
    lamp.position.set(gx, 22, sz - 18);
    this.soccerLampMat = lampMat;
    group.add(lamp);
    this.scene.add(group);
  }

  /** Lamp inserts — real emissive discs on the wood. */
  private buildLamps(pf: Playfield) {
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
    // CHICAGO letter inserts above the stadium — 22 px spacing keeps the
    // end lamps clear of both ramp-mouth funnel rails.
    for (let i = 0; i < CHICAGO.length; i++) {
      lamp(PLAYFIELD_W / 2 - ((CHICAGO.length - 1) * 22) / 2 + i * 22, 528, 8, '#e6293e', {
        t: 'chicago',
        i,
      });
    }
    // One arrow insert per sport, at its shot.
    const sportInsertPos: Array<[number, number]> = [
      [155, 598], // baseball — left ramp mouth
      [pf.loopArrowXs[0], 622], // football — left orbit
      [325, 598], // basketball — right ramp mouth
      [pf.loopArrowXs[1], 622], // hockey — right orbit
      [pf.cityTourScoop.x, pf.cityTourScoop.y - 45], // soccer — the scoop approach
    ];
    SPORTS.forEach((s, i) => {
      const [x, z] = sportInsertPos[i];
      lamp(x, z, 7, sportColor(s.id), { t: 'sport', i });
    });
    // Ball-save insert between the flippers — blinks faster as it expires.
    lamp(pf.playCenter, 812, 8, '#5cff9a', { t: 'save' });
    lamp(pf.kickbackPos.x, pf.kickbackPos.y - 8, 6, '#5cff9a', { t: 'kickback' });
    lamp(pf.expressPos.x, pf.expressPos.y - 8, 6, '#3ff0ff', { t: 'express' });
    // Lock inserts in a small arc below the Bean — flat, so live balls can
    // roll over them (the old tucked-ball toys sat in a live ball path).
    const lockSpots: Array<[number, number]> = [
      [pf.bean.cx - 18, pf.bean.cy + 34],
      [pf.bean.cx, pf.bean.cy + 40],
      [pf.bean.cx + 18, pf.bean.cy + 34],
    ];
    lockSpots.forEach(([x, z], i) => lamp(x, z, 5, '#ff3a4f', { t: 'lock', i }));
    lamp(pf.lakeMichiganScoop.x, pf.lakeMichiganScoop.y - 34, 7, '#4ea0d8', { t: 'mystery' });
    pf.loopArrowXs.forEach((x, i) => lamp(x, 590, 8, '#7fd1e8', { t: 'loop', i }));
  }

  /** ?debug — show collision geometry as red wireframes. */
  private buildDebug(pf: Playfield) {
    const mat = new THREE.LineBasicMaterial({ color: 0xff2040 });
    for (const w of pf.walls) {
      if (w.outline.length < 3) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(
        [...w.outline, w.outline[0]].map((p) => new THREE.Vector3(p.x, 24, p.y)),
      );
      this.scene.add(new THREE.Line(geo, mat));
    }
  }

  private makeBallMesh(r = BALL_RADIUS): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0xf5f8ff, metalness: 1, roughness: 0.08 }),
    );
    mesh.castShadow = true;
    return mesh;
  }

  // ── Painted panels ───────────────────────────────────────────────────────

  /** Sport-zone artwork blended into the playfield print. */
  private paintSportsZones(ctx: CanvasRenderingContext2D, pf: Playfield) {
    ctx.save();
    ctx.globalAlpha = 0.85;

    // Football turf up the left orbit.
    ctx.fillStyle = '#1d5c2c';
    ctx.fillRect(8, 300, 34, 130);
    ctx.strokeStyle = 'rgba(245,251,255,0.75)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i <= 6; i++) {
      const y = 308 + i * 19;
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(40, y);
      ctx.stroke();
    }
    // End zone.
    ctx.fillStyle = 'rgba(230,41,62,0.8)';
    ctx.fillRect(8, 300, 34, 12);

    // Soccer pitch surrounding the MODE scoop.
    const sx = pf.cityTourScoop.x;
    const sy = pf.cityTourScoop.y;
    ctx.fillStyle = '#1d5c2c';
    ctx.fillRect(sx - 42, sy - 30, 84, 62);
    ctx.strokeStyle = 'rgba(245,251,255,0.75)';
    ctx.strokeRect(sx - 38, sy - 26, 76, 54);
    ctx.strokeRect(sx - 20, sy + 4, 40, 24); // goal box around the scoop
    ctx.beginPath();
    ctx.arc(sx, sy - 26, 9, 0, Math.PI);
    ctx.stroke();

    // Hardwood court pad under the basketball hoop (shooter-lane edge).
    ctx.fillStyle = '#b07840';
    ctx.fillRect(452, 380, 64, 52);
    ctx.strokeStyle = 'rgba(245,251,255,0.8)';
    ctx.beginPath();
    ctx.arc(486, 392, 20, 0, Math.PI);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(214,42,62,0.9)';
    ctx.strokeRect(452, 380, 64, 52);

    ctx.globalAlpha = 1;
    ctx.restore();
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
      ctx.fillRect((i * 97) % 540, ((i * 61) % 40) + (i % 2 ? 82 : 2), 1.4, 1.4);
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

  /** Painted apron: pinstriped panel with instruction cards, Stern-style. */
  private paintApron(ctx: CanvasRenderingContext2D) {
    ctx.scale(2, 2);
    const W = 480;
    const H = 80;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3c0b14');
    g.addColorStop(1, '#24060c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = COLOR.BRASS;
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(217,164,65,0.5)';
    ctx.strokeRect(11, 11, W - 22, H - 22);
    for (const cx of [132, W - 132]) {
      ctx.fillStyle = '#e8e2d0';
      ctx.fillRect(cx - 42, 20, 84, 42);
      ctx.strokeStyle = '#8a2030';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - 42, 20, 84, 42);
      ctx.fillStyle = '#8a2030';
      ctx.font = 'bold 8px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cx < W / 2 ? 'FREE PLAY' : '3 BALLS', cx, 30);
      ctx.fillStyle = 'rgba(40,40,50,0.55)';
      for (let ln = 0; ln < 4; ln++) {
        ctx.fillRect(cx - 34, 36 + ln * 6, 68 - ((ln * 23) % 20), 2);
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '3px';
    ctx.fillStyle = COLOR.BRASS;
    ctx.font = 'bold 13px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('WINDY CITY', W / 2, 32);
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '2px';
    ctx.fillStyle = 'rgba(230,220,200,0.75)';
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('SHOWDOWN', W / 2, 48);
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '0px';
    decoStar(ctx, W / 2 - 62, 40, 7, COLOR.FLAG_RED);
    decoStar(ctx, W / 2 + 62, 40, 7, COLOR.FLAG_RED);
  }

  // ── Per-frame sync + render ──────────────────────────────────────────────

  draw(pf: Playfield, hud: HudInfo) {
    if (!this.built) this.buildTable(pf);
    const now = performance.now();

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

    this.updateTrails(pf);

    // Flippers / spinner / captive.
    for (const f of this.flipperGroups) {
      const flip = f.pf === 'left' ? pf.leftFlipper : pf.rightFlipper;
      f.group.rotation.y = -flip.body.angle;
    }
    if (this.spinnerMesh) this.spinnerMesh.rotation.x = pf.spinner.body.angle;
    if (this.captiveMesh) {
      this.captiveMesh.position.set(pf.captive.ball.position.x, 10, pf.captive.ball.position.y);
    }

    // Drop targets sink when hit — and spit chips on the way down.
    pf.bank.targets.forEach((t, i) => {
      this.dropMeshes[i].position.y = t.hit ? -12 : 13;
      if (t.hit && !this.prevDropHit[i]) {
        this.spawnSparks(t.home.x, t.home.y, 16, '#9ff2ff', 8);
      }
      this.prevDropHit[i] = t.hit;
    });
    // Standups glow while lit.
    pf.standups.forEach((s, i) => {
      this.standupMats[i].emissiveIntensity = s.lit ? 1.4 : 0.25;
    });
    // Bumper + sling flashes, with a spark burst on the rising edge.
    pf.popBumpers.forEach((b, i) => {
      this.bumperCapMats[i].emissiveIntensity = 0.35 + b.flashLevel * 2.2;
      if (b.flashLevel > 0.6 && (this.prevBumperFlash[i] ?? 0) <= 0.6) {
        this.spawnSparks(b.body.position.x, b.body.position.y, 22, '#ffcf7a', 10);
      }
      this.prevBumperFlash[i] = b.flashLevel;
    });
    pf.slingshots.forEach((s, i) => {
      this.slingMats[i].emissiveIntensity = s.flashLevel * 1.6;
      if (s.flashLevel > 0.6 && (this.prevSlingFlash[i] ?? 0) <= 0.6) {
        const v = s.verts;
        this.spawnSparks(
          (v[0].x + v[1].x + v[2].x) / 3,
          (v[0].y + v[1].y + v[2].y) / 3,
          24,
          '#ffe8f0',
          8,
        );
      }
      this.prevSlingFlash[i] = s.flashLevel;
    });
    if (this.beanMesh) {
      const s = 1 + pf.bean.flashLevel * 0.08;
      this.beanMesh.scale.set(1.25 * s, 0.8 * s, s);
    }
    // The Bean pulses amber whenever it's the hot target.
    if (this.beanMat) {
      const hot = hud.mbSuperLit || hud.superSkillMs > 0;
      this.beanMat.emissiveIntensity = hot ? 0.25 + 0.35 * Math.abs(Math.sin(now / 130)) : 0;
    }

    this.animateTrain(hud);
    this.animateStadium(hud, now);
    this.animateSports(now);
    this.updateLamps(pf, hud, now);

    // Camera shake.
    const baseX = PLAYFIELD_W / 2;
    const baseY = 1010;
    if (this.shakeMs > 0 && this.shakeAmp > 0) {
      this.camera.position.x = baseX + (Math.random() - 0.5) * 2 * this.shakeAmp;
      this.camera.position.y = baseY + (Math.random() - 0.5) * this.shakeAmp;
    } else {
      this.camera.position.x = baseX;
      this.camera.position.y = baseY;
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

  /** Fading ghost spheres behind each moving ball — speed made visible. */
  private updateTrails(pf: Playfield) {
    const LEN = Renderer3D.TRAIL_LEN;
    // Record history for live balls; drop stale entries.
    const live = new Set<Matter.Body>();
    for (const b of pf.balls) {
      live.add(b.body);
      let hist = this.trailHist.get(b.body);
      if (!hist) {
        hist = [];
        this.trailHist.set(b.body, hist);
      }
      const transit = (b.body as unknown as { $transit?: boolean }).$transit;
      hist.push(new THREE.Vector3(b.body.position.x, transit ? 30 : BALL_RADIUS, b.body.position.y));
      if (hist.length > LEN + 1) hist.shift();
    }
    for (const body of this.trailHist.keys()) {
      if (!live.has(body)) this.trailHist.delete(body);
    }
    // Grow the shared pool on demand, then lay the ghosts out.
    const needed = pf.balls.length * LEN;
    while (this.trailMeshes.length < needed) {
      const i = this.trailMeshes.length % LEN;
      if (!this.trailGeos[i]) {
        this.trailGeos[i] = new THREE.SphereGeometry(BALL_RADIUS * (0.75 - i * 0.09), 10, 8);
      }
      const mesh = new THREE.Mesh(
        this.trailGeos[i],
        new THREE.MeshBasicMaterial({
          color: 0xbfd8ff,
          transparent: true,
          opacity: 0.26 - i * 0.036,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.trailMeshes.push(mesh);
      this.scene.add(mesh);
    }
    let slot = 0;
    for (const b of pf.balls) {
      const hist = this.trailHist.get(b.body)!;
      const v = Matter.Body.getVelocity(b.body);
      const fast = Math.hypot(v.x, v.y) > 5;
      for (let i = 0; i < LEN; i++) {
        const mesh = this.trailMeshes[slot++];
        const p = hist[hist.length - 2 - i];
        if (!fast || !p) {
          mesh.visible = false;
          continue;
        }
        mesh.visible = true;
        mesh.position.copy(p);
      }
    }
    for (let i = slot; i < this.trailMeshes.length; i++) this.trailMeshes[i].visible = false;
  }

  /** The L: one lap around the skyline, driven by the game clock. */
  private animateTrain(hud: HudInfo) {
    const running = hud.trainPhase >= 0 && this.trainCurve;
    for (let i = 0; i < this.trainCars.length; i++) {
      const car = this.trainCars[i];
      car.visible = !!running;
      if (!running) continue;
      const t = (hud.trainPhase + 1 - i * 0.045) % 1;
      const p = this.trainCurve!.getPoint(t);
      const tan = this.trainCurve!.getTangent(t);
      car.position.set(p.x, p.y + 4, p.z);
      car.rotation.y = Math.atan2(-tan.z, tan.x);
    }
    if (this.trainLight) {
      this.trainLight.visible = !!running;
      if (running) {
        const p = this.trainCurve!.getPoint(hud.trainPhase);
        this.trainLight.position.set(p.x, p.y - 6, p.z + 6);
      }
    }
  }

  /** Stadium: chase lights spin (fast in a wizard mode), banners burn for
   *  completed sports and blink for the running one. */
  private animateStadium(hud: HudInfo, now: number) {
    const fast = hud.crosstownActive || hud.bossActive;
    const step = Math.floor(now / (fast ? 70 : 240));
    this.stadiumChase.forEach((mat, i) => {
      const on = (step + i) % 12 < (fast ? 5 : 3);
      mat.emissiveIntensity = on ? 2.4 : 0.15;
    });
    const blink = Math.sin(now / 160) > -0.1;
    this.stadiumBanners.forEach((mat, i) => {
      const active =
        hud.activeSport === i || (hud.crosstownActive && hud.crosstownLeft.includes(i));
      mat.emissiveIntensity = hud.sportsDone[i] ? 1.9 : active && blink ? 2.4 : 0.12;
    });
  }

  /** Attraction FX driven by the sportFx timers. */
  private animateSports(now: number) {
    const fx = this.sportFx;
    // Baseball: bat swing + diamond flash.
    if (this.batGroup) {
      const f = fx[0];
      this.batGroup.rotation.y = f > 0 ? Math.sin(((900 - f) / 900) * Math.PI) * 2.4 : 0;
    }
    if (this.diamondFlashMat) {
      this.diamondFlashMat.emissiveIntensity = fx[0] > 0 ? 2.6 : 0.12;
    }
    // Football posts flash.
    if (this.footballPostMat) {
      this.footballPostMat.emissiveIntensity = fx[1] > 0 ? 1.8 : 0.1;
    }
    // Basketball net glows on the swish.
    if (this.basketNetMat) {
      this.basketNetMat.emissiveIntensity = fx[2] > 0 ? 2.2 : 0.05;
    }
    // Hockey: goal light spins bright, puck twirls.
    if (this.hockeyLampMat) {
      this.hockeyLampMat.emissiveIntensity =
        fx[3] > 0 ? 2.2 + Math.sin(now / 40) * 1.4 : 0.15;
    }
    if (this.puckMesh && fx[3] > 0) this.puckMesh.rotation.y += 0.5;
    // Soccer lamp.
    if (this.soccerLampMat) {
      this.soccerLampMat.emissiveIntensity = fx[4] > 0 ? 2.4 : 0.15;
    }
  }

  private updateLamps(pf: Playfield, hud: HudInfo, now: number) {
    const blink = Math.sin(now / 180) > -0.2;
    // Attract mode: a light wave sweeps every insert across the board.
    if (hud.state === GameState.TITLE) {
      for (const l of this.lamps) {
        const p = l.mesh.position;
        const on = Math.sin(now / 280 - (p.x + p.z) / 95) > 0.45;
        l.mat.emissiveIntensity = on ? 2.2 : 0.1;
      }
      return;
    }
    for (const l of this.lamps) {
      let on = false;
      const k = l.kind;
      if (k.t === 'rollover') on = pf.rollovers[k.i].lit;
      else if (k.t === 'chicago') on = pf.bank.litMask()[k.i];
      else if (k.t === 'sport') {
        const active =
          hud.activeSport === k.i || (hud.crosstownActive && hud.crosstownLeft.includes(k.i));
        on = hud.sportsDone[k.i] || (active && blink);
      } else if (k.t === 'save') {
        // Steady early, urgent strobe in the final seconds.
        on =
          hud.ballSaveMs > 0 &&
          (hud.ballSaveMs > 3000 ? blink : Math.sin(now / 70) > 0);
      } else if (k.t === 'kickback') on = hud.kickbackLit && blink;
      else if (k.t === 'express') on = hud.expressLit && blink;
      else if (k.t === 'lock') on = k.i < pf.bean.locked;
      else if (k.t === 'mystery') on = hud.mysteryLit;
      else if (k.t === 'loop')
        on = (hud.multiball || hud.bossActive || hud.modeKind === 'loop') && blink;
      // Combo window: eligible shot arrows strobe fast, chasing the chain.
      if (!on && hud.comboActive && (k.t === 'sport' || k.t === 'loop')) {
        on = Math.sin(now / 90) > 0;
      }
      l.mat.emissiveIntensity = on ? 2.2 : 0.1;
    }
  }

  /** DMD contents — mode-first priority, same logic as a real machine. */
  private composeDmd(hud: HudInfo) {
    const d = this.dmd;
    d.clear();
    if (hud.state === GameState.TITLE || hud.state === GameState.GAME_OVER) {
      d.centerText(hud.state === GameState.TITLE ? 'WINDY CITY SHOWDOWN' : 'GAME OVER', 1);
      const hsTag = hud.highScoreInitials ? `${hud.highScoreInitials} ` : '';
      const msgs =
        hud.state === GameState.TITLE
          ? [
              'CHICAGO SPORTS',
              hud.highScore > 0 ? `HI ${hsTag}${hud.highScore.toLocaleString()}` : 'FREE PLAY',
              'PRESS ENTER',
            ]
          : hud.enteringInitials
            ? [
                `INITIALS ${hud.initials
                  .split('')
                  .map((c, i) => (i < hud.initialsPos ? c : i === hud.initialsPos ? c : '-'))
                  .join(' ')}`,
              ]
            : [
                `FINAL ${Math.max(...hud.playerScores).toLocaleString()}`,
                hud.matched ? 'MATCH!' : 'PRESS ENTER',
              ];
      d.centerText(msgs[Math.floor(performance.now() / 2200) % msgs.length], 10);
      return;
    }
    const playerTag = hud.playerScores.length > 1 ? `P${hud.currentPlayer + 1} ` : '';
    const ebTag = hud.extraBalls > 0 ? ` +${hud.extraBalls}EB` : '';
    d.text(`${playerTag}BALL ${Math.min(3, hud.ballNumber)}${ebTag}`, 2, 1);
    d.rightText(hud.score.toLocaleString(), 1);
    const latest = this.toasts[this.toasts.length - 1];
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    const secs = (ms: number) => `${Math.max(0, Math.ceil(ms / 1000))}S`;
    // End-of-ball bonus ceremony: the classic count-up owns the display.
    if (hud.ceremonyTotal > 0) {
      const shown = Math.round((hud.ceremonyTotal * hud.ceremonyProgress) / 100) * 100;
      d.centerText(`BONUS ${shown.toLocaleString()}`, 10);
      return;
    }
    if (latest && latest.total - latest.ttl < 2400) {
      if (latest.total - latest.ttl < 350 || blink || latest.total - latest.ttl > 900) {
        d.centerText(latest.text, 10);
      }
    } else if (hud.bossActive) {
      d.capone(2, 8);
      d.bar(17, 11, 74, 5, Math.max(0, hud.bossHp) / BOSS_HP);
      d.rightText(secs(hud.bossMsLeft), 10);
    } else if (hud.crosstownActive) {
      d.centerText(`CROSSTOWN ${hud.crosstownLeft.length} LEFT ${secs(hud.modeMsLeft)}`, 10);
    } else if (hud.activeSport >= 0 && hud.hurryUpValue > 0) {
      const s = SPORTS[hud.activeSport];
      d.centerText(`${s.sport} HURRY ${Math.round(hud.hurryUpValue / 1000)}K`, 10);
    } else if (hud.activeSport >= 0) {
      const s = SPORTS[hud.activeSport];
      d.centerText(`${s.sport} ${hud.modeHits}/${hud.modeGoal} ${secs(hud.modeMsLeft)}`, 10);
    } else if (hud.multiball) {
      if (hud.mbSuperLit && blink) d.centerText('SUPER AT THE BEAN', 10);
      else if (blink) d.centerText(`JACKPOT ${Math.round(hud.mbJackpotValue / 1000)}K`, 10);
    } else if (hud.tilted) {
      if (blink) d.centerText('TILT', 10);
    } else if (hud.tiltHeat >= 2) {
      d.centerText('CAREFUL!', 10);
    } else if (hud.bossLit && hud.state === GameState.PLAYING) {
      if (blink) d.centerText('SHOWDOWN AT THE SCOOP', 10);
    } else if (hud.playerScores.length > 1) {
      const strip = hud.playerScores
        .map(
          (s, i) =>
            `${i === hud.currentPlayer ? '*' : ''}P${i + 1} ${s >= 10000 ? Math.floor(s / 1000) + 'K' : s}`,
        )
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
      for (const y of [318, 324, 452, 458]) {
        ctx.beginPath();
        ctx.moveTo(y > 400 ? 120 : 80, y);
        ctx.lineTo(PLAYFIELD_W - (y > 400 ? 120 : 80), y);
        ctx.stroke();
      }
      (ctx as unknown as { letterSpacing?: string }).letterSpacing = '8px';
      ctx.shadowColor = COLOR.FLAG_RED;
      ctx.shadowBlur = 26;
      ctx.fillStyle = COLOR.FLAG_RED;
      ctx.font = 'bold 52px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('WINDY CITY', PLAYFIELD_W / 2 + 4, 366);
      ctx.shadowColor = COLOR.FLAG_BLUE;
      ctx.shadowBlur = 18;
      ctx.fillStyle = COLOR.FLAG_BLUE;
      ctx.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('SHOWDOWN', PLAYFIELD_W / 2 + 3, 414);
      ctx.shadowBlur = 0;
      (ctx as unknown as { letterSpacing?: string }).letterSpacing = '5px';
      ctx.fillStyle = COLOR.TEXT;
      ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('CHICAGO SPORTS PINBALL', PLAYFIELD_W / 2 + 2, 444);
      (ctx as unknown as { letterSpacing?: string }).letterSpacing = '0px';
      ctx.fillStyle = COLOR.TEXT;
      ctx.font = '13px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('PLAY ALL 5 SPORTS · WIN THE CROSSTOWN · TAKE THE TITLE', PLAYFIELD_W / 2, 486);
      // The five sports, spelled out.
      ctx.fillStyle = COLOR.TEXT_DIM;
      ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(
        SPORTS.map((s) => s.sport).join(' · '),
        PLAYFIELD_W / 2,
        510,
      );
      if (hud.highScore > 0) {
        ctx.fillStyle = COLOR.TEXT_GOLD;
        ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
        const tag = hud.highScoreInitials ? `${hud.highScoreInitials}  ` : '';
        ctx.fillText(`HIGH SCORE  ${tag}${hud.highScore.toLocaleString()}`, PLAYFIELD_W / 2, 540);
      }
      if (Math.sin(performance.now() / 300) > 0) {
        ctx.shadowColor = COLOR.NEON_AMBER;
        ctx.shadowBlur = 14;
        ctx.fillStyle = COLOR.NEON_AMBER;
        ctx.font = 'bold 18px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('PRESS ENTER TO START', PLAYFIELD_W / 2, 596);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = COLOR.TEXT_DIM;
      ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('Z / ⁄ flippers · SPACE plunger · C/N nudge · M mute', PLAYFIELD_W / 2, 634);
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
      if (hud.bestCombo > 1) {
        ctx.fillStyle = COLOR.NEON_PINK;
        ctx.font = 'bold 13px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText(`BEST COMBO  ×${hud.bestCombo}`, PLAYFIELD_W / 2, after + 6);
      }
      ctx.fillStyle = hud.matched ? COLOR.NEON_GREEN : COLOR.TEXT_DIM;
      ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(
        `MATCH  ${String(hud.matchNumber).padStart(2, '0')}${hud.matched ? ' — WELL PLAYED!' : ''}`,
        PLAYFIELD_W / 2,
        after + 26,
      );
      if (hud.enteringInitials) {
        ctx.fillStyle = COLOR.NEON_AMBER;
        ctx.font = 'bold 17px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('ENTER YOUR INITIALS', PLAYFIELD_W / 2, after + 58);
        const blinkOn = Math.sin(performance.now() / 220) > -0.3;
        for (let i = 0; i < 3; i++) {
          const x = PLAYFIELD_W / 2 + (i - 1) * 44;
          const active = i === hud.initialsPos;
          ctx.strokeStyle = active ? COLOR.NEON_AMBER : COLOR.TEXT_DIM;
          ctx.lineWidth = active ? 2.5 : 1.5;
          ctx.strokeRect(x - 16, after + 76, 32, 38);
          if (!active || blinkOn) {
            ctx.fillStyle = active ? '#ffffff' : COLOR.TEXT_DIM;
            ctx.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
            ctx.fillText(i < hud.initialsPos ? hud.initials[i] : active ? hud.initials[i] : '·', x, after + 96);
          }
        }
        ctx.fillStyle = COLOR.TEXT_DIM;
        ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('FLIPPERS CHANGE LETTER · SPACE / ENTER LOCKS IT', PLAYFIELD_W / 2, after + 132);
      } else if (Math.sin(performance.now() / 300) > 0) {
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

    // Instant info — both flippers held. Everything the deep ruleset is
    // tracking, on one panel, so progress is never a mystery.
    if (hud.statusOpen) this.drawStatusPanel(ctx, pf, hud);
    if (hud.paused) this.drawPausePanel(ctx, hud);

    if (hud.tilted) {
      ctx.shadowColor = COLOR.INSERT_RED;
      ctx.shadowBlur = 26;
      ctx.fillStyle = COLOR.INSERT_RED;
      ctx.font = 'bold 54px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('TILT', PLAYFIELD_W / 2, 520);
      ctx.shadowBlur = 0;
    }
  }

  /** Pause / settings — the machine frozen, volume on the flippers. */
  private drawPausePanel(ctx: CanvasRenderingContext2D, hud: HudInfo) {
    ctx.save();
    ctx.fillStyle = 'rgba(2, 4, 10, 0.72)';
    ctx.fillRect(0, 130, PLAYFIELD_W, PLAYFIELD_H - 130);

    const x0 = 60;
    const y0 = 330;
    const w = PLAYFIELD_W - 120;
    const h = 300;
    ctx.fillStyle = 'rgba(6, 10, 22, 0.96)';
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = COLOR.BRASS;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '8px';
    ctx.shadowColor = COLOR.FLAG_RED;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COLOR.FLAG_RED;
    ctx.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('PAUSED', PLAYFIELD_W / 2 + 4, y0 + 46);
    ctx.shadowBlur = 0;
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '0px';

    // Volume meter — ten segments, flippers adjust.
    ctx.fillStyle = COLOR.TEXT_DIM;
    ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(hud.muted ? 'VOLUME  (MUTED)' : 'VOLUME', PLAYFIELD_W / 2, y0 + 92);
    const barW = w - 96;
    const segW = barW / 10;
    for (let i = 0; i < 10; i++) {
      const on = !hud.muted && i < Math.round(hud.volume * 10);
      ctx.fillStyle = on ? COLOR.NEON_GREEN : 'rgba(120, 140, 175, 0.25)';
      ctx.fillRect(x0 + 48 + i * segW + 2, y0 + 108, segW - 5, 16);
    }
    ctx.fillStyle = COLOR.TEXT;
    ctx.font = 'bold 13px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(`${Math.round(hud.volume * 100)}%`, PLAYFIELD_W / 2, y0 + 144);
    ctx.fillStyle = COLOR.TEXT_DIM;
    ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('FLIPPERS ADJUST · M MUTES', PLAYFIELD_W / 2, y0 + 166);

    // Controls reference, since the title screen is long gone by now.
    const lines = [
      'Z / ⁄   flippers        SPACE   plunger',
      'C / N   nudge           M   mute',
      'HOLD BOTH FLIPPERS   status report',
    ];
    ctx.fillStyle = 'rgba(190, 210, 240, 0.7)';
    ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, PLAYFIELD_W / 2, y0 + 200 + i * 20));

    if (Math.sin(performance.now() / 300) > 0) {
      ctx.fillStyle = COLOR.NEON_AMBER;
      ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('P / ESC TO RESUME', PLAYFIELD_W / 2, y0 + h - 26);
    }
    ctx.restore();
  }

  /** The status report panel (Stern's "instant info"). */
  private drawStatusPanel(ctx: CanvasRenderingContext2D, pf: Playfield, hud: HudInfo) {
    const x0 = 46;
    const y0 = 250;
    const w = PLAYFIELD_W - 92;
    const h = 422;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 8, 18, 0.9)';
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = COLOR.BRASS;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '4px';
    ctx.fillStyle = COLOR.FLAG_BLUE;
    ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('STATUS', PLAYFIELD_W / 2, y0 + 24);
    (ctx as unknown as { letterSpacing?: string }).letterSpacing = '0px';

    // Sports ladder — the spine of the ruleset.
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
    SPORTS.forEach((s, i) => {
      const y = y0 + 52 + i * 21;
      const done = hud.sportsDone[i];
      const running = hud.activeSport === i;
      ctx.fillStyle = done ? COLOR.NEON_GREEN : running ? COLOR.NEON_AMBER : COLOR.TEXT_DIM;
      ctx.fillText(done ? '●' : running ? '◐' : '○', x0 + 16, y);
      ctx.fillStyle = done ? COLOR.TEXT : running ? COLOR.NEON_AMBER : COLOR.TEXT_DIM;
      ctx.fillText(s.sport, x0 + 34, y);
      ctx.fillStyle = COLOR.TEXT_DIM;
      ctx.font = '10px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(s.shotName, x0 + 138, y);
      ctx.font = 'bold 12px "Helvetica Neue", Arial, sans-serif';
    });

    // Wizard chain state.
    const doneCount = hud.sportsDone.filter(Boolean).length;
    let wiz = `SPORTS ${doneCount}/5`;
    if (hud.bossActive) wiz = 'SHOWDOWN RUNNING';
    else if (hud.bossLit) wiz = 'SHOWDOWN LIT — SCOOP';
    else if (hud.crosstownActive) wiz = `CROSSTOWN — ${hud.crosstownLeft.length} LEFT`;
    else if (doneCount === 5 && !hud.crosstownDone) wiz = 'CROSSTOWN LIT — SCOOP';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR.INSERT_RED;
    ctx.fillText(wiz, PLAYFIELD_W / 2, y0 + 176);

    // Two columns of everything else.
    const rows: Array<[string, string, boolean]> = [
      ['BONUS', `×${hud.bonusX}${hud.heldBonusX > 0 ? ` · HOLD ×${hud.heldBonusX}` : ''}`, hud.bonusX > 1],
      ['LOCKS', `${pf.bean.locked}/3`, pf.bean.locked > 0],
      ['CHICAGO', hud.chicagoCompletions > 0 ? `×${hud.chicagoCompletions}` : '—', hud.chicagoCompletions > 0],
      ['EL FARE', `${Math.min(hud.elFare, hud.elFareNeeded)}/${hud.elFareNeeded}`, hud.elFare > 0],
      ['KICKBACK', hud.kickbackLit ? 'LIT' : 'OFF', hud.kickbackLit],
      ['EL EXPRESS', hud.expressLit ? 'LIT' : 'OFF', hud.expressLit],
      ['MYSTERY', hud.mysteryLit ? 'LIT' : 'USED', hud.mysteryLit],
      ['EXTRA BALLS', `${hud.extraBalls}`, hud.extraBalls > 0],
      ['BEST COMBO', hud.bestCombo > 1 ? `×${hud.bestCombo}` : '—', hud.bestCombo > 1],
      ['BALL SAVE', hud.ballSaveMs > 0 ? `${Math.ceil(hud.ballSaveMs / 1000)}S` : 'OFF', hud.ballSaveMs > 0],
    ];
    rows.forEach(([label, value, on], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = x0 + 18 + col * (w / 2 - 4);
      const y = y0 + 206 + row * 30;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLOR.TEXT_DIM;
      ctx.font = '10px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(label, cx, y);
      ctx.fillStyle = on ? COLOR.NEON_GREEN : COLOR.TEXT_DIM;
      ctx.font = 'bold 13px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(value, cx, y + 14);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR.TEXT_DIM;
    ctx.font = '10px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('RELEASE A FLIPPER TO RESUME', PLAYFIELD_W / 2, y0 + h - 16);
    ctx.restore();
  }
}

/** Insert / banner color for each sport. */
function sportColor(id: string): string {
  switch (id) {
    case 'baseball':
      return '#ff3a4f';
    case 'football':
      return '#f2c744';
    case 'basketball':
      return '#ff8c42';
    case 'hockey':
      return '#7fd1e8';
    case 'soccer':
      return '#5cff9a';
    default:
      return '#ffffff';
  }
}
