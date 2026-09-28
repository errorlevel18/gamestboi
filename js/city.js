// Ciudad viva: mobiliario urbano, semáforos, pasos de cebra, autobuses con sus rutas reales y el tren de FGC
'use strict';
(function () {
const SB = window.SB;
const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const CG = 32;
const key = (a, b) => a * 100003 + b;

// Semáforo: ciclo de 30 s. Grupo A (eje principal) verde 0-12, ámbar 12-15; grupo B verde 16-27, ámbar 27-30
const CYCLE = 30;
function phase(t, grp) {
  if (grp === 0) return t < 12 ? 'g' : t < 15 ? 'y' : 'r';
  return t >= 16 && t < 27 ? 'g' : t >= 27 ? 'y' : 'r';
}

// Recorrido a lo largo de una polilínea
class Path {
  constructor(pts) {
    this.p = pts; this.n = pts.length / 2;
    this.cum = new Float32Array(this.n);
    for (let i = 1; i < this.n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    this.len = this.cum[this.n - 1];
  }
  // posición y ángulo a una distancia s del inicio
  at(s) {
    s = Math.max(0, Math.min(this.len, s));
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const L = this.cum[hi] - this.cum[lo] || 1, t = (s - this.cum[lo]) / L, p = this.p;
    const x0 = p[lo * 2], y0 = p[lo * 2 + 1], x1 = p[hi * 2], y1 = p[hi * 2 + 1];
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, a: Math.atan2(y1 - y0, x1 - x0) };
  }
  // distancia a lo largo del camino del punto más cercano a (x, y)
  project(x, y) {
    let best = 0, bd = Infinity; const p = this.p;
    for (let i = 0; i + 1 < this.n; i++) {
      const x0 = p[i * 2], y0 = p[i * 2 + 1], dx = p[i * 2 + 2] - x0, dy = p[i * 2 + 3] - y0, L2 = dx * dx + dy * dy || 1;
      let t = ((x - x0) * dx + (y - y0) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = (x - x0 - dx * t) ** 2 + (y - y0 - dy * t) ** 2;
      if (d < bd) { bd = d; best = this.cum[i] + Math.sqrt(L2) * t; }
    }
    return { s: best, d: Math.sqrt(bd) };
  }
}

// Une tramos de polilínea que comparten extremos
function chainLines(lines) {
  const segs = lines.map(l => { const a = []; for (let i = 0; i < l.length; i += 2) a.push([l[i], l[i + 1]]); return a; }).filter(a => a.length > 1);
  const near = (a, b) => Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1;
  const out = [];
  while (segs.length) {
    let ch = segs.shift(), grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], a = ch[0], b = ch[ch.length - 1];
        if (near(b, s[0])) ch = ch.concat(s.slice(1));
        else if (near(b, s[s.length - 1])) ch = ch.concat(s.slice().reverse().slice(1));
        else if (near(a, s[s.length - 1])) ch = s.concat(ch.slice(1));
        else if (near(a, s[0])) ch = s.slice().reverse().concat(ch.slice(1));
        else continue;
        segs.splice(i, 1); grown = true; break;
      }
    }
    out.push([].concat(...ch));
  }
  return out;
}

class City {
  constructor(world) {
    this.w = world;
    const m = world.map;
    this.mobile = typeof SB.isMobile === 'function' && SB.isMobile();
    this.props = [];
    this.propGrid = new Map();
    this.buildProps(m);
    this.buildSignals(m);
    this.buildCrossings(m);
    this.routes = (m.busRoutes || []).map(r => {
      const path = new Path(r.pts);
      const stops = r.stops.map(([x, y]) => path.project(x, y)).filter(q => q.d < 30).map(q => q.s).sort((a, b) => a - b);
      return { ref: r.ref, name: r.name, path, stops };
    }).filter(r => r.path.len > 300);
    this.buildTrain(m);
  }

