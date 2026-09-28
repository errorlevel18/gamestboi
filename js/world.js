// Mundo: índices espaciales, grafo de calles, colisiones y render del mapa en teselas
'use strict';
(function () {
const SB = window.SB;

const TILE = 128;        // metros por tesela
const TS = 5;            // píxeles por metro en la tesela
const CG = 32;           // celda de colisión (m)

const COLORS = {
  ground: '#b3ab9a', water: '#3d78b0', green: '#7fa65a', wood: '#5f8a45', farm: '#a9b16a',
  pitch: '#5a9a4e', sand: '#e0d3a2', cemetery: '#8d9d78', plaza: '#cdc5b3',
  park: '#86b45f', playground: '#d9c38f', orchard: '#9fb562', scrub: '#7d9a55', wetland: '#7fa38a',
  sidewalk: '#d5cebf', asphalt: '#46484d', asphaltMajor: '#3e4045', ped: '#cdbfa3', path: '#c2ae8a',
  rail: '#6b5b4b',
};
const ROOFS = ['#9c8f84', '#a39486', '#8e8580', '#b09a88', '#998b7a', '#a8a39b', '#b8a48f', '#8f7f72', '#a0806e', '#b3aea4'];

function key(a, b) { return a * 100003 + b; }
const TAU2 = Math.PI * 2;

class World {
  constructor(map) {
    this.map = map;
    this.bounds = map.bounds;
    this.tileFeatures = new Map();
    this.tileCache = new Map();
    this.buildings = [];
    this.bGrid = new Map();
    this.segGrid = new Map();
    this.terrain = new SB.Terrain(map.source === 'fallback' ? null : SB.ELEVATION);
    this.buildIndex();
    this.buildTrees();
    this.buildGraph();
    this.city = new SB.City(this);
  }

  tileBucket(tx, ty) {
    const k = key(tx, ty);
    let b = this.tileFeatures.get(k);
    if (!b) { b = { roads: [], buildings: [], areas: [], waterLines: [], rails: [], trees: [], props: [], cross: [] }; this.tileFeatures.set(k, b); }
    return b;
  }
  insertTiles(bb, margin, list, item) {
    const tx0 = Math.floor((bb[0] - margin) / TILE), tx1 = Math.floor((bb[2] + margin) / TILE);
    const ty0 = Math.floor((bb[1] - margin) / TILE), ty1 = Math.floor((bb[3] + margin) / TILE);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 2500) return;
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) this.tileBucket(tx, ty)[list].push(item);
  }

  buildIndex() {
    const m = this.map;
    const bbox = (p) => {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        if (p[i] < a) a = p[i]; if (p[i] > c) c = p[i];
        if (p[i + 1] < b) b = p[i + 1]; if (p[i + 1] > d) d = p[i + 1];
      }
      return [a, b, c, d];
    };
    for (const a of m.areas) { a.bb = bbox(a.rings[0]); for (let i = 1; i < a.rings.length; i++) { const q = bbox(a.rings[i]); a.bb = [Math.min(a.bb[0], q[0]), Math.min(a.bb[1], q[1]), Math.max(a.bb[2], q[2]), Math.max(a.bb[3], q[3])]; } this.insertTiles(a.bb, 0, 'areas', a); }
    for (const w of m.waterLines) this.insertTiles(bbox(w.pts), w.w, 'waterLines', w);
    for (const r of m.rails) this.insertTiles(bbox(r), 4, 'rails', r);
    m.roads.forEach((r, ri) => {
      r.bb = bbox(r.pts);
      r.drive = r.rank >= 1 && r.type !== 'pedestrian';
      this.insertTiles(r.bb, r.w / 2 + 3, 'roads', r);
      // segmentos para buscar el nombre de la calle
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const x0 = Math.min(r.pts[i], r.pts[i + 2]), x1 = Math.max(r.pts[i], r.pts[i + 2]);
        const y0 = Math.min(r.pts[i + 1], r.pts[i + 3]), y1 = Math.max(r.pts[i + 1], r.pts[i + 3]);
        for (let cx = Math.floor(x0 / CG); cx <= Math.floor(x1 / CG); cx++)
          for (let cy = Math.floor(y0 / CG); cy <= Math.floor(y1 / CG); cy++) {
            const k = key(cx, cy); let l = this.segGrid.get(k); if (!l) this.segGrid.set(k, l = []);
            l.push(ri, i);
          }
      }
    });
    m.buildings.forEach((p, i) => {
      const bb = bbox(p);
      const hue = ROOFS[(i * 2654435761 >>> 0) % ROOFS.length];
      const b = { pts: p, bb, color: hue, i };
      this.buildings.push(b);
      this.insertTiles(bb, 3, 'buildings', b);
      // no colisionamos con edificios enormes mal cerrados
      if ((bb[2] - bb[0]) * (bb[3] - bb[1]) > 400000) return;
      for (let cx = Math.floor(bb[0] / CG); cx <= Math.floor(bb[2] / CG); cx++)
        for (let cy = Math.floor(bb[1] / CG); cy <= Math.floor(bb[3] / CG); cy++) {
          const k = key(cx, cy); let l = this.bGrid.get(k); if (!l) this.bGrid.set(k, l = []);
          l.push(b);
        }
    });
  }

  // ---------- Árboles ----------
  // Árboles reales de OSM (natural=tree, tree_row) + relleno de parques, bosques y césped
  // donde OSM no tiene árboles sueltos. Tipos: 0 hoja ancha, 1 pino, 2 palmera, 3 arbusto, 4 frutal, 5 ciprés
  buildTrees() {
    const m = this.map, X = [], Yy = [], T = [], S = [];
    let seed = 12345;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const add = (x, y, t, s) => { X.push(x); Yy.push(y); T.push(t); S.push(s); };
    const real = m.trees || [];
    const realGrid = new Map();
    for (let i = 0; i < real.length; i += 3) {
      add(real[i], real[i + 1], real[i + 2], 0.8 + rnd() * 0.5);
      const k = key(Math.floor(real[i] / CG), Math.floor(real[i + 1] / CG));
      let l = realGrid.get(k); if (!l) realGrid.set(k, l = []); l.push(i);
    }
    const mobile = typeof SB.isMobile === 'function' && SB.isMobile();
    const cap = mobile ? 9000 : 30000;
    let filled = 0;
    const inArea = (a, x, y) => { let c = false; for (const r of a.rings) if (pointInPoly(x, y, r)) c = !c; return c; };
    const RULES = {
      park: [[1 / 230, [0, 0, 0, 1, 1, 2]], [1 / 700, [3]]],
      wood: [[1 / 75, [1, 1, 1, 0, 0]], [1 / 300, [3]]],
      scrub: [[1 / 45, [3]], [1 / 500, [1]]],
      green: [[1 / 900, [0]], [1 / 450, [3]]],
      cemetery: [[1 / 160, [5]]],
      wetland: [[1 / 300, [3]]],
    };
    for (const a of m.areas) {
      const bb = a.bb, area = (bb[2] - bb[0]) * (bb[3] - bb[1]);
      if (area < 150 || area > 4e6) continue;
      if (a.kind === 'orchard') {
        for (let x = bb[0] + 2.5; x < bb[2] && filled < cap; x += 5.5) for (let y = bb[1] + 2.5; y < bb[3] && filled < cap; y += 5.5)
          if (inArea(a, x, y) && !this.isInsideBuilding(x, y)) { add(x + rnd() - 0.5, y + rnd() - 0.5, 4, 0.8 + rnd() * 0.3); filled++; }
        continue;
      }
      const rules = RULES[a.kind];
      if (!rules) continue;
      // si en el parque ya hay árboles reales de OSM, rellenamos mucho menos
      let realN = 0;
      for (let cx = Math.floor(bb[0] / CG); cx <= Math.floor(bb[2] / CG); cx++)
        for (let cy = Math.floor(bb[1] / CG); cy <= Math.floor(bb[3] / CG); cy++)
          for (const i of realGrid.get(key(cx, cy)) || []) if (inArea(a, real[i], real[i + 1])) realN++;
      const factor = realN > area / 800 ? 0.15 : 1;
      for (const [dens, types] of rules) {
        const n = Math.min(3000, Math.round(area * dens * factor));
        for (let k = 0; k < n && filled < cap; k++) {
          const x = bb[0] + rnd() * (bb[2] - bb[0]), y = bb[1] + rnd() * (bb[3] - bb[1]);
          if (!inArea(a, x, y) || this.isInsideBuilding(x, y) || this.roadDist(x, y, true) < 1.3) continue;
          add(x, y, types[Math.floor(rnd() * types.length)], 0.75 + rnd() * 0.55);
          filled++;
        }
      }
    }
    const n = X.length;
    this.trees = { n, x: new Float32Array(X), y: new Float32Array(Yy), t: new Uint8Array(T), s: new Float32Array(S), real: real.length / 3 };
    this.treeGrid = new Map();
    for (let i = 0; i < n; i++) {
      const x = X[i], y = Yy[i];
      this.insertTiles([x, y, x, y], 3.5, 'trees', i);
      if (T[i] === 3) continue; // los arbustos no chocan
      const k = key(Math.floor(x / CG), Math.floor(y / CG));
      let l = this.treeGrid.get(k); if (!l) this.treeGrid.set(k, l = []); l.push(i);
    }
  }

  // ---------- Grafo de calles ----------
  buildGraph() {
    const idx = new Map();
    const nx = [], ny = [], carAdj = [], pedAdj = [], undAdj = [], nodeRoad = [];
    const node = (id, x, y, road) => {
      let i = idx.get(id);
      if (i === undefined) {
        i = nx.length; idx.set(id, i); nx.push(x); ny.push(y);
        carAdj.push([]); pedAdj.push([]); undAdj.push([]); nodeRoad.push(road);
      } else if (road.car && (!nodeRoad[i].car || (road.name && !nodeRoad[i].name) || road.rank > nodeRoad[i].rank)) nodeRoad[i] = road;
      return i;
    };
    for (const r of this.map.roads) {
      if (!r.ids || r.ids.length * 2 !== r.pts.length) continue;
      let prev = -1;
      for (let k = 0; k < r.ids.length; k++) {
        const i = node(r.ids[k], r.pts[k * 2], r.pts[k * 2 + 1], r);
        if (prev >= 0 && prev !== i) {
          const d = Math.hypot(nx[i] - nx[prev], ny[i] - ny[prev]);
          if (r.car) {
            if (r.oneway >= 0) carAdj[prev].push({ to: i, d, r });
            if (r.oneway <= 0) carAdj[i].push({ to: prev, d, r });
            undAdj[prev].push({ to: i, d }); undAdj[i].push({ to: prev, d });
          }
          if (r.type !== 'motorway' && r.type !== 'trunk' && !r.tunnel) {
            pedAdj[prev].push({ to: i, d, r }); pedAdj[i].push({ to: prev, d, r });
          }
        }
        prev = i;
      }
    }
    this.nx = nx; this.ny = ny; this.carAdj = carAdj; this.pedAdj = pedAdj; this.undAdj = undAdj; this.nodeRoad = nodeRoad;
    // índices de nodos útiles
    const carGrid = new Map(), pedGrid = new Map();
    this.carNodes = []; this.pedNodes = [];
    for (let i = 0; i < nx.length; i++) {
      const b = this.bounds;
      if (nx[i] < b.minx || nx[i] > b.maxx || ny[i] < b.miny || ny[i] > b.maxy) continue;
      const k = key(Math.floor(nx[i] / CG), Math.floor(ny[i] / CG));
      if (carAdj[i].length) { this.carNodes.push(i); let l = carGrid.get(k); if (!l) carGrid.set(k, l = []); l.push(i); }
      if (pedAdj[i].length) { this.pedNodes.push(i); let l = pedGrid.get(k); if (!l) pedGrid.set(k, l = []); l.push(i); }
    }
    this.carGrid = carGrid; this.pedGrid = pedGrid;
    this.dist = new Float32Array(nx.length).fill(Infinity);
  }

  nearestNode(x, y, ped, maxR = 4) {
    const grid = ped ? this.pedGrid : this.carGrid;
    const cx = Math.floor(x / CG), cy = Math.floor(y / CG);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
        if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
        const l = grid.get(key(i, j)); if (!l) continue;
        for (const n of l) { const d = (this.nx[n] - x) ** 2 + (this.ny[n] - y) ** 2; if (d < bd) { bd = d; best = n; } }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }

  // Dijkstra desde el jugador (lo usa la policía para perseguir)
  computeDistanceField(src) {
    const dist = this.dist; dist.fill(Infinity);
    if (src < 0) return;
    const heap = [[0, src]]; dist[src] = 0;
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u] || d > 3000) continue;
      for (const e of this.undAdj[u]) { const nd = d + e.d; if (nd < dist[e.to]) { dist[e.to] = nd; push([nd, e.to]); } }
    }
  }

  streetNameAt(x, y) {
    const cx = Math.floor(x / CG), cy = Math.floor(y / CG);
    let best = '', bd = 30 * 30, bestUnnamed = Infinity;
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      const l = this.segGrid.get(key(i, j)); if (!l) continue;
      for (let k = 0; k < l.length; k += 2) {
        const r = this.map.roads[l[k]], p = r.pts, s = l[k + 1];
        const d = segDist2(x, y, p[s], p[s + 1], p[s + 2], p[s + 3]);
        if (r.name) { if (d < bd) { bd = d; best = r.name; } } else if (d < bestUnnamed) bestUnnamed = d;
      }
    }
    return best;
  }

  // ---------- Colisiones ----------
  // Empuja un círculo fuera de los edificios. Devuelve la normal y profundidad del choque.
  collide(x, y, r) {
    const res = { x, y, hit: false, nx: 0, ny: 0, depth: 0 };
    for (let pass = 0; pass < 2; pass++) {
      const cx0 = Math.floor((res.x - r) / CG), cx1 = Math.floor((res.x + r) / CG);
      const cy0 = Math.floor((res.y - r) / CG), cy1 = Math.floor((res.y + r) / CG);
      let moved = false;
      const seen = new Set();
      for (let i = cx0; i <= cx1; i++) for (let j = cy0; j <= cy1; j++) {
        const l = this.bGrid.get(key(i, j)); if (!l) continue;
        for (const b of l) {
          if (seen.has(b)) continue; seen.add(b);
          const bb = b.bb;
          if (res.x + r < bb[0] || res.x - r > bb[2] || res.y + r < bb[1] || res.y - r > bb[3]) continue;
          const p = b.pts;
          let inside = false, bd = Infinity, bx = 0, by = 0;
          for (let k = 0, m = p.length - 2; k < p.length; m = k, k += 2) {
            const x1 = p[m], y1 = p[m + 1], x2 = p[k], y2 = p[k + 1];
            if ((y2 > res.y) !== (y1 > res.y) && res.x < (x1 - x2) * (res.y - y2) / (y1 - y2) + x2) inside = !inside;
            const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
            let t = L ? ((res.x - x1) * dx + (res.y - y1) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = x1 + dx * t, qy = y1 + dy * t, d = (res.x - qx) ** 2 + (res.y - qy) ** 2;
            if (d < bd) { bd = d; bx = qx; by = qy; }
          }
          const dist = Math.sqrt(bd);
          if (!inside && dist >= r) continue;
          let nx = (res.x - bx) / (dist || 1), ny = (res.y - by) / (dist || 1);
          if (inside) { nx = -nx; ny = -ny; }
          const depth = inside ? r + dist : r - dist;
          res.x += nx * (depth + 0.01); res.y += ny * (depth + 0.01);
          res.hit = true; res.nx = nx; res.ny = ny; res.depth = Math.max(res.depth, depth);
          moved = true;
        }
        const pl = this.city && this.city.propGrid.get(key(i, j));
        if (pl) for (const pr of pl) {
          const dx = res.x - pr.x, dy = res.y - pr.y, d = Math.hypot(dx, dy);
          if (d >= r + pr.r) continue;
          const nx = dx / (d || 1), ny = dy / (d || 1), depth = r + pr.r - d;
          res.x += nx * (depth + 0.01); res.y += ny * (depth + 0.01);
          res.hit = true; res.nx = nx; res.ny = ny; res.depth = Math.max(res.depth, depth);
          moved = true;
        }
        const tl = this.treeGrid && this.treeGrid.get(key(i, j)); if (!tl) continue;
        const T = this.trees;
        for (const ti of tl) {
          const tr = 0.3 * T.s[ti] + 0.05, dx = res.x - T.x[ti], dy = res.y - T.y[ti], d = Math.hypot(dx, dy);
          if (d >= r + tr) continue;
          const nx = dx / (d || 1), ny = dy / (d || 1), depth = r + tr - d;
          res.x += nx * (depth + 0.01); res.y += ny * (depth + 0.01);
          res.hit = true; res.nx = nx; res.ny = ny; res.depth = Math.max(res.depth, depth);
          moved = true;
        }
      }
      if (!moved) break;
    }
    return res;
  }

  // Distancia (m) desde un punto al borde de la calle más cercana
  roadDist(x, y, all) {
    const cx = Math.floor(x / CG), cy = Math.floor(y / CG);
    let best = Infinity;
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      const l = this.segGrid.get(key(i, j)); if (!l) continue;
      for (let k = 0; k < l.length; k += 2) {
        const r = this.map.roads[l[k]]; if (!all && !r.drive && r.type !== 'pedestrian') continue;
        const p = r.pts, s = l[k + 1];
        const d = Math.sqrt(segDist2(x, y, p[s], p[s + 1], p[s + 2], p[s + 3])) - r.w / 2;
        if (d < best) best = d;
      }
    }
    return best;
  }

  buildingsNear(x, y, r) {
    const out = new Set();
    for (let i = Math.floor((x - r) / CG); i <= Math.floor((x + r) / CG); i++)
      for (let j = Math.floor((y - r) / CG); j <= Math.floor((y + r) / CG); j++) {
        const l = this.bGrid.get(key(i, j)); if (l) for (const b of l) out.add(b);
      }
    return out;
  }

  buildingAt(x, y) {
    const l = this.bGrid.get(key(Math.floor(x / CG), Math.floor(y / CG)));
    if (!l) return null;
    for (const b of l) if (pointInPoly(x, y, b.pts, b.bb)) return b;
    return null;
  }

  isInsideBuilding(x, y) {
    const l = this.bGrid.get(key(Math.floor(x / CG), Math.floor(y / CG)));
    if (!l) return false;
    for (const b of l) {
      const bb = b.bb; if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
      const p = b.pts; let inside = false;
      for (let k = 0, m = p.length - 2; k < p.length; m = k, k += 2)
        if ((p[k + 1] > y) !== (p[m + 1] > y) && x < (p[m] - p[k]) * (y - p[k + 1]) / (p[m + 1] - p[k + 1]) + p[k]) inside = !inside;
      if (inside) return true;
    }
    return false;
  }

  // Línea de visión aproximada (muestreo)
  lineClear(x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(d / 3);
    for (let i = 1; i < n; i++) if (this.isInsideBuilding(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n)) return false;
    return true;
  }

  // ---------- Render ----------
  // groundOnly: sólo el suelo (para texturizar el terreno 3D), sin edificios ni árboles
  renderTile(tx, ty, ts = TS, groundOnly = false) {
    const c = document.createElement('canvas');
    c.width = c.height = Math.round(TILE * ts);
    const g = c.getContext('2d');
    g.fillStyle = COLORS.ground; g.fillRect(0, 0, c.width, c.height);
    g.setTransform(ts, 0, 0, ts, -tx * TILE * ts, -ty * TILE * ts);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const f = this.tileFeatures.get(key(tx, ty));
    if (!f) return c;
    const pathOf = (p) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); };

    const order = ['farm', 'orchard', 'green', 'scrub', 'wood', 'park', 'wetland', 'cemetery', 'pitch', 'playground', 'sand', 'plaza', 'water'];
    const areas = f.areas.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const a of areas) {
      g.beginPath();
      for (const ring of a.rings) { g.moveTo(ring[0], ring[1]); for (let i = 2; i < ring.length; i += 2) g.lineTo(ring[i], ring[i + 1]); g.closePath(); }
      g.fillStyle = COLORS[a.kind] || COLORS.green; g.fill('evenodd');
      if (a.kind === 'pitch') { g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 0.4; g.stroke(); }
      if (a.kind === 'farm' || a.kind === 'orchard') { g.save(); g.clip('evenodd'); g.strokeStyle = 'rgba(80,100,40,.25)'; g.lineWidth = 0.6; for (let i = -TILE; i < TILE * 2; i += 3) { g.beginPath(); g.moveTo(tx * TILE + i, ty * TILE); g.lineTo(tx * TILE + i + 40, ty * TILE + TILE); g.stroke(); } g.restore(); }
    }
    for (const w of f.waterLines) { pathOf(w.pts); g.strokeStyle = COLORS.water; g.lineWidth = w.w; g.stroke(); }
    // sombreado del relieve en la vista cenital (en 3D ya lo da la luz)
    if (!groundOnly && this.terrain.ok) this.hillshade(g, tx, ty);

    // aceras
    for (const r of f.roads) {
      if (!r.drive || r.tunnel) continue;
      pathOf(r.pts); g.strokeStyle = r.bridge ? '#8a8578' : COLORS.sidewalk; g.lineWidth = r.w + (r.rank >= 3 ? 4 : 1.5); g.stroke();
    }
    for (const r of f.roads) {
      if (r.tunnel) continue;
      pathOf(r.pts);
      g.strokeStyle = r.drive ? (r.rank >= 5 ? COLORS.asphaltMajor : COLORS.asphalt)
        : r.type === 'pedestrian' ? COLORS.ped : r.type === 'steps' ? '#b09a7c' : COLORS.path;
      g.lineWidth = r.w; g.stroke();
    }
    // marcas viales: líneas de borde y línea central discontinua
    for (const r of f.roads) {
      if (!r.car || r.tunnel || r.w < 9) continue;
      pathOf(r.pts);
      g.lineWidth = r.w - 1.2; g.strokeStyle = 'rgba(255,255,255,.28)'; g.stroke();
      g.lineWidth = r.w - 1.6; g.strokeStyle = r.rank >= 5 ? COLORS.asphaltMajor : COLORS.asphalt; g.stroke();
    }
    g.setLineDash([3, 4]);
    for (const r of f.roads) {
      if (!r.car || r.tunnel || r.w < 9 || r.oneway) continue;
      pathOf(r.pts); g.strokeStyle = 'rgba(240,235,210,.75)'; g.lineWidth = 0.3; g.stroke();
    }
    g.setLineDash([]);
    // vías del tren
    for (const p of f.rails) {
      pathOf(p); g.strokeStyle = '#8f8676'; g.lineWidth = 4; g.stroke();
      g.setLineDash([0.4, 0.9]); g.strokeStyle = '#5a4a3a'; g.lineWidth = 3; g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#3c3c3c'; g.lineWidth = 0.25;
      g.save(); g.lineWidth = 1.7; g.stroke(); g.lineWidth = 1.3; g.strokeStyle = '#7d705f'; g.stroke(); g.restore();
    }
    for (const cr of f.cross) SB.City.drawCrossing(g, cr);
    if (groundOnly) return c;
    // edificios: sombra y tejado
    g.fillStyle = 'rgba(0,0,0,.28)';
    for (const b of f.buildings) {
      g.beginPath(); const p = b.pts;
      g.moveTo(p[0] + 1.3, p[1] + 1.8); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] + 1.3, p[i + 1] + 1.8);
      g.fill();
    }
    for (const b of f.buildings) {
      pathOf(b.pts); g.closePath(); g.fillStyle = b.color; g.fill();
      g.strokeStyle = 'rgba(40,30,25,.45)'; g.lineWidth = 0.35; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1.2;
      g.save(); g.clip(); g.stroke(); g.restore();
    }
    // mobiliario urbano visto desde arriba
    for (const pr of f.props) {
      g.save(); g.translate(pr.x, pr.y); g.rotate(pr.a || 0);
      if (pr.k === 'lamp') { g.fillStyle = '#9aa0a6'; g.fillRect(0, -0.1, 1.4, 0.2); g.fillStyle = '#34383d'; g.beginPath(); g.arc(0, 0, 0.25, 0, TAU2); g.fill(); }
      else if (pr.k === 'bench') { g.fillStyle = '#8b5a2b'; g.fillRect(-0.9, -0.25, 1.8, 0.5); }
      else if (pr.k === 'recycle') { const cols = ['#2e7d32', '#f9c80e', '#1565c0', '#6d4c41']; cols.forEach((cc, k) => { g.fillStyle = cc; g.fillRect(-3.4 + k * 1.7, -0.6, 1.6, 1.2); }); }
      else if (pr.k === 'busstop') { g.rotate((pr.face || 0) - (pr.a || 0)); g.fillStyle = 'rgba(160,200,215,.9)'; g.fillRect(-0.8, -2, 1.6, 4); g.strokeStyle = '#333'; g.lineWidth = 0.15; g.strokeRect(-0.8, -2, 1.6, 4); }
      else { g.fillStyle = pr.k === 'postbox' ? '#f6c90e' : pr.k === 'fountain' ? '#2f4f3a' : '#3e4a3d'; g.fillRect(-0.3, -0.3, 0.6, 0.6); }
      g.restore();
    }
    // árboles vistos desde arriba
    const T = this.trees;
    if (T && f.trees.length) {
      const R = [2.3, 2.7, 1.9, 1.0, 1.4, 0.9];
      const CC = [['#4f7d3a', '#5b8c3e', '#446e33', '#628f3f'], ['#3b6536', '#44703c'], ['#5d8a3a'], ['#5e8a45', '#6b9444'], ['#6f9a45'], ['#2f5a2f']];
      g.fillStyle = 'rgba(0,0,0,.25)';
      for (const i of f.trees) { g.beginPath(); g.arc(T.x[i] + 0.8, T.y[i] + 1.1, R[T.t[i]] * T.s[i], 0, TAU2); g.fill(); }
      for (const i of f.trees) {
        const t = T.t[i], r = R[t] * T.s[i], x = T.x[i], y = T.y[i], cols = CC[t];
        g.fillStyle = cols[i % cols.length];
        if (t === 2) { // palmera: estrella de hojas
          g.beginPath();
          for (let k = 0; k < 14; k++) { const a = k / 14 * TAU2 + i, rr = k % 2 ? r * 0.35 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
          g.fill();
        } else {
          g.beginPath(); g.arc(x, y, r, 0, TAU2); g.fill();
          g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, TAU2); g.fill();
        }
      }
    }
    return c;
  }

  hillshade(g, tx, ty) {
    const N = 17, st = TILE / (N - 1), T = this.terrain;
    const hc = document.createElement('canvas'); hc.width = hc.height = N;
    const hg = hc.getContext('2d'), img = hg.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = tx * TILE + i * st, y = ty * TILE + j * st;
      const dx = T.at(x + 4, y) - T.at(x - 4, y), dy = T.at(x, y + 4) - T.at(x, y - 4);
      const s = Math.max(-1, Math.min(1, (dx + dy) * 0.12));
      const k = (j * N + i) * 4;
      if (s > 0) { img.data[k] = img.data[k + 1] = img.data[k + 2] = 0; img.data[k + 3] = s * 110; }
      else { img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = -s * 70; }
    }
    hg.putImageData(img, 0, 0);
    g.save(); g.imageSmoothingEnabled = true;
    g.drawImage(hc, 0, 0, N, N, tx * TILE - st / 2, ty * TILE - st / 2, TILE + st, TILE + st);
    g.restore();
  }

  getTile(tx, ty, budget) {
    const k = key(tx, ty);
    let t = this.tileCache.get(k);
    if (t) { t.used = performance.now(); return t.c; }
    if (budget.n <= 0) return null;
    budget.n--;
    t = { c: this.renderTile(tx, ty), used: performance.now() };
    this.tileCache.set(k, t);
    if (this.tileCache.size > 60) {
      let oldK, oldT = Infinity;
      for (const [kk, v] of this.tileCache) if (v.used < oldT) { oldT = v.used; oldK = kk; }
      this.tileCache.delete(oldK);
    }
    return t.c;
  }

  drawGround(ctx, cam, W, H) {
    const Z = cam.z;
    const x0 = cam.x - W / 2 / Z, y0 = cam.y - H / 2 / Z, x1 = cam.x + W / 2 / Z, y1 = cam.y + H / 2 / Z;
    const budget = { n: 3 };
    ctx.fillStyle = COLORS.ground; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    // teselas del centro primero
    const list = [];
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++)
      for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++)
        list.push([tx, ty, ((tx + 0.5) * TILE - cam.x) ** 2 + ((ty + 0.5) * TILE - cam.y) ** 2]);
    list.sort((a, b) => a[2] - b[2]);
    for (const [tx, ty] of list) {
      const c = this.getTile(tx, ty, budget);
      if (!c) continue;
      const sx = Math.floor((tx * TILE - cam.x) * Z + W / 2), sy = Math.floor((ty * TILE - cam.y) * Z + H / 2);
      const sz = Math.ceil(TILE * Z) + 1;
      ctx.drawImage(c, sx, sy, sz, sz);
    }
    // precarga alrededor
    if (budget.n > 0) {
      for (let tx = Math.floor(x0 / TILE) - 1; tx <= Math.floor(x1 / TILE) + 1 && budget.n > 0; tx++)
        for (let ty = Math.floor(y0 / TILE) - 1; ty <= Math.floor(y1 / TILE) + 1 && budget.n > 0; ty++)
          this.getTile(tx, ty, budget);
    }
  }

  // Minimapa pre-renderizado
  buildMinimap() {
    const b = this.bounds, S = 0.35;
    const c = document.createElement('canvas');
    c.width = Math.ceil((b.maxx - b.minx) * S); c.height = Math.ceil((b.maxy - b.miny) * S);
    const g = c.getContext('2d');
    g.fillStyle = '#2b2f2a'; g.fillRect(0, 0, c.width, c.height);
    g.setTransform(S, 0, 0, S, -b.minx * S, -b.miny * S);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const a of this.map.areas) {
      g.beginPath();
      for (const ring of a.rings) { g.moveTo(ring[0], ring[1]); for (let i = 2; i < ring.length; i += 2) g.lineTo(ring[i], ring[i + 1]); g.closePath(); }
      g.fillStyle = a.kind === 'water' ? '#2f6aa0' : a.kind === 'plaza' ? '#6d6a60' : a.kind === 'sand' || a.kind === 'playground' ? '#9e9670'
        : a.kind === 'farm' || a.kind === 'orchard' ? '#56672f' : a.kind === 'park' ? '#44803a' : '#3e6a36';
      g.fill('evenodd');
    }
    for (const w of this.map.waterLines) { g.beginPath(); g.moveTo(w.pts[0], w.pts[1]); for (let i = 2; i < w.pts.length; i += 2) g.lineTo(w.pts[i], w.pts[i + 1]); g.strokeStyle = '#2f6aa0'; g.lineWidth = w.w; g.stroke(); }
    g.fillStyle = '#4b4843';
    for (const p of this.map.buildings) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.fill(); }
    for (const r of this.map.roads) {
      if (r.tunnel) continue;
      g.beginPath(); g.moveTo(r.pts[0], r.pts[1]); for (let i = 2; i < r.pts.length; i += 2) g.lineTo(r.pts[i], r.pts[i + 1]);
      g.strokeStyle = r.drive ? (r.rank >= 5 ? '#e8d9a0' : '#bdb8ab') : '#8a8069';
      g.lineWidth = r.car ? Math.max(r.w, 7) : 2.5; g.stroke();
    }
    for (const p of this.map.rails) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.strokeStyle = '#a0643c'; g.lineWidth = 4; g.stroke(); }
    this.minimap = { c, S };
    return this.minimap;
  }
}

function pointInPoly(x, y, p, bb) {
  if (bb && (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3])) return false;
  let inside = false;
  for (let k = 0, m = p.length - 2; k < p.length; m = k, k += 2)
    if ((p[k + 1] > y) !== (p[m + 1] > y) && x < (p[m] - p[k]) * (y - p[k + 1]) / (p[m + 1] - p[k + 1]) + p[k]) inside = !inside;
  return inside;
}

function segDist2(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  let t = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return (x - x1 - dx * t) ** 2 + (y - y1 - dy * t) ** 2;
}

SB.World = World;
SB.TILE = TILE;
SB.segDist2 = segDist2;
SB.pointInPoly = pointInPoly;
})();
