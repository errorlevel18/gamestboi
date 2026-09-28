// Lógica del juego: jugador, coches, peatones, policía, misiones y render
'use strict';
(function () {
const SB = window.SB;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const MODELS = [
  { name: 'Compacto', max: 36, acc: 9, turn: 2.6, l: 4.0, w: 1.8, weight: 34, colors: ['#c0392b', '#2e86c1', '#f1c40f', '#ecf0f1', '#27ae60', '#7f8c8d', '#8e44ad', '#d35400'] },
  { name: 'Berlina', max: 41, acc: 10, turn: 2.4, l: 4.6, w: 1.9, weight: 25, colors: ['#1c2833', '#566573', '#d0d3d4', '#922b21', '#1f618d', '#154360'] },
  { name: 'Furgoneta', max: 31, acc: 7, turn: 2.1, l: 5.2, w: 2.1, weight: 14, van: true, colors: ['#f4f6f6', '#d4ac0d', '#5d6d7e', '#a04000'] },
  { name: 'Taxi', max: 38, acc: 9.5, turn: 2.5, l: 4.6, w: 1.9, weight: 15, taxi: true, colors: ['#15161a'] },
  { name: 'Deportivo', max: 54, acc: 16, turn: 2.9, l: 4.4, w: 1.95, weight: 8, sport: true, colors: ['#e74c3c', '#f39c12', '#16a085', '#2c3e50', '#f1c40f'] },
  { name: 'Moto', max: 46, acc: 14, turn: 3.2, l: 2.2, w: 0.8, weight: 6, bike: true, colors: ['#c0392b', '#111', '#2471a3'] },
];
const POLICE = { name: 'Policía', max: 50, acc: 13, turn: 2.8, l: 4.7, w: 1.95, police: true, colors: ['#f4f6f7'] };
const SHIRTS = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#f39c12', '#16a085', '#ecf0f1', '#34495e', '#e67e22', '#d35400', '#7f8c8d', '#f5b7b1'];
const HAIR = ['#2c1e14', '#4a3222', '#0f0f0f', '#8a6b3d', '#c9b37e', '#9a9a9a', '#6b2d16'];
const STAR_HEAT = [0, 20, 60, 130, 220, 320];

const MISSION_FLAVOR = [
  { t: 'Carxofes urgents', d: 'Lleva las alcachofas del Baix Llobregat a {dest}' },
  { t: 'Pizza calentita', d: 'Entrega la pizza en {dest} antes de que se enfríe' },
  { t: 'Paquete misterioso', d: 'No preguntes qué hay dentro. Llévalo a {dest}' },
  { t: 'El primo de Marianao', d: 'Tu primo necesita el paquete en {dest}. Ya.' },
  { t: 'Coca de Sant Joan', d: 'Lleva la coca a {dest} para la verbena' },
  { t: 'Recado de la yaya', d: 'La yaya quiere sus pastillas en {dest}' },
];

let uid = 1;

class Game {
  constructor(world, canvas, hud) {
    this.w = world; this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hud = hud;
    this.keys = {}; this.pressed = {}; this.touch = { jx: 0, jy: 0, active: false };
    this.cars = []; this.peds = []; this.bullets = []; this.parts = []; this.decals = []; this.skids = [];
    this.money = 500; this.heat = 0; this.stars = 0; this.unseen = 0; this.bustT = 0;
    this.time = 0; this.paused = false; this.dead = null; this.showMap = false;
    this.mission = null; this.starts = []; this.msgs = [];
    this.cam = { x: 0, y: 0, z: 6 };
    this.nameT = 0; this.fieldT = 0; this.seenT = 0; this.crimeCd = 0;
    this.audio = new SB.Sfx();
    const spawn = this.findSpawn();
    this.home = spawn;
    this.player = { x: spawn.x, y: spawn.y, a: 0, hp: 100, car: null, walk: 0, shootCd: 0 };
    this.cam.x = spawn.x; this.cam.y = spawn.y;
    this.hospital = this.poiOf('hospital') || spawn;
    this.comisaria = this.poiOf('police') || spawn;
    this.w.buildMinimap();
    this.resize();
    // coche aparcado al lado para empezar
    this.spawnParked(spawn.x, spawn.y, 0, 40, true);
    for (let i = 0; i < 6; i++) this.spawnParked(spawn.x, spawn.y, 15, 180);
    for (let i = 0; i < 18; i++) this.spawnTraffic(40, 240);
    for (let i = 0; i < 35; i++) this.spawnPed(15, 140);
    this.refreshStarts();
    this.msg('Bienvenido a Sant Boi de Llobregat', 4);
    this.msg('Acércate a un coche y pulsa E para robarlo', 5);
  }

  poiOf(kind) {
    const p = this.w.map.pois.find(q => q.kind === kind);
    if (!p) return null;
    const n = this.w.nearestNode(p.x, p.y, true, 6);
    return n >= 0 ? { x: this.w.nx[n], y: this.w.ny[n] } : null;
  }

  findSpawn() {
    const w = this.w;
    const town = w.map.pois.find(p => p.kind === 'townhall');
    const cx = town ? town.x : 0, cy = town ? town.y : 0;
    const n = w.nearestNode(cx, cy, false, 20);
    if (n >= 0) return { x: w.nx[n], y: w.ny[n] };
    if (w.pedNodes.length) { const m = w.pedNodes[0]; return { x: w.nx[m], y: w.ny[m] }; }
    return { x: 0, y: 0 };
  }

  resize() {
    if (this.r3d) this.r3d.resize();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.dpr = dpr;
    this.canvas.width = Math.floor(innerWidth * dpr); this.canvas.height = Math.floor(innerHeight * dpr);
    this.W = this.canvas.width; this.H = this.canvas.height;
  }

  setView(v3d) {
    if (v3d && !this.r3d && this.init3d) this.init3d();
    if (v3d && !this.r3d) { this.msg('Vista 3D no disponible en este dispositivo' + (this.r3dError ? ': ' + this.r3dError : ''), 5); }
    this.view3d = v3d && !!this.r3d;
    if (this.r3d) this.r3d.renderer.domElement.style.display = this.view3d ? 'block' : 'none';
    try { localStorage.setItem('santboi-view', this.view3d ? '3d' : '2d'); } catch (e) { /* nada */ }
  }

  msg(text, dur = 3, big = false) { this.msgs.push({ text, t: dur, big }); }

  // ---------- utilidades de spawn ----------
  nodeNear(x, y, minD, maxD, ped) {
    const w = this.w, grid = ped ? w.pedGrid : w.carGrid;
    for (let tries = 0; tries < 40; tries++) {
      const a = Math.random() * TAU, r = rand(minD, maxD);
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      const l = grid.get(Math.floor(px / 32) * 100003 + Math.floor(py / 32));
      if (!l) continue;
      const n = pick(l), d = Math.hypot(w.nx[n] - x, w.ny[n] - y);
      if (d >= minD && d <= maxD) return n;
    }
    return -1;
  }
  laneOffset(r) { return r.oneway ? 0 : Math.min(r.w / 4, 2.2); }
  freeSpot(x, y, r) {
    for (const c of this.cars) if ((c.x - x) ** 2 + (c.y - y) ** 2 < r * r) return false;
    return !this.w.isInsideBuilding(x, y);
  }
  pickModel() {
    let t = Math.random() * MODELS.reduce((s, m) => s + m.weight, 0);
    for (const m of MODELS) { t -= m.weight; if (t <= 0) return m; }
    return MODELS[0];
  }
  makeCar(model, x, y, a) {
    return { id: uid++, x, y, a, vx: 0, vy: 0, av: 0, m: model, color: pick(model.colors), hp: 100,
      driver: null, ai: null, fire: 0, dead: false, stuck: 0, rev: 0, hitCd: 0 };
  }
  spawnTraffic(minD, maxD, police = false) {
    const w = this.w, P = this.pos();
    const n = this.nodeNear(P.x, P.y, minD, maxD, false);
    if (n < 0) return null;
    const e = pick(w.carAdj[n]);
    const dx = w.nx[e.to] - w.nx[n], dy = w.ny[e.to] - w.ny[n], L = Math.hypot(dx, dy) || 1;
    const off = police ? 0 : this.laneOffset(e.r);
    const x = w.nx[n] + dx / L * 2 - dy / L * off, y = w.ny[n] + dy / L * 2 + dx / L * off;
    if (!this.freeSpot(x, y, 9)) return null;
    const c = this.makeCar(police ? POLICE : this.pickModel(), x, y, Math.atan2(dy, dx));
    c.driver = police ? 'cop' : 'ai';
    c.ai = { from: n, to: e.to, road: e.r, next: null, speed: police ? 28 : rand(9, 13.5) };
    const sp = police ? 15 : 7; c.vx = Math.cos(c.a) * sp; c.vy = Math.sin(c.a) * sp;
    this.cars.push(c);
    return c;
  }
  spawnParked(x, y, minD, maxD, force) {
    const w = this.w;
    for (let t = 0; t < (force ? 10 : 1); t++) {
      const n = this.nodeNear(x, y, minD, maxD + t * 20, false);
      if (n < 0) continue;
      const e = pick(w.carAdj[n]);
      const dx = w.nx[e.to] - w.nx[n], dy = w.ny[e.to] - w.ny[n], L = Math.hypot(dx, dy);
      if (L < 14) continue;
      const off = e.r.w / 2 - 1.1, k = rand(6, L - 6);
      const px = w.nx[n] + dx / L * k - dy / L * off, py = w.ny[n] + dy / L * k + dx / L * off;
      if (!this.freeSpot(px, py, 6)) continue;
      const c = this.makeCar(force ? MODELS[0] : this.pickModel(), px, py, Math.atan2(dy, dx));
      c.parked = true;
      this.cars.push(c);
      return c;
    }
    return null;
  }
  spawnPed(minD, maxD) {
    const w = this.w, P = this.pos();
    const n = this.nodeNear(P.x, P.y, minD, maxD, true);
    if (n < 0) return;
    const e = pick(w.pedAdj[n]);
    const p = { id: uid++, x: w.nx[n], y: w.ny[n], a: 0, from: n, to: e.to, road: e.r, side: Math.random() < 0.5 ? -1 : 1,
      speed: rand(1.1, 1.6), shirt: pick(SHIRTS), hair: pick(HAIR), pants: pick(['#2c3e50', '#1b2631', '#5d4037', '#34495e', '#7b7d7d']),
      state: 'walk', t: 0, walk: Math.random() * 10 };
    const o = this.pedOffset(p);
    p.x += o.x; p.y += o.y;
    if (w.isInsideBuilding(p.x, p.y)) { p.x = w.nx[n]; p.y = w.ny[n]; }
    this.peds.push(p);
  }
  pedOffset(p) {
    const w = this.w, r = p.road;
    if (!r || !r.car) return { x: 0, y: 0 };
    const a = Math.min(p.from, p.to), b = Math.max(p.from, p.to);
    const dx = w.nx[b] - w.nx[a], dy = w.ny[b] - w.ny[a], L = Math.hypot(dx, dy) || 1;
    const off = (r.w / 2 + 1.2) * p.side;
    return { x: -dy / L * off, y: dx / L * off };
  }

  pos() { return this.player.car || this.player; }

  refreshStarts() {
    const P = this.pos();
    while (this.starts.length < 3) {
      const n = this.nodeNear(P.x, P.y, 120, 650, true);
      if (n < 0) break;
      this.starts.push({ x: this.w.nx[n], y: this.w.ny[n] });
    }
  }

  placeLabel(x, y) {
    let best = null, bd = 70 * 70;
    for (const p of this.w.map.pois) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
    if (best) return best.name;
    return this.w.streetNameAt(x, y) || 'el punto marcado';
  }
  pickDest(x, y, minD, maxD) {
    const w = this.w;
    for (let i = 0; i < 60; i++) {
      const n = this.nodeNear(x, y, minD, maxD, false);
      if (n < 0) continue;
      if (i < 40 && !w.nodeRoad[n].name) continue;
      return { x: w.nx[n], y: w.ny[n], label: this.placeLabel(w.nx[n], w.ny[n]) };
    }
    return null;
  }

  startMission(st) {
    const type = pick(['entrega', 'entrega', 'robo', 'carrera']);
    if (type === 'entrega') {
      const f = pick(MISSION_FLAVOR);
      const d = this.pickDest(st.x, st.y, 500, 1400);
      if (!d) return;
      const dd = Math.hypot(d.x - st.x, d.y - st.y);
      this.mission = { title: f.t, steps: [{ ...d, text: f.d.replace('{dest}', d.label) }], timer: Math.round(dd / 8 + 35),
        reward: Math.round(dd * 0.6 / 10) * 10 + 150 };
    } else if (type === 'robo') {
      const cst = this.pickDest(st.x, st.y, 250, 700);
      const g = cst && this.pickDest(cst.x, cst.y, 500, 1200);
      if (!g) return;
      const n = this.w.nearestNode(cst.x, cst.y, false);
      const car = this.makeCar(MODELS[4], this.w.nx[n], this.w.ny[n], Math.random() * TAU);
      car.color = '#f1c40f'; car.mission = true; car.parked = true;
      this.cars.push(car);
      this.mission = { title: 'Encargo del desguace', car, timer: null, reward: 900,
        steps: [
          { x: car.x, y: car.y, text: `Roba el deportivo amarillo aparcado en ${cst.label}`, car },
          { ...g, text: `Lleva el deportivo al taller de ${g.label} sin romperlo`, needCar: car, alarm: true },
        ] };
    } else {
      const steps = []; let x = st.x, y = st.y, total = 0;
      for (let i = 0; i < 5; i++) {
        const d = this.pickDest(x, y, 250, 500);
        if (!d) break;
        total += Math.hypot(d.x - x, d.y - y);
        steps.push({ ...d, text: `Carrera ilegal: checkpoint ${i + 1}/5 — ${d.label}`, needAnyCar: true });
        x = d.x; y = d.y;
      }
      if (steps.length < 3) return;
      this.mission = { title: 'Carrera por Sant Boi', steps, timer: Math.round(total / 13 + 20), reward: Math.round(total / 10) * 10 };
    }
    this.mission.step = 0;
    this.msg(this.mission.title, 3, true);
    this.audio.play('mission');
  }
  endMission(ok, why) {
    const m = this.mission; if (!m) return;
    if (ok) { this.money += m.reward; this.msg(`¡Misión completada! +$${m.reward}`, 4, true); this.audio.play('cash'); }
    else this.msg(`Misión fallida${why ? ': ' + why : ''}`, 4, true);
    if (m.car && m.car !== this.player.car) m.car.mission = false;
    this.mission = null;
    this.refreshStarts();
  }

  // ---------- crímenes y policía ----------
  crime(amount, x, y) {
    let witness = false;
    for (const c of this.cars) if (c.m.police && !c.dead && Math.hypot(c.x - x, c.y - y) < 80) witness = true;
    const prev = this.stars;
    this.heat = Math.min(400, this.heat + amount * (witness ? 1.5 : 1));
    this.updateStars();
    this.unseen = 0;
    if (this.stars > prev) this.audio.play('star');
  }
  updateStars() {
    let s = 0; for (let i = 1; i < STAR_HEAT.length; i++) if (this.heat >= STAR_HEAT[i]) s = i;
    this.stars = s;
  }

  // ---------- bucle ----------
  update(dt) {
    this.time += dt;
    for (const m of this.msgs) m.t -= dt;
    if (this.msgs.length && this.msgs[0].t <= 0) this.msgs.shift();
    this.lastDt = dt;
    if (this.pressed.KeyM) this.showMap = !this.showMap;
    if (this.pressed.KeyC || this.pressed.KeyV) this.setView(!this.view3d);
    if (this.pressed.KeyP || this.pressed.Escape) this.paused = !this.paused;
    if (this.paused) { this.pressed = {}; return; }

    if (this.dead) {
      this.dead.t -= dt;
      if (this.dead.t <= 0) this.respawn();
    } else this.updatePlayer(dt);

    for (const c of this.cars) {
      let inp = { thr: 0, steer: 0, hb: false };
      if (c.dead) inp.hb = true;
      else if (c.driver === 'player') inp = this.playerInput;
      else if (c.driver === 'ai') inp = this.aiDrive(c, dt);
      else if (c.driver === 'cop') inp = this.copDrive(c, dt);
      else inp.hb = !c.dead && Math.hypot(c.vx, c.vy) < 3;
      this.stepCar(c, inp, dt);
      this.carDamage(c, dt);
    }
    this.carCarCollisions();
    this.updatePeds(dt);
    this.updateBullets(dt);
    this.updatePolice(dt);
    this.updateMission(dt);
    this.population();
    this.updateParticles(dt);
    this.updateCamera(dt);
    this.audio.engine(this.player.car && !this.dead ? Math.hypot(this.player.car.vx, this.player.car.vy) / this.player.car.m.max : -1,
      this.stars > 0 && this.cars.some(c => c.m.police && !c.dead && dist(c, this.pos()) < 120));
    this.pressed = {};
  }

  get playerInputRaw() {
    const K = this.keys, T = this.touch;
    let x = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    let y = (K.KeyS || K.ArrowDown ? 1 : 0) - (K.KeyW || K.ArrowUp ? 1 : 0);
    if (T.active) { x = T.jx; y = T.jy; }
    return { x, y, fire: K.Space || K.KeyK || T.fire, run: K.ShiftLeft || K.ShiftRight || (T.active && Math.hypot(T.jx, T.jy) > 0.9) };
  }

  updatePlayer(dt) {
    const p = this.player, inp = this.playerInputRaw;
    p.shootCd -= dt;
    if (this.pressed.KeyE || this.pressed.KeyF || this.pressed.Enter) {
      if (p.car) this.exitCar(); else this.enterCar();
    }
    if (this.pressed.KeyH && p.car) this.audio.play('horn');
    if (p.car) {
      const c = p.car;
      this.playerInput = { thr: -inp.y, steer: inp.x, hb: !!inp.fire };
      p.x = c.x; p.y = c.y; p.a = c.a;
      if (c.dead) { this.exitCar(); }
      return;
    }
    this.playerInput = null;
    let mx = inp.x, my = inp.y;
    if (this.view3d) {
      // en 3D: izquierda/derecha giran, arriba/abajo avanzan (relativo a la cámara)
      p.a += inp.x * 3 * dt;
      const f = -inp.y;
      mx = Math.cos(p.a) * f; my = Math.sin(p.a) * f;
      if (Math.abs(f) > 0.1) {
        const sp = (inp.run ? 6.5 : 3.4) * (f < 0 ? 0.6 : 1);
        p.x += mx * sp * dt; p.y += my * sp * dt;
        p.walk += dt * sp * 2.2;
      }
      mx = my = 0;
    }
    const L = Math.hypot(mx, my);
    if (L > 0.1) {
      mx /= Math.max(1, L); my /= Math.max(1, L);
      const sp = inp.run ? 6.5 : 3.4;
      p.x += mx * sp * dt; p.y += my * sp * dt;
      p.a = Math.atan2(my, mx);
      p.walk += dt * sp * 2.2;
    }
    const r = this.w.collide(p.x, p.y, 0.45); p.x = r.x; p.y = r.y;
    this.clampBounds(p);
    if (inp.fire && p.shootCd <= 0) this.shoot();
  }

  clampBounds(o) {
    const b = this.w.bounds;
    o.x = clamp(o.x, b.minx, b.maxx); o.y = clamp(o.y, b.miny, b.maxy);
  }

  enterCar() {
    const p = this.player;
    let best = null, bd = Infinity;
    for (const c of this.cars) {
      if (c.dead) continue;
      const d = dist(c, p) - c.m.l / 2;
      if (d < 2.6 && d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    const c = best;
    if (c.driver === 'ai' || c.driver === 'cop') {
      // sacamos al conductor
      const ex = c.x - Math.sin(c.a) * (c.m.w / 2 + 0.8), ey = c.y + Math.cos(c.a) * (c.m.w / 2 + 0.8);
      const n = this.w.nearestNode(ex, ey, true);
      if (n >= 0) {
        const e = this.w.pedAdj[n][0];
        this.peds.push({ id: uid++, x: ex, y: ey, a: 0, from: n, to: e ? e.to : n, road: e ? e.r : null, side: 1, speed: 1.4,
          shirt: c.driver === 'cop' ? '#1f3a93' : pick(SHIRTS), hair: pick(HAIR), pants: '#1b2631', state: 'flee', t: 5, fx: p.x, fy: p.y, walk: 0, cop: c.driver === 'cop' });
      }
      this.crime(c.m.police ? 45 : 8, c.x, c.y);
      this.msg(c.m.police ? '¡Has robado un coche patrulla!' : '¡Coche robado!', 2);
    } else if (c.parked && !c.mission) this.crime(3, c.x, c.y);
    c.driver = 'player'; c.ai = null; c.parked = false;
    p.car = c;
    this.audio.play('door');
    const m = this.mission;
    if (m && m.steps[m.step] && m.steps[m.step].car === c) {
      m.step++;
      if (m.steps[m.step].alarm) { this.crime(STAR_HEAT[2], c.x, c.y); this.msg('¡Ha saltado la alarma!', 2); }
      m.timer = Math.round(Math.hypot(m.steps[m.step].x - c.x, m.steps[m.step].y - c.y) / 8 + 40);
    }
  }

  exitCar() {
    const p = this.player, c = p.car;
    if (!c) return;
    for (const side of [-1, 1]) {
      const ox = -Math.sin(c.a) * (c.m.w / 2 + 0.7) * side, oy = Math.cos(c.a) * (c.m.w / 2 + 0.7) * side;
      if (!this.w.isInsideBuilding(c.x + ox, c.y + oy) || side === 1) { p.x = c.x + ox; p.y = c.y + oy; break; }
    }
    c.driver = null; p.car = null;
    this.audio.play('door');
  }

  shoot() {
    const p = this.player;
    p.shootCd = 0.25;
    let a = p.a;
    // autoapuntado suave
    let best = null, bs = 0.45;
    for (const q of this.peds) {
      if (q.state === 'dead') continue;
      const d = dist(q, p); if (d > 28) continue;
      const da = Math.abs(angDiff(p.a, Math.atan2(q.y - p.y, q.x - p.x)));
      if (da < bs) { bs = da; best = q; }
    }
    for (const c of this.cars) {
      if (c.dead) continue;
      const d = dist(c, p); if (d > 30 || d < 1) continue;
      const da = Math.abs(angDiff(p.a, Math.atan2(c.y - p.y, c.x - p.x)));
      if (da < bs) { bs = da; best = c; }
    }
    if (best) a = Math.atan2(best.y - p.y, best.x - p.x);
    a += rand(-0.03, 0.03);
    this.bullets.push({ x: p.x + Math.cos(a) * 0.6, y: p.y + Math.sin(a) * 0.6, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, life: 0.35, owner: 'player' });
    this.parts.push({ x: p.x + Math.cos(a) * 0.8, y: p.y + Math.sin(a) * 0.8, vx: 0, vy: 0, life: 0.05, max: 0.05, size: 0.5, color: '#ffe680' });
    this.audio.play('shot');
    for (const q of this.peds) if (q.state === 'walk' && dist(q, p) < 30) { q.state = 'flee'; q.t = rand(4, 8); q.fx = p.x; q.fy = p.y; }
    let copNear = false;
    for (const c of this.cars) if (c.m.police && !c.dead && dist(c, p) < 45) copNear = true;
    if (copNear) this.crime(4, p.x, p.y);
  }

  // ---------- física de coches ----------
  stepCar(c, inp, dt) {
    const m = c.m;
    let fx = Math.cos(c.a), fy = Math.sin(c.a);
    let vf = c.vx * fx + c.vy * fy, vl = -c.vx * fy + c.vy * fx;
    const thr = c.dead ? 0 : inp.thr;
    const maxF = m.max * (c.hp < 30 ? 0.6 : 1);
    if (thr > 0) vf += thr * m.acc * dt * (vf < 0 ? 2.2 : 1) * (1 - Math.max(0, vf) / maxF * 0.7);
    else if (thr < 0) { if (vf > 0.3) vf += thr * 18 * dt; else vf += thr * m.acc * 0.6 * dt; }
    else vf -= vf * 0.35 * dt + Math.sign(vf) * Math.min(Math.abs(vf), 0.8 * dt);
    // cuestas: la gravedad frena al subir y acelera al bajar
    const T = this.w.terrain;
    if (T.ok) vf -= 9.8 * T.slope(c.x, c.y, fx, fy) * 0.85 * dt;
    vf = clamp(vf, -m.max * 0.3, maxF);
    if (inp.hb) vf -= vf * 1.2 * dt;
    const grip = inp.hb ? 1.6 : m.bike ? 14 : 9;
    const prevVl = vl;
    vl *= Math.exp(-grip * dt);
    const sp = Math.abs(vf);
    const turn = (c.dead ? 0 : inp.steer) * m.turn * Math.min(1, sp / 5) * (1 - 0.4 * Math.min(1, sp / 45)) * Math.sign(vf) * (inp.hb ? 1.35 : 1);
    c.av += (turn - c.av) * Math.min(1, 12 * dt);
    c.a += c.av * dt;
    fx = Math.cos(c.a); fy = Math.sin(c.a);
    c.vx = fx * vf - fy * vl; c.vy = fy * vf + fx * vl;
    // derrape: marcas en el asfalto
    if ((Math.abs(prevVl) > 3.5 || (inp.hb && sp > 8) || (thr < 0 && vf > 12)) && !c.m.bike) {
      const rx = -fy, ry = fx, bx = c.x - fx * m.l * 0.35, by = c.y - fy * m.l * 0.35;
      for (const s of [-1, 1]) {
        const x = bx + rx * s * m.w * 0.4, y = by + ry * s * m.w * 0.4;
        const k = c.id * 2 + (s > 0 ? 1 : 0);
        const last = c['sk' + s];
        if (last && Math.hypot(last.x - x, last.y - y) < 3) this.skids.push({ x1: last.x, y1: last.y, x2: x, y2: y, t: 30 });
        c['sk' + s] = { x, y, k };
      }
      if (this.skids.length > 600) this.skids.splice(0, this.skids.length - 600);
      if (c.driver === 'player' && Math.random() < dt * 6) this.audio.play('skid');
    } else { c['sk-1'] = null; c.sk1 = null; }

    c.x += c.vx * dt; c.y += c.vy * dt;
    // colisión con edificios: dos círculos (morro y cola)
    const rad = m.w / 2 + 0.05, half = Math.max(0, m.l / 2 - rad);
    for (const s of [1, -1]) {
      const cx = c.x + Math.cos(c.a) * half * s, cy = c.y + Math.sin(c.a) * half * s;
      const r = this.w.collide(cx, cy, rad);
      if (!r.hit) continue;
      c.x += r.x - cx; c.y += r.y - cy;
      const vn = c.vx * r.nx + c.vy * r.ny;
      if (vn < 0) {
        c.vx -= 1.35 * vn * r.nx; c.vy -= 1.35 * vn * r.ny;
        c.vx *= 0.92; c.vy *= 0.92;
        const imp = -vn;
        if (imp > 4) this.damageCar(c, (imp - 4) * 2.2, c.x + r.nx * -rad, c.y + r.ny * -rad);
        c.av += (s * (r.nx * -Math.sin(c.a) + r.ny * Math.cos(c.a))) * imp * 0.08;
      }
    }
    this.clampBounds(c);
  }

  damageCar(c, amount, x, y) {
    if (c.dead) return;
    c.hp -= amount;
    if (amount > 6) {
      for (let i = 0; i < Math.min(12, amount); i++) this.parts.push({ x, y, vx: rand(-8, 8), vy: rand(-8, 8), life: 0.3, max: 0.3, size: 0.2, color: '#ffd27a' });
      if (c.driver === 'player' && amount > 8) this.audio.play('crash');
    }
  }

  carDamage(c, dt) {
    if (c.dead) { if (Math.random() < dt * 4) this.smoke(c.x, c.y, '#333'); return; }
    if (c.hp < 35 && Math.random() < dt * (c.hp < 18 ? 14 : 5)) this.smoke(c.x + Math.cos(c.a) * c.m.l * 0.35, c.y + Math.sin(c.a) * c.m.l * 0.35, c.hp < 18 ? '#222' : '#888');
    if (c.hp <= 15) {
      c.fire += dt;
      if (Math.random() < dt * 20) this.parts.push({ x: c.x + rand(-1, 1), y: c.y + rand(-1, 1), vx: rand(-1, 1), vy: rand(-1, 1), life: 0.5, max: 0.5, size: rand(0.6, 1.2), color: pick(['#ff6a00', '#ffb000', '#ff3c00']) });
      if (c.fire > 4 || c.hp <= -20) this.explode(c);
    }
  }

  explode(c) {
    c.dead = true; c.hp = 0; c.color = '#252525';
    this.audio.play('boom');
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * TAU, s = rand(3, 20);
      this.parts.push({ x: c.x, y: c.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 1.1), max: 1.1, size: rand(0.8, 2.2), color: pick(['#ff6a00', '#ffb000', '#ffe066', '#ff3c00']) });
    }
    for (let i = 0; i < 25; i++) this.smoke(c.x + rand(-3, 3), c.y + rand(-3, 3), '#2b2b2b');
    this.decals.push({ x: c.x, y: c.y, r: 5, color: 'rgba(20,20,20,.55)', t: 60 });
    this.flash = 0.25;
    if (this.player.car === c) this.hurtPlayer(999);
    const byPlayer = c.lastHitByPlayer || c.driver === 'player';
    if (byPlayer) this.crime(c.m.police ? 70 : 25, c.x, c.y);
    for (const o of this.cars) if (o !== c && !o.dead) { const d = dist(o, c); if (d < 9) { this.damageCar(o, (9 - d) * 8, o.x, o.y); o.vx += (o.x - c.x) / (d || 1) * 6; o.vy += (o.y - c.y) / (d || 1) * 6; } }
    for (const q of this.peds) if (q.state !== 'dead' && dist(q, c) < 7) this.killPed(q, (q.x - c.x) * 2, (q.y - c.y) * 2, byPlayer);
    if (!this.player.car && dist(this.player, c) < 7) this.hurtPlayer((7 - dist(this.player, c)) * 15);
    if (c.driver === 'cop' || c.driver === 'ai') c.driver = null;
    if (this.mission && this.mission.car === c) this.endMission(false, 'el deportivo ha quedado calcinado');
  }

  smoke(x, y, color) {
    this.parts.push({ x, y, vx: rand(-0.8, 0.8), vy: rand(-0.8, 0.8) - 0.5, life: rand(0.8, 1.6), max: 1.6, size: rand(0.8, 1.6), color, grow: 1.8 });
  }

  carCarCollisions() {
    const cs = this.cars;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        const lim = (a.m.l + b.m.l) / 2 + 0.3;
        if (Math.abs(a.x - b.x) > lim || Math.abs(a.y - b.y) > lim) continue;
        const ra = a.m.w / 2, rb = b.m.w / 2, ha = Math.max(0, a.m.l / 2 - ra), hb = Math.max(0, b.m.l / 2 - rb);
        let hit = null, best = 0;
        for (const sa of [-1, 0, 1]) for (const sb of [-1, 0, 1]) {
          const ax = a.x + Math.cos(a.a) * ha * sa, ay = a.y + Math.sin(a.a) * ha * sa;
          const bx = b.x + Math.cos(b.a) * hb * sb, by = b.y + Math.sin(b.a) * hb * sb;
          const d = Math.hypot(bx - ax, by - ay), pen = ra + rb - d;
          if (pen > best) { best = pen; hit = { nx: (bx - ax) / (d || 1), ny: (by - ay) / (d || 1), x: (ax + bx) / 2, y: (ay + by) / 2 }; }
        }
        if (!hit) continue;
        const ma = a.dead || a.parked ? 1.5 : 1, mb = b.dead || b.parked ? 1.5 : 1;
        const wa = mb / (ma + mb), wb = ma / (ma + mb);
        a.x -= hit.nx * best * wa; a.y -= hit.ny * best * wa;
        b.x += hit.nx * best * wb; b.y += hit.ny * best * wb;
        const vn = (b.vx - a.vx) * hit.nx + (b.vy - a.vy) * hit.ny;
        if (vn < 0) {
          const jimp = -1.3 * vn;
          a.vx -= hit.nx * jimp * wa; a.vy -= hit.ny * jimp * wa;
          b.vx += hit.nx * jimp * wb; b.vy += hit.ny * jimp * wb;
          const imp = -vn;
          if (imp > 3) {
            this.damageCar(a, (imp - 3) * 1.6, hit.x, hit.y); this.damageCar(b, (imp - 3) * 1.6, hit.x, hit.y);
            const pl = a.driver === 'player' ? b : b.driver === 'player' ? a : null;
            if (pl) {
              pl.lastHitByPlayer = true;
              if (pl.m.police && this.crimeCd <= 0) { this.crime(15, pl.x, pl.y); this.crimeCd = 2; }
              if (pl.driver === 'ai' && Math.random() < 0.4) this.audio.play('horn');
            }
          }
          if (a.parked) a.parked = false; if (b.parked) b.parked = false;
        }
      }
    }
    this.crimeCd -= 1 / 60;
  }

  // ---------- IA de tráfico ----------
  chooseNext(from, to) {
    const adj = this.w.carAdj[to];
    let opts = adj.filter(e => e.to !== from);
    if (!opts.length) opts = adj;
    if (!opts.length) return null;
    let tot = 0; for (const e of opts) tot += 1 + e.r.rank;
    let t = Math.random() * tot;
    for (const e of opts) { t -= 1 + e.r.rank; if (t <= 0) return e; }
    return opts[0];
  }

  aiDrive(c, dt) {
    const w = this.w, ai = c.ai;
    const fx = w.nx[ai.from], fy = w.ny[ai.from], tx = w.nx[ai.to], ty = w.ny[ai.to];
    let dx = tx - fx, dy = ty - fy; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const off = this.laneOffset(ai.road);
    const t = ((c.x - fx) * dx + (c.y - fy) * dy);
    if (!ai.next) ai.next = this.chooseNext(ai.from, ai.to);
    let gx, gy, target = ai.speed;
    const la = t + 7;
    if (la < L || !ai.next) {
      gx = fx + dx * Math.min(la, L) - dy * off; gy = fy + dy * Math.min(la, L) + dx * off;
    } else {
      const n = ai.next, nx2 = w.nx[n.to] - tx, ny2 = w.ny[n.to] - ty, L2 = Math.hypot(nx2, ny2) || 1;
      const o2 = this.laneOffset(n.r), k = Math.min(la - L, L2);
      gx = tx + nx2 / L2 * k - ny2 / L2 * o2; gy = ty + ny2 / L2 * k + nx2 / L2 * o2;
    }
    if (ai.next && L - t < 18) {
      const n = ai.next, nx2 = w.nx[n.to] - tx, ny2 = w.ny[n.to] - ty;
      const turnA = Math.abs(angDiff(Math.atan2(dy, dx), Math.atan2(ny2, nx2)));
      if (turnA > 0.5) target = Math.min(target, 11 - turnA * 3.5);
    }
    if (t > L - 2.5) {
      if (!ai.next) { c.driver = null; c.parked = true; return { thr: -1, steer: 0, hb: true }; }
      ai.from = ai.to; ai.to = ai.next.to; ai.road = ai.next.r; ai.next = null;
    }
    // obstáculos delante
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    const P = this.pos();
    const check = (o, lat) => {
      const ox = o.x - c.x, oy = o.y - c.y, fwd = ox * ca + oy * sa, side = -ox * sa + oy * ca;
      if (fwd > 0 && fwd < 14 && Math.abs(side) < lat) target = Math.min(target, Math.max(0, (fwd - 5) * 0.9));
    };
    for (const o of this.cars) if (o !== c && Math.abs(o.x - c.x) < 15 && Math.abs(o.y - c.y) < 15) check(o, 1.9);
    if (!this.player.car) check(P, 1.6);
    for (const q of this.peds) if (q.state !== 'dead' && Math.abs(q.x - c.x) < 12 && Math.abs(q.y - c.y) < 12) check(q, 1.3);
    return this.driveTo(c, gx, gy, target, dt);
  }

  driveTo(c, gx, gy, target, dt) {
    const desired = Math.atan2(gy - c.y, gx - c.x);
    const vf = c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a);
    let d = angDiff(c.a, desired);
    const sp = Math.abs(vf);
    // atascado: marcha atrás
    if (c.rev > 0) { c.rev -= dt; return { thr: -1, steer: -Math.sign(d), hb: false }; }
    if (sp < 1 && target > 3) { c.stuck += dt; if (c.stuck > 1.5) { c.stuck = 0; c.rev = 1.2; } } else c.stuck = Math.max(0, c.stuck - dt);
    if (Math.abs(d) > 1.3) target = Math.min(target, 7);
    let thr = sp < target - 0.5 ? 1 : sp > target + 1.5 ? -1 : 0;
    if (target < 0.5 && sp < 1) thr = 0;
    return { thr, steer: clamp(d * 2.8, -1, 1), hb: false };
  }

  // vecino que más acerca al jugador según el campo de distancias
  downhill(n) {
    const w = this.w;
    let best = -1, bd = w.dist[n];
    for (const e of w.undAdj[n]) if (w.dist[e.to] < bd) { bd = w.dist[e.to]; best = e.to; }
    return best;
  }

  copDrive(c, dt) {
    const w = this.w, P = this.pos(), ai = c.ai;
    const d = dist(c, P);
    if (this.stars === 0) {
      // sin estrellas: vuelven a patrullar
      if (!ai.patrol) { ai.patrol = true; ai.next = null; ai.speed = 12; const n = w.nearestNode(c.x, c.y, false); ai.from = n; const e = pick(w.carAdj[n] || []); if (e) { ai.to = e.to; ai.road = e.r; } else { c.driver = null; return { thr: 0, steer: 0, hb: true }; } }
      return this.aiDrive(c, dt);
    }
    ai.patrol = false;
    let gx, gy, target = 30;
    if (d < 40 && (d < 12 || w.lineClear(c.x, c.y, P.x, P.y))) {
      gx = P.x; gy = P.y;
      if (!this.player.car) target = Math.max(3, d * 1.2);
    } else {
      if (ai.to < 0 || ai.to === undefined || ai.lost > 3) { ai.to = w.nearestNode(c.x, c.y, false); ai.from = -1; ai.lost = 0; }
      if (ai.to < 0) { gx = P.x; gy = P.y; } else {
        const sp = Math.hypot(c.vx, c.vy);
        let node = ai.to, nxt = this.downhill(node);
        let dN = Math.hypot(w.nx[node] - c.x, w.ny[node] - c.y);
        if (nxt >= 0) {
          const ux = w.nx[nxt] - w.nx[node], uy = w.ny[nxt] - w.ny[node];
          const passed = (c.x - w.nx[node]) * ux + (c.y - w.ny[node]) * uy > 0;
          if (dN < Math.max(5, sp * 0.3) || (passed && dN < 25)) { ai.from = node; node = ai.to = nxt; nxt = this.downhill(node); dN = Math.hypot(w.nx[node] - c.x, w.ny[node] - c.y); }
        } else if (dN < 6) { node = -1; }
        if (dN > 60) ai.lost = (ai.lost || 0) + dt; else ai.lost = 0;
        if (node < 0) { gx = P.x; gy = P.y; } else {
          gx = w.nx[node]; gy = w.ny[node];
          // seguimos la línea de la calle en lugar de cortar esquinas
          if (ai.from >= 0 && ai.from !== node) {
            const fx = w.nx[ai.from], fy = w.ny[ai.from];
            let ex = gx - fx, ey = gy - fy; const L = Math.hypot(ex, ey) || 1; ex /= L; ey /= L;
            const t = clamp((c.x - fx) * ex + (c.y - fy) * ey + 8, 0, L);
            const px = fx + ex * t, py = fy + ey * t;
            if (Math.hypot(px - c.x, py - c.y) < 30) { gx = px; gy = py; }
          }
          target = 30;
          if (nxt >= 0) {
            const nX = w.nx[node], nY = w.ny[node];
            const turnA = Math.abs(angDiff(Math.atan2(nY - c.y, nX - c.x), Math.atan2(w.ny[nxt] - nY, w.nx[nxt] - nX)));
            const vTurn = Math.max(7, 30 * (1 - turnA / 1.8));
            const brakeD = (sp * sp - vTurn * vTurn) / 20 + 6;
            if (dN < brakeD) target = vTurn;
          }
          const hd = Math.abs(angDiff(c.a, Math.atan2(gy - c.y, gx - c.x)));
          if (hd > 0.6) target = Math.min(target, 30 * (1 - hd / 2.2) + 5);
        }
      }
    }
    // disparos a partir de 3 estrellas
    if (this.stars >= 3 && d < 30 && !this.dead) {
      c.shootCd = (c.shootCd || 0) - dt;
      if (c.shootCd <= 0 && w.lineClear(c.x, c.y, P.x, P.y)) {
        c.shootCd = rand(0.8, 1.6);
        const a = Math.atan2(P.y - c.y, P.x - c.x) + rand(-0.12, 0.12);
        this.bullets.push({ x: c.x + Math.cos(a) * 2.5, y: c.y + Math.sin(a) * 2.5, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, life: 0.4, owner: 'cop' });
        this.audio.play('shot', 0.4);
      }
    }
    return this.driveTo(c, gx, gy, target, dt);
  }

  updatePolice(dt) {
    const P = this.pos();
    this.fieldT -= dt;
    if (this.stars > 0 && this.fieldT <= 0) {
      this.fieldT = 1;
      this.w.computeDistanceField(this.w.nearestNode(P.x, P.y, false));
    }
    // ¿nos ve la policía?
    this.seenT -= dt;
    if (this.seenT <= 0) {
      this.seenT = 0.5;
      let seen = false;
      for (const c of this.cars) if (c.m.police && !c.dead && c.driver === 'cop' && dist(c, P) < 90 && this.w.lineClear(c.x, c.y, P.x, P.y)) seen = true;
      this.seen = seen;
    }
    if (this.stars > 0) {
      if (this.seen) this.unseen = 0; else this.unseen += dt;
      if (this.unseen > 7) {
        this.heat -= 9 * dt;
        if (this.heat <= 0) { this.heat = 0; this.msg('Has despistado a la policía', 3); }
        this.updateStars();
      }
    }
    // busted
    if (!this.dead && this.stars > 0) {
      let close = false;
      const pcar = this.player.car;
      const pspeed = pcar ? Math.hypot(pcar.vx, pcar.vy) : 0;
      for (const c of this.cars) {
        if (!c.m.police || c.dead || c.driver !== 'cop') continue;
        const d = dist(c, P);
        if (pcar ? (d < c.m.l / 2 + pcar.m.l / 2 + 1.5 && pspeed < 2) : d < 4.5 && Math.hypot(c.vx, c.vy) < 8) close = true;
      }
      this.bustT = close ? this.bustT + dt : Math.max(0, this.bustT - dt * 2);
      if (this.bustT > (pcar ? 2.2 : 1.2)) this.die('busted');
    }
    // número de patrullas
    const want = [0, 1, 2, 3, 4, 6][this.stars];
    const active = this.cars.filter(c => c.m.police && !c.dead && c.driver === 'cop').length;
    if (active < want && Math.random() < dt * 0.8) {
      const c = this.spawnTraffic(110, 220, true);
      if (c) c.ai.to = c.ai.to;
    }
  }

  // ---------- peatones ----------
  killPed(q, vx, vy, byPlayer) {
    if (q.state === 'dead') return;
    q.state = 'dead'; q.t = 0; q.a = Math.atan2(vy, vx);
    q.x += vx * 0.05; q.y += vy * 0.05;
    const r = this.w.collide(q.x, q.y, 0.4); q.x = r.x; q.y = r.y;
    this.decals.push({ x: q.x, y: q.y, r: rand(0.8, 1.3), color: 'rgba(130,10,10,.8)', t: 40 });
    for (let i = 0; i < 10; i++) this.parts.push({ x: q.x, y: q.y, vx: vx * 0.2 + rand(-3, 3), vy: vy * 0.2 + rand(-3, 3), life: 0.4, max: 0.4, size: 0.25, color: '#9b1010' });
    this.audio.play('hit');
    if (byPlayer) {
      this.crime(q.cop ? 50 : 22, q.x, q.y);
      if (Math.random() < 0.5) this.pickups.push({ x: q.x + rand(-1, 1), y: q.y + rand(-1, 1), v: Math.floor(rand(1, 6)) * 5, t: 20 });
    }
    for (const o of this.peds) if (o.state === 'walk' && dist(o, q) < 20) { o.state = 'flee'; o.t = rand(4, 8); o.fx = q.x; o.fy = q.y; }
  }

  get pickups() { return this._pk || (this._pk = []); }

  updatePeds(dt) {
    const w = this.w;
    for (const q of this.peds) {
      if (q.state === 'dead') { q.t += dt; continue; }
      q.walk += dt * (q.state === 'flee' ? 11 : 4);
      if (q.state === 'flee') {
        const a = Math.atan2(q.y - q.fy, q.x - q.fx) + Math.sin(q.walk * 0.3) * 0.4;
        q.x += Math.cos(a) * 5.2 * dt; q.y += Math.sin(a) * 5.2 * dt; q.a = a;
        const r = w.collide(q.x, q.y, 0.35); q.x = r.x; q.y = r.y;
        q.t -= dt;
        if (q.t <= 0) {
          const n = w.nearestNode(q.x, q.y, true);
          if (n >= 0 && w.pedAdj[n].length) { const e = pick(w.pedAdj[n]); q.from = n; q.to = e.to; q.road = e.r; q.state = 'walk'; }
          else q.t = 2;
        }
        continue;
      }
      const o = this.pedOffset(q);
      const gx = w.nx[q.to] + o.x, gy = w.ny[q.to] + o.y;
      const dx = gx - q.x, dy = gy - q.y, d = Math.hypot(dx, dy);
      if (d < 0.8) {
        const adj = w.pedAdj[q.to];
        let opts = adj.filter(e => e.to !== q.from); if (!opts.length) opts = adj;
        if (!opts.length) { q.state = 'flee'; q.t = 1; q.fx = q.x + 1; q.fy = q.y; continue; }
        const e = pick(opts); q.from = q.to; q.to = e.to; q.road = e.r;
      } else {
        const sp = q.speed * dt;
        q.x += dx / d * sp; q.y += dy / d * sp;
        q.a += angDiff(q.a, Math.atan2(dy, dx)) * Math.min(1, dt * 8);
      }
      // se asustan con coches rápidos o con el jugador disparando
      if (this.player.car) {
        const c = this.player.car, sp = Math.hypot(c.vx, c.vy);
        if (sp > 14 && dist(c, q) < 10) { q.state = 'flee'; q.t = rand(2, 4); q.fx = c.x; q.fy = c.y; }
      }
    }
    // coches contra peatones
    for (const c of this.cars) {
      const sp = Math.hypot(c.vx, c.vy);
      const ca = Math.cos(c.a), sa = Math.sin(c.a), hl = c.m.l / 2 + 0.35, hw = c.m.w / 2 + 0.35;
      if (sp < 0.5) {
        // el jugador no atraviesa coches parados
        if (!this.player.car && !this.dead) {
          const p = this.player, ox = p.x - c.x, oy = p.y - c.y;
          const lx = ox * ca + oy * sa, ly = -ox * sa + oy * ca;
          if (Math.abs(lx) < hl && Math.abs(ly) < hw) {
            if (hl - Math.abs(lx) < hw - Math.abs(ly)) { const k = Math.sign(lx) || 1, d = hl - Math.abs(lx); p.x += ca * k * d; p.y += sa * k * d; }
            else { const k = Math.sign(ly) || 1, d = hw - Math.abs(ly); p.x -= sa * k * d; p.y += ca * k * d; }
          }
        }
        continue;
      }
      for (const q of this.peds) {
        if (q.state === 'dead') continue;
        const ox = q.x - c.x, oy = q.y - c.y;
        if (Math.abs(ox) > 4 || Math.abs(oy) > 4) continue;
        const lx = ox * ca + oy * sa, ly = -ox * sa + oy * ca;
        if (Math.abs(lx) > hl || Math.abs(ly) > hw) continue;
        if (sp > 4) this.killPed(q, c.vx * 1.2, c.vy * 1.2, c.driver === 'player');
        else { const k = Math.sign(ly) || 1; q.x -= sa * k * 0.3; q.y += ca * k * 0.3; }
      }
      if (!this.player.car && !this.dead && c.driver !== 'player') {
        const p = this.player, ox = p.x - c.x, oy = p.y - c.y;
        const lx = ox * ca + oy * sa, ly = -ox * sa + oy * ca;
        if (Math.abs(lx) < hl && Math.abs(ly) < hw) {
          if (sp > 5 && !(p.hitCd > this.time)) { this.hurtPlayer(sp * 2.2); p.hitCd = this.time + 0.6; }
          const k = Math.sign(ly) || 1; p.x -= sa * k * (hw - Math.abs(ly) + 0.05); p.y += ca * k * (hw - Math.abs(ly) + 0.05);
        }
      }
    }
    // recoger dinero
    const P = this.pos();
    for (const k of this.pickups) {
      k.t -= dt;
      if (dist(k, P) < 1.8) { this.money += k.v; k.t = 0; this.audio.play('cash'); }
    }
    this._pk = this.pickups.filter(k => k.t > 0);
  }

  hurtPlayer(d) {
    if (this.dead) return;
    this.player.hp -= d;
    this.hurtFlash = 0.3;
    if (this.player.hp <= 0) this.die('wasted');
  }

  updateBullets(dt) {
    const w = this.w;
    for (const b of this.bullets) {
      const x0 = b.x, y0 = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (w.isInsideBuilding(b.x, b.y)) { b.life = 0; this.parts.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.15, max: 0.15, size: 0.3, color: '#ddd' }); continue; }
      if (b.owner === 'player') {
        for (const q of this.peds) {
          if (q.state === 'dead') continue;
          if (SB.segDist2(q.x, q.y, x0, y0, b.x, b.y) < 0.45 * 0.45) { this.killPed(q, b.vx * 0.05, b.vy * 0.05, true); b.life = 0; break; }
        }
      } else if (!this.dead) {
        const P = this.pos(), r = this.player.car ? 2 : 0.5;
        if (SB.segDist2(P.x, P.y, x0, y0, b.x, b.y) < r * r) {
          b.life = 0;
          if (this.player.car) this.damageCar(this.player.car, 4, b.x, b.y); else this.hurtPlayer(7);
        }
      }
      if (b.life <= 0) continue;
      for (const c of this.cars) {
        if (c.dead || (b.owner === 'cop' && c.m.police) || c === this.player.car && b.owner === 'player') continue;
        const ox = b.x - c.x, oy = b.y - c.y;
        if (Math.abs(ox) > 3 || Math.abs(oy) > 3) continue;
        const lx = ox * Math.cos(c.a) + oy * Math.sin(c.a), ly = -ox * Math.sin(c.a) + oy * Math.cos(c.a);
        if (Math.abs(lx) < c.m.l / 2 && Math.abs(ly) < c.m.w / 2) {
          b.life = 0; this.damageCar(c, 7, b.x, b.y);
          if (b.owner === 'player') { c.lastHitByPlayer = true; if (c.m.police) this.crime(8, c.x, c.y); }
          break;
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.life > 0);
  }

  updateParticles(dt) {
    for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; p.life -= dt; if (p.grow) p.size += p.grow * dt; }
    this.parts = this.parts.filter(p => p.life > 0);
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
    for (const d of this.decals) d.t -= dt;
    this.decals = this.decals.filter(d => d.t > 0);
    for (const s of this.skids) s.t -= dt;
    if (this.skids.length && this.skids[0].t <= 0) this.skids = this.skids.filter(s => s.t > 0);
    if (this.flash) this.flash = Math.max(0, this.flash - dt);
    if (this.hurtFlash) this.hurtFlash = Math.max(0, this.hurtFlash - dt);
  }

  population() {
    const P = this.pos();
    this.cars = this.cars.filter(c => {
      if (c === this.player.car || c.mission) return true;
      const d = dist(c, P);
      if (c.m.police && c.driver === 'cop') return d < (this.stars ? 500 : 300);
      if (c.driver === 'ai') return d < 300;
      return d < 420;
    });
    this.peds = this.peds.filter(q => { const d = dist(q, P); return q.state === 'dead' ? q.t < 30 && d < 250 : d < 190; });
    const civ = this.cars.filter(c => c.driver === 'ai').length;
    if (civ < 22) this.spawnTraffic(130, 260);
    const parked = this.cars.filter(c => !c.driver && !c.dead && dist(c, P) < 220).length;
    if (parked < 7) this.spawnParked(P.x, P.y, 90, 200);
    const alive = this.peds.filter(q => q.state !== 'dead').length;
    if (alive < 40) this.spawnPed(60, 150);
  }

  updateMission(dt) {
    const P = this.pos();
    if (!this.mission) {
      this.refreshStarts();
      for (let i = 0; i < this.starts.length; i++) {
        const s = this.starts[i];
        if (dist(s, P) < 5 && !this.dead) { this.starts.splice(i, 1); this.startMission(s); break; }
      }
      this.starts = this.starts.filter(s => dist(s, P) < 900);
      return;
    }
    const m = this.mission;
    if (m.timer != null) { m.timer -= dt; if (m.timer <= 0) { this.endMission(false, 'se acabó el tiempo'); return; } }
    const st = m.steps[m.step];
    if (!st) return;
    if (st.car) { st.x = st.car.x; st.y = st.car.y; return; }
    const ok = st.needCar ? this.player.car === st.needCar : st.needAnyCar ? !!this.player.car : true;
    if (dist(st, P) < 7 && ok) {
      m.step++;
      this.audio.play('check');
      if (m.step >= m.steps.length) {
        if (m.car) m.car.mission = false;
        this.endMission(true);
      }
    } else if (dist(st, P) < 7 && st.needCar) this.msg('Necesitas venir con el deportivo', 1);
    else if (dist(st, P) < 7 && st.needAnyCar) this.msg('¡Sube a un coche!', 1);
  }

  die(kind) {
    if (this.dead) return;
    this.dead = { kind, t: 3.5 };
    this.audio.play(kind === 'busted' ? 'busted' : 'wasted');
    if (this.player.car) { const c = this.player.car; if (kind === 'busted') { c.driver = null; } this.player.car = null; }
    if (this.mission) this.endMission(false);
  }
  respawn() {
    const kind = this.dead.kind;
    const at = kind === 'busted' ? this.comisaria : this.hospital;
    const p = this.player;
    p.x = at.x; p.y = at.y; p.hp = 100; p.car = null;
    if (kind === 'busted') { const f = Math.floor(this.money * 0.1); this.money -= f; this.msg(`Multa: -$${f}`, 3); }
    else { const f = Math.min(this.money, 150); this.money -= f; this.msg(`Factura del hospital: -$${f}`, 3); }
    this.heat = 0; this.stars = 0; this.bustT = 0;
    this.cars = this.cars.filter(c => !(c.m.police && c.driver === 'cop'));
    this.dead = null;
    this.cam.x = p.x; this.cam.y = p.y;
  }

  updateCamera(dt) {
    const P = this.pos();
    const c = this.player.car;
    const sp = c ? Math.hypot(c.vx, c.vy) : 0;
    const lead = c ? 0.9 : 0;
    const tx = P.x + (c ? c.vx * lead : 0), ty = P.y + (c ? c.vy * lead : 0);
    const k = Math.min(1, dt * 4);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    const minDim = Math.min(this.W, this.H);
    const span = c ? 70 + sp * 2.3 : 48;
    const tz = minDim / span;
    this.cam.z += (tz - this.cam.z) * Math.min(1, dt * 1.5);
  }

  // ---------- render ----------
  render() {
    if (this.view3d && this.r3d.lost) { this.setView(false); this.msg('Se perdió el contexto 3D; pulsa CÁM para volver a intentarlo', 4); }
    if (this.view3d) {
      this.r3d.render(this, this.lastDt || 0.016);
      const g = this.ctx;
      g.clearRect(0, 0, this.W, this.H);
      this.drawArrow3d(g);
      if (this.flash) { g.fillStyle = `rgba(255,220,150,${this.flash * 2})`; g.fillRect(0, 0, this.W, this.H); }
      if (this.hurtFlash) { g.fillStyle = `rgba(200,0,0,${this.hurtFlash})`; g.fillRect(0, 0, this.W, this.H); }
      this.drawMinimap();
      if (this.showMap) this.drawBigMap();
      this.updateHud();
      return;
    }
    const g = this.ctx, W = this.W, H = this.H, cam = this.cam, Z = cam.z;
    this.w.drawGround(g, cam, W, H);
    const S = (x, y) => [(x - cam.x) * Z + W / 2, (y - cam.y) * Z + H / 2];
    g.save();
    g.setTransform(Z, 0, 0, Z, W / 2 - cam.x * Z, H / 2 - cam.y * Z);
    const vx0 = cam.x - W / 2 / Z - 10, vx1 = cam.x + W / 2 / Z + 10, vy0 = cam.y - H / 2 / Z - 10, vy1 = cam.y + H / 2 / Z + 10;
    const vis = (o, m = 0) => o.x > vx0 - m && o.x < vx1 + m && o.y > vy0 - m && o.y < vy1 + m;

    // marcas de frenada y manchas
    g.strokeStyle = 'rgba(20,20,20,.35)'; g.lineWidth = 0.35; g.lineCap = 'round';
    g.beginPath();
    for (const s of this.skids) { g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); }
    g.stroke();
    for (const d of this.decals) {
      if (!vis(d)) continue;
      g.fillStyle = d.color; g.beginPath(); g.arc(d.x, d.y, d.r, 0, TAU); g.fill();
    }
    // marcadores de misión
    const pulse = 1 + Math.sin(this.time * 5) * 0.15;
    if (!this.mission) for (const s of this.starts) this.drawMarker(g, s.x, s.y, '#35d46a', 'M', pulse);
    else { const st = this.mission.steps[this.mission.step]; if (st && !st.car) this.drawMarker(g, st.x, st.y, '#ffd21f', '★', pulse); }
    for (const k of this.pickups) if (vis(k)) { g.fillStyle = '#2ecc40'; g.fillRect(k.x - 0.4, k.y - 0.3, 0.8, 0.6); g.fillStyle = '#145a1e'; g.font = '0.5px sans-serif'; g.fillText('$', k.x - 0.15, k.y + 0.18); }

    // peatones
    for (const q of this.peds) if (vis(q)) this.drawPed(g, q, false);
    if (!this.player.car && !this.dead) this.drawPed(g, this.player, true);
    else if (this.dead && !this.player.car && this.dead.kind === 'wasted') this.drawPed(g, { ...this.player, state: 'dead' }, true);
    // coches
    for (const c of this.cars) if (vis(c, 5)) this.drawCar(g, c);
    // balas
    g.strokeStyle = '#ffe680'; g.lineWidth = 0.15;
    g.beginPath();
    for (const b of this.bullets) { g.moveTo(b.x, b.y); g.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012); }
    g.stroke();
    // partículas
    for (const p of this.parts) {
      if (!vis(p)) continue;
      g.globalAlpha = clamp(p.life / p.max, 0, 1) * (p.grow ? 0.55 : 1);
      g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    // nombres de lugares
    g.restore();
    this.drawLabels(g, S, vis);
    this.drawArrow(g, S);
    if (this.flash) { g.fillStyle = `rgba(255,220,150,${this.flash * 2})`; g.fillRect(0, 0, W, H); }
    if (this.hurtFlash) { g.fillStyle = `rgba(200,0,0,${this.hurtFlash})`; g.fillRect(0, 0, W, H); }
    this.drawMinimap();
    if (this.showMap) this.drawBigMap();
    this.updateHud();
  }

  drawMarker(g, x, y, color, sym, pulse) {
    g.save(); g.translate(x, y);
    g.fillStyle = color + '44'; g.beginPath(); g.arc(0, 0, 4 * pulse, 0, TAU); g.fill();
    g.strokeStyle = color; g.lineWidth = 0.35; g.beginPath(); g.arc(0, 0, 4 * pulse, 0, TAU); g.stroke();
    g.fillStyle = color; g.beginPath(); g.arc(0, 0, 1.3, 0, TAU); g.fill();
    g.fillStyle = '#111'; g.font = 'bold 1.6px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sym, 0, 0.1);
    g.restore();
  }

  drawPed(g, q, isPlayer) {
    g.save(); g.translate(q.x, q.y); g.rotate(q.a); g.scale(1.35, 1.35);
    if (q.state === 'dead') {
      g.fillStyle = isPlayer ? '#e67e22' : q.shirt; g.beginPath(); g.ellipse(0, 0, 0.8, 0.3, 0, 0, TAU); g.fill();
      g.fillStyle = q.hair || '#222'; g.beginPath(); g.arc(0.85, 0, 0.2, 0, TAU); g.fill();
      g.restore(); return;
    }
    const sw = Math.sin(q.walk) * 0.28;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(0.12, 0.15, 0.36, 0.42, 0, 0, TAU); g.fill();
    g.fillStyle = isPlayer ? '#1b2631' : q.pants;
    g.fillRect(sw - 0.12, -0.2, 0.24, 0.13); g.fillRect(-sw - 0.12, 0.07, 0.24, 0.13);
    g.fillStyle = isPlayer ? '#e67e22' : q.cop ? '#1f3a93' : q.shirt;
    g.beginPath(); g.ellipse(0, 0, 0.22, 0.4, 0, 0, TAU); g.fill();
    g.fillStyle = '#e0ac80'; // manos
    g.beginPath(); g.arc(-sw * 0.8, -0.42, 0.08, 0, TAU); g.arc(sw * 0.8, 0.42, 0.08, 0, TAU); g.fill();
    g.fillStyle = isPlayer ? '#111' : q.hair; g.beginPath(); g.arc(0, 0, 0.18, 0, TAU); g.fill();
    if (isPlayer) { g.fillStyle = '#333'; g.fillRect(0.2, 0.15, 0.4, 0.1); }
    g.restore();
  }

  drawCar(g, c) {
    const m = c.m, L = m.l, W = m.w;
    g.save(); g.translate(c.x, c.y); g.rotate(c.a);
    g.fillStyle = 'rgba(0,0,0,.35)'; rr(g, -L / 2 + 0.25, -W / 2 + 0.35, L, W, 0.4); g.fill();
    if (m.bike) {
      g.fillStyle = '#111'; g.fillRect(-L / 2, -0.12, L, 0.24);
      g.fillStyle = c.color; rr(g, -0.5, -0.3, 1.2, 0.6, 0.2); g.fill();
      if (c.driver) { g.fillStyle = c.driver === 'player' ? '#e67e22' : '#555'; g.beginPath(); g.ellipse(-0.2, 0, 0.3, 0.38, 0, 0, TAU); g.fill(); g.fillStyle = '#222'; g.beginPath(); g.arc(-0.15, 0, 0.2, 0, TAU); g.fill(); }
      g.restore(); return;
    }
    g.fillStyle = c.color; rr(g, -L / 2, -W / 2, L, W, 0.45); g.fill();
    if (m.taxi && !c.dead) { g.fillStyle = '#f5c518'; g.fillRect(-L * 0.28, -W / 2, L * 0.5, 0.3); g.fillRect(-L * 0.28, W / 2 - 0.3, L * 0.5, 0.3); }
    if (m.police && !c.dead) { g.fillStyle = '#1f4fbf'; g.fillRect(-L / 2 + 0.3, -W / 2, L - 0.6, 0.28); g.fillRect(-L / 2 + 0.3, W / 2 - 0.28, L - 0.6, 0.28); }
    if (m.sport && !c.dead) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-L / 2, -0.15, L, 0.3); }
    const shade = 'rgba(0,0,0,.18)';
    g.fillStyle = shade; g.fillRect(L * 0.22, -W / 2 + 0.2, 0.05, W - 0.4);
    // cristales
    g.fillStyle = c.dead ? '#111' : '#1d2a38';
    if (m.van) { g.fillRect(L * 0.2, -W / 2 + 0.15, L * 0.14, W - 0.3); g.fillStyle = c.dead ? '#1a1a1a' : lighten(c.color); g.fillRect(-L / 2 + 0.2, -W / 2 + 0.2, L * 0.68, W - 0.4); }
    else {
      g.beginPath(); g.moveTo(L * 0.26, -W / 2 + 0.16); g.lineTo(L * 0.1, -W / 2 + 0.26); g.lineTo(L * 0.1, W / 2 - 0.26); g.lineTo(L * 0.26, W / 2 - 0.16); g.fill();
      g.fillRect(-L * 0.34, -W / 2 + 0.25, L * 0.09, W - 0.5);
      g.fillStyle = c.dead ? '#1a1a1a' : lighten(c.color); g.fillRect(-L * 0.25, -W / 2 + 0.22, L * 0.35, W - 0.44);
    }
    if (m.taxi && !c.dead) { g.fillStyle = '#39d353'; g.fillRect(-0.3, -0.15, 0.3, 0.3); }
    if (m.police && !c.dead) {
      const on = this.stars > 0 && c.driver === 'cop';
      const ph = Math.floor(this.time * 8) % 2;
      g.fillStyle = on && ph ? '#ff2d2d' : '#7a1d1d'; g.fillRect(-0.35, -W / 2 + 0.35, 0.4, (W - 0.7) / 2);
      g.fillStyle = on && !ph ? '#2d6dff' : '#1d2f7a'; g.fillRect(-0.35, 0, 0.4, (W - 0.7) / 2);
      if (on) { g.fillStyle = ph ? 'rgba(255,40,40,.18)' : 'rgba(40,110,255,.18)'; g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill(); }
    }
    if (!c.dead) {
      g.fillStyle = '#fff6c9'; g.fillRect(L / 2 - 0.15, -W / 2 + 0.15, 0.15, 0.35); g.fillRect(L / 2 - 0.15, W / 2 - 0.5, 0.15, 0.35);
      g.fillStyle = '#b01010'; g.fillRect(-L / 2, -W / 2 + 0.15, 0.12, 0.35); g.fillRect(-L / 2, W / 2 - 0.5, 0.12, 0.35);
    }
    if (c.mission && !c.dead && c.driver !== 'player') { g.strokeStyle = '#ffd21f'; g.lineWidth = 0.25; rr(g, -L / 2 - 0.4, -W / 2 - 0.4, L + 0.8, W + 0.8, 0.6); g.stroke(); }
    g.restore();
  }

  drawLabels(g, S, vis) {
    const Z = this.cam.z;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${Math.round(12 * this.dpr)}px system-ui, sans-serif`;
    for (const p of this.w.map.pois) {
      if (!vis(p)) continue;
      const [x, y] = S(p.x, p.y);
      const icon = { townhall: '🏛', hospital: '🏥', police: '🚓', station: '🚉', place_of_worship: '⛪', marketplace: '🛒', library: '📚', school: '🏫', fire_station: '🚒', theatre: '🎭', cinema: '🎬', museum: '🏺', park: '🌳', stadium: '🏟', cemetery: '✝', building: '🏢' }[p.kind] || '📍';
      g.fillStyle = 'rgba(0,0,0,.55)';
      const t = `${icon} ${p.name}`;
      const wd = g.measureText(t).width + 10 * this.dpr;
      g.fillRect(x - wd / 2, y - 10 * this.dpr, wd, 20 * this.dpr);
      g.fillStyle = '#fff'; g.fillText(t, x, y);
    }
  }

  target() {
    if (this.mission) { const st = this.mission.steps[this.mission.step]; return st || null; }
    return null;
  }

  drawArrow(g, S) {
    const P = this.pos();
    const targets = [];
    const t = this.target();
    if (t) targets.push({ ...t, color: '#ffd21f' });
    else { let best = null, bd = Infinity; for (const s of this.starts) { const d = dist(s, P); if (d < bd) { bd = d; best = s; } } if (best) targets.push({ ...best, color: '#35d46a' }); }
    for (const tg of targets) {
      const [sx, sy] = S(tg.x, tg.y);
      const m = 40 * this.dpr;
      if (sx > m && sx < this.W - m && sy > m && sy < this.H - m) continue;
      const cx = this.W / 2, cy = this.H / 2, a = Math.atan2(sy - cy, sx - cx);
      const k = Math.min((this.W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (this.H / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
      const ax = cx + Math.cos(a) * k, ay = cy + Math.sin(a) * k;
      g.save(); g.translate(ax, ay); g.rotate(a);
      const s = this.dpr;
      g.fillStyle = tg.color; g.strokeStyle = '#000'; g.lineWidth = 2 * s;
      g.beginPath(); g.moveTo(18 * s, 0); g.lineTo(-10 * s, -12 * s); g.lineTo(-4 * s, 0); g.lineTo(-10 * s, 12 * s); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.fillStyle = '#fff'; g.font = `bold ${Math.round(12 * s)}px system-ui`; g.textAlign = 'center';
      g.fillText(`${Math.round(dist(tg, P))} m`, ax - Math.cos(a) * 30 * s, ay - Math.sin(a) * 30 * s);
    }
  }

  // Flecha tipo brújula arriba de la pantalla apuntando al objetivo
  drawArrow3d(g) {
    const P = this.pos();
    let t = this.target(), color = '#ffd21f';
    if (!t) { let bd = Infinity; for (const s of this.starts) { const d = dist(s, P); if (d < bd) { bd = d; t = s; } } color = '#35d46a'; }
    if (!t) return;
    const yaw = this.r3d.yaw == null ? 0 : this.r3d.yaw;
    const rel = angDiff(yaw, Math.atan2(t.y - P.y, t.x - P.x));
    const s = this.dpr, cx = this.W / 2, cy = (this.mission ? 120 : 50) * s;
    g.save(); g.translate(cx, cy); g.rotate(rel);
    g.fillStyle = color; g.strokeStyle = '#000'; g.lineWidth = 2 * s;
    g.beginPath(); g.moveTo(0, -20 * s); g.lineTo(13 * s, 12 * s); g.lineTo(0, 5 * s); g.lineTo(-13 * s, 12 * s); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3 * s; g.font = `bold ${Math.round(13 * s)}px system-ui`; g.textAlign = 'center';
    const txt = `${Math.round(dist(t, P))} m`;
    g.strokeText(txt, cx, cy + 34 * s); g.fillText(txt, cx, cy + 34 * s);
  }

  drawMinimap() {
    const mc = this.hud.mini, g = mc.getContext('2d'), mm = this.w.minimap, b = this.w.bounds;
    const size = mc.width, P = this.pos(), R = 260; // metros de radio
    const k = size / (2 * R);
    g.save();
    g.fillStyle = '#1d201c'; g.fillRect(0, 0, size, size);
    g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 2, 0, TAU); g.clip();
    // en 3D el minimapa gira para que "arriba" sea hacia donde mira la cámara
    const rot = this.view3d && this.r3d && this.r3d.yaw != null ? -Math.PI / 2 - this.r3d.yaw : 0;
    g.translate(size / 2, size / 2); g.rotate(rot); g.translate(-size / 2, -size / 2);
    const sx = (P.x - R - b.minx) * mm.S, sy = (P.y - R - b.miny) * mm.S;
    g.drawImage(mm.c, sx, sy, 2 * R * mm.S, 2 * R * mm.S, 0, 0, size, size);
    const M = (x, y) => [(x - P.x) * k + size / 2, (y - P.y) * k + size / 2];
    const dot = (x, y, col, r) => { let [u, v] = M(x, y); const dx = u - size / 2, dy = v - size / 2, d = Math.hypot(dx, dy), lim = size / 2 - 8; if (d > lim) { u = size / 2 + dx / d * lim; v = size / 2 + dy / d * lim; } g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.arc(u, v, r, 0, TAU); g.fill(); g.stroke(); };
    for (const c of this.cars) if (c.m.police && c.driver === 'cop' && !c.dead && dist(c, P) < R) dot(c.x, c.y, Math.floor(this.time * 6) % 2 ? '#ff3b3b' : '#3b7bff', 3.5);
    if (!this.mission) for (const s of this.starts) dot(s.x, s.y, '#35d46a', 5);
    const t = this.target(); if (t) dot(t.x, t.y, '#ffd21f', 6);
    g.restore();
    // jugador
    g.save(); g.translate(size / 2, size / 2); g.rotate((this.player.car ? this.player.car.a : this.player.a) + rot);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, -5); g.lineTo(-2, 0); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.strokeStyle = this.stars ? (Math.floor(this.time * 4) % 2 ? '#ff3b3b' : '#3b7bff') : '#e8e2cf'; g.lineWidth = 3;
    g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 2, 0, TAU); g.stroke();
    const na = -Math.PI / 2 + rot, nr = size / 2 - 11;
    g.fillStyle = '#e53935'; g.beginPath(); g.arc(size / 2 + Math.cos(na) * nr, size / 2 + Math.sin(na) * nr, 8, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', size / 2 + Math.cos(na) * nr, size / 2 + Math.sin(na) * nr + 1); g.textBaseline = 'alphabetic';
  }

  drawBigMap() {
    const g = this.ctx, mm = this.w.minimap, b = this.w.bounds;
    const W = this.W, H = this.H;
    g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(0, 0, W, H);
    const sc = Math.min((W - 40) / mm.c.width, (H - 80) / mm.c.height);
    const ox = (W - mm.c.width * sc) / 2, oy = (H - mm.c.height * sc) / 2 + 15;
    g.drawImage(mm.c, ox, oy, mm.c.width * sc, mm.c.height * sc);
    const M = (x, y) => [ox + (x - b.minx) * mm.S * sc, oy + (y - b.miny) * mm.S * sc];
    const s = this.dpr;
    g.font = `${Math.round(11 * s)}px system-ui`; g.textAlign = 'center';
    for (const p of this.w.map.places || []) { const [x, y] = M(p.x, p.y); g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(p.name.toUpperCase(), x, y); }
    const dot = (x, y, col, r) => { const [u, v] = M(x, y); g.fillStyle = col; g.strokeStyle = '#000'; g.beginPath(); g.arc(u, v, r * s, 0, TAU); g.fill(); g.stroke(); };
    if (!this.mission) for (const st of this.starts) dot(st.x, st.y, '#35d46a', 6);
    const t = this.target(); if (t) dot(t.x, t.y, '#ffd21f', 7);
    const P = this.pos(); dot(P.x, P.y, '#fff', 6);
    g.fillStyle = '#fff'; g.font = `bold ${Math.round(18 * s)}px system-ui`;
    g.fillText('SANT BOI DE LLOBREGAT — pulsa M para cerrar', W / 2, 30 * s);
  }

  updateHud() {
    const h = this.hud, P = this.pos();
    this.nameT -= 1 / 60;
    if (this.nameT <= 0) {
      this.nameT = 0.3;
      h.street.textContent = this.w.streetNameAt(P.x, P.y) || ' ';
      let pl = '', bd = Infinity;
      for (const p of this.w.map.places || []) { if (p.big) continue; const d = dist(p, P); if (d < bd) { bd = d; pl = p.name; } }
      h.zone.textContent = pl && bd < 900 ? pl : 'Sant Boi de Llobregat';
    }
    h.money.textContent = '$' + String(Math.max(0, Math.floor(this.money))).padStart(8, '0');
    let st = '';
    for (let i = 1; i <= 5; i++) st += `<span class="${i <= this.stars ? 'on' : ''}${i <= this.stars && !this.seen && this.unseen > 7 && Math.floor(this.time * 3) % 2 ? ' blink' : ''}">★</span>`;
    if (st !== this._st) { h.stars.innerHTML = st; this._st = st; }
    h.hp.style.width = clamp(this.player.hp, 0, 100) + '%';
    const c = this.player.car;
    if (c) { h.car.style.display = 'block'; h.speed.textContent = Math.round(Math.hypot(c.vx, c.vy) * 3.6) + ' km/h'; h.carName.textContent = c.m.name; h.carHp.style.width = clamp(c.hp, 0, 100) + '%'; }
    else h.car.style.display = 'none';
    const m = this.mission;
    if (m) {
      h.mission.style.display = 'block';
      const stp = m.steps[m.step];
      h.missionTitle.textContent = m.title;
      h.missionText.textContent = stp ? stp.text : '';
      h.timer.textContent = m.timer != null ? `${Math.floor(m.timer / 60)}:${String(Math.floor(m.timer % 60)).padStart(2, '0')}` : '';
      h.reward.textContent = `Recompensa: $${m.reward}`;
    } else h.mission.style.display = 'none';
    const msg = this.msgs[0];
    const big = this.dead ? (this.dead.kind === 'busted' ? 'BUSTED' : 'WASTED') : '';
    h.big.textContent = big; h.big.className = big ? 'show ' + this.dead.kind : '';
    h.msg.textContent = msg ? msg.text : ''; h.msg.className = msg ? (msg.big ? 'show big' : 'show') : '';
    h.pause.style.display = this.paused ? 'flex' : 'none';
  }
}

function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
const lightCache = {};
function lighten(hex) {
  if (lightCache[hex]) return lightCache[hex];
  let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join('');
  const n = parseInt(h, 16), f = (v) => Math.min(255, Math.round(v + (255 - v) * 0.18));
  return (lightCache[hex] = `rgb(${f(n >> 16 & 255)},${f(n >> 8 & 255)},${f(n & 255)})`);
}

SB.Game = Game;
})();
