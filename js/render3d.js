// Vista 3D en tercera persona (Three.js): edificios extruidos de OSM y cámara detrás del jugador
'use strict';
(function () {
const SB = window.SB;
const CH = 200; // tamaño de trozo (m) para descartar geometría fuera de cámara
const TCH = 400; // trozos de árboles
const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

const TILES = ['#b5553a', '#a64b32', '#c0643f', '#9c4a35', '#b86b4b'];
const WALLS = ['#e8dcc8', '#d9c7a8', '#cfc3b3', '#e6d2b5', '#c9b49a', '#ddd4c6', '#bfae9a', '#e3c9a8', '#d8b9a0', '#f0e6d6'];
const Y = { ground: 0, water: 0.02, area: 0.04, plaza: 0.05, rail: 0.07, path: 0.08, sidewalk: 0.1, road: 0.14, line: 0.17 };

function col(hex) { return new THREE.Color(hex); }
function hash(i) { return ((i * 2654435761) >>> 0) / 4294967296; }

// Acumulador de triángulos por trozo y material
class Batches {
  constructor() { this.map = new Map(); }
  get(x, z, mat) {
    const k = Math.floor(x / CH) + ',' + Math.floor(z / CH) + ',' + mat;
    let b = this.map.get(k);
    if (!b) { b = { mat, p: new Buf(Float32Array), c: new Buf(Uint8Array), uv: new Buf(Float32Array), cell: new Buf(Float32Array) }; this.map.set(k, b); }
    return b;
  }
}
// Buffer con tipo que crece solo (mucha menos memoria que un Array normal, importante en móviles)
class Buf {
  constructor(T) { this.T = T; this.a = new T(768); this.n = 0; }
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    const b = new this.T(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b;
  }
  push3(x, y, z) { this.reserve(3); const a = this.a; a[this.n++] = x; a[this.n++] = y; a[this.n++] = z; }
  push2(x, y) { this.reserve(2); const a = this.a; a[this.n++] = x; a[this.n++] = y; }
  view() { return this.a.subarray(0, this.n); }
}
function pushTri(b, ax, ay, az, bx, by, bz, cx, cy, cz, c) {
  b.p.push3(ax, ay, az); b.p.push3(bx, by, bz); b.p.push3(cx, cy, cz);
  const r = Math.round(c.r * 255), g = Math.round(c.g * 255), bl = Math.round(c.b * 255);
  b.c.push3(r, g, bl); b.c.push3(r, g, bl); b.c.push3(r, g, bl);
}

class Renderer3D {
  constructor(world, canvas) {
    this.w = world;
    const mobile = SB.isMobile();
    this.mobile = mobile;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; });
    const R = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: mobile ? 'default' : 'high-performance' });
    R.setPixelRatio(mobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new THREE.Scene();
    const sky = col('#9fc3e6');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, mobile ? 110 : 160, mobile ? 300 : 480);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.4, mobile ? 320 : 900);
    this.scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x8a7f6a, 0.62));
    const sun = new THREE.DirectionalLight(0xfff0d8, 0.55); sun.position.set(-0.45, 1, -0.3); this.scene.add(sun);
    this.mats = {
      flat: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      roof: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    };
    this.models = new SB.Models(THREE);
    this.atlas = SB.buildFacadeAtlas(THREE);
    this.mats.wall = this.wallMaterial(this.atlas);
    this.bHeight = new Float32Array(world.buildings.length);
    this.bBase = new Float32Array(world.buildings.length);
    this.buildStatic();
    this.buildSigns();
    this.buildLandmarks();
    this.buildDynamicPools();
    this.meshes = new Map();
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.matCache = new Map();
    this.yaw = null;
    this.camPos = new THREE.Vector3();
    this.resize();
  }

  // Material de fachadas: repite cada celda del atlas con fract() (atributo "cell" = esquina de la celda)
  wallMaterial(atlas) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: atlas.tex });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.cellSize = { value: new THREE.Vector2(atlas.size[0], atlas.size[1]) };
      sh.vertexShader = 'attribute vec2 cell;\nvarying vec2 vCell;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvCell = cell;');
      sh.fragmentShader = 'uniform vec2 cellSize;\nvarying vec2 vCell;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec2 fuv = vCell + fract(vUv) * cellSize;
  #if __VERSION__ >= 300
    vec4 sampledDiffuseColor = textureGrad(map, fuv, dFdx(vUv) * cellSize, dFdy(vUv) * cellSize);
  #else
    vec4 sampledDiffuseColor = texture2D(map, fuv);
  #endif
  diffuseColor *= sampledDiffuseColor;