  // Calle más cercana: punto, dirección y ancho
  nearestRoad(x, y, driveOnly) {
    const w = this.w, cx = Math.floor(x / CG), cy = Math.floor(y / CG);
    let best = null, bd = Infinity;
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      const l = w.segGrid.get(key(i, j)); if (!l) continue;
      for (let k = 0; k < l.length; k += 2) {
        const r = w.map.roads[l[k]]; if (driveOnly && !r.drive) continue;
        const p = r.pts, s = l[k + 1];
        const x0 = p[s], y0 = p[s + 1], dx = p[s + 2] - x0, dy = p[s + 3] - y0, L2 = dx * dx + dy * dy || 1;
        let t = ((x - x0) * dx + (y - y0) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = x0 + dx * t, qy = y0 + dy * t, d = Math.hypot(x - qx, y - qy);
        if (d < bd) { bd = d; const L = Math.sqrt(L2); best = { r, qx, qy, ux: dx / L, uy: dy / L, d }; }
      }
    }
    return best;
  }

  addProp(p, r) {
    this.props.push(p);
    // sólo chocan los muebles que están fuera de la calzada (así nunca bloquean el tráfico)
    if (r && this.w.roadDist(p.x, p.y) > 0.3) {
      p.r = r;
      const k = key(Math.floor(p.x / CG), Math.floor(p.y / CG));
      let l = this.propGrid.get(k); if (!l) this.propGrid.set(k, l = []); l.push(p);
    }
    this.w.insertTiles([p.x, p.y, p.x, p.y], 3, 'props', p);
  }

  buildProps(m) {
    const w = this.w;
    // orientación: mirando a la calle más cercana
    const facing = (x, y) => { const nr = this.nearestRoad(x, y, true); return nr ? { a: Math.atan2(nr.uy, nr.ux), nr } : { a: 0, nr: null }; };
    // farolas: las de OSM, o si apenas hay, una cada ~28 m en las aceras de las calles con coches
    const lampGrid = new Set();
    const lampOk = (x, y) => {
      const k = Math.floor(x / 10) + ',' + Math.floor(y / 10);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (lampGrid.has((Math.floor(x / 10) + i) + ',' + (Math.floor(y / 10) + j))) return false;
      lampGrid.add(k); return true;
    };
    const L = m.lamps || [];
    for (let i = 0; i < L.length; i += 2) {
      const f = facing(L[i], L[i + 1]); lampOk(L[i], L[i + 1]);
      const ta = f.nr ? Math.atan2(f.nr.qy - L[i + 1], f.nr.qx - L[i]) : 0;
      this.addProp({ x: L[i], y: L[i + 1], a: ta, k: 'lamp' }, 0.2);
    }
    if (L.length / 2 < 60) {
      const cap = this.mobile ? 1500 : 3500;
      let n = 0;
      for (const r of m.roads) {
        if (!r.drive || r.tunnel || r.rank < 2 || n >= cap) continue;
        const p = r.pts; let acc = 14, side = 1;
        for (let i = 0; i + 3 < p.length && n < cap; i += 2) {
          const x0 = p[i], y0 = p[i + 1], dx = p[i + 2] - x0, dy = p[i + 3] - y0, len = Math.hypot(dx, dy);
          if (len < 0.1) continue;
          const ux = dx / len, uy = dy / len;
          for (; acc < len; acc += 28) {
            const off = r.w / 2 + 0.6, sd = side;
            const x = x0 + ux * acc - uy * off * sd, y = y0 + uy * acc + ux * off * sd;
            side = -side;
            if (w.isInsideBuilding(x, y) || w.roadDist(x, y) < 0.2 || !lampOk(x, y)) continue;
            // a = ángulo hacia el centro de la calle (el brazo de la farola apunta allí)
            this.addProp({ x, y, a: Math.atan2(-ux * sd, uy * sd), k: 'lamp' }, 0.2); n++;
          }
          acc -= len;
        }
      }
    }
    for (const f of m.furniture || []) {
      const fc = facing(f.x, f.y);
      const R = { bench: 0, fountain: 0.6, bin: 0.3, recycle: 1.2, postbox: 0.3 }[f.k];
      this.addProp({ x: f.x, y: f.y, a: fc.a, k: f.k }, R);
    }
    for (const s of m.busStops || []) {
      const fc = facing(s.x, s.y);
      let x = s.x, y = s.y;
      // si la parada está dibujada en mitad de la calle, la pasamos a la acera
      if (fc.nr && w.roadDist(x, y) < 0.8) {
        let nx = -fc.nr.uy, ny = fc.nr.ux;
        if ((x - fc.nr.qx) * nx + (y - fc.nr.qy) * ny < 0) { nx = -nx; ny = -ny; }
        // nos alejamos de la calle hasta quedar fuera de cualquier calzada
        for (let off = fc.nr.r.w / 2 + 1.6; off < fc.nr.r.w / 2 + 8; off += 0.5) {
          x = fc.nr.qx + nx * off; y = fc.nr.qy + ny * off;
          if (w.roadDist(x, y) > 0.8) break;
        }
      }
      if (w.isInsideBuilding(x, y)) { x = s.x; y = s.y; }
      // la marquesina mira hacia la calle
      let face = fc.a;
      if (fc.nr) { const nx = -fc.nr.uy, ny = fc.nr.ux, sgn = (fc.nr.qx - x) * nx + (fc.nr.qy - y) * ny > 0 ? 1 : -1; face = Math.atan2(ny * sgn, nx * sgn); }
      this.addProp({ x, y, a: fc.a, face, k: 'busstop', name: s.name }, 0.9);
    }
  }

