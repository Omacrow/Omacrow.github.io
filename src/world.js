import * as THREE from 'three';

// A floating autumn island: golden tree, ruined temple, a glowing light at its centre, falling leaves.
// Everything is built from primitives, so the site ships zero model files.

// Stone and wood stay the same in every theme.
const BASE = {
  cliff: 0x463d34,
  stoneDark: 0x322c26,
  rock: 0x5a5148,
  marble: 0xd6c8ad,
  marbleShade: 0xa99b80,
  path: 0x857c70,
  trunk: 0x3a2a1f,
  birch: 0xd9d1c1,
};

// Foliage, ground, glow and light per theme. Keep in sync with the [data-theme] blocks in style.css.
// `gold`/`goldDeep` are the canopy colours and `amber`/`rust` the conifers, whatever the hue.
export const WORLD_THEMES = {
  gold: {
    earth: 0x7a3d1c,
    earthLight: 0x94512a,
    gold: 0xe8b647,
    goldDeep: 0xc98a2c,
    amber: 0xc46f2a,
    rust: 0xa24f24,
    emissive: 0x7a4e10,
    leaf: 0xf3c35b,
    mote: 0xffd58a,
    glow: 0xffbf4d,
    glowCore: 0xffe6a8,
    hemiSky: 0xffdcae,
    hemiGround: 0x24170e,
    sunWarm: 0xffc98a,
    sunDusk: 0xff8f4a,
    fog: 0x140e09,
  },
  amethyst: {
    earth: 0x3f2a4c,
    earthLight: 0x553a63,
    gold: 0xa77bf0,
    goldDeep: 0x7d52c9,
    amber: 0x6a4aa6,
    rust: 0x7e3f7c,
    emissive: 0x3b1e7a,
    leaf: 0xc9a6ff,
    mote: 0xe2ccff,
    glow: 0xc49bff,
    glowCore: 0xf0e4ff,
    hemiSky: 0xdcd0ff,
    hemiGround: 0x1a1224,
    sunWarm: 0xe0ceff,
    sunDusk: 0xff9ad5,
    fog: 0x0f0b16,
  },
  crimson: {
    earth: 0x4f1f17,
    earthLight: 0x66291e,
    gold: 0xd8443a,
    goldDeep: 0xa52a2a,
    amber: 0x9a2f24,
    rust: 0xb8492c,
    emissive: 0x5a0f0a,
    leaf: 0xff6a55,
    mote: 0xffb39a,
    glow: 0xff7a5a,
    glowCore: 0xffd8c8,
    hemiSky: 0xffd0c4,
    hemiGround: 0x200c0a,
    sunWarm: 0xffb59a,
    sunDusk: 0xff6a4a,
    fog: 0x150909,
  },
};

