import * as THREE from "three";
import { LANE_WIDTH } from "./config";
import type { Obstacle, Pickup, World } from "./world";
import type { Outfit } from "../meta/progression";

const SKY = 0x8fc9d9;
const TRACK_LENGTH = 420;
const SLEEPER_SPACING = 2;
const assetUrl = (name: string) => `${import.meta.env.BASE_URL}assets/runtime/${name}`;

type FacadeKey = "palazzo" | "naples";

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

interface StreetPiece {
  root: THREE.Group;
  s: number;
  side: number;
  x: number;
}

interface RailProp {
  root: THREE.Group;
  s: number;
}

interface Pursuer {
  sprite: THREE.Sprite;
  lane: number;
  phase: number;
}

interface ArtTextures {
  facades: Record<FacadeKey, THREE.Texture>;
  station: THREE.Texture;
  trains: THREE.Texture[];
  pursuers: THREE.Texture[];
}

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

function sample(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/** Renders a World snapshot. Holds no game state of its own beyond animation. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 9 / 16, 0.1, 400);
  private trackTexture!: THREE.Texture;
  private groundTexture!: THREE.Texture;
  private buildings: StreetPiece[] = [];
  private railProps: RailProp[] = [];
  private pursuers: Pursuer[] = [];
  private buildingSpan = 0;
  private railSpan = 0;
  private obstacleMeshes = new Map<number, THREE.Object3D>();
  private pickupMeshes = new Map<number, THREE.Object3D>();
  private player!: PlayerRig;
  private art!: ArtTextures;
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
    this.scene.add(new THREE.HemisphereLight(0xfff4dc, 0x4f493d, 1.7));
    const sun = new THREE.DirectionalLight(0xffe2ae, 2.1);
    sun.position.set(-18, 20, 10);
    this.scene.add(sun);

    this.art = this.loadArtTextures();
    this.trackTexture = this.createTrackTexture();
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_WIDTH * 3 + 0.8, TRACK_LENGTH),
      new THREE.MeshStandardMaterial({ map: this.trackTexture, roughness: 0.9 }),
    );
    track.rotation.x = -Math.PI / 2;
    track.position.z = -TRACK_LENGTH / 2 + 25;
    this.scene.add(track);

    this.groundTexture = canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = "#c5a270";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "#a68457";
      for (let i = 0; i < 48; i++) ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
    });
    this.groundTexture.wrapS = this.groundTexture.wrapT = THREE.RepeatWrapping;
    this.groundTexture.repeat.set(10, TRACK_LENGTH / 8);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, TRACK_LENGTH),
      new THREE.MeshStandardMaterial({ map: this.groundTexture, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -TRACK_LENGTH / 2 + 25);
    this.scene.add(ground);

    this.createRails();
    this.createBuildings();
    this.createRailwayProps();
    this.createPursuers();
    this.player = this.createPlayer();
    this.scene.add(this.player.root);
    this.resize();
  }

  private loadTexture(file: string) {
    const texture = new THREE.TextureLoader().load(assetUrl(file));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private loadArtTextures(): ArtTextures {
    return {
      facades: {
        palazzo: this.loadTexture("travertine-palazzo.webp"),
        naples: this.loadTexture("naples-balcony-house.webp"),
      },
      station: this.loadTexture("volcanic-station-canopy.webp"),
      trains: [this.loadTexture("silver-metro-car.webp"), this.loadTexture("terracotta-commuter-car.webp")],
      pursuers: [
        this.loadTexture("fedora-pursuer.webp"),
        this.loadTexture("trenchcoat-pursuer.webp"),
        this.loadTexture("floral-pursuer.webp"),
      ],
    };
  }

  private createResources() {
    const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
    return {
      box: new THREE.BoxGeometry(1, 1, 1),
      coinGeo: new THREE.CylinderGeometry(0.36, 0.36, 0.1, 20),
      coinMat: std(0xffc531, { metalness: 0.6, roughness: 0.25, emissive: 0x7a4a00, emissiveIntensity: 0.4 }),
      barrierMat: new THREE.MeshStandardMaterial({ map: stripes("#fff3dd", "#b63a2d"), roughness: 0.55 }),
      gateMat: new THREE.MeshStandardMaterial({ map: stripes("#d6b163", "#313333"), roughness: 0.6 }),
      postMat: std(0x37403f, { metalness: 0.65, roughness: 0.35 }),
      trainColors: [0x2f7771, 0xb6583c, 0x4c5e79, 0x8b6b46].map((c) => std(c)),
      movingMat: std(0xb64536),
      windowMat: std(0x243b52, { metalness: 0.55, roughness: 0.18, emissive: 0x10202d, emissiveIntensity: 0.25 }),
      lightMat: new THREE.MeshBasicMaterial({ color: 0xffdc88 }),
      roofMat: std(0xd9cbb1, { roughness: 0.75 }),
      railMat: std(0x5b6564, { metalness: 0.8, roughness: 0.32 }),
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
      ctx.fillStyle = "#857d72";
      ctx.fillRect(0, 0, width, 64);
      for (let lane = 0; lane < 3; lane++) {
        const x0 = 16 + lane * lanePx;
        ctx.fillStyle = "#4c4338";
        for (let y = 2; y < 64; y += 16) ctx.fillRect(x0 + 8, y, lanePx - 16, 4);
        ctx.fillStyle = "#c5c8c0";
        ctx.fillRect(x0 + 22, 0, 5, 64);
        ctx.fillRect(x0 + lanePx - 27, 0, 5, 64);
        ctx.fillStyle = "#6d6458";
        ctx.fillRect(x0 + 30, 0, lanePx - 60, 64);
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, TRACK_LENGTH / SLEEPER_SPACING);
    return texture;
  }

  private createRails() {
    const railGeo = new THREE.BoxGeometry(0.055, 0.075, TRACK_LENGTH);
    for (const lane of [-1, 0, 1]) {
      for (const offset of [-0.56, 0.56]) {
        const rail = new THREE.Mesh(railGeo, this.res.railMat);
        rail.position.set(lane * LANE_WIDTH + offset, 0.055, -TRACK_LENGTH / 2 + 25);
        this.scene.add(rail);
      }
    }
  }

  private createBuildings() {
    const count = 30;
    const spacing = 9;
    const baseColors = [0xbda78c, 0xc79066, 0xbaa691, 0x9b7f62, 0xcb936c, 0xa69a83];
    this.buildingSpan = count * spacing;
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const random = sample(i + side * 81);
        const variant: FacadeKey = (i + (side > 0 ? 1 : 0)) % 3 === 0 ? "naples" : "palazzo";
        const height = variant === "palazzo" ? 7.4 + random * 4.4 : 8.6 + random * 4.5;
        const width = 5.2 + sample(i * 2.1 + side) * 2.3;
        const depth = spacing - 1.2;
        const root = new THREE.Group();
        const base = new THREE.Mesh(
          this.res.box,
          new THREE.MeshStandardMaterial({ color: baseColors[(i + (side > 0 ? 2 : 0)) % baseColors.length], roughness: 0.92 }),
        );
        base.scale.set(width, height, depth);
        base.position.y = height / 2;
        root.add(base);

        const facade = new THREE.Mesh(
          new THREE.PlaneGeometry(depth * 0.93, height * 0.97),
          new THREE.MeshBasicMaterial({
            map: this.art.facades[variant],
            transparent: true,
            alphaTest: 0.04,
            side: THREE.DoubleSide,
          }),
        );
        facade.position.set(-side * (width / 2 + 0.018), height / 2, 0);
        facade.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        root.add(facade);

        const roof = new THREE.Mesh(this.res.box, this.res.roofMat);
        roof.scale.set(width + 0.32, 0.18, depth + 0.25);
        roof.position.y = height + 0.08;
        root.add(roof);

        if ((i + (side > 0 ? 0 : 1)) % 5 === 0) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), this.res.lightMat);
          lamp.position.set(side * (width / 2 + 0.32), 2.25, depth * 0.32);
          root.add(lamp);
        }

        this.scene.add(root);
        this.buildings.push({
          root,
          s: i * spacing + (side > 0 ? spacing / 2 : 0),
          side,
          x: side * (LANE_WIDTH * 1.5 + 3.2 + width / 2 + sample(i * 7.2) * 0.7),
        });
      }
    }
  }

  private createRailwayProps() {
    const count = 18;
    const spacing = 18;
    this.railSpan = count * spacing;
    for (let i = 0; i < count; i++) {
      const root = new THREE.Group();
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(this.res.box, this.res.postMat);
        post.scale.set(0.18, 5.1, 0.18);
        post.position.set(side * 5.4, 2.55, 0);
        root.add(post);
        const foot = new THREE.Mesh(this.res.box, this.res.roofMat);
        foot.scale.set(0.7, 0.18, 0.7);
        foot.position.set(side * 5.4, 0.09, 0);
        root.add(foot);
      }
      const beam = new THREE.Mesh(this.res.box, this.res.postMat);
      beam.scale.set(11.1, 0.14, 0.14);
      beam.position.y = 4.85;
      root.add(beam);
      const wire = new THREE.Mesh(this.res.box, this.res.railMat);
      wire.scale.set(8.2, 0.035, 0.035);
      wire.position.y = 4.42;
      root.add(wire);

      if (i % 4 === 1) {
        const station = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: this.art.station, transparent: true, alphaTest: 0.04, depthWrite: false }),
        );
        station.scale.set(5.5, 4.1, 1);
        station.position.set(i % 8 === 1 ? -8.4 : 8.4, 2.0, 0.2);
        root.add(station);
      }
      this.scene.add(root);
      this.railProps.push({ root, s: i * spacing + 7 });
    }
  }

  private createPursuers() {
    this.art.pursuers.forEach((texture, index) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.04, depthWrite: false }),
      );
      sprite.scale.set(2.2, 3.0, 1);
      this.scene.add(sprite);
      this.pursuers.push({ sprite, lane: index - 1, phase: index * 1.8 });
    });
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
      const mesh = new THREE.Mesh(r.box, mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
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

      const trainArt = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.art.trains[o.id % this.art.trains.length], transparent: true, alphaTest: 0.04, depthWrite: false }),
      );
      trainArt.scale.set(4.1, 3.15, 1);
      trainArt.position.set(0, 1.55, 0.08);
      group.add(trainArt);
    }
    return group;
  }

  private makePickup(k: Pickup): THREE.Object3D {
    const r = this.res;
    if (k.kind === "coin") {
      const coin = new THREE.Mesh(r.coinGeo, r.coinMat);
      coin.rotation.x = Math.PI / 2;
      const group = new THREE.Group();
      group.add(coin);
      return group;
    }
    const group = new THREE.Group();
    group.add(new THREE.Mesh(r.powerGeos[k.kind], r.powerMats[k.kind]));
    const ring = new THREE.Mesh(r.ringGeo, r.ringMat);
    group.add(ring);
    return group;
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
    const player = world.player;
    const time = this.clock;
    const crashed = world.status === "over";
    const travelled = idle ? time * 6 : player.s;

    this.trackTexture.offset.y = travelled / SLEEPER_SPACING;
    this.groundTexture.offset.y = travelled / 8;
    for (const building of this.buildings) {
      while (building.s - travelled < -25) building.s += this.buildingSpan;
      building.root.position.set(building.x, 0, -(building.s - travelled));
    }
    for (const prop of this.railProps) {
      while (prop.s - travelled < -25) prop.s += this.railSpan;
      prop.root.position.z = -(prop.s - travelled);
    }

    this.pursuers.forEach((pursuer, index) => {
      const stride = Math.sin(time * 7 + pursuer.phase);
      const depth = 34 + index * 9 + Math.sin(time * 0.8 + pursuer.phase) * 2;
      pursuer.sprite.position.set(pursuer.lane * LANE_WIDTH + Math.sin(time * 1.6 + pursuer.phase) * 0.18, 1.32 + Math.abs(stride) * 0.08, -depth);
      pursuer.sprite.scale.set(2.15 + index * 0.06, 2.95 + index * 0.06, 1);
      pursuer.sprite.material.rotation = Math.sin(time * 7 + pursuer.phase) * 0.025;
      pursuer.sprite.visible = !crashed;
    });

    this.syncEntities(world.obstacles, this.obstacleMeshes, (o) => this.makeObstacle(o), (o, obj) => {
      obj.visible = !o.destroyed;
      obj.position.set(o.lane * LANE_WIDTH, 0, -(o.s - player.s));
    });
    this.syncEntities(world.pickups, this.pickupMeshes, (k) => this.makePickup(k), (k, obj) => {
      obj.visible = !k.collected;
      obj.position.set(k.x, k.y + (k.kind === "coin" ? 0 : Math.sin(time * 3 + k.id) * 0.15), -(k.s - player.s));
      obj.rotation.y = time * (k.kind === "coin" ? 4 : 2) + k.id;
    });

    const rig = this.player;
    rig.root.position.set(player.x, player.y, 0);
    const running = !idle && !crashed;
    const cycle = time * (running ? 4 + world.speed * 0.35 : 7);
    const swing = Math.sin(cycle) * (player.y > 0 ? 0.25 : 0.9);
    rig.legL.rotation.x = swing;
    rig.legR.rotation.x = -swing;
    rig.armL.rotation.x = -swing * 0.8;
    rig.armR.rotation.x = swing * 0.8;
    rig.body.position.y = player.y > 0 ? 0 : Math.abs(Math.sin(cycle)) * 0.08;
    rig.root.rotation.z = (player.x - player.lane * LANE_WIDTH) * 0.12 + (player.stumbleTime > 0 ? Math.sin(time * 40) * 0.2 : 0);
    rig.root.rotation.y = Math.PI;
    rig.head.rotation.x = 0;

    if (world.rolling) {
      rig.body.rotation.x = -(1 - player.rollTime / 0.8) * Math.PI * 2;
      rig.body.scale.setScalar(0.62);
      rig.body.position.y = 0.35;
    } else if (crashed) {
      rig.body.rotation.x = Math.min(Math.PI / 2, rig.body.rotation.x + dt * 6);
      rig.body.scale.setScalar(1);
    } else {
      rig.body.rotation.x = player.y > 0 ? -0.25 : 0;
      const squash = player.vy > 0 ? 1.08 : 1;
      rig.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    }
    rig.shield.visible = world.shield;
    rig.shield.scale.setScalar(1 + Math.sin(time * 6) * 0.03);
    rig.magnetRing.visible = world.magnetTime > 0;
    rig.magnetRing.rotation.z = time * 4;
    rig.root.visible = !(world.invulnerableTime > 0 && Math.floor(time * 20) % 2 === 0);
    const blob = rig.root.getObjectByName("blob")!;
    blob.position.y = 0.02 - player.y;
    blob.scale.setScalar(Math.max(0.4, 1 - player.y * 0.25));

    const camX = player.x * 0.55 + (idle ? Math.sin(time * 0.5) * 0.8 : 0);
    this.camera.position.x += (camX - this.camera.position.x) * Math.min(1, dt * 8);
    this.camera.position.y = 4.4 + player.y * 0.35;
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
