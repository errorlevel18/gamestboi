// Modelos 3D procedurales: coches con silueta real (perfil extruido), ruedas que giran y
// personas articuladas (caderas, rodillas, hombros, codos) con animación de caminar y correr.
'use strict';
(function () {
const SB = window.SB;

// Perfiles laterales: x en fracción del largo (+ = morro), y en metros.
// ws/rw = índices del perfil donde van el parabrisas y la luna trasera; win = ventanillas laterales.
const PROFILES = {
  hatch: {
    body: [[-0.5, 0.3], [0.5, 0.3], [0.5, 0.58], [0.46, 0.76], [0.2, 0.84], [0.04, 1.36], [-0.36, 1.39], [-0.5, 1.02]],
    ws: [4, 5], rw: [6, 7],
    win: [[0.19, 0.88], [0.05, 1.3], [-0.35, 1.33], [-0.47, 1.0], [-0.47, 0.9]],
  },
  sedan: {
    body: [[-0.5, 0.3], [0.5, 0.3], [0.5, 0.6], [0.46, 0.77], [0.18, 0.84], [0.01, 1.38], [-0.25, 1.4], [-0.39, 0.92], [-0.5, 0.88]],
    ws: [4, 5], rw: [6, 7],
    win: [[0.17, 0.89], [0.02, 1.32], [-0.24, 1.34], [-0.36, 0.93]],
  },
  van: {
    body: [[-0.5, 0.32], [0.5, 0.32], [0.5, 0.72], [0.45, 1.02], [0.3, 1.95], [-0.5, 1.98]],
    ws: [3, 4], rw: null,
    win: [[0.29, 1.08], [0.28, 1.85], [0.12, 1.87], [0.12, 1.08]],
  },
  sport: {
    body: [[-0.5, 0.26], [0.5, 0.26], [0.5, 0.5], [0.44, 0.62], [0.12, 0.74], [-0.06, 1.13], [-0.27, 1.14], [-0.5, 0.78]],
    ws: [4, 5], rw: [6, 7],
    win: [[0.11, 0.78], [-0.05, 1.08], [-0.26, 1.09], [-0.43, 0.82]],
  },
};

class Models {
  constructor(THREE) {
    this.T = THREE;
    this.geo = new Map();
    this.mat = new Map();
    const T = THREE;
    this.box = new T.BoxGeometry(1, 1, 1);
    this.tire = new T.CylinderGeometry(1, 1, 1, 16); this.tire.rotateX(Math.PI / 2);
    this.hub = new T.CylinderGeometry(1, 1, 1, 8); this.hub.rotateX(Math.PI / 2);
    // piezas del cuerpo humano
    this.limb = new T.CapsuleGeometry(1, 1, 3, 8);
    this.head = new T.SphereGeometry(0.115, 12, 10);
    this.hairShort = new T.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.skirt = new T.CylinderGeometry(0.16, 0.27, 0.42, 12);
    this.carCache = new Map();
    this.vcPhong = new T.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x444444, side: T.DoubleSide });
    this.vcLambert = new T.MeshLambertMaterial({ vertexColors: true });
  }

  // Fusiona las mallas hijas directas de cada grupo en una sola malla con colores por vértice.
  // Así un coche pasa de ~30 mallas a ~7 y una persona de ~20 a ~11 (menos llamadas de dibujo).
  collapse(root, keep, shiny) {
    const T = this.T, groups = [];
    root.traverse((o) => { if (o.children.some(c => c.isMesh && !keep(c))) groups.push(o); });
    const tmp = new T.Color();
    for (const grp of groups) {
      const meshes = grp.children.filter(c => c.isMesh && !keep(c));
      let n = 0;
      const geos = meshes.map((m) => {
        m.updateMatrix();
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
        g.applyMatrix4(m.matrix);
        n += g.attributes.position.count;
        return g;
      });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
      let o = 0;
      geos.forEach((g, i) => {
        const mt = meshes[i].material;
        tmp.copy(mt.color);
        if (mt.emissive) { tmp.r = Math.min(1, tmp.r + mt.emissive.r * 0.6); tmp.g = Math.min(1, tmp.g + mt.emissive.g * 0.6); tmp.b = Math.min(1, tmp.b + mt.emissive.b * 0.6); }
        const c = g.attributes.position.count;
        pos.set(g.attributes.position.array, o * 3);
        if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
        for (let k = 0; k < c; k++) { col[(o + k) * 3] = tmp.r; col[(o + k) * 3 + 1] = tmp.g; col[(o + k) * 3 + 2] = tmp.b; }
        o += c;
        g.dispose();
      });
      const merged = new T.BufferGeometry();
      merged.setAttribute('position', new T.BufferAttribute(pos, 3));
      merged.setAttribute('normal', new T.BufferAttribute(nor, 3));
      merged.setAttribute('color', new T.BufferAttribute(col, 3));
      merged.computeBoundingSphere();
      for (const m of meshes) grp.remove(m);
      const mesh = new T.Mesh(merged, shiny && grp === root ? this.vcPhong : this.vcLambert);
      if (grp === root) mesh.name = 'body';
      grp.add(mesh);
    }
  }

  m(color, opts) {
    const k = color + JSON.stringify(opts || {});
    let m = this.mat.get(k);
    if (!m) {
      const T = this.T;
      m = opts && opts.phong ? new T.MeshPhongMaterial({ color, shininess: opts.shininess || 70, specular: 0x555555, emissive: opts.emissive || 0x000000 })
        : new T.MeshLambertMaterial({ color, emissive: (opts && opts.emissive) || 0x000000, side: opts && opts.double ? T.DoubleSide : T.FrontSide });
      this.mat.set(k, m);
    }
    return m;
  }
  add(parent, geo, mat, sx, sy, sz, x, y, z) {
    const mesh = new this.T.Mesh(geo, mat);
    mesh.scale.set(sx, sy, sz); mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // Extrusión de un perfil lateral a lo ancho del coche
  profileGeo(pts, L, depth, key) {
    const k = key + '|' + L + '|' + depth;
    let g = this.geo.get(k);
    if (g) return g;
    const T = this.T, sh = new T.Shape();
    pts.forEach(([x, y], i) => (i ? sh.lineTo(x * L, y) : sh.moveTo(x * L, y)));
    sh.closePath();
    const bev = 0.06;
    g = new T.ExtrudeGeometry(sh, { depth: depth - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -(depth - bev * 2) / 2);
    g.computeVertexNormals();
    this.geo.set(k, g);
    return g;
  }

  // Cristal inclinado (parabrisas / luna trasera) sobre el tramo a-b del perfil, un poco hacia fuera
  glassQuad(parent, a, b, L, W, mat) {
    const T = this.T;
    const ax = a[0] * L, ay = a[1], bx = b[0] * L, by = b[1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let nx = dy / len, ny = -dx / len;
    if (ny < 0) { nx = -nx; ny = -ny; }
    const o = 0.07, s = 0.06, z = W * 0.42;
    const A = [ax + dx * s + nx * o, ay + dy * s + ny * o], B = [bx - dx * s + nx * o, by - dy * s + ny * o];
    const pos = [A[0], A[1], -z, B[0], B[1], -z, B[0], B[1], z, A[0], A[1], -z, B[0], B[1], z, A[0], A[1], z];
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, this.glassDouble || (this.glassDouble = new T.MeshPhongMaterial({ color: '#1e2a36', shininess: 120, specular: 0x666666, side: T.DoubleSide })));
    parent.add(mesh);
    return mesh;
  }

  // Coche listo para usar: se construye una vez por modelo+color, se fusiona y luego se clona
  car(model, color) {
    const key = model.name + '|' + color;
    let tpl = this.carCache.get(key);
    if (!tpl) {
      tpl = this.buildCar(model, color);
      this.collapse(tpl, (m) => m.name === 'red' || m.name === 'blue' || m.name === 'shadow', true);
      // clone() copia userData con JSON: lo vaciamos para no serializar mallas en cada coche nuevo
      tpl.traverse((o) => { o.userData = o.name === 'wheelF' || o.name === 'wheelB' ? { r: o.userData.r } : {}; });
      this.carCache.set(key, tpl);
    }
    const g = tpl.clone();
    const parts = { body: [], wheels: [] };
    g.traverse((o) => {
      if (o.name === 'wheelF' || o.name === 'wheelB') parts.wheels.push({ pivot: o, wheel: o.children[0], front: o.name === 'wheelF', r: o.userData.r });
      else if (o.name === 'body') parts.body.push(o);
      else if (o.name === 'red') parts.red = o; else if (o.name === 'blue') parts.blue = o;
      else if (o.name === 'rider') parts.rider = o;
    });
    for (const w of parts.wheels) w.wheel = w.pivot.children.find(c => c.name === 'wheel') || w.pivot.children[0];
    g.userData = parts;
    return g;
  }

  buildCar(model, color) {
    const T = this.T, g = new T.Group(), L = model.l, W = model.w;
    const parts = { body: [], wheels: [], spin: 0 };
    const shadow = new T.Mesh(new T.PlaneGeometry(L + 0.5, W + 0.5), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.05; shadow.name = 'shadow'; g.add(shadow);

    if (model.bike) return this.bike(model, color, g, parts);
    if (model.bus) return this.bus(model, color, g, parts);

    const type = model.van ? 'van' : model.sport ? 'sport' : model.name === 'Compacto' ? 'hatch' : 'sedan';
    const P = PROFILES[type];
    const paint = this.m(color, { phong: true });
    const glass = this.m('#1e2a36', { phong: true, shininess: 120 });
    const dark = this.m('#1b1b1d');
    const body = new T.Mesh(this.profileGeo(P.body, L, W, type), paint);
    g.add(body); parts.body.push(body);
    // ventanillas laterales (un poco más anchas que la carrocería)
    const win = new T.Mesh(this.profileGeo(P.win, L, W + 0.03, type + 'w'), glass);
    g.add(win);
    this.glassQuad(g, P.body[P.ws[0]], P.body[P.ws[1]], L, W, glass);
    if (P.rw) this.glassQuad(g, P.body[P.rw[0]], P.body[P.rw[1]], L, W, glass);
    // parachoques, faros, pilotos, matrículas, retrovisores
    this.add(g, this.box, dark, 0.14, 0.2, W + 0.02, L / 2, 0.42, 0);
    this.add(g, this.box, dark, 0.14, 0.2, W + 0.02, -L / 2, 0.42, 0);
    const head = this.m('#fff6d0', { emissive: 0x777055 }), tail = this.m('#c0111a', { emissive: 0x550000 });
    for (const s of [1, -1]) {
      this.add(g, this.box, head, 0.08, 0.13, 0.36, L / 2 + 0.01, 0.62, s * (W / 2 - 0.3));
      this.add(g, this.box, tail, 0.08, 0.14, 0.34, -L / 2 - 0.01, 0.72, s * (W / 2 - 0.28));
      this.add(g, this.box, paint, 0.12, 0.1, 0.16, L * 0.17, 0.95, s * (W / 2 + 0.07));
    }
    const plate = this.m('#f2f2f2');
    this.add(g, this.box, plate, 0.03, 0.12, 0.5, L / 2 + 0.08, 0.42, 0);
    this.add(g, this.box, plate, 0.03, 0.12, 0.5, -L / 2 - 0.08, 0.42, 0);
    // detalles por modelo
    if (model.taxi) {
      const y = this.m('#f5c518', { phong: true });
      for (const s of [1, -1]) this.add(g, this.box, y, L * 0.42, 0.5, 0.03, L * 0.02, 0.62, s * (W / 2 + 0.005));
      this.add(g, this.box, this.m('#39d353', { emissive: 0x1a7a2a }), 0.3, 0.14, 0.3, -L * 0.1, 1.46, 0);
    }
    if (model.police) {
      const blue = this.m('#1f4fbf', { phong: true }), red = this.m('#c0392b');
      for (const s of [1, -1]) {
        this.add(g, this.box, blue, L * 0.9, 0.2, 0.03, 0, 0.62, s * (W / 2 + 0.005));
        this.add(g, this.box, red, L * 0.9, 0.05, 0.035, 0, 0.75, s * (W / 2 + 0.005));
      }
      this.add(g, this.box, this.m('#222'), 0.3, 0.08, W * 0.8, -L * 0.1, 1.44, 0);
      parts.red = this.add(g, this.box, this.m('#7a1d1d'), 0.26, 0.14, W * 0.36, -L * 0.1, 1.53, W * 0.2);
      parts.blue = this.add(g, this.box, this.m('#1d2f7a'), 0.26, 0.14, W * 0.36, -L * 0.1, 1.53, -W * 0.2);
      parts.red.name = 'red'; parts.blue.name = 'blue';
    }
    if (model.sport) this.add(g, this.box, this.m('#111'), 0.06, 0.2, W * 0.9, -L / 2 + 0.05, 0.95, 0); // alerón
    // ruedas
    const r = model.van ? 0.36 : model.sport ? 0.33 : 0.32;
    const tire = this.m('#141414'), rim = this.m('#b9bcc0', { phong: true });
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const pivot = new T.Group(); pivot.position.set(sx * L * 0.32, r, sz * (W / 2 - 0.12));
      pivot.name = sx > 0 ? 'wheelF' : 'wheelB'; pivot.userData.r = r;
      const wheel = new T.Group(); wheel.name = 'wheel';
      this.add(wheel, this.tire, tire, r, r, 0.22, 0, 0, 0);
      this.add(wheel, this.hub, rim, r * 0.6, r * 0.6, 0.24, 0, 0, 0);
      this.add(wheel, this.box, tire, r * 1.1, 0.07, 0.25, 0, 0, 0); // radio: se ve girar
      pivot.add(wheel); g.add(pivot);
      parts.wheels.push({ pivot, wheel, front: sx > 0, r });
    }
    g.userData = parts;
    return g;
  }

  bike(model, color, g, parts) {
    const T = this.T, paint = this.m(color, { phong: true }), tire = this.m('#141414');
    const body = this.add(g, this.box, paint, model.l * 0.55, 0.35, 0.32, 0, 0.72, 0); parts.body.push(body);
    this.add(g, this.box, this.m('#222'), 0.5, 0.12, 0.3, -0.25, 0.95, 0);
    this.add(g, this.box, this.m('#999'), 0.08, 0.5, 0.06, model.l * 0.38, 0.9, 0);
    this.add(g, this.box, this.m('#999'), 0.06, 0.06, 0.6, model.l * 0.36, 1.12, 0);
    for (const sx of [1, -1]) {
      const pivot = new T.Group(); pivot.position.set(sx * model.l * 0.36, 0.32, 0);
      pivot.name = sx > 0 ? 'wheelF' : 'wheelB'; pivot.userData.r = 0.32;
      const wheel = new T.Group(); wheel.name = 'wheel'; this.add(wheel, this.tire, tire, 0.32, 0.32, 0.12, 0, 0, 0);
      this.add(wheel, this.box, this.m('#888'), 0.36, 0.05, 0.13, 0, 0, 0);
      pivot.add(wheel); g.add(pivot); parts.wheels.push({ pivot, wheel, front: sx > 0, r: 0.32 });
    }
    const rider = this.ped({ shirt: '#e67e22', pants: '#1b2631', hair: '#111', skin: '#d9a47a', player: true });
    rider.position.set(-0.2, 0.25, 0); rider.name = 'rider';
    this.pose(rider, 0, 0, 'sit');
    g.add(rider); parts.rider = rider;
    g.userData = parts;
    return g;
  }

  bus(model, color, g, parts) {
    const T = this.T, L = model.l, W = model.w, H = 3.0;
    const paint = this.m(color, { phong: true }), glass = this.m('#1e2a36', { phong: true, shininess: 120 }), white = this.m('#f2f2f2', { phong: true });
    const body = this.add(g, this.box, paint, L, H - 0.35, W, 0, 0.35 + (H - 0.35) / 2, 0); parts.body.push(body);
    this.add(g, this.box, white, L * 0.98, 0.25, W + 0.01, 0, H - 0.05, 0);
    this.add(g, this.box, glass, L * 0.86, 1.0, W + 0.03, -L * 0.03, 2.05, 0);
    this.add(g, this.box, glass, 0.05, 1.5, W * 0.9, L / 2 + 0.01, 1.8, 0);
    this.add(g, this.box, glass, 0.05, 0.9, W * 0.8, -L / 2 - 0.01, 2.1, 0);
    this.add(g, this.box, this.m('#111'), 0.04, 0.3, W * 0.7, L / 2 + 0.03, 2.75, 0); // letrero de línea
    const head = this.m('#fff6d0', { emissive: 0x777055 });
    for (const s of [1, -1]) this.add(g, this.box, head, 0.06, 0.18, 0.4, L / 2 + 0.01, 0.65, s * (W / 2 - 0.35));
    const tire = this.m('#141414'), rim = this.m('#b9bcc0');
    for (const sx of [0.32, -0.3]) for (const sz of [1, -1]) {
      const pivot = new T.Group(); pivot.position.set(sx * L, 0.5, sz * (W / 2 - 0.2));
      pivot.name = sx > 0 ? 'wheelF' : 'wheelB'; pivot.userData.r = 0.5;
      const wheel = new T.Group(); wheel.name = 'wheel'; this.add(wheel, this.tire, tire, 0.5, 0.5, 0.3, 0, 0, 0); this.add(wheel, this.hub, rim, 0.3, 0.3, 0.32, 0, 0, 0);
      this.add(wheel, this.box, tire, 0.55, 0.08, 0.33, 0, 0, 0);
      pivot.add(wheel); g.add(pivot); parts.wheels.push({ pivot, wheel, front: sx > 0, r: 0.5 });
    }
    g.userData = parts;
    return g;
  }

  // Vagón de tren (FGC: blanco con franja naranja)
  train(L, cab) {
    const T = this.T, g = new T.Group(), W = 2.9, H = 3.4;
    const white = this.m('#eef0f0', { phong: true }), orange = this.m('#ef7d00', { phong: true }), glass = this.m('#1e2a36', { phong: true, shininess: 120 });
    const grey = this.m('#8d9296'), dark = this.m('#222');
    this.add(g, this.box, white, L, H - 0.6, W, 0, 0.6 + (H - 0.6) / 2, 0);
    this.add(g, this.box, glass, L * 0.94, 0.9, W + 0.02, 0, 2.3, 0);
    this.add(g, this.box, orange, L * 1.001, 0.35, W + 0.03, 0, 1.2, 0);
    this.add(g, this.box, grey, L * 0.98, 0.25, W * 0.9, 0, H + 0.1, 0);
    for (const s of [0.35, -0.35]) this.add(g, this.box, dark, 2.6, 0.6, W * 0.8, s * L, 0.3, 0);
    for (const s of [-0.25, 0.25]) for (const z of [1, -1]) this.add(g, this.box, this.m('#9aa0a4'), 1.3, 2.1, 0.03, s * L, 1.65, z * (W / 2 + 0.02));
    if (cab) { this.add(g, this.box, glass, 0.05, 1.1, W * 0.85, L / 2 + 0.01, 2.2, 0); this.add(g, this.box, glass, 0.05, 1.1, W * 0.85, -L / 2 - 0.01, 2.2, 0); }
    this.collapse(g, () => false, true);
    return g;
  }

  // Anima ruedas: giro según la velocidad y dirección de las delanteras
  animateCar(g, car, dt, steer) {
    const u = g.userData;
    const vf = car.vx * Math.cos(car.a) + car.vy * Math.sin(car.a);
    for (const w of u.wheels) {
      w.wheel.rotation.z -= vf * dt / w.r;
      if (w.front) w.pivot.rotation.y += ((steer || 0) * -0.45 - w.pivot.rotation.y) * Math.min(1, dt * 10);
    }
  }

  // ---------- personas ----------
  ped(o) {
    const T = this.T, g = new T.Group();
    const skin = this.m(o.skin || '#e0ac80'), shirt = this.m(o.shirt), pants = this.m(o.pants), shoe = this.m(o.shoes || '#222'), hair = this.m(o.hair || '#2c1e14');
    const sk = o.woman ? 0.94 : 1, wd = o.woman ? 0.88 : 1;
    const hips = new T.Group(); hips.position.y = 0.95 * sk; g.add(hips);
    const torso = new T.Group(); hips.add(torso);
    // torso y pelvis
    this.add(hips, this.limb, pants, 0.13 * wd, 0.075, 0.17 * wd, 0, 0.0, 0);
    this.add(torso, this.limb, shirt, 0.13 * wd, 0.2 * sk, 0.22 * wd, 0, 0.3 * sk, 0);
    this.add(torso, this.limb, skin, 0.05, 0.045, 0.05, 0, 0.62 * sk, 0); // cuello
    const headG = new T.Group(); headG.position.y = 0.73 * sk; torso.add(headG);
    this.add(headG, this.head, skin, 1, 1.08, 0.95, 0, 0, 0);
    if (o.hairStyle !== 'bald') this.add(headG, this.hairShort, hair, 1, 1, 1, -0.01, 0.015, 0);
    if (o.hairStyle === 'long') this.add(headG, this.box, hair, 0.08, 0.3, 0.22, -0.1, -0.1, 0);
    if (o.cap) this.add(headG, this.box, this.m(o.cap), 0.26, 0.05, 0.24, 0.04, 0.1, 0);
    // piernas: muslo (cadera) y pierna (rodilla)
    const legs = [];
    for (const s of [1, -1]) {
      const hip = new T.Group(); hip.position.set(0, -0.02, s * 0.09 * wd); hips.add(hip);
      this.add(hip, this.limb, o.skirt ? skin : pants, 0.075, 0.155 * sk, 0.075, 0, -0.22 * sk, 0);
      const knee = new T.Group(); knee.position.y = -0.44 * sk; hip.add(knee);
      this.add(knee, this.limb, o.skirt ? skin : pants, 0.06, 0.15 * sk, 0.06, 0, -0.22 * sk, 0);
      this.add(knee, this.box, shoe, 0.24, 0.08, 0.11, 0.05, -0.46 * sk, 0);
      legs.push({ hip, knee });
    }
    if (o.skirt) this.add(hips, this.skirt, pants, wd, sk, wd, 0, -0.15, 0);
    // brazos: hombro y codo
    const arms = [];
    for (const s of [1, -1]) {
      const sh = new T.Group(); sh.position.set(0, 0.53 * sk, s * 0.24 * wd); torso.add(sh);
      this.add(sh, this.limb, shirt, 0.055, 0.1 * sk, 0.055, 0, -0.14 * sk, 0);
      const el = new T.Group(); el.position.y = -0.29 * sk; sh.add(el);
      this.add(el, this.limb, o.longSleeve ? shirt : skin, 0.045, 0.09 * sk, 0.045, 0, -0.13 * sk, 0);
      this.add(el, this.box, skin, 0.08, 0.1, 0.05, 0, -0.3 * sk, 0);
      arms.push({ sh, el });
    }
    if (o.player) this.add(arms[1].el, this.box, this.m('#2b2b2b'), 0.25, 0.07, 0.05, 0.08, -0.33, 0); // pistola
    g.userData = { hips, torso, legs, arms, sk };
    this.collapse(g, () => false, false);
    return g;
  }

  // phase: fase del paso; amp: 0 quieto, 0.5 andar, 1 correr
  pose(g, phase, amp, mode) {
    const u = g.userData, s = Math.sin(phase), c = Math.cos(phase);
    if (mode === 'sit') {
      for (const l of u.legs) { l.hip.rotation.z = 1.4; l.knee.rotation.z = -1.3; }
      for (const a of u.arms) { a.sh.rotation.z = 1.0; a.el.rotation.z = 0.3; }
      return;
    }
    const A = amp;
    u.legs[0].hip.rotation.z = s * 0.7 * A; u.legs[1].hip.rotation.z = -s * 0.7 * A;
    u.legs[0].knee.rotation.z = -Math.max(0, -c) * 1.2 * A - 0.05; u.legs[1].knee.rotation.z = -Math.max(0, c) * 1.2 * A - 0.05;
    u.arms[0].sh.rotation.z = -s * 0.6 * A; u.arms[1].sh.rotation.z = s * 0.6 * A;
    u.arms[0].el.rotation.z = u.arms[1].el.rotation.z = 0.15 + 0.9 * A * A;
    u.torso.rotation.z = -0.18 * A * A;
    u.hips.position.y = 0.95 * u.sk + Math.abs(c) * 0.05 * A;
    if (mode === 'aim') { u.arms[1].sh.rotation.z = 1.5; u.arms[1].el.rotation.z = 0; }
  }
}

SB.Models = Models;
})();