const GROUND = 0.35;
const RADIUS = 4.9;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smoothstep = (a, b, t) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function softDotTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(canvas, { reducedMotion = false, theme = 'amethyst', progress = 0, intro: playIntro = true } = {}) {
  const PALETTE = { ...BASE, ...(WORLD_THEMES[theme] ?? WORLD_THEMES.amethyst) };
  const rand = mulberry32(1337);
  const range = (a, b) => lerp(a, b, rand());
  const isSmall = () => window.matchMedia('(max-width: 900px)').matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmall() ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !isSmall();
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.fog, 24, 56);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);

  const world = new THREE.Group();
  scene.add(world);

  const tickers = [];
  const dot = softDotTexture();

  // ---------- helpers ----------

  const materials = new Map();
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!materials.has(key)) {
      materials.set(
        key,
        new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, metalness: 0, ...opts }),
      );
    }
    return materials.get(key);
  }

  function place(parent, geometry, material, o = {}) {
    const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, cast = true, receive = false } = o;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    if (Array.isArray(s)) mesh.scale.set(...s);
    else mesh.scale.setScalar(s);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  }

  // Displace vertices for a hand-made, low-poly look. Coincident vertices share an offset so seams stay closed.
  function roughen(geometry, amount, yAmount = amount) {
    const pos = geometry.attributes.position;
    const offsets = new Map();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
      let d = offsets.get(key);
      if (!d) {
        d = [(rand() - 0.5) * amount, (rand() - 0.5) * yAmount, (rand() - 0.5) * amount];
        offsets.set(key, d);
      }
      pos.setXYZ(i, x + d[0], y + d[1], z + d[2]);
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  // ---------- layout anchors ----------

  const T = new THREE.Vector2(0.9, 0); // temple centre (x, z)
  const G = new THREE.Vector2(-2.0, -1.4); // golden tree
  const FRONT_ANGLE = 0.6;
  const front = new THREE.Vector2(Math.sin(FRONT_ANGLE) * 4.7, Math.cos(FRONT_ANGLE) * 4.7);
  const dir = front.clone().sub(T).normalize(); // temple → island edge, the path
  const perp = new THREE.Vector2(dir.y, -dir.x);

  const occupied = [];
  function distToPath(x, z) {
    const dx = x - T.x;
    const dz = z - T.y;
    const s = dx * dir.x + dz * dir.y;
    if (s < 1.6) return Infinity;
    return Math.abs(dx * perp.x + dz * perp.y);
  }
  function findSpot(rMin, rMax, clearance) {
    for (let i = 0; i < 60; i++) {
      const a = rand() * Math.PI * 2;
      const r = range(rMin, rMax);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (Math.hypot(x - T.x, z - T.y) < 2.3) continue;
      if (Math.hypot(x - G.x, z - G.y) < 1.5) continue;
      if (distToPath(x, z) < 0.6) continue;
      if (occupied.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + clearance)) continue;
      occupied.push({ x, z, r: clearance });
      return { x, z };
    }
    return null;
  }

  // ---------- island body ----------

  place(world, roughen(new THREE.CylinderGeometry(RADIUS, RADIUS - 0.3, 0.7, 22, 2), 0.32, 0.06), mat(PALETTE.earth), {
    cast: false,
    receive: true,
  });
  place(world, roughen(new THREE.CylinderGeometry(RADIUS - 0.2, RADIUS - 0.75, 1.0, 18, 1), 0.4), mat(PALETTE.cliff), {
    y: -0.8,
    cast: false,
  });
  const under = new THREE.ConeGeometry(RADIUS - 0.7, 6.5, 16, 5);
  under.rotateX(Math.PI);
  place(world, roughen(under, 0.75), mat(PALETTE.stoneDark), { y: -1.25 - 3.25, cast: false });

  // lighter turf patches
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const r = range(0.5, 3.8);
    const size = range(0.6, 1.2);
    place(world, roughen(new THREE.CylinderGeometry(size, size, 0.05, 7), 0.25, 0), mat(PALETTE.earthLight), {
      x: Math.sin(a) * r,
      y: GROUND + 0.02,
      z: Math.cos(a) * r,
      cast: false,
      receive: true,
    });
  }

  // fallen leaves carpet
  {
    const count = 320;
    const leaf = new THREE.PlaneGeometry(0.12, 0.12);
    leaf.rotateX(-Math.PI / 2);
    const leafMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
    const carpet = new THREE.InstancedMesh(leaf, leafMat, count);
    carpet.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    const tones = [PALETTE.gold, PALETTE.goldDeep, PALETTE.amber, PALETTE.rust];
    for (let i = 0; i < count; i++) {
      let x;
      let z;
      if (i < count * 0.45) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * 2.0;
        x = G.x + Math.sin(a) * r;
        z = G.y + Math.cos(a) * r;
      } else {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * (RADIUS - 0.35);
        x = Math.sin(a) * r;
        z = Math.cos(a) * r;
      }
      p.set(x, GROUND + 0.06, z);
      q.setFromAxisAngle(up, rand() * Math.PI);
      sc.setScalar(range(0.7, 1.4));
      m.compose(p, q, sc);
      carpet.setMatrixAt(i, m);
      carpet.setColorAt(i, c.setHex(tones[i % tones.length]));
    }
    world.add(carpet);
  }

  // ---------- golden tree ----------

  const goldLeaf = mat(PALETTE.gold, { emissive: PALETTE.emissive, emissiveIntensity: 0.45, roughness: 0.7 });
  const canopy = new THREE.Group();
  {
    const tree = new THREE.Group();
    tree.position.set(G.x, GROUND, G.y);
    world.add(tree);

    place(tree, roughen(new THREE.CylinderGeometry(0.17, 0.42, 2.9, 7, 4), 0.1), mat(PALETTE.trunk), { y: 1.45 });

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + range(-0.3, 0.3);
      place(tree, new THREE.ConeGeometry(0.13, 0.9, 5), mat(PALETTE.trunk), {
        x: Math.cos(a) * 0.38,
        y: 0.12,
        z: -Math.sin(a) * 0.38,
        ry: a,
        rz: -1.9,
      });
    }

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      place(tree, new THREE.CylinderGeometry(0.03, 0.08, 1.3, 5), mat(PALETTE.trunk), {
        x: Math.cos(a) * 0.45,
        y: 2.45,
        z: -Math.sin(a) * 0.45,
        ry: a,
        rz: -0.85,
      });
    }

    canopy.position.y = 3.25;
    tree.add(canopy);
    const blobs = [
      [0, 0.35, 0, 1.3],
      [0.95, -0.1, 0.3, 0.9],
      [-0.9, 0, -0.2, 0.95],
      [0.2, -0.2, -0.95, 0.85],
      [-0.3, -0.3, 0.9, 0.85],
      [0.45, 0.8, 0.25, 0.75],
      [-0.5, 0.65, -0.45, 0.7],
      [1.25, -0.55, -0.4, 0.55],
      [-1.2, -0.5, 0.55, 0.55],
    ];
    for (const [x, y, z, r] of blobs) {
      place(canopy, roughen(new THREE.IcosahedronGeometry(r, 1), r * 0.2), goldLeaf, { x, y, z, ry: rand() * 6 });
    }
    tickers.push((t) => {
      canopy.rotation.z = Math.sin(t * 0.7) * 0.025;
      canopy.rotation.x = Math.sin(t * 0.5 + 1) * 0.02;
    });
  }

  // ---------- ruined temple ----------

  let graceLight;
  {
    const temple = new THREE.Group();
    temple.position.set(T.x, GROUND, T.y);
    world.add(temple);

    place(temple, new THREE.CylinderGeometry(1.75, 1.9, 0.22, 32), mat(PALETTE.marbleShade), { y: 0.11, receive: true });
    place(temple, new THREE.CylinderGeometry(1.5, 1.58, 0.16, 32), mat(PALETTE.marble), { y: 0.3, receive: true });
    const floor = 0.38;

    const openAngle = Math.atan2(-dir.y, dir.x); // column angle a sits at (cos a, -sin a)
    const n = 9;
    const R = 1.25;
    const a0 = openAngle + Math.PI * 0.27;
    const a1 = openAngle + Math.PI * 1.73;
    const heights = [1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 0.55, 0.95, 0.3];
    for (let i = 0; i < n; i++) {
      const a = lerp(a0, a1, i / (n - 1));
      const h = heights[i];
      const x = Math.cos(a) * R;
      const z = -Math.sin(a) * R;
      place(temple, new THREE.CylinderGeometry(0.09, 0.11, h, 8), mat(PALETTE.marble), { x, y: floor + h / 2, z });
      place(temple, new THREE.BoxGeometry(0.28, 0.07, 0.28), mat(PALETTE.marbleShade), { x, y: floor + 0.035, z, ry: -a });
      if (h > 1) {
        place(temple, new THREE.BoxGeometry(0.26, 0.08, 0.26), mat(PALETTE.marbleShade), { x, y: floor + h + 0.04, z, ry: -a });
      }
    }

    // lintel arc over the intact columns
    const intactSpan = ((a1 - a0) / (n - 1)) * 5;
    const lintel = new THREE.TorusGeometry(R, 0.075, 4, 40, intactSpan);
    lintel.rotateX(-Math.PI / 2);
    place(temple, lintel, mat(PALETTE.marble), { y: floor + 1.4 + 0.15, ry: a0 });

    // fallen column drums
    place(temple, new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8), mat(PALETTE.marble), {
      x: Math.cos(a1 + 0.35) * 2.15,
      y: 0.1,
      z: -Math.sin(a1 + 0.35) * 2.15,
      rz: Math.PI / 2,
      ry: 0.6,
    });
    place(temple, new THREE.CylinderGeometry(0.1, 0.1, 0.4, 8), mat(PALETTE.marble), {
      x: Math.cos(a1 - 0.2) * 2.35,
      y: 0.1,
      z: -Math.sin(a1 - 0.2) * 2.35,
      rz: Math.PI / 2,
      ry: -0.4,
    });

    // steps facing the path
    const stepYaw = Math.atan2(dir.x, dir.y);
    place(temple, new THREE.BoxGeometry(1.1, 0.12, 0.34), mat(PALETTE.marbleShade), {
      x: dir.x * 2.0,
      y: 0.06,
      z: dir.y * 2.0,
      ry: stepYaw,
      receive: true,
    });
    place(temple, new THREE.BoxGeometry(1.1, 0.24, 0.3), mat(PALETTE.marble), {
      x: dir.x * 1.78,
      y: 0.12,
      z: dir.y * 1.78,
      ry: stepYaw,
      receive: true,
    });

    // guardian statues flanking the entrance
    for (const side of [-1, 1]) {
      const sx = dir.x * 2.15 + perp.x * 0.75 * side;
      const sz = dir.y * 2.15 + perp.y * 0.75 * side;
      place(temple, new THREE.BoxGeometry(0.3, 0.3, 0.3), mat(PALETTE.marbleShade), { x: sx, y: 0.15, z: sz, ry: stepYaw });
      place(temple, new THREE.CylinderGeometry(0.07, 0.12, 0.55, 6), mat(PALETTE.marble), { x: sx, y: 0.58, z: sz });
      place(temple, new THREE.IcosahedronGeometry(0.075, 0), mat(PALETTE.marble), { x: sx, y: 0.93, z: sz });
      place(temple, new THREE.CylinderGeometry(0.012, 0.012, 0.8, 4), mat(PALETTE.marbleShade), {
        x: sx + perp.x * 0.1 * side,
        y: 0.75,
        z: sz + perp.y * 0.1 * side,
      });
    }

    // pedestal + glowing light
    place(temple, new THREE.CylinderGeometry(0.2, 0.26, 0.35, 8), mat(PALETTE.marbleShade), { y: floor + 0.175 });
    const grace = place(temple, new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: PALETTE.glowCore }), {
      y: floor + 0.8,
      cast: false,
    });
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: dot,
        color: PALETTE.glow,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.position.y = floor + 0.8;
    halo.scale.setScalar(1.5);
    temple.add(halo);
    graceLight = new THREE.PointLight(PALETTE.glow, 5, 7, 1.6);
    graceLight.position.y = floor + 0.85;
    temple.add(graceLight);

    tickers.push((t) => {
      grace.rotation.y = t * 0.9;
      grace.position.y = floor + 0.8 + Math.sin(t * 1.6) * 0.05;
      const pulse = 0.85 + Math.sin(t * 2.1) * 0.15;
      halo.scale.setScalar(1.35 * pulse + 0.2);
      graceLight.intensity = 4.5 * pulse;
    });
  }

  // ---------- path + lamp pillars ----------

  {
    const yaw = Math.atan2(dir.x, dir.y);
    for (let s = 2.35, i = 0; s < 4.15; s += 0.44, i++) {
      if (i === 3) continue; // a missing slab
      const x = T.x + dir.x * s + perp.x * range(-0.06, 0.06);
      const z = T.y + dir.y * s + perp.y * range(-0.06, 0.06);
      place(world, new THREE.BoxGeometry(0.62, 0.06, 0.38), mat(PALETTE.path), {
        x,
        y: GROUND + 0.03,
        z,
        ry: yaw + range(-0.12, 0.12),
        receive: true,
      });
    }
    for (const [s, side] of [
      [2.7, 1],
      [2.7, -1],
      [3.75, 1],
      [3.75, -1],
    ]) {
      const x = T.x + dir.x * s + perp.x * 0.62 * side;
      const z = T.y + dir.y * s + perp.y * 0.62 * side;
      place(world, new THREE.BoxGeometry(0.16, 0.08, 0.16), mat(PALETTE.marbleShade), { x, y: GROUND + 0.04, z });
      place(world, new THREE.CylinderGeometry(0.04, 0.05, 0.7, 6), mat(PALETTE.marble), { x, y: GROUND + 0.43, z });
      place(world, new THREE.IcosahedronGeometry(0.07, 0), mat(PALETTE.marble), { x, y: GROUND + 0.84, z });
    }
  }

  // ---------- rock spires on the far side ----------

  for (let i = 0; i < 6; i++) {
    const a = FRONT_ANGLE + Math.PI + range(-1.0, 1.0);
    const r = range(3.9, 4.5);
    const h = range(1.0, 2.6);
    const geo = roughen(new THREE.CylinderGeometry(range(0.12, 0.2), range(0.3, 0.45), h, 5, 3), 0.12);
    place(world, geo, mat(PALETTE.rock), { x: Math.sin(a) * r, y: GROUND + h / 2 - 0.1, z: Math.cos(a) * r, ry: rand() * 6 });
    occupied.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, r: 0.45 });
  }

  // ---------- conifers, aspens, rocks ----------

  const coniferTones = [PALETTE.amber, PALETTE.rust, PALETTE.goldDeep];
  for (let i = 0; i < 11; i++) {
    const spot = findSpot(2.4, 4.4, 0.45);
    if (!spot) continue;
    const h = range(1.1, 2.1);
    const g = new THREE.Group();
    g.position.set(spot.x, GROUND, spot.z);
    world.add(g);
    place(g, new THREE.CylinderGeometry(0.03, 0.06, h * 0.4, 5), mat(PALETTE.trunk), { y: h * 0.2 });
    const tone = coniferTones[i % coniferTones.length];
    for (let k = 0; k < 3; k++) {
      const r = h * (0.27 - k * 0.065);
      const th = h * (0.48 - k * 0.08);
      place(g, new THREE.ConeGeometry(r, th, 7), mat(tone), { y: h * (0.28 + k * 0.2) + th / 2, ry: rand() * 6 });
    }
  }

  for (let i = 0; i < 7; i++) {
    const spot = findSpot(1.8, 4.3, 0.5);
    if (!spot) continue;
    const g = new THREE.Group();
    g.position.set(spot.x, GROUND, spot.z);
    world.add(g);
    const h = range(0.55, 0.9);
    place(g, new THREE.CylinderGeometry(0.035, 0.05, h, 5), mat(PALETTE.birch), { y: h / 2 });
    const r = range(0.32, 0.5);
    place(g, roughen(new THREE.IcosahedronGeometry(r, 0), r * 0.25), goldLeaf, { y: h + r * 0.6 });
    place(g, roughen(new THREE.IcosahedronGeometry(r * 0.7, 0), r * 0.2), mat(PALETTE.goldDeep), {
      x: r * 0.5,
      y: h + r * 0.15,
      z: r * 0.3,
    });
  }

  for (let i = 0; i < 16; i++) {
    const spot = findSpot(3.6, 4.75, 0.2);
    if (!spot) continue;
    const r = range(0.14, 0.42);
    place(world, roughen(new THREE.DodecahedronGeometry(r, 0), r * 0.3), mat(PALETTE.rock), {
      x: spot.x,
      y: GROUND + r * 0.25,
      z: spot.z,
      rx: rand() * 3,
      ry: rand() * 3,
      s: [1, 0.7, 1],
      receive: true,
    });
  }

  // ---------- floating islets ----------

  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const a = (i / 7) * Math.PI * 2 + range(-0.3, 0.3);
    const r = range(6.4, 8.8);
    g.position.set(Math.sin(a) * r, range(-2.8, 2.2), Math.cos(a) * r);
    g.scale.setScalar(range(0.25, 0.65));
    place(g, roughen(new THREE.CylinderGeometry(1, 0.9, 0.35, 9), 0.15, 0.04), mat(PALETTE.earth), { receive: true });
    const cone = new THREE.ConeGeometry(0.9, 2.2, 8, 2);
    cone.rotateX(Math.PI);
    place(g, roughen(cone, 0.3), mat(PALETTE.stoneDark), { y: -1.25 });
    if (rand() > 0.35) {
      place(g, new THREE.CylinderGeometry(0.05, 0.08, 0.6, 5), mat(PALETTE.birch), { y: 0.45 });
      place(g, roughen(new THREE.IcosahedronGeometry(0.45, 0), 0.12), goldLeaf, { y: 0.95 });
    }
    world.add(g);
    const base = g.position.y;
    const phase = rand() * Math.PI * 2;
    const speed = range(0.35, 0.7);
    tickers.push((t) => {
      g.position.y = base + Math.sin(t * speed + phase) * 0.25;
      g.rotation.y = phase + t * 0.04;
    });
  }

  // ---------- falling leaves ----------

  {
    const count = isSmall() ? 140 : 260;
    const pos = new Float32Array(count * 3);
    const meta = new Float32Array(count * 2); // fall speed, phase
    const crownY = GROUND + 3.25;
    const spawn = (i, anywhere) => {
      pos[i * 3] = G.x + range(-1.6, 1.6);
      pos[i * 3 + 1] = anywhere ? range(GROUND + 0.2, crownY + 0.6) : crownY + range(-0.7, 0.7);
      pos[i * 3 + 2] = G.y + range(-1.6, 1.6);
      meta[i * 2] = range(0.25, 0.6);
      meta[i * 2 + 1] = rand() * Math.PI * 2;
    };
    for (let i = 0; i < count; i++) spawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.11, map: dot, color: PALETTE.leaf, transparent: true, depthWrite: false }),
    );
    points.frustumCulled = false;
    world.add(points);
    const edge = (RADIUS - 0.2) ** 2;
    tickers.push((t, dt) => {
      if (!dt) return;
      for (let i = 0; i < count; i++) {
        const ph = meta[i * 2 + 1];
        pos[i * 3] += (Math.sin(t * 1.4 + ph) * 0.35 + 0.22) * dt;
        pos[i * 3 + 1] -= meta[i * 2] * dt;
        pos[i * 3 + 2] += Math.cos(t * 1.1 + ph) * 0.3 * dt;
        const x = pos[i * 3];
        const y = pos[i * 3 + 1];
        const z = pos[i * 3 + 2];
        if ((x * x + z * z < edge && y < GROUND + 0.05) || y < -7) spawn(i, false);
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  // ---------- drifting motes ----------

  {
    const count = isSmall() ? 90 : 170;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = range(2, 11);
      pos[i * 3] = Math.sin(a) * r;
      pos[i * 3 + 1] = range(-4, 7);
      pos[i * 3 + 2] = Math.cos(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.06,
        map: dot,
        color: PALETTE.mote,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    motes.frustumCulled = false;
    scene.add(motes);
    tickers.push((t, dt) => {
      if (!dt) return;
      for (let i = 0; i < count; i++) {
        pos[i * 3 + 1] += (0.12 + (i % 5) * 0.03) * dt;
        pos[i * 3] += Math.sin(t * 0.5 + i) * 0.05 * dt;
        if (pos[i * 3 + 1] > 7) pos[i * 3 + 1] = -4;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  // ---------- lighting ----------

  scene.add(new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.95));
  const sun = new THREE.DirectionalLight(0xffc27a, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 34 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0x8090d8, 0.7);
  rim.position.set(-8, 4, -7);
  scene.add(rim);

  const sunWarm = new THREE.Color(PALETTE.sunWarm);
  const sunDusk = new THREE.Color(PALETTE.sunDusk);

  // ---------- camera rig ----------

  const state = { target: progress, p: progress, px: 0, py: 0, tx: 0, ty: 0 };
  const view = { w: 1, h: 1, small: isSmall() };

  function updateCamera() {
    const p = state.p;
    const mid = Math.sin(p * Math.PI);
    const late = smoothstep(0.78, 1, p);

    // orbit around the island, ending in a top-down isometric view (a teaser of the game)
    const theta = FRONT_ANGLE + 0.15 - p * Math.PI * 1.1 + state.px * 0.08;
    const elev = lerp(0.3, 0.95, late) + 0.07 * mid - state.py * 0.04;
    let dist = lerp(21, 24, mid) + late * 1.5;
    if (camera.aspect < 1) dist *= 1.75;

    camera.position.set(
      Math.sin(theta) * Math.cos(elev) * dist,
      Math.sin(elev) * dist + 0.6,
      Math.cos(theta) * Math.cos(elev) * dist,
    );
    camera.lookAt(0, 0.9 - late * 0.5, 0);

    // keep the island beside the text on desktop, above it on mobile
    if (view.small) {
      camera.setViewOffset(view.w, view.h, 0, view.h * 0.24, view.w, view.h);
    } else {
      const side = 0.04 + 0.17 * Math.max(1 - smoothstep(0, 0.16, p), late);
      camera.setViewOffset(view.w, view.h, -view.w * side, 0, view.w, view.h);
    }

    const sa = 0.9 + p * 1.7;
    sun.position.set(Math.cos(sa) * 11, lerp(11, 7, p), Math.sin(sa) * 11);
    sun.color.copy(sunWarm).lerp(sunDusk, p);
  }

  function resize() {
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    view.small = isSmall();
    renderer.setSize(view.w, view.h, false);
    camera.aspect = view.w / view.h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // ---------- loop ----------

  let raf = 0;
  let last = performance.now();
  let t = 0;
  let intro = reducedMotion || !playIntro ? 1 : 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const realDt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    if (document.hidden) return;

    const dt = reducedMotion ? 0 : realDt;
    t += dt;

    const k = 1 - Math.exp(-realDt * 5);
    state.p += (state.target - state.p) * k;
    state.px += (state.tx - state.px) * k;
    state.py += (state.ty - state.py) * k;

    intro = Math.min(1, intro + realDt / 2.4);
    const e = 1 - (1 - intro) ** 3;
    world.position.y = lerp(-1.8, 0, e);
    world.rotation.y = lerp(-0.6, 0, e);

    for (const tick of tickers) tick(t, dt);
    updateCamera();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    setProgress(p) {
      state.target = clamp01(p);
    },
    setPointer(x, y) {
      if (reducedMotion) return;
      state.tx = x;
      state.ty = y;
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      scene.traverse((obj) => {
        obj.geometry?.dispose();
        obj.material?.map?.dispose();
        obj.material?.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