  buildSignals(m) {
    const w = this.w, S = m.signals || [];
    this.sigNodes = new Map();
    this.ctrls = [];
    this.heads = [];
    for (let i = 0; i < S.length; i += 2) {
      const n = w.nearestNode(S[i], S[i + 1], false, 1);
      if (n < 0 || Math.hypot(w.nx[n] - S[i], w.ny[n] - S[i + 1]) > 12 || this.sigNodes.has(n)) continue;
      let ctrl = this.ctrls.find(c => Math.hypot(c.x - w.nx[n], c.y - w.ny[n]) < 40);
      if (!ctrl) {
        const e = w.carAdj[n][0] || w.undAdj[n][0];
        const axis = e ? Math.atan2(w.ny[e.to] - w.ny[n], w.nx[e.to] - w.nx[n]) : 0;
        ctrl = { x: w.nx[n], y: w.ny[n], axis, offset: Math.random() * CYCLE };
        this.ctrls.push(ctrl);
      }
      this.sigNodes.set(n, ctrl);
    }
    // cabezas de semáforo: una por cada calle que llega al nodo, a la derecha y mirando a los coches
    const incoming = new Map();
    for (let a = 0; a < w.nx.length; a++) for (const e of w.carAdj[a]) if (this.sigNodes.has(e.to)) {
      let l = incoming.get(e.to); if (!l) incoming.set(e.to, l = []); l.push({ from: a, r: e.r });
    }
    for (const [n, list] of incoming) {
      const ctrl = this.sigNodes.get(n);
      // ancho de la calle más ancha del cruce: el semáforo va antes de invadirla
      let maxW = 0; for (const e of w.undAdj[n]) { const r = w.nodeRoad[e.to]; if (r) maxW = Math.max(maxW, r.w); }
      for (const e of w.carAdj[n]) maxW = Math.max(maxW, e.r.w);
      for (const { from, r } of list.slice(0, 3)) {
        let dx = w.nx[n] - w.nx[from], dy = w.ny[n] - w.ny[from]; const L = Math.hypot(dx, dy);
        if (L < 4) continue; dx /= L; dy /= L;
        const off = r.w / 2 + 0.7;
        const back = Math.min(L - 1, Math.max(1.5, maxW / 2 + 1.2));
        const x = w.nx[n] - dx * back - dy * off, y = w.ny[n] - dy * back + dx * off;
        const heading = Math.atan2(dy, dx);
        this.heads.push({ x, y, a: heading + Math.PI, ctrl, grp: this.group(ctrl, heading), state: 'r' });
        if (w.roadDist(x, y) > 0.3) {
          const k = key(Math.floor(x / CG), Math.floor(y / CG));
          const p = { x, y, r: 0.15 }; let l = this.propGrid.get(k); if (!l) this.propGrid.set(k, l = []); l.push(p);
        }
      }
    }
  }

