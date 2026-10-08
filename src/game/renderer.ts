import * as THREE from "three";
import { LANE_WIDTH } from "./config";
import type { Obstacle, Pickup, World } from "./world";
import type { Outfit } from "../meta/progression";

const SKY = 0x8fc9d9;
const TRACK_LENGTH = 420;
const SLEEPER_SPACING = 2;
const COIN_CAPACITY = 256;
const assetUrl = (name: string) => `${import.meta.env.BASE_URL}assets/runtime/${name}`;

type FacadeKey = "palazzo" | "naples";
const MAX_POOLED_OBSTACLES = 64;
const MAX_POOLED_PER_OBSTACLE_VARIANT = 3;
const MAX_POOLED_POWERS = 12;
const MAX_POOLED_PER_POWER_KIND = 3;


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
  blob: THREE.Mesh;
  materials: { body: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial };
}

interface ActiveVisual {
  key: string;
  object: THREE.Object3D;
  seen: number;
}

interface TownHouse {
  s: number;
  x: number;
  width: number;
  height: number;
  depth: number;
  wallIndex: number;
  roofIndex: number;
  windowIndex: number;
  facade: THREE.Mesh;
}

interface ParkTree {
  s: number;
  x: number;
  scale: number;
  index: number;
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

interface ArtMaterials {
  facades: Record<FacadeKey, THREE.MeshBasicMaterial>;
  station: THREE.SpriteMaterial;
  trains: THREE.SpriteMaterial[];
  pursuers: THREE.SpriteMaterial[];
}

/** Renders a World snapshot. Holds no game state of its own beyond animation. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 9 / 16, 0.1, 400);
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];
  private res = this.createResources();
  private trackTexture!: THREE.Texture;
  private groundTexture!: THREE.Texture;
  private art!: ArtTextures;
  private artMaterials!: ArtMaterials;
  private player!: PlayerRig;
  private coinMesh!: THREE.InstancedMesh;
  private readonly instanceDummy = new THREE.Object3D();
  private readonly coinDummy = new THREE.Object3D();
  private houses: TownHouse[] = [];
  private trees: ParkTree[] = [];
  private houseWalls!: THREE.InstancedMesh;
  private houseRoofs!: THREE.InstancedMesh;
  private houseWindows!: THREE.InstancedMesh;
  private treeTrunks!: THREE.InstancedMesh;
  private treeCanopies!: THREE.InstancedMesh;
  private buildingSpan = 0;
  private treeSpan = 0;
  private railProps: RailProp[] = [];
  private railSpan = 0;
  private pursuers: Pursuer[] = [];
  private obstacleActive = new Map<number, ActiveVisual>();
  private powerActive = new Map<number, ActiveVisual>();
  private obstaclePool = new Map<string, THREE.Object3D[]>();
  private powerPool = new Map<string, THREE.Object3D[]>();
  private pooledObstacleCount = 0;
  private pooledPowerCount = 0;
  private syncedWorld: World | null = null;
  private syncEpoch = 0;
  private shake = 0;
  private clock = 0;
  private reducedMotion = false;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 68, 185);
    this.scene.add(new THREE.HemisphereLight(0xfff4dc, 0x4f493d, 1.7));
    const sun = new THREE.DirectionalLight(0xffe2ae, 2.1);
    sun.position.set(-18, 20, 10);
    this.scene.add(sun);

    this.art = this.loadArtTextures();
    this.artMaterials = this.createArtMaterials();
    this.trackTexture = this.ownTexture(this.createTrackTexture());
    const track = new THREE.Mesh(
      this.ownGeometry(new THREE.PlaneGeometry(LANE_WIDTH * 3 + 0.8, TRACK_LENGTH)),
      this.ownMaterial(new THREE.MeshStandardMaterial({ map: this.trackTexture, roughness: 0.92 })),
    );
    track.rotation.x = -Math.PI / 2;
    track.position.z = -TRACK_LENGTH / 2 + 25;
    this.scene.add(track);

    this.groundTexture = this.ownTexture(canvasTexture(96, 96, (ctx) => {
      ctx.fillStyle = "#c5a270";
      ctx.fillRect(0, 0, 96, 96);
      ctx.strokeStyle = "rgba(94, 67, 43, 0.38)";
      ctx.lineWidth = 1;
      for (let y = 0; y <= 96; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(96, y);
        ctx.stroke();
      }
      for (let row = 0; row < 6; row++) {
        const offset = row % 2 ? 8 : 0;
        for (let x = offset; x <= 96; x += 16) {
          ctx.beginPath();
          ctx.moveTo(x, row * 16);
          ctx.lineTo(x, row * 16 + 16);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "rgba(116, 81, 48, 0.2)";
      for (let i = 0; i < 42; i++) ctx.fillRect((i * 31 + 5) % 96, (i * 17 + 11) % 96, 1, 1);
    }));
    this.groundTexture.wrapS = this.groundTexture.wrapT = THREE.RepeatWrapping;
    this.groundTexture.repeat.set(10, TRACK_LENGTH / 8);
    const ground = new THREE.Mesh(
      this.ownGeometry(new THREE.PlaneGeometry(80, TRACK_LENGTH)),
      this.ownMaterial(new THREE.MeshStandardMaterial({ map: this.groundTexture, roughness: 1 })),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.025, -TRACK_LENGTH / 2 + 25);
    this.scene.add(ground);

    this.createRails();
    this.createScenery();
    this.createRailwayProps();
    this.createPursuers();
    this.createSkyProps();
    this.createCoinInstances();
    this.player = this.createPlayer();
    this.scene.add(this.player.root);
    this.camera.position.set(0, 4.4, 7.2);
    this.resize();
  }

  private ownGeometry<T extends THREE.BufferGeometry>(geometry: T) {
    this.ownedGeometries.push(geometry);
    return geometry;
  }

  private ownMaterial<T extends THREE.Material>(material: T) {
    this.ownedMaterials.push(material);
    return material;
  }

  private ownTexture<T extends THREE.Texture>(texture: T) {
    this.ownedTextures.push(texture);
    return texture;
  }

  private loadTexture(file: string) {
    const texture = this.ownTexture(new THREE.TextureLoader().load(assetUrl(file)));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
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

  private createArtMaterials(): ArtMaterials {
    const facade = (map: THREE.Texture) => this.ownMaterial(new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      alphaTest: 0.04,
      side: THREE.DoubleSide,
    }));
    const sprite = (map: THREE.Texture) => this.ownMaterial(new THREE.SpriteMaterial({
      map,
      transparent: true,
      alphaTest: 0.04,
      depthWrite: false,
    }));
    return {
      facades: {
        palazzo: facade(this.art.facades.palazzo),
        naples: facade(this.art.facades.naples),
      },
      station: sprite(this.art.station),
      trains: this.art.trains.map(sprite),
      pursuers: this.art.pursuers.map(sprite),
    };
  }

  private createResources() {
    const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      this.ownMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra }));
    const barrierStripeTexture = this.ownTexture(stripes("#ffffff", "#ea4335"));
    const gateStripeTexture = this.ownTexture(stripes("#fff6ce", "#4285f4"));
    const windowTexture = this.ownTexture(canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = "#d9f0ff";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(29, 0, 5, 64);
      ctx.fillRect(0, 29, 64, 5);
    }));
    return {
      box: this.ownGeometry(new THREE.BoxGeometry(1, 1, 1)),
      coinGeo: this.ownGeometry(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 16)),
      coinMat: std(0xfbbc05, { metalness: 0.45, roughness: 0.3, emissive: 0x8a5b00, emissiveIntensity: 0.25 }),
      barrierMat: this.ownMaterial(new THREE.MeshStandardMaterial({ map: barrierStripeTexture, roughness: 0.55 })),
      gateMat: this.ownMaterial(new THREE.MeshStandardMaterial({ map: gateStripeTexture, roughness: 0.55 })),
      postMat: std(0x37403f, { metalness: 0.65, roughness: 0.35 }),
      trainColors: [0x2f7771, 0xb6583c, 0x4c5e79, 0x8b6b46].map((color) => std(color, { roughness: 0.55 })),
      movingMat: std(0xb64536),
      windowMat: this.ownMaterial(new THREE.MeshStandardMaterial({ map: windowTexture, emissive: 0x3d7ba6, emissiveIntensity: 0.25, roughness: 0.4 })),
      lightMat: this.ownMaterial(new THREE.MeshBasicMaterial({ color: 0xffdc88 })),
      roofMat: std(0xd9cbb1, { roughness: 0.75 }),
      railMat: std(0x414847, { metalness: 0.8, roughness: 0.32 }),
      powerMats: {
        multiplier: std(0x34a853, { emissive: 0x0b6b2a, emissiveIntensity: 0.6 }),
        magnet: std(0xea4335, { emissive: 0x6b0b1a, emissiveIntensity: 0.6 }),
        shield: std(0x4285f4, { emissive: 0x0b3a6b, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 }),
      },
      powerGeos: {
        multiplier: this.ownGeometry(new THREE.OctahedronGeometry(0.45)),
        magnet: this.ownGeometry(new THREE.TorusGeometry(0.32, 0.12, 8, 16, Math.PI * 1.3)),
        shield: this.ownGeometry(new THREE.IcosahedronGeometry(0.42)),
      },
      ringGeo: this.ownGeometry(new THREE.TorusGeometry(0.6, 0.04, 8, 24)),
      ringMat: this.ownMaterial(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })),
    };
  }

  private createTrackTexture() {
    const lanePx = 96;
    const width = lanePx * 3 + 32;
    const texture = canvasTexture(width, 64, (ctx) => {
      ctx.fillStyle = "#8b7864";
      ctx.fillRect(0, 0, width, 64);
      for (let lane = 0; lane < 3; lane++) {
        const x = 16 + lane * lanePx;
        ctx.fillStyle = "#4c4338";
        ctx.fillRect(x, 0, lanePx, 64);
        ctx.fillStyle = "#aa9270";
        for (let y = 2; y < 64; y += 16) ctx.fillRect(x + 8, y, lanePx - 16, 4);
        ctx.fillStyle = "#c5c8c0";
        ctx.fillRect(x + 22, 0, 5, 64);
        ctx.fillRect(x + lanePx - 27, 0, 5, 64);
        ctx.fillStyle = "#6d6458";
        ctx.fillRect(x + 30, 0, lanePx - 60, 64);
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, TRACK_LENGTH / SLEEPER_SPACING);
    return texture;
  }

  private createRails() {
    const railGeo = this.ownGeometry(new THREE.BoxGeometry(0.055, 0.075, TRACK_LENGTH));
    for (const lane of [-1, 0, 1]) {
      for (const offset of [-0.56, 0.56]) {
        const rail = new THREE.Mesh(railGeo, this.res.railMat);
        rail.position.set(lane * LANE_WIDTH + offset, 0.055, -TRACK_LENGTH / 2 + 25);
        this.scene.add(rail);
      }
    }
  }

  private createScenery() {
    const houseCountPerSide = 20;
    const houseCount = houseCountPerSide * 2;
    const wallMat = this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0xc5ab87, roughness: 0.9 }));
    const roofMat = this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0xb85d3f, roughness: 0.72 }));
    const windowMat = this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0x243b52, emissive: 0x10202d, emissiveIntensity: 0.25, roughness: 0.35 }));
    const facadeGeo = this.ownGeometry(new THREE.PlaneGeometry(1, 1));
    this.houseWalls = new THREE.InstancedMesh(this.res.box, wallMat, houseCount);
    this.houseRoofs = new THREE.InstancedMesh(this.ownGeometry(new THREE.ConeGeometry(1, 1, 4)), roofMat, houseCount);
    this.houseWindows = new THREE.InstancedMesh(this.ownGeometry(new THREE.BoxGeometry(1, 1, 0.06)), windowMat, houseCount * 2);
    this.houseWalls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.houseRoofs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.houseWindows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.houseWalls, this.houseRoofs, this.houseWindows);

    const spacing = 10.5;
    this.buildingSpan = houseCountPerSide * spacing;
    let houseIndex = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < houseCountPerSide; i++) {
        const width = 3.1 + ((i * 7 + (side > 0 ? 2 : 0)) % 4) * 0.45;
        const height = 4.4 + ((i * 5 + (side > 0 ? 1 : 0)) % 5) * 0.85;
        const depth = 4.8 + (i % 3) * 0.5;
        const s = i * spacing + (side > 0 ? spacing / 2 : 0);
        const x = side * (LANE_WIDTH * 1.5 + 4 + width / 2);
        const facadeKey: FacadeKey = (i + (side > 0 ? 1 : 0)) % 3 === 0 ? "naples" : "palazzo";
        const facade = new THREE.Mesh(facadeGeo, this.artMaterials.facades[facadeKey]);
        facade.renderOrder = 1;
        this.scene.add(facade);
        this.houses.push({ s, x, width, height, depth, wallIndex: houseIndex, roofIndex: houseIndex, windowIndex: houseIndex * 2, facade });
        this.houseWalls.setColorAt(houseIndex, new THREE.Color([0xc6ad89, 0xd6b88c, 0xb98f74, 0xd5a36f][(i + (side > 0 ? 2 : 0)) % 4]));
        this.houseRoofs.setColorAt(houseIndex, new THREE.Color([0xb85d3f, 0xa94d36, 0xc6754e][(i + (side > 0 ? 1 : 0)) % 3]));
        houseIndex++;
      }
    }
    if (this.houseWalls.instanceColor) this.houseWalls.instanceColor.needsUpdate = true;
    if (this.houseRoofs.instanceColor) this.houseRoofs.instanceColor.needsUpdate = true;

    const treeCountPerSide = 22;
    const treeCount = treeCountPerSide * 2;
    const trunkMat = this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0x8a613b, roughness: 1 }));
    const canopyMat = this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0x34a853, roughness: 0.85, flatShading: true }));
    this.treeTrunks = new THREE.InstancedMesh(this.ownGeometry(new THREE.CylinderGeometry(0.12, 0.18, 1, 6)), trunkMat, treeCount);
    this.treeCanopies = new THREE.InstancedMesh(this.ownGeometry(new THREE.ConeGeometry(1, 1.8, 6)), canopyMat, treeCount);
    this.treeTrunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.treeCanopies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.treeTrunks, this.treeCanopies);

    this.treeSpan = treeCountPerSide * 10;
    let treeIndex = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < treeCountPerSide; i++) {
        const s = i * 10 + (side > 0 ? 5 : 0);
        const x = side * (LANE_WIDTH * 1.5 + 2.8 + (i % 3) * 0.65);
        this.trees.push({ s, x, scale: 0.72 + ((i * 3) % 4) * 0.12, index: treeIndex++ });
      }
    }
    this.updateScenery(0);
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
        const station = new THREE.Sprite(this.artMaterials.station);
        station.scale.set(5.5, 4.1, 1);
        station.position.set(i % 8 === 1 ? -7.2 : 7.2, 2.0, 0.2);
        root.add(station);
      }
      this.scene.add(root);
      this.railProps.push({ root, s: i * spacing + 7 });
    }
  }

  private createPursuers() {
    this.artMaterials.pursuers.forEach((material, index) => {
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(2.2, 3.0, 1);
      this.scene.add(sprite);
      this.pursuers.push({ sprite, lane: index - 1, phase: index * 1.8 });
    });
  }

  private createSkyProps() {
    const cloudGeo = this.ownGeometry(new THREE.DodecahedronGeometry(1, 0));
    const cloudMat = this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }));
    const cloudSpecs: Array<[number, number, number, number]> = [
      [-6.5, 8, -20, 1.1],
      [7, 7.2, -28, 0.9],
      [-1.5, 9.5, -46, 1.35],
    ];
    for (const [x, y, z, scale] of cloudSpecs) {
      const cloud = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const puff = new THREE.Mesh(cloudGeo, cloudMat);
        puff.position.set((i - 1) * 0.9, (i % 2) * 0.25, (i - 1) * 0.08);
        puff.scale.set(0.8 + (i % 2) * 0.25, 0.55 + (i % 2) * 0.25, 0.6);
        cloud.add(puff);
      }
      cloud.position.set(x, y, z);
      cloud.scale.setScalar(scale);
      this.scene.add(cloud);
    }

    const hillGeo = this.ownGeometry(new THREE.ConeGeometry(14, 15, 5));
    const hillMat = this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0x74bd63, roughness: 1, flatShading: true }));
    for (const [x, scale] of [[-20, 1.1], [3, 0.85], [22, 1.25]] as const) {
      const hill = new THREE.Mesh(hillGeo, hillMat);
      hill.position.set(x, 2.4, -96);
      hill.scale.set(scale, scale, scale);
      hill.rotation.y = 0.45;
      this.scene.add(hill);
    }
  }

  private createCoinInstances() {
    this.coinMesh = new THREE.InstancedMesh(this.res.coinGeo, this.res.coinMat, COIN_CAPACITY);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coinMesh.count = 0;
    this.coinMesh.frustumCulled = false;
    this.scene.add(this.coinMesh);
  }

  private createPlayer(): PlayerRig {
    const materials = {
      body: this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0x4285f4, roughness: 0.5 })),
      head: this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0xffd2a8, roughness: 0.7 })),
      accent: this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0xea4335, roughness: 0.5 })),
    };
    const root = new THREE.Group();
    // Slightly oversized for a portrait cabinet, with no effect on world physics.
    root.scale.setScalar(1.08);
    const body = new THREE.Group();
    root.add(body);

    const torso = new THREE.Mesh(this.ownGeometry(new THREE.CapsuleGeometry(0.28, 0.35, 6, 12)), materials.body);
    torso.position.y = 0.85;
    body.add(torso);
    const limb = this.ownGeometry(new THREE.CapsuleGeometry(0.09, 0.38, 4, 8));
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

    // The oversized head remains the character's readable signature.
    const head = new THREE.Mesh(this.ownGeometry(new THREE.SphereGeometry(0.5, 20, 14)), materials.head);
    head.position.y = 1.6;
    const eyeGeo = this.ownGeometry(new THREE.SphereGeometry(0.07, 8, 6));
    const eyeMat = this.ownMaterial(new THREE.MeshBasicMaterial({ color: 0x202124 }));
    for (const x of [-0.17, 0.17]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(x, 0.08, 0.45);
      head.add(eye);
    }
    const band = new THREE.Mesh(this.ownGeometry(new THREE.TorusGeometry(0.47, 0.07, 8, 20)), materials.accent);
    band.rotation.x = Math.PI / 2 - 0.25;
    band.position.y = 0.2;
    head.add(band);
    body.add(head);

    const blob = new THREE.Mesh(
      this.ownGeometry(new THREE.CircleGeometry(0.55, 20)),
      this.ownMaterial(new THREE.MeshBasicMaterial({ color: 0x202124, transparent: true, opacity: 0.22, depthWrite: false })),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    root.add(blob);

    const shield = new THREE.Mesh(
      this.ownGeometry(new THREE.SphereGeometry(1.25, 18, 14)),
      this.ownMaterial(new THREE.MeshStandardMaterial({ color: 0x55bbff, transparent: true, opacity: 0.25, emissive: 0x1166aa, depthWrite: false })),
    );
    shield.position.y = 1.1;
    root.add(shield);
    const magnetRing = new THREE.Mesh(
      this.ownGeometry(new THREE.TorusGeometry(0.9, 0.05, 8, 28)),
      this.ownMaterial(new THREE.MeshBasicMaterial({ color: 0xea4335 })),
    );
    magnetRing.rotation.x = Math.PI / 2;
    magnetRing.position.y = 0.1;
    root.add(magnetRing);

    return { root, body, head, legL, legR, armL, armR, shield, magnetRing, blob, materials };
  }

  setOutfit(outfit: Outfit) {
    this.player.materials.body.color.setHex(outfit.body);
    this.player.materials.head.color.setHex(outfit.head);
    this.player.materials.accent.color.setHex(outfit.accent);
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    if (reduced) this.shake = 0;
  }

  bump(amount = 0.35) {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, amount);
  }

  resize() {
    const { clientWidth, clientHeight } = this.container;
    if (!clientWidth || !clientHeight) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  private updateScenery(travelled: number) {
    for (const house of this.houses) {
      while (house.s - travelled < -30) house.s += this.buildingSpan;
      const z = -(house.s - travelled);
      this.setInstance(this.houseWalls, house.wallIndex, house.x, house.height / 2, z, house.width, house.height, house.depth);
      this.setInstance(this.houseRoofs, house.roofIndex, house.x, house.height + 0.65, z, house.width * 0.78, 1.3, house.depth * 0.7, Math.PI / 4);
      const windowZ = z + house.depth / 2 + 0.04;
      this.setInstance(this.houseWindows, house.windowIndex, house.x - house.width * 0.23, house.height * 0.56, windowZ, 0.48, 0.72, 1);
      this.setInstance(this.houseWindows, house.windowIndex + 1, house.x + house.width * 0.23, house.height * 0.56, windowZ, 0.48, 0.72, 1);
      const side = Math.sign(house.x);
      house.facade.position.set(house.x - side * (house.width / 2 + 0.025), house.height * 0.51, z);
      house.facade.rotation.set(0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
      house.facade.scale.set(house.depth * 0.97, house.height * 1.02, 1);
    }
    this.houseWalls.instanceMatrix.needsUpdate = true;
    this.houseRoofs.instanceMatrix.needsUpdate = true;
    this.houseWindows.instanceMatrix.needsUpdate = true;

    for (const tree of this.trees) {
      while (tree.s - travelled < -26) tree.s += this.treeSpan;
      const z = -(tree.s - travelled);
      this.setInstance(this.treeTrunks, tree.index, tree.x, tree.scale * 0.42, z, tree.scale, tree.scale * 0.84, tree.scale);
      this.setInstance(this.treeCanopies, tree.index, tree.x, tree.scale * 1.32, z, tree.scale, tree.scale, tree.scale);
    }
    this.treeTrunks.instanceMatrix.needsUpdate = true;
    this.treeCanopies.instanceMatrix.needsUpdate = true;

    for (const prop of this.railProps) {
      while (prop.s - travelled < -25) prop.s += this.railSpan;
      prop.root.position.z = -(prop.s - travelled);
    }
  }

  private updatePursuers(time: number, crashed: boolean) {
    this.pursuers.forEach((pursuer, index) => {
      const stride = this.reducedMotion ? 0 : Math.sin(time * 7 + pursuer.phase);
      const sway = this.reducedMotion ? 0 : Math.sin(time * 1.6 + pursuer.phase) * 0.18;
      const depth = 34 + index * 9 + (this.reducedMotion ? 0 : Math.sin(time * 0.8 + pursuer.phase) * 2);
      pursuer.sprite.position.set(pursuer.lane * LANE_WIDTH + sway, 1.32 + Math.abs(stride) * 0.08, -depth);
      pursuer.sprite.scale.set(2.15 + index * 0.06, 2.95 + index * 0.06, 1);
      pursuer.sprite.material.rotation = this.reducedMotion ? 0 : stride * 0.025;
      pursuer.sprite.visible = !crashed;
    });
  }

  private setInstance(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotationY = 0) {
    this.instanceDummy.position.set(x, y, z);
    this.instanceDummy.rotation.set(0, rotationY, 0);
    this.instanceDummy.scale.set(sx, sy, sz);
    this.instanceDummy.updateMatrix();
    mesh.setMatrixAt(index, this.instanceDummy.matrix);
  }

  private obstacleKey(obstacle: Obstacle) {
    if (obstacle.kind === "barrier" || obstacle.kind === "gate") return obstacle.kind;
    const colorIndex = obstacle.kind === "moving" ? 0 : obstacle.id % this.res.trainColors.length;
    const liveryIndex = obstacle.id % this.artMaterials.trains.length;
    // Pool long vehicles by livery and half-unit base length, then scale to the exact world length.
    const lengthBucket = Math.max(0.5, Math.round(obstacle.length * 2) / 2);
    return `${obstacle.kind}:${colorIndex}:${liveryIndex}:${lengthBucket.toFixed(1)}`;
  }

  private makeObstacle(obstacle: Obstacle, key: string): THREE.Object3D {
    const r = this.res;
    const group = new THREE.Group();
    const add = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(r.box, mat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      group.add(mesh);
    };
    if (obstacle.kind === "barrier") {
      add(r.barrierMat, 2.0, 0.45, 0.2, 0, 0.6, 0);
      add(r.postMat, 0.12, 0.6, 0.12, -0.8, 0.3, 0);
      add(r.postMat, 0.12, 0.6, 0.12, 0.8, 0.3, 0);
    } else if (obstacle.kind === "gate") {
      add(r.postMat, 0.18, 2.6, 0.18, -1.0, 1.3, 0);
      add(r.postMat, 0.18, 2.6, 0.18, 1.0, 1.3, 0);
      add(r.gateMat, 2.2, 0.9, 0.2, 0, 1.85, 0);
    } else {
      const [, , liveryKey, lengthKey] = key.split(":");
      const length = Number(lengthKey);
      const liveryIndex = Number(liveryKey);
      const moving = obstacle.kind === "moving";
      const colorIndex = moving ? 0 : obstacle.id % r.trainColors.length;
      const mat = moving ? r.movingMat : r.trainColors[colorIndex];
      add(mat, 2.1, 2.7, length, 0, 1.45, -length / 2);
      add(r.roofMat, 2.0, 0.15, Math.max(0.2, length - 0.2), 0, 2.85, -length / 2);
      add(r.windowMat, 2.14, 0.6, Math.max(0.2, length - 1), 0, 1.9, -length / 2);
      add(r.windowMat, 1.5, 0.8, 0.05, 0, 1.9, 0.01);
      add(r.lightMat, 0.3, 0.2, 0.05, -0.65, 0.7, 0.02);
      add(r.lightMat, 0.3, 0.2, 0.05, 0.65, 0.7, 0.02);
      const livery = new THREE.Sprite(this.artMaterials.trains[liveryIndex]);
      livery.scale.set(4.1, 3.15, 1);
      livery.position.set(0, 1.55, 0.08);
      group.add(livery);
      group.userData.baseLength = length;
    }
    group.userData.poolKey = key;
    return group;
  }

  private makePowerPickup(kind: Exclude<Pickup["kind"], "coin">) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.res.powerGeos[kind], this.res.powerMats[kind]));
    group.add(new THREE.Mesh(this.res.ringGeo, this.res.ringMat));
    return group;
  }

  private acquireObstacle(obstacle: Obstacle, key: string) {
    const available = this.obstaclePool.get(key);
    const object = available?.pop();
    if (object) {
      this.pooledObstacleCount--;
      return object;
    }
    return this.makeObstacle(obstacle, key);
  }

  private releaseObstacle(entry: ActiveVisual) {
    this.scene.remove(entry.object);
    entry.object.visible = false;
    entry.object.scale.set(1, 1, 1);
    const available = this.obstaclePool.get(entry.key);
    if (available) {
      if (available.length >= MAX_POOLED_PER_OBSTACLE_VARIANT || this.pooledObstacleCount >= MAX_POOLED_OBSTACLES) return;
      available.push(entry.object);
    } else if (this.pooledObstacleCount < MAX_POOLED_OBSTACLES) {
      this.obstaclePool.set(entry.key, [entry.object]);
    } else {
      return;
    }
    this.pooledObstacleCount++;
  }

  private acquirePower(kind: Exclude<Pickup["kind"], "coin">) {
    const key = `power:${kind}`;
    const available = this.powerPool.get(key);
    const object = available?.pop();
    if (object) {
      this.pooledPowerCount--;
      return object;
    }
    return this.makePowerPickup(kind);
  }

  private releasePower(entry: ActiveVisual) {
    this.scene.remove(entry.object);
    entry.object.visible = false;
    const available = this.powerPool.get(entry.key);
    if (available) {
      if (available.length >= MAX_POOLED_PER_POWER_KIND || this.pooledPowerCount >= MAX_POOLED_POWERS) return;
      available.push(entry.object);
    } else if (this.pooledPowerCount < MAX_POOLED_POWERS) {
      this.powerPool.set(entry.key, [entry.object]);
    } else {
      return;
    }
    this.pooledPowerCount++;
  }

  private resetEntitySync() {
    for (const entry of this.obstacleActive.values()) this.releaseObstacle(entry);
    for (const entry of this.powerActive.values()) this.releasePower(entry);
    this.obstacleActive.clear();
    this.powerActive.clear();
    this.coinMesh.count = 0;
  }

  private syncObstacles(obstacles: Obstacle[], playerS: number, epoch: number) {
    for (const obstacle of obstacles) {
      const key = this.obstacleKey(obstacle);
      let entry = this.obstacleActive.get(obstacle.id);
      if (entry && entry.key !== key) {
        this.releaseObstacle(entry);
        this.obstacleActive.delete(obstacle.id);
        entry = undefined;
      }
      if (!entry) {
        entry = { key, object: this.acquireObstacle(obstacle, key), seen: epoch };
        this.obstacleActive.set(obstacle.id, entry);
        this.scene.add(entry.object);
      }
      entry.seen = epoch;
      entry.object.visible = !obstacle.destroyed;
      entry.object.position.set(obstacle.lane * LANE_WIDTH, 0, -(obstacle.s - playerS));
      const baseLength = entry.object.userData.baseLength as number | undefined;
      entry.object.scale.set(1, 1, baseLength ? obstacle.length / baseLength : 1);
    }
    for (const [id, entry] of this.obstacleActive) {
      if (entry.seen === epoch) continue;
      this.releaseObstacle(entry);
      this.obstacleActive.delete(id);
    }
  }

  private syncPowers(pickups: Pickup[], playerS: number, time: number, epoch: number) {
    for (const pickup of pickups) {
      if (pickup.kind === "coin") continue;
      const key = `power:${pickup.kind}`;
      let entry = this.powerActive.get(pickup.id);
      if (entry && entry.key !== key) {
        this.releasePower(entry);
        this.powerActive.delete(pickup.id);
        entry = undefined;
      }
      if (!entry) {
        entry = { key, object: this.acquirePower(pickup.kind), seen: epoch };
        this.powerActive.set(pickup.id, entry);
        this.scene.add(entry.object);
      }
      entry.seen = epoch;
      entry.object.visible = !pickup.collected;
      const bob = this.reducedMotion ? 0 : Math.sin(time * 3 + pickup.id) * 0.15;
      entry.object.position.set(pickup.x, pickup.y + bob, -(pickup.s - playerS));
      entry.object.rotation.y = this.reducedMotion ? 0 : time * 2 + pickup.id;
    }
    for (const [id, entry] of this.powerActive) {
      if (entry.seen === epoch) continue;
      this.releasePower(entry);
      this.powerActive.delete(id);
    }
  }

  private syncCoins(pickups: Pickup[], playerS: number, time: number) {
    let count = 0;
    for (const pickup of pickups) {
      if (pickup.kind !== "coin" || pickup.collected || count === COIN_CAPACITY) continue;
      const bob = this.reducedMotion ? 0 : Math.sin(time * 3 + pickup.id) * 0.04;
      this.coinDummy.position.set(pickup.x, pickup.y + bob, -(pickup.s - playerS));
      this.coinDummy.rotation.set(Math.PI / 2, this.reducedMotion ? 0 : time * 4 + pickup.id, 0);
      this.coinDummy.scale.setScalar(1);
      this.coinDummy.updateMatrix();
      this.coinMesh.setMatrixAt(count++, this.coinDummy.matrix);
    }
    this.coinMesh.count = count;
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  /** Draws the world. `idle` animates the attract-mode scene before a run starts. */
  render(world: World, dt: number, idle: boolean) {
    if (this.disposed) return;
    this.clock += dt;
    if (world !== this.syncedWorld) {
      this.resetEntitySync();
      this.syncedWorld = world;
      this.clock = 0;
      // Recycling advances these positions during a run; restore their original
      // span on restart so a long previous run cannot leave an empty town.
      for (const house of this.houses) house.s %= this.buildingSpan;
      for (const tree of this.trees) tree.s %= this.treeSpan;
      for (const prop of this.railProps) prop.s %= this.railSpan;
    }
    this.syncEpoch++;
    if (this.syncEpoch === Number.MAX_SAFE_INTEGER) this.syncEpoch = 1;

    const p = world.player;
    const t = this.clock;
    const crashed = world.status === "over";
    const travelled = idle ? t * 6 : p.s;
    this.trackTexture.offset.y = travelled / SLEEPER_SPACING;
    this.groundTexture.offset.y = travelled / 8;
    this.updateScenery(travelled);
    this.updatePursuers(t, crashed);

    this.syncObstacles(world.obstacles, p.s, this.syncEpoch);
    this.syncPowers(world.pickups, p.s, t, this.syncEpoch);
    this.syncCoins(world.pickups, p.s, t);

    // Player mechanics and silhouette remain unchanged; reduced motion only removes cosmetic movement.
    const rig = this.player;
    rig.root.position.set(p.x, p.y, 0);
    const running = !idle && !crashed;
    const cycle = t * (running ? 4 + world.speed * 0.35 : 7);
    const swing = Math.sin(cycle) * (p.y > 0 ? 0.25 : 0.9);
    rig.legL.rotation.x = swing;
    rig.legR.rotation.x = -swing;
    rig.armL.rotation.x = -swing * 0.8;
    rig.armR.rotation.x = swing * 0.8;
    rig.body.position.y = p.y > 0 || this.reducedMotion ? 0 : Math.abs(Math.sin(cycle)) * 0.08;
    const stumble = !this.reducedMotion && p.stumbleTime > 0 ? Math.sin(t * 40) * 0.2 : 0;
    rig.root.rotation.z = (p.x - p.lane * LANE_WIDTH) * 0.12 + stumble;
    rig.root.rotation.y = Math.PI; // Face toward the approaching track.
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
    rig.shield.scale.setScalar(this.reducedMotion ? 1 : 1 + Math.sin(t * 6) * 0.03);
    rig.magnetRing.visible = world.magnetTime > 0;
    rig.magnetRing.rotation.z = this.reducedMotion ? 0 : t * 4;
    rig.root.visible = !(world.invulnerableTime > 0 && Math.floor(t * 20) % 2 === 0);
    rig.blob.position.y = 0.02 - p.y;
    rig.blob.scale.setScalar(Math.max(0.4, 1 - p.y * 0.25));

    // The camera follows lane choice but reserves sway and impact shake for full-motion mode.
    const idleSway = !this.reducedMotion && idle ? Math.sin(t * 0.5) * 0.65 : 0;
    const camX = p.x * 0.55 + idleSway;
    this.camera.position.x += (camX - this.camera.position.x) * Math.min(1, dt * 8);
    this.camera.position.y = 4.4 + p.y * 0.35;
    this.camera.position.z = 7.2;
    this.shake = this.reducedMotion ? 0 : Math.max(0, this.shake - dt);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.camera.position.x * 0.8, 1.2, -10);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resetEntitySync();
    this.obstaclePool.clear();
    this.powerPool.clear();
    for (const mesh of [this.coinMesh, this.houseWalls, this.houseRoofs, this.houseWindows, this.treeTrunks, this.treeCanopies]) mesh.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