#endif`);
    };
    return m;
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ---------- geometría estática ----------
  buildStatic() {
    const m = this.w.map, B = new Batches();
    const C = {
      sidewalk: col('#d5cebf'), asphalt: col('#4a4c51'), major: col('#404247'), ped: col('#cdbfa3'), path: col('#c2ae8a'),
      steps: col('#b09a7c'), water: col('#3d78b0'), green: col('#7fa65a'), wood: col('#5f8a45'), farm: col('#a9b16a'),
      pitch: col('#5a9a4e'), sand: col('#e0d3a2'), cemetery: col('#8d9d78'), plaza: col('#cdc5b3'), rail: col('#6b5b4b'),
      bridge: col('#8a8578'), line: col('#e9e4cf'),
      park: col('#86b45f'), playground: col('#d9c38f'), orchard: col('#9fb562'), scrub: col('#7d9a55'), wetland: col('#7fa38a'),
    };
    // suelo lejano (fuera del mapa) a la altura del borde
    const b = this.w.bounds;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(b.maxx - b.minx + 4000, b.maxy - b.miny + 4000),
      new THREE.MeshLambertMaterial({ color: '#a9a28f' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minx + b.maxx) / 2, -0.6, (b.miny + b.maxy) / 2);
    this.scene.add(ground);
    // el suelo del mapa (calles, parques, agua…) se dibuja en teselas de terreno bajo demanda: ver updateTerrain()
    this.terrainTiles = new Map();
    this.terrainMat = new Map();

    // edificios
    this.w.buildings.forEach((bd, i) => this.building(B, bd, (m.bh && m.bh[i]) || 0, i));
    this.trees();
    this.buildCity(B);

    for (const bt of B.map.values()) {
      if (!bt.p.n) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(bt.p.a.slice(0, bt.p.n), 3));
      g.setAttribute('color', new THREE.BufferAttribute(bt.c.a.slice(0, bt.c.n), 3, true));
      if (bt.mat === 'wall') {
        g.setAttribute('uv', new THREE.BufferAttribute(bt.uv.a.slice(0, bt.uv.n), 2));
        g.setAttribute('cell', new THREE.BufferAttribute(bt.cell.a.slice(0, bt.cell.n), 2));
      }
      bt.p = bt.c = bt.uv = bt.cell = null;
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.mats[bt.mat]);
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
  }

  polygon(B, ring, y, c) {
    const pts = [];
    const n = ring.length / 2 - (ring[0] === ring[ring.length - 2] && ring[1] === ring[ring.length - 1] ? 1 : 0);
    if (n < 3) return;
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(ring[i * 2], ring[i * 2 + 1]));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch (e) { return; }
    const bt = B.get(pts[0].x, pts[0].y, 'flat');
    for (const t of tris) {
      const a = pts[t[0]], b2 = pts[t[1]], d = pts[t[2]];
      pushTri(bt, a.x, y, a.y, b2.x, y, b2.y, d.x, y, d.y, c);
    }
    return tris;
  }

  // Cinta con uniones redondeadas a lo largo de una polilínea
  ribbon(B, p, width, y, c, joints) {
    const hw = width / 2;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x1 = p[i], z1 = p[i + 1], x2 = p[i + 2], z2 = p[i + 3];
      const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      const nx = -dz / L * hw, nz = dx / L * hw;
      const bt = B.get((x1 + x2) / 2, (z1 + z2) / 2, 'flat');
      pushTri(bt, x1 + nx, y, z1 + nz, x2 + nx, y, z2 + nz, x2 - nx, y, z2 - nz, c);
      pushTri(bt, x1 + nx, y, z1 + nz, x2 - nx, y, z2 - nz, x1 - nx, y, z1 - nz, c);
    }
    if (!joints) return;
    const seg = hw > 4 ? 10 : 7;
    for (let i = 0; i < p.length; i += 2) {
      // sólo en extremos y en quiebros
      if (i > 0 && i + 2 < p.length) {
        const a1 = Math.atan2(p[i + 1] - p[i - 1], p[i] - p[i - 2]), a2 = Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]);
        if (Math.abs(angDiff(a1, a2)) < 0.12) continue;
      }
      const x = p[i], z = p[i + 1], bt = B.get(x, z, 'flat');
      for (let k = 0; k < seg; k++) {
        const a = k / seg * TAU, b2 = (k + 1) / seg * TAU;
        pushTri(bt, x, y, z, x + Math.cos(a) * hw, y, z + Math.sin(a) * hw, x + Math.cos(b2) * hw, y, z + Math.sin(b2) * hw, c);
      }
    }
  }

  dashes(B, p, c) {
    let acc = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x1 = p[i], z1 = p[i + 1], dx = p[i + 2] - x1, dz = p[i + 3] - z1, L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      const ux = dx / L, uz = dz / L, nx = -uz * 0.12, nz = ux * 0.12;
      for (let t = (3 - acc % 7 + 7) % 7; t < L; t += 7) {
        const e = Math.min(L, t + 3);
        const ax = x1 + ux * t, az = z1 + uz * t, bx = x1 + ux * e, bz = z1 + uz * e;
        const bt = B.get(ax, az, 'flat');
        pushTri(bt, ax + nx, Y.line, az + nz, bx + nx, Y.line, bz + nz, bx - nx, Y.line, bz - nz, c);
        pushTri(bt, ax + nx, Y.line, az + nz, bx - nx, Y.line, bz - nz, ax - nx, Y.line, az - nz, c);
      }
      acc += L;
    }
  }

  building(B, bd, h, i) {
    const p = bd.pts;
    if ((bd.bb[2] - bd.bb[0]) * (bd.bb[3] - bd.bb[1]) > 400000) return;
    const kind = (this.w.map.bk && this.w.map.bk[i]) || '';
    const r1 = hash(i + 3), r2 = hash(i + 11), r3 = hash(i + 7);
    const area = (this.w.map.binfo && this.w.map.binfo[i] && this.w.map.binfo[i].area) || 200;
    if (!h) {
      if (kind === 'house') h = area < 70 && r1 < 0.5 ? 3.4 : r1 < 0.8 ? 6.4 : 9.3; // 1, 2 o 3 plantas
      else if (kind === 'lowres') h = r1 < 0.55 ? 6.4 : 9.4;
      else h = { shed: 3.2, industrial: 9, church: 16, school: 10.5, commercial: 8, public: 12.5, construction: 2.6, ruins: 2.4 }[kind] || 9.3 + Math.floor(r1 * 4) * 3.1;
    }
    this.bHeight[i] = h;
    let upper, ground = null;
    if (kind === 'church') upper = 'stone';
    else if (kind === 'school') upper = 'school';
    else if (kind === 'industrial') upper = 'industrial';
    else if (kind === 'house') upper = ['house', 'house', 'classic', 'blind', 'plaster'][Math.floor(r1 * 5)];
    else if (kind === 'lowres') upper = ['classic', 'blind', 'brick', 'plaster', 'balcony'][Math.floor(r1 * 5)];
    else if (kind === 'shed' || kind === 'construction' || kind === 'ruins') upper = 'plaster';
    else if (kind === 'commercial' || kind === 'public') upper = r1 < 0.6 ? 'modern' : 'brick';
    else upper = ['classic', 'balcony', 'brick', 'brick', 'brickBalcony', 'blind', 'blind', 'plaster', 'modern', 'balcony'][Math.floor(r1 * 10)];
    if ((kind === '' || kind === 'commercial') && h > 6)
      ground = ['shopRed', 'shopGreen', 'shopBlue', 'shopOrange', 'shutter1', 'shutter2', 'shutter1', 'door', 'door', 'garage'][Math.floor(r2 * 10)];
    else if ((kind === 'house' || kind === 'lowres') && h > 5) ground = ['door', 'door', 'garage', 'door'][Math.floor(r2 * 4)];
    const tintC = (key) => this.atlas.tint[key] ? col(WALLS[Math.floor(r3 * WALLS.length)]) : new THREE.Color().setScalar(0.9 + r3 * 0.1);
    const upC = tintC('u_' + upper);
    const upCell = this.atlas.cells['u_' + upper], gCell = ground ? this.atlas.cells['g_' + ground] : null;
    const cx = (bd.bb[0] + bd.bb[2]) / 2, cz = (bd.bb[1] + bd.bb[3]) / 2;
    const n = p.length / 2 - 1;
    // base = punto más bajo del terreno bajo el edificio; las paredes bajan un poco más para no flotar
    const T = this.w.terrain;
    let base = Infinity;
    for (let k = 0; k < n; k++) base = Math.min(base, T.at(p[k * 2], p[k * 2 + 1]));
    base = Math.min(base, T.at(cx, cz));
    this.bBase[i] = base;
    const y0 = base - 0.8, top = base + h;
    const gh = ground ? base + Math.min(3.8, h) : base;
    const floorH = kind === 'industrial' || kind === 'shed' ? h : kind === 'church' ? 5 : 3.1;
    const floors = Math.max(1, Math.round((top - gh) / floorH));
    const ub = B.get(cx, cz, 'wall'), gb = ground ? ub : null;
    const gC = ground ? tintC('g_' + ground) : null;
    for (let k = 0; k < n; k++) {
      const x1 = p[k * 2], z1 = p[k * 2 + 1], x2 = p[k * 2 + 2], z2 = p[k * 2 + 3];
      const L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 0.05) continue;
      const u = Math.max(1, Math.round(L / (kind === 'industrial' ? 6 : 3.6)));
      const ub0 = gb ? gh : y0;
      pushTri(ub, x1, ub0, z1, x2, ub0, z2, x2, top, z2, upC);
      pushTri(ub, x1, ub0, z1, x2, top, z2, x1, top, z1, upC);
      ub.uv.push2(0, 0); ub.uv.push2(u, 0); ub.uv.push2(u, floors);
      ub.uv.push2(0, 0); ub.uv.push2(u, floors); ub.uv.push2(0, floors);
      for (let q = 0; q < 6; q++) ub.cell.push2(upCell[0], upCell[1]);
      if (gb) {
        pushTri(gb, x1, y0, z1, x2, y0, z2, x2, gh, z2, gC);
        pushTri(gb, x1, y0, z1, x2, gh, z2, x1, gh, z1, gC);
        const v0 = -0.8 / 3.8;
        gb.uv.push2(0, v0); gb.uv.push2(u, v0); gb.uv.push2(u, 0.999);
        gb.uv.push2(0, v0); gb.uv.push2(u, 0.999); gb.uv.push2(0, 0.999);
        for (let q = 0; q < 6; q++) gb.cell.push2(gCell[0], gCell[1]);
      }
    }
    const pts = [];
    for (let k = 0; k < n; k++) pts.push(new THREE.Vector2(p[k * 2], p[k * 2 + 1]));
    // casas: tejado de teja a cuatro aguas
    if (kind === 'house' && n >= 3 && n <= 10 && this.hipRoof(B.get(cx, cz, 'roof'), pts, top, col(TILES[Math.floor(r2 * TILES.length)]))) return;
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch (e) { return; }
    const roofC = col(kind === 'church' ? '#9a5b43' : kind === 'industrial' ? '#8d9499' : kind === 'construction' ? '#9b9689' : bd.color);
    const rb = B.get(cx, cz, 'roof');
    for (const t of tris) {
      const a = pts[t[0]], b2 = pts[t[1]], d = pts[t[2]];
      pushTri(rb, a.x, top, a.y, b2.x, top, b2.y, d.x, top, d.y, roofC);
    }
  }

  // Tejado a cuatro aguas (o piramidal si la planta es casi cuadrada) sobre el rectángulo orientado de la planta
  hipRoof(rb, pts, top, c) {
    // eje principal = lado más largo
    let best = 0, ux = 1, uy = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L > best) { best = L; ux = (b.x - a.x) / L; uy = (b.y - a.y) / L; }
    }
    const vx = -uy, vy = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of pts) { const u = q.x * ux + q.y * uy, v = q.x * vx + q.y * vy; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const W = v1 - v0, L = u1 - u0;
    if (W < 2 || L < 2) return false;
    const rh = Math.min(3.2, W * 0.42), vm = (v0 + v1) / 2;
    const ra = Math.min(u0 + W / 2, (u0 + u1) / 2), rbU = Math.max(u1 - W / 2, (u0 + u1) / 2);
    const R = (u) => [ux * u + vx * vm, uy * u + vy * vm];
    const R1 = R(ra), R2 = R(rbU), mid = (u0 + u1) / 2, yT = top + rh;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const ua = a.x * ux + a.y * uy, ub = b.x * ux + b.y * uy;
      const ea = ua < mid ? R1 : R2, eb = ub < mid ? R1 : R2;
      pushTri(rb, a.x, top, a.y, b.x, top, b.y, eb[0], yT, eb[1], c);
      if (ea !== eb) pushTri(rb, a.x, top, a.y, eb[0], yT, eb[1], ea[0], yT, ea[1], c);
    }
    return true;
  }

  // ---------- letreros: placas de calle y tiendas reales de OSM ----------
  buildSigns() {
    const w = this.w, m = w.map, atlas = new SB.TextAtlas(), R = SB.SIGN_RATIO;
    const bufs = [];
    const buf = (i) => bufs[i] || (bufs[i] = { p: new Buf(Float32Array), uv: new Buf(Float32Array) });
    // quad legible desde el lado (-uz, ux)
    const quad = (t, cx, cy, cz, ux, uz, W, H) => {
      const b = buf(t.atlas), hx = ux * W / 2, hz = uz * W / 2;
      const x0 = cx - hx, z0 = cz - hz, x1 = cx + hx, z1 = cz + hz, y0 = cy - H / 2, y1 = cy + H / 2;
      b.p.push3(x0, y0, z0); b.p.push3(x1, y0, z1); b.p.push3(x1, y1, z1);
      b.p.push3(x0, y0, z0); b.p.push3(x1, y1, z1); b.p.push3(x0, y1, z0);
      b.uv.push2(t.u0, t.v0); b.uv.push2(t.u1, t.v0); b.uv.push2(t.u1, t.v1);
      b.uv.push2(t.u0, t.v0); b.uv.push2(t.u1, t.v1); b.uv.push2(t.u0, t.v1);
    };
    const poles = { p: new Buf(Float32Array), c: new Buf(Uint8Array) };
    const poleC = col('#3a3d42');

    // Placas en los cruces: una por calle, sin repetir la misma calle a menos de 45 m
    const placed = new Map();
    let plates = 0;
    for (let n = 0; n < w.nx.length && plates < 3500; n++) {
      const byName = new Map();
      for (const e of w.pedAdj[n]) if (e.r.name && e.r.drive && !byName.has(e.r.name)) byName.set(e.r.name, e);
      if (byName.size < 2) continue;
      for (const [name, e] of byName) {
        const x = w.nx[n], z = w.ny[n];
        const list = placed.get(name) || [];
        if (list.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < 45 * 45)) continue;
        let ux = w.nx[e.to] - x, uz = w.ny[e.to] - z; const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
        let side = 1, off = e.r.w / 2 + 1.2;
        let px = x - uz * off * side + ux * Math.min(6, L * 0.4), pz = z + ux * off * side + uz * Math.min(6, L * 0.4);
        if (w.isInsideBuilding(px, pz)) { side = -1; px = x - uz * off * side + ux * Math.min(6, L * 0.4); pz = z + ux * off * side + uz * Math.min(6, L * 0.4); }
        const t = atlas.add(name, 'street');
        const W = 3.2, H = W / R, gy = w.terrain.at(px, pz), sy = gy + 2.9;
        quad(t, px, sy, pz, ux, uz, W, H);
        quad(t, px, sy, pz, -ux, -uz, W, H);
        // poste
        const pw = 0.06, g0 = gy - 0.3, g1 = sy - H / 2;
        pushTri(poles, px - uz * pw, g0, pz + ux * pw, px + uz * pw, g0, pz - ux * pw, px + uz * pw, g1, pz - ux * pw, poleC);
        pushTri(poles, px - uz * pw, g0, pz + ux * pw, px + uz * pw, g1, pz - ux * pw, px - uz * pw, g1, pz + ux * pw, poleC);
        list.push([x, z]); placed.set(name, list); plates++;
      }
    }

    // Paradas de bus: letrero con el nombre en un poste junto a la marquesina
    for (const p of (w.city ? w.city.props : [])) {
      if (p.k !== 'busstop' || !p.name) continue;
      const f = p.face != null ? p.face : p.a, al = f + Math.PI / 2;
      const x = p.x + Math.cos(f) * 0.6 + Math.cos(al) * 2.6, z = p.y + Math.sin(f) * 0.6 + Math.sin(al) * 2.6;
      const t = atlas.add(p.name, 'bus'), W = 2.4, H = W / R, y = w.terrain.at(x, z) + 2.7;
      quad(t, x, y, z, Math.cos(f), Math.sin(f), W, H);
      quad(t, x, y, z, -Math.cos(f), -Math.sin(f), W, H);
    }

    // Letreros de tiendas, bares, farmacias… en la fachada que da a la calle
    const used = [];
    for (const sh of m.shops || []) {
      let best = null, bs = Infinity;
      for (const b of w.buildingsNear(sh.x, sh.y, 25)) {
        const p = b.pts;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const x1 = p[k], z1 = p[k + 1], x2 = p[k + 2], z2 = p[k + 3];
          const L = Math.hypot(x2 - x1, z2 - z1); if (L < 3) continue;
          const d = Math.sqrt(SB.segDist2(sh.x, sh.y, x1, z1, x2, z2)); if (d > 25) continue;
          const ux = (x2 - x1) / L, uz = (z2 - z1) / L;
          let t = ((sh.x - x1) * ux + (sh.y - z1) * uz); t = Math.max(1.5, Math.min(L - 1.5, t));
          const qx = x1 + ux * t, qz = z1 + uz * t;
          let nx = -uz, nz = ux;
          if (SB.pointInPoly(qx + nx * 0.4, qz + nz * 0.4, p, b.bb)) { nx = -nx; nz = -nz; }
          const rd = w.roadDist(qx + nx * 3, qz + nz * 3);
          const score = d + (rd > 8 ? 30 : rd);
          if (score < bs) { bs = score; best = { qx, qz, nx, nz, L, b }; }
        }
      }
      if (!best || bs > 40) continue;
      if (used.some(([a, c]) => (a - best.qx) ** 2 + (c - best.qz) ** 2 < 36)) continue;
      used.push([best.qx, best.qz]);
      const W = Math.min(best.L * 0.95, 7), H = W / R;
      const bh = this.bHeight[best.b.i] || 9;
      const y = (this.bBase[best.b.i] || 0) + Math.min(bh - H / 2 - 0.2, 4.3);
      const t = atlas.add(sh.name, sh.kind);
      // legible desde fuera: u = (nz, -nx)
      quad(t, best.qx + best.nx * 0.15, y, best.qz + best.nz * 0.15, best.nz, -best.nx, W, H);
    }

    bufs.forEach((b, i) => {
      if (!b) return;
      const tex = new THREE.CanvasTexture(atlas.canvases[i]);
      tex.anisotropy = 4;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.p.view().slice(), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(b.uv.view().slice(), 2));
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex }));
      mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    });
    if (poles.p.n) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(poles.p.view().slice(), 3));
      g.setAttribute('color', new THREE.BufferAttribute(poles.c.view().slice(), 3, true));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, this.mats.flat); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
    this.signCount = { plates, shops: used.length };
  }

  // Nombres flotantes sobre los sitios conocidos (Ajuntament, parques, iglesias…)
  buildLandmarks() {
    const ICON = { townhall: '🏛', hospital: '🏥', police: '🚓', station: '🚉', place_of_worship: '⛪', marketplace: '🛒', library: '📚',
      school: '🏫', fire_station: '🚒', theatre: '🎭', cinema: '🎬', museum: '🏺', park: '🌳', stadium: '🏟', cemetery: '✝', building: '🏢' };
    this.labels = [];
    const PRIO = ['townhall', 'hospital', 'station', 'police', 'place_of_worship', 'marketplace', 'park', 'stadium', 'museum',
      'theatre', 'cinema', 'library', 'fire_station', 'school', 'college', 'university', 'cemetery', 'bus_station'];
    const prio = (k) => { const i = PRIO.indexOf(k); return i < 0 ? (k === 'building' ? 99 : 50) : i; };
    const pois = this.w.map.pois.slice().sort((a, b) => prio(a.kind) - prio(b.kind));
    const seen = new Set();
    for (const p of pois) {
      if (this.labels.length >= 120) break;
      if (seen.has(p.name)) continue; seen.add(p.name);
      const c = document.createElement('canvas'); c.width = 512; c.height = 80;
      const g = c.getContext('2d');
      const text = (ICON[p.kind] || '📍') + ' ' + p.name;
      let size = 38; g.font = `bold ${size}px system-ui, sans-serif`;
      while (g.measureText(text).width > 480 && size > 16) { size--; g.font = `bold ${size}px system-ui, sans-serif`; }
      const tw = g.measureText(text).width + 30;
      g.fillStyle = 'rgba(15,15,25,.72)';
      g.beginPath(); g.roundRect ? g.roundRect(256 - tw / 2, 8, tw, 64, 14) : g.rect(256 - tw / 2, 8, tw, 64); g.fill();
      g.fillStyle = '#ffd21f'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 42);
      const tex = new THREE.CanvasTexture(c);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false }));
      const b = this.w.buildingAt(p.x, p.y);
      const h = b ? (this.bBase[b.i] || 0) + (this.bHeight[b.i] || 10) : this.w.terrain.at(p.x, p.y) + 4;
      sp.position.set(p.x, h + 5, p.y);
      sp.scale.set(20, 20 * 80 / 512, 1);
      sp.visible = false;
      this.scene.add(sp);
      this.labels.push(sp);
    }
  }

  // Árboles (reales de OSM + relleno de parques), instanciados por tipo
  trees() {
    const T = this.w.trees;
    if (!T || !T.n) return;
    const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4f32' });
    const crownMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
    const palmMat = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    // hojas de palmera: 8 hojas que salen del centro y caen hacia fuera
    const palmLeaves = () => {
      const pos = [];
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2 + (k % 2) * 0.2, c = Math.cos(a), sn = Math.sin(a), px = -sn * 0.45, pz = c * 0.45;
        const mx = c * 1.7, my = 0.35, mz = sn * 1.7, tx = c * 3.2, ty = -1.3 + (k % 3) * 0.3, tz = sn * 3.2;
        pos.push(0, 0, 0, mx + px, my, mz + pz, mx - px, my, mz - pz);
        pos.push(mx + px, my, mz + pz, tx, ty, tz, mx - px, my, mz - pz);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    };
    // [tronco: radio arriba, radio abajo, alto], [copa: geometría, altura del centro, escala x/y/z], colores
    const TYPES = [
      { trunk: [0.16, 0.24, 3], crown: new THREE.IcosahedronGeometry(2.1, 0), cy: 4.4, sc: [1, 0.9, 1], cols: ['#4f7d3a', '#5b8c3e', '#446e33', '#628f3f', '#557a35'] },
      { trunk: [0.14, 0.22, 6], crown: new THREE.IcosahedronGeometry(2.6, 0), cy: 6.8, sc: [1.15, 0.42, 1.15], cols: ['#3b6536', '#44703c', '#355c31'] },
      { trunk: [0.13, 0.2, 7.5], crown: palmLeaves(), cy: 7.5, sc: [1, 1, 1], cols: ['#5d8a3a', '#6a9440'], mat: palmMat },
      { trunk: null, crown: new THREE.IcosahedronGeometry(1, 0), cy: 0.7, sc: [1, 0.75, 1], cols: ['#5e8a45', '#6b9444', '#56803f'] },
      { trunk: [0.1, 0.15, 1.4], crown: new THREE.IcosahedronGeometry(1.3, 0), cy: 2.1, sc: [1, 0.85, 1], cols: ['#6f9a45', '#7da64c'] },
      { trunk: [0.1, 0.14, 1], crown: new THREE.ConeGeometry(0.8, 7, 7), cy: 4.2, sc: [1, 1, 1], cols: ['#2f5a2f', '#355f33'] },
    ];
    // agrupamos por tipo y por trozo de mapa para que la cámara descarte los que no ve
    const groups = new Map();
    for (let i = 0; i < T.n; i++) {
      const k = T.t[i] + ',' + Math.floor(T.x[i] / TCH) + ',' + Math.floor(T.y[i] / TCH);
      let l = groups.get(k); if (!l) groups.set(k, l = []); l.push(i);
    }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
    const trunkGeo = TYPES.map(ty => ty.trunk && new THREE.CylinderGeometry(ty.trunk[0], ty.trunk[1], ty.trunk[2], 5));
    // geometría que comparte los datos pero con una esfera envolvente del tamaño del trozo
    const chunkGeo = (base) => {
      const g = new THREE.BufferGeometry();
      for (const n in base.attributes) g.setAttribute(n, base.attributes[n]);
      if (base.index) g.setIndex(base.index);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 40, 0), TCH * 0.75 + 60);
      return g;
    };
    for (const [k, list] of groups) {
      const [tt, gx, gz] = k.split(',').map(Number), ty = TYPES[tt];
      const ox = (gx + 0.5) * TCH, oz = (gz + 0.5) * TCH;
      const crown = new THREE.InstancedMesh(chunkGeo(ty.crown), ty.mat || crownMat, list.length);
      const trunk = ty.trunk ? new THREE.InstancedMesh(chunkGeo(trunkGeo[tt]), trunkMat, list.length) : null;
      crown.position.set(ox, 0, oz); if (trunk) trunk.position.set(ox, 0, oz);
      list.forEach((i, j) => {
        const x = T.x[i] - ox, z = T.y[i] - oz, sc = T.s[i], gy = this.w.terrain.at(T.x[i], T.y[i]) - 0.1;
        if (trunk) { Q.identity(); S.set(sc, sc, sc); P.set(x, gy + ty.trunk[2] / 2 * sc, z); M.compose(P, Q, S); trunk.setMatrixAt(j, M); }
        E.set(0, (i * 1.7) % 6.28, 0); Q.setFromEuler(E);
        S.set(ty.sc[0] * sc, ty.sc[1] * sc, ty.sc[2] * sc); P.set(x, gy + ty.cy * sc, z); M.compose(P, Q, S); crown.setMatrixAt(j, M);
        C.set(ty.cols[i % ty.cols.length]); crown.setColorAt(j, C);
      });
      crown.instanceMatrix.needsUpdate = true; if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
      this.scene.add(crown); if (trunk) this.scene.add(trunk);
    }
  }

  // ---------- mobiliario urbano, semáforos y tren ----------
  buildCity(B) {
    const city = this.w.city, T = this.w.terrain;
    if (!city) return;
    const C = (h) => col(h);
    const box = (x, y, z, sx, sy, sz, a, c) => {
      const bt = B.get(x, z, 'flat'), ca = Math.cos(a), sa = Math.sin(a);
      const P = (dx, dy, dz) => [x + ca * dx - sa * dz, y + dy, z + sa * dx + ca * dz];
      const hx = sx / 2, hz = sz / 2;
      const v = [P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, 0, hz), P(-hx, 0, hz), P(-hx, sy, -hz), P(hx, sy, -hz), P(hx, sy, hz), P(-hx, sy, hz)];
      const quad = (a1, b1, c1, d1) => { pushTri(bt, ...v[a1], ...v[b1], ...v[c1], c); pushTri(bt, ...v[a1], ...v[c1], ...v[d1], c); };
      quad(4, 5, 6, 7); quad(0, 1, 5, 4); quad(1, 2, 6, 5); quad(2, 3, 7, 6); quad(3, 0, 4, 7);
    };
    const pole = C('#3d4247'), lampHead = C('#dfe3e6'), wood = C('#8b5a2b'), dark = C('#2b2e31'), glass = C('#a9cfdc');
    const RC = [C('#2e7d32'), C('#f9c80e'), C('#1565c0'), C('#6d4c41')];
    for (const p of city.props) {
      const g = T.at(p.x, p.y), a = p.a || 0, ca = Math.cos(a), sa = Math.sin(a);
      if (p.k === 'lamp') {
        box(p.x, g - 0.2, p.y, 0.16, 7.2, 0.16, a, pole);
        box(p.x + ca * 0.8, g + 6.85, p.y + sa * 0.8, 1.6, 0.1, 0.1, a, pole);
        box(p.x + ca * 1.6, g + 6.7, p.y + sa * 1.6, 0.6, 0.18, 0.32, a, lampHead);
      } else if (p.k === 'bench') {
        box(p.x, g + 0.4, p.y, 1.8, 0.07, 0.45, a, wood);
        box(p.x - sa * 0.22, g + 0.47, p.y + ca * 0.22, 1.8, 0.45, 0.06, a, wood);
        box(p.x + ca * 0.75, g - 0.1, p.y + sa * 0.75, 0.08, 0.5, 0.4, a, dark);
        box(p.x - ca * 0.75, g - 0.1, p.y - sa * 0.75, 0.08, 0.5, 0.4, a, dark);
      } else if (p.k === 'fountain') {
        box(p.x, g - 0.1, p.y, 0.32, 1.15, 0.32, a, C('#2f4f3a'));
        box(p.x + ca * 0.25, g + 0.5, p.y + sa * 0.25, 0.5, 0.08, 0.35, a, C('#2f4f3a'));
      } else if (p.k === 'bin') box(p.x, g - 0.1, p.y, 0.45, 0.95, 0.45, a, C('#3e4a3d'));
      else if (p.k === 'postbox') box(p.x, g - 0.1, p.y, 0.5, 1.25, 0.42, a, C('#f6c90e'));
      else if (p.k === 'recycle') {
        for (let k = 0; k < 4; k++) {
          const o = -2.6 + k * 1.75, x = p.x + ca * o, y = p.y + sa * o;
          box(x, g - 0.1, y, 1.6, 1.65, 1.3, a, RC[k]);
          box(x, g + 1.55, y, 1.62, 0.08, 1.32, a, dark);
        }
      } else if (p.k === 'busstop') {
        const f = p.face != null ? p.face : a, fx = Math.cos(f), fy = Math.sin(f), al = f + Math.PI / 2;
        const bx = p.x - fx * 0.75, by = p.y - fy * 0.75; // panel trasero, lejos de la calle
        box(bx, g - 0.1, by, 0.06, 2.4, 4.2, f, glass);
        box(p.x, g + 2.45, p.y, 1.8, 0.12, 4.4, f, C('#c62828'));
        for (const s of [-2, 2]) box(bx + Math.cos(al) * s, g - 0.1, by + Math.sin(al) * s, 0.1, 2.55, 0.1, f, pole);
        box(p.x - fx * 0.45, g + 0.42, p.y - fy * 0.45, 0.4, 0.07, 2.4, f, C('#9aa0a6'));
        box(p.x + fx * 0.6 + Math.cos(al) * 2.6, g - 0.1, p.y + fy * 0.6 + Math.sin(al) * 2.6, 0.08, 2.5, 0.08, f, pole);
      }
    }
    // semáforos: poste y caja; la luz encendida es una instancia que se mueve y cambia de color
    for (const h of city.heads) {
      const g = T.at(h.x, h.y), ca = Math.cos(h.a), sa = Math.sin(h.a);
      box(h.x, g - 0.2, h.y, 0.13, 3.9, 0.13, h.a, pole);
      box(h.x + ca * 0.05, g + 2.55, h.y + sa * 0.05, 0.3, 1.05, 0.34, h.a, C('#1c1c1c'));
      for (let k = 0; k < 3; k++) box(h.x + ca * 0.2, g + 2.63 + k * 0.32, h.y + sa * 0.2, 0.04, 0.2, 0.2, h.a, C('#3a3a3a'));
      h.g = g;
    }
    if (city.heads.length) {
      this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), city.heads.length);
      this.bulbs.frustumCulled = false;
      this.scene.add(this.bulbs);
      this.bulbsDirty = true;
    }
    // tren
    this.trainMeshes = [];
    if (city.train) for (let k = 0; k < city.train.cars; k++) {
      const m = this.models.train(city.train.carLen, k === 0 || k === city.train.cars - 1);
      m.visible = false; this.scene.add(m); this.trainMeshes.push(m);
    }
  }

  updateCity(game) {
    const city = this.w.city; if (!city) return;
    if (this.bulbs) {
      const M = new THREE.Matrix4(), Cc = new THREE.Color();
      const COLS = { r: 0xff2a2a, y: 0xffc21f, g: 0x3cff5a };
      city.heads.forEach((h, i) => {
        if (h.shown === h.state && !this.bulbsDirty) return;
        h.shown = h.state;
        const slot = h.state === 'r' ? 2 : h.state === 'y' ? 1 : 0;
        M.makeTranslation(h.x + Math.cos(h.a) * 0.24, h.g + 2.73 + slot * 0.32, h.y + Math.sin(h.a) * 0.24);
        this.bulbs.setMatrixAt(i, M); this.bulbs.setColorAt(i, Cc.set(COLS[h.state]));
        this.bulbs.instanceMatrix.needsUpdate = true; this.bulbs.instanceColor.needsUpdate = true;
      });
      this.bulbsDirty = false;
    }
    const cars = city.trainCars();
    cars.forEach((c, k) => {
      const m = this.trainMeshes[k]; if (!m) return;
      m.visible = true;
      m.position.set(c.x, this.w.terrain.at(c.x, c.y) + 0.35, c.y);
      m.rotation.y = -c.a + (city.train.dir < 0 ? Math.PI : 0);
    });
  }

  // ---------- objetos dinámicos ----------
  buildDynamicPools() {
    // partículas
    this.maxParts = 900;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxParts * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.maxParts * 3), 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.9, vertexColors: true, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    // balas
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(200 * 6), 3));
    this.bulletLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: '#ffe680' }));
    this.bulletLines.frustumCulled = false;
    this.scene.add(this.bulletLines);
    // marcadores de misión
    this.markers = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2.5, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: '#35d46a', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      cyl.position.y = 1.25;
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3, 24), new THREE.MeshBasicMaterial({ color: '#35d46a', side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25;
      const icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshBasicMaterial({ color: '#35d46a' }));
      icon.position.y = 3.5;
      g.add(cyl, ring, icon); g.visible = false; g.userData = { cyl, ring, icon };
      this.scene.add(g); this.markers.push(g);
    }
    // manchas en el suelo
    this.decalMeshes = [];
    const dg = new THREE.CircleGeometry(1, 14);
    for (let i = 0; i < 60; i++) {
      const d = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: '#7a0d0d', transparent: true, opacity: 0.8, depthWrite: false }));
      d.rotation.x = -Math.PI / 2; d.position.y = Y.line + 0.02; d.visible = false;
      this.scene.add(d); this.decalMeshes.push(d);
    }
    // billetes
    this.cashMeshes = [];
    for (let i = 0; i < 30; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.35), new THREE.MeshLambertMaterial({ color: '#2ecc40', emissive: '#0b4d14' }));
      c.visible = false; this.scene.add(c); this.cashMeshes.push(c);
    }
  }

  mat(color, emissive) {
    const k = color + '|' + (emissive || '');
    let m = this.matCache.get(k);
    if (!m) { m = new THREE.MeshLambertMaterial({ color, emissive: emissive || '#000000' }); this.matCache.set(k, m); }
    return m;
  }
  box(parent, sx, sy, sz, x, y, z, color, emissive) {
    const b = new THREE.Mesh(this.boxGeo, this.mat(color, emissive));
    b.scale.set(sx, sy, sz); b.position.set(x, y, z);
    parent.add(b);
    return b;
  }

  makeCar(c) {
    const g = this.models.car(c.m, c.color);
    this.scene.add(g);
    return g;
  }

  makePed(q, isPlayer) {
    // aspecto variado y estable para cada peatón (derivado de su id)
    const r = (k) => hash(q.id * 7 + k);
    const woman = !isPlayer && r(1) < 0.5;
    const SKIN = ['#f1c7a5', '#e0ac80', '#c68d63', '#8d5a3b', '#f5d0b5'];
    const o = isPlayer
      ? { shirt: '#e67e22', pants: '#1b2631', hair: '#111', skin: '#d9a47a', player: true, longSleeve: true, shoes: '#111' }
      : {
        shirt: q.cop ? '#1f3a93' : q.shirt, pants: q.cop ? '#1b2631' : q.pants, hair: q.hair, skin: SKIN[Math.floor(r(2) * SKIN.length)],
        woman, skirt: woman && r(3) < 0.35, hairStyle: woman ? (r(4) < 0.7 ? 'long' : 'short') : r(4) < 0.12 ? 'bald' : 'short',
        longSleeve: r(5) < 0.4, shoes: ['#222', '#eee', '#5d4037', '#b71c1c'][Math.floor(r(6) * 4)], cap: q.cop ? '#1b2631' : r(7) < 0.1 ? '#c0392b' : null,
      };
    const g = this.models.ped(o);
    const s = 0.94 + r(8) * 0.12; g.scale.setScalar(isPlayer ? 1.02 : s);
    this.scene.add(g);
    return g;
  }

  syncEntities(game) {
    const seen = new Set();
    const sync = (key, make, update) => {
      let o = this.meshes.get(key);
      if (!o) { o = make(); this.meshes.set(key, o); }
      seen.add(key); update(o);
    };
    const t = game.time;
    for (const c of game.cars) {
      sync('c' + c.id, () => this.makeCar(c), (g) => {
        // coche apoyado en el terreno, inclinado según la pendiente
        const T = this.w.terrain, ca = Math.cos(c.a), sa = Math.sin(c.a), hl = c.m.l * 0.4, hw = c.m.w * 0.45;
        const hf = T.at(c.x + ca * hl, c.y + sa * hl), hb = T.at(c.x - ca * hl, c.y - sa * hl);
        const hr = T.at(c.x - sa * hw, c.y + ca * hw), hL = T.at(c.x + sa * hw, c.y - ca * hw);
        g.position.set(c.x, (hf + hb) / 2, c.y);
        g.rotation.order = 'YZX';
        g.rotation.set(Math.atan2(hL - hr, hw * 2), -c.a, Math.atan2(hf - hb, hl * 2));
        const u = g.userData;
        if (c.dead && !u.burnt) { u.burnt = true; for (const b of u.body) b.material = this.mat('#252525'); }
        if (u.rider) u.rider.visible = !!c.driver;
        const steer = c.driver === 'player' && game.playerInput ? game.playerInput.steer : (c.av || 0) * 0.5;
        this.models.animateCar(g, c, this.dt || 0.016, steer);
        if (u.red) {
          const on = game.stars > 0 && c.driver === 'cop' && !c.dead, ph = Math.floor(t * 8) % 2;
          u.red.material = this.mat(on && ph ? '#ff2d2d' : '#7a1d1d', on && ph ? '#ff0000' : null);
          u.blue.material = this.mat(on && !ph ? '#2d6dff' : '#1d2f7a', on && !ph ? '#0033ff' : null);
        }
      });
    }
    const pedUpdate = (q, g) => {
      const Pp = game.pos();
      g.visible = Math.abs(q.x - Pp.x) < 110 && Math.abs(q.y - Pp.y) < 110;
      if (!g.visible) return;
      const gy = this.w.terrain.at(q.x, q.y);
      g.position.set(q.x, gy, q.y); g.rotation.y = -q.a;
      const u = g.userData;
      if (q.state === 'dead') { g.rotation.z = Math.PI / 2; g.position.y = gy + 0.15; this.models.pose(g, 0, 0); return; }
      g.rotation.z = 0;
      // amplitud según lo rápido que se mueve (quieto / andando / corriendo)
      const px = q._px === undefined ? q.x : q._px, py = q._py === undefined ? q.y : q._py;
      const v = Math.hypot(q.x - px, q.y - py) / Math.max(this.dt || 0.016, 0.001);
      q._px = q.x; q._py = q.y;
      q._amp = (q._amp || 0) + (Math.min(1, v / 6.5) - (q._amp || 0)) * 0.2;
      const amp = v > 0.3 ? Math.max(0.35, q._amp) : q._amp * 0.8;
      this.models.pose(g, (q.walk || 0) * 1.1, amp, q.aim > game.time ? 'aim' : null);
    };
    for (const q of game.peds) sync('p' + q.id, () => this.makePed(q, false), (g) => pedUpdate(q, g));
    const p = game.player;
    if (!p.car && !(game.dead && game.dead.kind === 'busted' && false)) {
      sync('player', () => this.makePed(p, true), (g) => pedUpdate(game.dead ? { ...p, state: 'dead' } : p, g));
    }
    for (const [k, o] of this.meshes) if (!seen.has(k)) { this.scene.remove(o); this.meshes.delete(k); }

    // partículas
    const pos = this.points.geometry.attributes.position, colA = this.points.geometry.attributes.color;
    const n = Math.min(game.parts.length, this.maxParts), tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const q = game.parts[i];
      const up = q.grow ? 0.8 + (q.max - q.life) * 2.5 : 0.8;
      pos.setXYZ(i, q.x, up + this.w.terrain.at(q.x, q.y), q.y);
      tmp.set(q.color); const f = Math.max(0.2, q.life / q.max); colA.setXYZ(i, tmp.r * f + 0.1, tmp.g * f + 0.1, tmp.b * f + 0.1);
    }
    pos.needsUpdate = true; colA.needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);
    // balas
    const bp = this.bulletLines.geometry.attributes.position;
    const nb = Math.min(game.bullets.length, 200);
    for (let i = 0; i < nb; i++) {
      const b = game.bullets[i];
      const by = 1.2 + this.w.terrain.at(b.x, b.y);
      bp.setXYZ(i * 2, b.x, by, b.y); bp.setXYZ(i * 2 + 1, b.x - b.vx * 0.015, by, b.y - b.vy * 0.015);
    }
    bp.needsUpdate = true; this.bulletLines.geometry.setDrawRange(0, nb * 2);
    // marcadores
    const marks = [];
    if (!game.mission) for (const s of game.starts) marks.push([s.x, s.y, '#35d46a']);
    else { const st = game.target(); if (st && !st.car) marks.push([st.x, st.y, '#ffd21f']); else if (st && st.car) marks.push([st.x, st.y, '#ffd21f', true]); }
    this.markers.forEach((mk, i) => {
      const d = marks[i];
      mk.visible = !!d;
      if (!d) return;
      mk.position.set(d[0], this.w.terrain.at(d[0], d[1]), d[1]);
      const u = mk.userData;
      u.cyl.visible = u.ring.visible = !d[3];
      u.icon.position.y = d[3] ? 3.2 : 3.5 + Math.sin(t * 3) * 0.3; u.icon.rotation.y = t * 2;
      for (const o of [u.cyl, u.ring, u.icon]) o.material.color.set(d[2]);
    });
    this.decalMeshes.forEach((m, i) => {
      const d = game.decals[game.decals.length - 1 - i];
      m.visible = !!d;
      if (d) { m.position.set(d.x, this.w.terrain.at(d.x, d.y) + 0.12, d.y); m.scale.setScalar(d.r); m.material.color.set(d.r > 3 ? '#1a1a1a' : '#7a0d0d'); }
    });
    const P = game.pos();
    for (const l of this.labels) { const d = Math.hypot(l.position.x - P.x, l.position.z - P.y); l.visible = d > 12 && d < 450; }
    this.cashMeshes.forEach((m, i) => {
      const k = game.pickups[i];
      m.visible = !!k;
      if (k) { m.position.set(k.x, this.w.terrain.at(k.x, k.y) + 0.5 + Math.sin(t * 4 + i) * 0.15, k.y); m.rotation.y = t * 2; }
    });
  }

  // ---------- cámara ----------
  updateCamera(game, dt) {
    const P = game.pos(), car = game.player.car, w = this.w;
    const sp = car ? Math.hypot(car.vx, car.vy) : 0;
    let yawT = car ? car.a : game.player.a;
    if (car) {
      // si vamos marcha atrás rápido, la cámara no gira
      const vf = car.vx * Math.cos(car.a) + car.vy * Math.sin(car.a);
      if (vf < -4) yawT = this.yaw;
    }
    if (this.yaw === null) this.yaw = yawT;
    this.yaw += angDiff(this.yaw, yawT) * Math.min(1, dt * (car ? 3.2 : 5));
    const want = car ? 8.5 + sp * 0.1 : 5;
    let d = want;
    for (let s = 1.2; s <= want; s += 0.6) {
      if (w.isInsideBuilding(P.x - Math.cos(this.yaw) * s, P.y - Math.sin(this.yaw) * s)) { d = Math.max(1.2, s - 0.8); break; }
    }
    const tx = P.x - Math.cos(this.yaw) * d, tz = P.y - Math.sin(this.yaw) * d;
    const T = this.w.terrain, gp = T.at(P.x, P.y);
    this.gp = this.gp == null ? gp : this.gp + (gp - this.gp) * Math.min(1, dt * 10);
    let h = this.gp + (car ? 3.4 + sp * 0.025 : 2.5) + (want - d) * 0.45;
    h = Math.max(h, T.at(tx, tz) + 1.5);
    if (!this.camInit) { this.camPos.set(tx, h, tz); this.camInit = true; }
    const k = Math.min(1, dt * 8);
    this.camPos.x += (tx - this.camPos.x) * k; this.camPos.z += (tz - this.camPos.z) * k; this.camPos.y += (h - this.camPos.y) * k;
    this.camera.position.copy(this.camPos);
    const look = car ? 5 : 3;
    this.camera.lookAt(P.x + Math.cos(this.yaw) * look, this.gp + (car ? 1.2 : 1.4), P.y + Math.sin(this.yaw) * look);
    const fov = 62 + Math.min(14, sp * 0.3);
    if (Math.abs(this.camera.fov - fov) > 0.1) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  // Teselas de terreno alrededor del jugador: malla con relieve + textura del suelo (calles, parques…)
  updateTerrain(game) {
    const P = game.pos(), TL = SB.TILE, T = this.w.terrain;
    const R = this.mobile ? 3 : 4, cx = Math.floor(P.x / TL), cy = Math.floor(P.y / TL);
    let budget = 2;
    const want = [];
    for (let i = cx - R; i <= cx + R; i++) for (let j = cy - R; j <= cy + R; j++) {
      const d = Math.max(Math.abs(i - cx), Math.abs(j - cy));
      want.push([i, j, d]);
    }
    want.sort((a, b) => a[2] - b[2]);
    const keep = new Set();
    for (const [i, j, d] of want) {
      const k = i + ',' + j; keep.add(k);
      const lod = d <= 1 ? 2 : d <= 2 ? 1 : 0;
      let t = this.terrainTiles.get(k);
      if (t && t.lod === lod) continue;
      if (budget <= 0) continue;
      budget -= lod === 2 ? 2 : 1;
      const ts = [1.2, 2.5, 5][lod];
      const tex = new THREE.CanvasTexture(this.w.renderTile(i, j, ts, true));
      tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      if (!t) {
        // malla de 17x17 vértices (cada 8 m) siguiendo la altura
        const N = 17, pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), idx = [];
        for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
          const x = i * TL + a * TL / (N - 1), z = j * TL + b * TL / (N - 1), o = b * N + a;
          pos[o * 3] = x; pos[o * 3 + 1] = T.at(x, z); pos[o * 3 + 2] = z;
          uv[o * 2] = a / (N - 1); uv[o * 2 + 1] = 1 - b / (N - 1);
          if (a < N - 1 && b < N - 1) idx.push(o, o + N, o + 1, o + 1, o + N, o + N + 1);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
        mesh.matrixAutoUpdate = false;
        this.scene.add(mesh);
        t = { mesh, lod };
        this.terrainTiles.set(k, t);
      } else {
        t.mesh.material.map.dispose();
        t.mesh.material.map = tex; t.mesh.material.needsUpdate = true;
        t.lod = lod;
      }
    }
    for (const [k, t] of this.terrainTiles) {
      if (keep.has(k)) continue;
      this.scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.map.dispose(); t.mesh.material.dispose();
      this.terrainTiles.delete(k);
    }
  }

  render(game, dt) {
    this.dt = dt;
    this.updateTerrain(game);
    this.updateCity(game);
    this.syncEntities(game);
    this.updateCamera(game, dt);
    this.renderer.render(this.scene, this.camera);
  }
}

SB.Renderer3D = Renderer3D;
SB.isMobile = function () {
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
};
SB.webglAvailable = function () {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); }
  catch (e) { return false; }
};
})();