  group(ctrl, heading) { return Math.abs(Math.cos(heading - ctrl.axis)) > 0.7071 ? 0 : 1; }
  state(ctrl, heading, time) { return phase(((time + ctrl.offset) % CYCLE + CYCLE) % CYCLE, this.group(ctrl, heading)); }

  // Distancia hasta un semáforo en rojo/ámbar en el camino del coche (Infinity si no hay que parar)
  stopDistance(c, ai, remain, time) {
    const w = this.w;
    const check = (n, d, heading) => {
      const ctrl = this.sigNodes.get(n);
      if (!ctrl) return null;
      const st = this.state(ctrl, heading, time);
      if (st === 'g' || d < 4 || (st === 'y' && d < 12)) return Infinity;
      return d;
    };
    const h1 = Math.atan2(w.ny[ai.to] - w.ny[ai.from], w.nx[ai.to] - w.nx[ai.from]);
    let r = check(ai.to, remain, h1);
    if (r !== null) return r;
    if (ai.next) {
      const L = Math.hypot(w.nx[ai.next.to] - w.nx[ai.to], w.ny[ai.next.to] - w.ny[ai.to]);
      r = check(ai.next.to, remain + L, Math.atan2(w.ny[ai.next.to] - w.ny[ai.to], w.nx[ai.next.to] - w.nx[ai.to]));
      if (r !== null) return r;
    }
    return Infinity;
  }

