import * as THREE from "three";
import { LANE_WIDTH } from "./config";
import type { Obstacle, Pickup, World } from "./world";
import type { Outfit } from "../meta/progression";

const SKY = 0x8fd3ff;
const TRACK_LENGTH = 420;
const SLEEPER_SPACING = 2;

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function stripes(a: string, b: string) {
  return canvasTexture(128, 32, (ctx) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = b;
    for (let x = -32; x < 160; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 32);
      ctx.lineTo(x + 16, 32);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 16, 0);
      ctx.fill();
    }
  });
}

interface PlayerRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  shield: THREE.Mesh;
  magnetRing: THREE.Mesh;
  materials: { body: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial };
}

/** Renders a World snapshot. Holds no game state of its own beyond animation. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 9 / 16, 0.1, 400);
  private trackTexture: THREE.Texture;
  private groundTexture: THREE.Texture;
  private buildings: { mesh: THREE.Mesh; s: number }[] = [];
  private buildingSpan = 0;
  private obstacleMeshes = new Map<number, THREE.Object3D>();
  private pickupMeshes = new Map<number, THREE.Object3D>();
  private player: PlayerRig;
  private shake = 0;
  private clock = 0;
  private res = this.createResources();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 70, 190);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x7a6a55, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.8);
    sun.position.set(-6, 14, 6);
    this.scene.add(sun);

    this.trackTexture = this.createTrackTexture();
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_WIDTH * 3 + 0.8, TRACK_LENGTH),
      new THREE.MeshStandardMaterial({ map: this.trackTexture, roughness: 0.9 }),
    );
    track.rotation.x = -Math.PI / 2;
    track.position.z = -TRACK_LENGTH / 2 + 25;
    this.scene.add(track);

    this.groundTexture = canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = "#c9b48a";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "#bfa87c";
      for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * 64, Math.random() * 64, 3, 3);
    });
    this.groundTexture.wrapS = this.groundTexture.wrapT = THREE.RepeatWrapping;
    this.groundTexture.repeat.set(8, TRACK_LENGTH / 8);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, TRACK_LENGTH),
      new THREE.MeshStandardMaterial({ map: this.groundTexture, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -TRACK_LENGTH / 2 + 25);
    this.scene.add(ground);

    this.createBuildings();
    this.player = this.createPlayer();
    this.scene.add(this.player.root);
    this.resize();
  }

  private createResources() {
    const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
    return {
      box: new THREE.BoxGeometry(1, 1, 1),
      coinGeo: new THREE.CylinderGeometry(0.36, 0.36, 0.1, 20),
      coinMat: std(0xffc531, { metalness: 0.6, roughness: 0.25, emissive: 0x7a4a00, emissiveIntensity: 0.4 }),
      barrierMat: new THREE.MeshStandardMaterial({ map: stripes("#ffffff", "#ff3b3b"), roughness: 0.5 }),
      gateMat: new THREE.MeshStandardMaterial({ map: stripes("#ffd400", "#1d1d2b"), roughness: 0.5 }),
      postMat: std(0x55607a),
      trainColors: [0x2f9e8f, 0x3d6cf0, 0xf2a03d, 0x8d5cf6].map((c) => std(c)),
      movingMat: std(0xe23b3b),
      windowMat: std(0xcfeeff, { emissive: 0x335577, emissiveIntensity: 0.3 }),
      lightMat: new THREE.MeshBasicMaterial({ color: 0xfff6a0 }),
      roofMat: std(0xd8dde6),
      powerMats: {
        multiplier: std(0x33dd66, { emissive: 0x0b6b2a, emissiveIntensity: 0.6 }),
        magnet: std(0xff3355, { emissive: 0x6b0b1a, emissiveIntensity: 0.6 }),
        shield: std(0x33aaff, { emissive: 0x0b3a6b, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 }),
      },
      powerGeos: {
        multiplier: new THREE.OctahedronGeometry(0.45),
        magnet: new THREE.TorusGeometry(0.32, 0.12, 10, 20, Math.PI * 1.3),
        shield: new THREE.IcosahedronGeometry(0.42),
      },
      ringGeo: new THREE.TorusGeometry(0.6, 0.04, 8, 32),
      ringMat: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
    };
  }

  private createTrackTexture() {
    const lanePx = 96;
    const width = lanePx * 3 + 32;
    const texture = canvasTexture(width, 64, (ctx) => {
      ctx.fillStyle = "#8d8a86";
      ctx.fillRect(0, 0, width, 64);
      for (let lane = 0; lane < 3; lane++) {
        const x0 = 16 + lane * lanePx;
        ctx.fillStyle = "#6b4a2f";
        ctx.fillRect(x0 + 8, 20, lanePx - 16, 14);
        ctx.fillStyle = "#cfd6de";
        ctx.fillRect(x0 + 22, 0, 6, 64);
        ctx.fillRect(x0 + lanePx - 28, 0, 6, 64);
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, TRACK_LENGTH / SLEEPER_SPACING);
    return texture;
  }

  private createBuildings() {
    const colors = [0xffb4a2, 0xe5989b, 0xb5e48c, 0x99d98c, 0xffd6a5, 0xa0c4ff, 0xbdb2ff, 0xfdffb6];
    const windowTex = canvasTexture(64, 128, (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 64, 128);
      ctx.fillStyle = "rgba(40,60,90,0.55)";
      for (let y = 8; y < 128; y += 20) for (let x = 8; x < 64; x += 18) ctx.fillRect(x, y, 10, 12);
    });
    const count = 26;
    const spacing = 9;
    this.buildingSpan = count * spacing;
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const height = 5 + Math.random() * 14;
        const mat = new THREE.MeshStandardMaterial({ color: colors[(i * 3 + (side > 0 ? 1 : 0)) % colors.length], map: windowTex });
        const mesh = new THREE.Mesh(this.res.box, mat);
        const width = 5 + Math.random() * 3;
        mesh.scale.set(width, height, spacing - 1.5);
        mesh.position.set(side * (LANE_WIDTH * 1.5 + 3.2 + width / 2 + Math.random()), height / 2, 0);
        this.scene.add(mesh);
        this.buildings.push({ mesh, s: i * spacing + (side > 0 ? spacing / 2 : 0) });
      }
    }
  }

  private createPlayer(): PlayerRig {
    const materials = {
      body: new THREE.MeshStandardMaterial({ color: 0x2f6bff, roughness: 0.5 }),
      head: new THREE.MeshStandardMaterial({ color: 0xffd2a8, roughness: 0.7 }),
      accent: new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.5 }),
    };
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.35, 6, 12), materials.body);
    torso.position.y = 0.85;
    body.add(torso);
    const limb = new THREE.CapsuleGeometry(0.09, 0.38, 4, 8);
    limb.translate(0, -0.22, 0);
    const legL = new THREE.Mesh(limb, materials.accent);
    const legR = new THREE.Mesh(limb, materials.accent);
    legL.position.set(-0.14, 0.58, 0);
    legR.position.set(0.14, 0.58, 0);
    const armL = new THREE.Mesh(limb, materials.body);
    const armR = new THREE.Mesh(limb, materials.body);
    armL.position.set(-0.38, 1.08, 0);
    armR.position.set(0.38, 1.08, 0);
    body.add(legL, legR, armL, armR);

    // The oversized head is the character's signature.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 18), materials.head);
    head.position.y = 1.6;
    const eyeGeo = new THREE.SphereGeometry(0.07, 10, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const x of [-0.17, 0.17]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(x, 0.08, 0.45);
      head.add(eye);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.07, 8, 28), materials.accent);
    band.rotation.x = Math.PI / 2 - 0.25;
    band.position.y = 0.2;
    head.add(band);
    body.add(head);

    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    blob.name = "blob";
    root.add(blob);

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0x55bbff, transparent: true, opacity: 0.25, emissive: 0x1166aa, depthWrite: false }),
    );
    shield.position.y = 1.1;
    root.add(shield);
    const magnetRing = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 40), new THREE.MeshBasicMaterial({ color: 0xff3355 }));
    magnetRing.rotation.x = Math.PI / 2;
    magnetRing.position.y = 0.1;
    root.add(magnetRing);

    return { root, body, head, legL, legR, armL, armR, shield, magnetRing, materials };
  }

  setOutfit(outfit: Outfit) {
    this.player.materials.body.color.setHex(outfit.body);
    this.player.materials.head.color.setHex(outfit.head);
    this.player.materials.accent.color.setHex(outfit.accent);
  }

  bump(amount = 0.35) {
    this.shake = Math.max(this.shake, amount);
  }

  resize() {
    const { clientWidth, clientHeight } = this.container;
    if (!clientWidth || !clientHeight) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  private makeObstacle(o: Obstacle): THREE.Object3D {
    const r = this.res;
    const group = new THREE.Group();
    const add = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(r.box, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      group.add(m);
      return m;
    };
    if (o.kind === "barrier") {
      add(r.barrierMat, 2.0, 0.45, 0.2, 0, 0.6, 0);
      add(r.postMat, 0.12, 0.6, 0.12, -0.8, 0.3, 0);
      add(r.postMat, 0.12, 0.6, 0.12, 0.8, 0.3, 0);
    } else if (o.kind === "gate") {
      add(r.postMat, 0.18, 2.6, 0.18, -1.0, 1.3, 0);
      add(r.postMat, 0.18, 2.6, 0.18, 1.0, 1.3, 0);
      add(r.gateMat, 2.2, 0.9, 0.2, 0, 1.85, 0);
    } else {
      const moving = o.kind === "moving";
      const mat = moving ? r.movingMat : r.trainColors[o.id % r.trainColors.length];
      const len = o.length;
      add(mat, 2.1, 2.7, len, 0, 1.45, -len / 2);
      add(r.roofMat, 2.0, 0.15, len - 0.2, 0, 2.85, -len / 2);
      add(r.windowMat, 2.14, 0.6, len - 1, 0, 1.9, -len / 2);
      add(r.windowMat, 1.5, 0.8, 0.05, 0, 1.9, 0.01);
      add(r.lightMat, 0.3, 0.2, 0.05, -0.65, 0.7, 0.02);
      add(r.lightMat, 0.3, 0.2, 0.05, 0.65, 0.7, 0.02);
    }
    return group;
  }

  private makePickup(k: Pickup): THREE.Object3D {
    const r = this.res;
    if (k.kind === "coin") {
      const coin = new THREE.Mesh(r.coinGeo, r.coinMat);
      coin.rotation.x = Math.PI / 2;
      const g = new THREE.Group();
      g.add(coin);
      return g;
    }
    const g = new THREE.Group();
    g.add(new THREE.Mesh(r.powerGeos[k.kind], r.powerMats[k.kind]));
    const ring = new THREE.Mesh(r.ringGeo, r.ringMat);
    g.add(ring);
    return g;
  }

  private syncEntities<T extends { id: number }>(
    items: T[],
    meshes: Map<number, THREE.Object3D>,
    make: (item: T) => THREE.Object3D,
    place: (item: T, obj: THREE.Object3D) => void,
  ) {
    const alive = new Set<number>();
    for (const item of items) {
      alive.add(item.id);
      let obj = meshes.get(item.id);
      if (!obj) {
        obj = make(item);
        meshes.set(item.id, obj);
        this.scene.add(obj);
      }
      place(item, obj);
    }
    for (const [id, obj] of meshes) {
      if (!alive.has(id)) {
        this.scene.remove(obj);
        meshes.delete(id);
      }
    }
  }

  /** Draws the world. `idle` animates the attract-mode scene before a run starts. */
  render(world: World, dt: number, idle: boolean) {
    this.clock += dt;
    const p = world.player;
    const t = this.clock;
    const crashed = world.status === "over";
    const travelled = idle ? t * 6 : p.s;

    this.trackTexture.offset.y = travelled / SLEEPER_SPACING;
    this.groundTexture.offset.y = travelled / 8;
    for (const b of this.buildings) {
      while (b.s - travelled < -25) b.s += this.buildingSpan;
      b.mesh.position.z = -(b.s - travelled);
    }

    this.syncEntities(world.obstacles, this.obstacleMeshes, (o) => this.makeObstacle(o), (o, obj) => {
      obj.visible = !o.destroyed;
      obj.position.set(o.lane * LANE_WIDTH, 0, -(o.s - p.s));
    });
    this.syncEntities(world.pickups, this.pickupMeshes, (k) => this.makePickup(k), (k, obj) => {
      obj.visible = !k.collected;
      obj.position.set(k.x, k.y + (k.kind === "coin" ? 0 : Math.sin(t * 3 + k.id) * 0.15), -(k.s - p.s));
      obj.rotation.y = t * (k.kind === "coin" ? 4 : 2) + k.id;
    });

    // Player animation.
    const rig = this.player;
    rig.root.position.set(p.x, p.y, 0);
    const running = !idle && !crashed;
    const cycle = t * (running ? 4 + world.speed * 0.35 : 7);
    const swing = Math.sin(cycle) * (p.y > 0 ? 0.25 : 0.9);
    rig.legL.rotation.x = swing;
    rig.legR.rotation.x = -swing;
    rig.armL.rotation.x = -swing * 0.8;
    rig.armR.rotation.x = swing * 0.8;
    rig.body.position.y = p.y > 0 ? 0 : Math.abs(Math.sin(cycle)) * 0.08;
    rig.root.rotation.z = (p.x - p.lane * LANE_WIDTH) * 0.12 + (p.stumbleTime > 0 ? Math.sin(t * 40) * 0.2 : 0);
    rig.root.rotation.y = Math.PI; // face away from the camera
    rig.head.rotation.x = 0;

    if (world.rolling) {
      rig.body.rotation.x = -(1 - p.rollTime / 0.8) * Math.PI * 2;
      rig.body.scale.setScalar(0.62);
      rig.body.position.y = 0.35;
    } else if (crashed) {
      rig.body.rotation.x = Math.min(Math.PI / 2, rig.body.rotation.x + dt * 6);
      rig.body.scale.setScalar(1);
    } else {
      rig.body.rotation.x = p.y > 0 ? -0.25 : 0;
      const squash = p.vy > 0 ? 1.08 : 1;
      rig.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    }
    rig.shield.visible = world.shield;
    rig.shield.scale.setScalar(1 + Math.sin(t * 6) * 0.03);
    rig.magnetRing.visible = world.magnetTime > 0;
    rig.magnetRing.rotation.z = t * 4;
    rig.root.visible = !(world.invulnerableTime > 0 && Math.floor(t * 20) % 2 === 0);
    const blob = rig.root.getObjectByName("blob")!;
    blob.position.y = 0.02 - p.y;
    blob.scale.setScalar(Math.max(0.4, 1 - p.y * 0.25));

    // Camera follows lazily to keep lane changes readable.
    const camX = p.x * 0.55 + (idle ? Math.sin(t * 0.5) * 0.8 : 0);
    this.camera.position.x += (camX - this.camera.position.x) * Math.min(1, dt * 8);
    this.camera.position.y = 4.4 + p.y * 0.35;
    this.camera.position.z = 7.2;
    this.shake = Math.max(0, this.shake - dt);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.camera.position.x * 0.8, 1.2, -10);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
