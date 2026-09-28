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
  sidewalk: '#d5cebf', asphalt: '#46484d', asphaltMajor: '#3e4045', ped: '#cdbfa3', path: '#c2ae8a',
  rail: '#6b5b4b',
};
const ROOFS = ['#9c8f84', '#a39486', '#8e8580', '#b09a88', '#998b7a', '#a8a39b', '#b8a48f', '#8f7f72', '#a0806e', '#b3aea4'];

function key(a, b) { return a * 100003 + b; }

class World {
  constructor(map) {
    this.map = map;
    this.bounds = map.bounds;
    this.tileFeatures = new Map();
    this.tileCache = new Map();
    this.buildings = [];
    this.bGrid = new Map();
    this.segGrid = new Map();
    this.buildIndex();
    this.buildGraph();
  }

  tileBucket(tx, ty) {
    const k = key(tx, ty);
    let b = this.tileFeatures.get(k);
    if (!b) { b = { roads: [], buildings: [], areas: [], waterLines: [], rails: [] }; this.tileFeatures.set(k, b); }
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
      const b = { pts: p, bb, color: hue };
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
      }
      if (!moved) break;
    }
    return res;
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
  renderTile(tx, ty) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE * TS;
    const g = c.getContext('2d');
    g.fillStyle = COLORS.ground; g.fillRect(0, 0, c.width, c.height);
    g.setTransform(TS, 0, 0, TS, -tx * TILE * TS, -ty * TILE * TS);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const f = this.tileFeatures.get(key(tx, ty));
    if (!f) return c;
    const pathOf = (p) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); };

    const order = ['farm', 'green', 'wood', 'cemetery', 'pitch', 'sand', 'plaza', 'water'];
    const areas = f.areas.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const a of areas) {
      g.beginPath();
      for (const ring of a.rings) { g.moveTo(ring[0], ring[1]); for (let i = 2; i < ring.length; i += 2) g.lineTo(ring[i], ring[i + 1]); g.closePath(); }
      g.fillStyle = COLORS[a.kind] || COLORS.green; g.fill('evenodd');
      if (a.kind === 'pitch') { g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 0.4; g.stroke(); }
      if (a.kind === 'farm') { g.save(); g.clip('evenodd'); g.strokeStyle = 'rgba(80,100,40,.25)'; g.lineWidth = 0.6; for (let i = -TILE; i < TILE * 2; i += 3) { g.beginPath(); g.moveTo(tx * TILE + i, ty * TILE); g.lineTo(tx * TILE + i + 40, ty * TILE + TILE); g.stroke(); } g.restore(); }
    }
    for (const w of f.waterLines) { pathOf(w.pts); g.strokeStyle = COLORS.water; g.lineWidth = w.w; g.stroke(); }

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
    return c;
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
      g.fillStyle = a.kind === 'water' ? '#2f6aa0' : a.kind === 'plaza' ? '#6d6a60' : a.kind === 'sand' ? '#9e9670' : '#3e6a36';
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

function segDist2(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  let t = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return (x - x1 - dx * t) ** 2 + (y - y1 - dy * t) ** 2;
}

SB.World = World;
SB.segDist2 = segDist2;
})();