  buildCrossings(m) {
    const w = this.w;
    this.crossings = [];
    for (const p of m.crossWays || []) {
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x = (p[i] + p[i + 2]) / 2, y = (p[i + 1] + p[i + 3]) / 2, len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        if (len < 2) continue;
        const nr = this.nearestRoad(x, y, true);
        if (!nr || nr.d > nr.r.w / 2 + 2) continue;
        this.crossings.push({ x: nr.qx, y: nr.qy, a: Math.atan2(nr.uy, nr.ux), w: nr.r.w });
      }
    }
    const C = m.crossNodes || [];
    for (let i = 0; i < C.length; i += 2) {
      if (this.crossings.some(c => Math.abs(c.x - C[i]) < 5 && Math.abs(c.y - C[i + 1]) < 5)) continue;
      const nr = this.nearestRoad(C[i], C[i + 1], true);
      if (!nr || nr.d > 3) continue;
      this.crossings.push({ x: nr.qx, y: nr.qy, a: Math.atan2(nr.uy, nr.ux), w: nr.r.w });
    }
    for (const c of this.crossings) w.insertTiles([c.x, c.y, c.x, c.y], c.w, 'cross', c);
  }

  // Paso de cebra: franjas blancas paralelas a la calle, repartidas a lo ancho
  static drawCrossing(g, c) {
    g.save(); g.translate(c.x, c.y); g.rotate(c.a);
    g.fillStyle = 'rgba(245,245,240,.92)';
    for (let k = -c.w / 2 + 0.3; k < c.w / 2 - 0.3; k += 1.0) g.fillRect(-1.5, k, 3, 0.5);
    g.restore();
  }

  buildTrain(m) {
    const chains = chainLines(m.rails || []);
    let best = null;
    for (const c of chains) { const p = new Path(c); if (p.len > 500 && (!best || p.len > best.len)) best = p; }
    this.train = null;
    if (!best) return;
    const st = (m.pois || []).filter(p => p.kind === 'station').map(p => best.project(p.x, p.y)).filter(q => q.d < 80).map(q => q.s)
      .filter(s => s > 40 && s < best.len - 40).sort((a, b) => a - b);
    this.train = { path: best, stations: st, s: Math.min(best.len - 70, 70), dir: 1, v: 0, wait: 3, cars: 3, carLen: 20 };
  }

  // Posición de cada vagón del tren
  trainCars() {
    const T = this.train; if (!T) return [];
    const out = [];
    for (let k = 0; k < T.cars; k++) {
      const s = T.s - T.dir * (k * (T.carLen + 0.6) + T.carLen / 2);
      const p = T.path.at(s);
      out.push({ x: p.x, y: p.y, a: p.a, l: T.carLen, w: 2.9, k });
    }
    return out;
  }

  update(game, dt) {
    this.time = game.time;
    // semáforos
    for (const h of this.heads) h.state = this.state(h.ctrl, h.a + Math.PI, game.time);
    this.updateTrain(game, dt);
  }

  updateTrain(game, dt) {
    const T = this.train; if (!T) return;
    if (T.wait > 0) { T.wait -= dt; return; }
    const ahead = T.stations.filter(s => (s - T.s) * T.dir > 0.5).sort((a, b) => (a - b) * T.dir)[0];
    const total = T.cars * (T.carLen + 0.6);
    const end = T.dir > 0 ? T.path.len - 5 : 5;
    const goal = ahead !== undefined ? ahead : end;
    const remain = Math.abs(goal - T.s);
    const vmax = 16, brake = 0.9;
    const vTarget = Math.min(vmax, Math.sqrt(2 * brake * Math.max(0, remain - 0.5)));
    T.v += Math.max(-brake * 2, Math.min(0.7, (vTarget - T.v) * 2)) * dt;
    if (T.v < 0) T.v = 0;
    T.s += T.v * dt * T.dir;
    if (remain < 0.8 && T.v < 0.6) {
      T.v = 0; T.s = goal;
      if (ahead !== undefined) T.wait = 18;
      else { T.wait = 8; T.s -= T.dir * total; T.dir = -T.dir; } // final de vía: cambia de sentido (la cabeza pasa al otro extremo)
    }
    // atropellos: el tren empuja y hace daño
    if (T.v < 0.3) return;
    for (const car of this.trainCars()) {
      const ca = Math.cos(car.a), sa = Math.sin(car.a), hl = car.l / 2 + 0.3, hw = car.w / 2 + 0.3;
      const hit = (o, r) => {
        const ox = o.x - car.x, oy = o.y - car.y, lx = ox * ca + oy * sa, ly = -ox * sa + oy * ca;
        if (Math.abs(lx) > hl + r || Math.abs(ly) > hw + r) return false;
        const s = ly >= 0 ? 1 : -1, push = hw + r - Math.abs(ly) + 0.1;
        o.x += -sa * s * push; o.y += ca * s * push;
        return true;
      };
      for (const c of game.cars) if (!c.dead && hit(c, c.m.w / 2)) { game.damageCar(c, T.v * 3, c.x, c.y); c.vx += -Math.sin(car.a) * T.v; c.vy += Math.cos(car.a) * T.v; }
      for (const q of game.peds) if (q.state !== 'dead' && hit(q, 0.3)) game.killPed(q, Math.cos(car.a) * T.v * T.dir * 2, Math.sin(car.a) * T.v * T.dir * 2, false);
      if (!game.player.car && !game.dead && hit(game.player, 0.4)) game.hurtPlayer(T.v * 4);
    }
  }

  // ---------- 2D ----------
  draw2D(g, game, vis) {
    for (const h of this.heads) {
      if (!vis(h)) continue;
      g.fillStyle = '#222'; g.fillRect(h.x - 0.35, h.y - 0.35, 0.7, 0.7);
      g.fillStyle = h.state === 'g' ? '#3cff5a' : h.state === 'y' ? '#ffc21f' : '#ff3030';
      g.beginPath(); g.arc(h.x, h.y, 0.3, 0, TAU); g.fill();
    }
    for (const c of this.trainCars()) {
      if (!vis(c, 25)) continue;
      g.save(); g.translate(c.x, c.y); g.rotate(c.a);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-c.l / 2 + 0.4, -c.w / 2 + 0.5, c.l, c.w);
      g.fillStyle = '#eef0f0'; g.fillRect(-c.l / 2, -c.w / 2, c.l, c.w);
      g.fillStyle = '#ef7d00'; g.fillRect(-c.l / 2, -c.w / 2, c.l, 0.35); g.fillRect(-c.l / 2, c.w / 2 - 0.35, c.l, 0.35);
      g.fillStyle = '#9aa0a4'; g.fillRect(-c.l / 2 + 1.5, -0.6, c.l - 3, 1.2);
      g.restore();
    }
  }
}

City.Path = Path;
SB.City = City;
})();
