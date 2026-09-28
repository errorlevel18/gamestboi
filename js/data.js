// Descarga y procesado del mapa de Sant Boi de Llobregat (OpenStreetMap / Overpass API)
'use strict';
const SB = window.SB = window.SB || {};

// Área de juego: casco urbano de Sant Boi de Llobregat
SB.BBOX = { s: 41.3265, w: 2.0130, n: 41.3600, e: 2.0580 };
SB.ORIGIN = { lat: 41.3435, lon: 2.0355 };

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const CACHE_KEY = 'santboi-map-v3';

function buildQuery(b) {
  const bb = `${b.s},${b.w},${b.n},${b.e}`;
  return `[out:json][timeout:120];
(
  way["highway"](${bb});
  way["building"](${bb});
  way["leisure"~"^(park|garden|pitch|playground|stadium|sports_centre|track)$"](${bb});
  way["landuse"~"^(grass|forest|meadow|farmland|orchard|recreation_ground|cemetery|village_green|allotments|vineyard)$"](${bb});
  way["natural"~"^(water|wood|scrub|grassland|beach|sand|wetland)$"](${bb});
  way["waterway"~"^(river|riverbank|canal|stream)$"](${bb});
  way["railway"~"^(rail|light_rail|narrow_gauge)$"](${bb});
  relation["type"="multipolygon"]["natural"~"^(water|wood|scrub)$"](${bb});
  relation["type"="multipolygon"]["landuse"~"^(forest|grass|meadow|farmland|cemetery)$"](${bb});
  relation["type"="multipolygon"]["leisure"~"^(park|garden)$"](${bb});
  relation["type"="multipolygon"]["waterway"="riverbank"](${bb});
  node["name"]["amenity"~"^(townhall|hospital|police|fire_station|marketplace|place_of_worship|library|theatre|cinema|university|college|bus_station)$"](${bb});
  node["name"]["railway"="station"](${bb});
  node["name"]["place"~"^(suburb|neighbourhood|quarter|town)$"](${bb});
  node["name"]["tourism"~"^(museum|attraction|artwork)$"](${bb});
  way["name"]["amenity"~"^(townhall|hospital|police|marketplace|place_of_worship|school)$"](${bb});
  way["building:part"](${bb});
  node["name"]["shop"](${bb});
  way["name"]["shop"](${bb});
  node["name"]["amenity"~"^(bar|restaurant|cafe|pharmacy|bank|fast_food|pub|ice_cream|post_office|fuel|clinic|dentist|veterinary|driving_school|kindergarten|school)$"](${bb});
);
out geom;`;
}

// ---------- Proyección lat/lon -> metros ----------
const KX = 111320 * Math.cos(SB.ORIGIN.lat * Math.PI / 180);
const KY = 110540;
function px(lon) { return Math.round((lon - SB.ORIGIN.lon) * KX * 10) / 10; }
function py(lat) { return Math.round((SB.ORIGIN.lat - lat) * KY * 10) / 10; }

const ROAD_W = {
  motorway: 15, trunk: 13, primary: 12, secondary: 11, tertiary: 9.5,
  motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 7,
  unclassified: 7.5, residential: 7.5, living_street: 6, service: 4.5, road: 7,
  pedestrian: 7, footway: 2.5, path: 2.2, cycleway: 2.5, steps: 2.5, track: 3.5, bridleway: 2.5,
};
const CAR_TYPES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link',
  'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'unclassified', 'residential',
  'living_street', 'service', 'road']);
const ROAD_RANK = { footway: 0, path: 0, cycleway: 0, steps: 0, track: 0, bridleway: 0, service: 1,
  pedestrian: 2, living_street: 2, residential: 3, unclassified: 3, road: 3, tertiary_link: 3,
  secondary_link: 3, primary_link: 3, trunk_link: 3, motorway_link: 3, tertiary: 4, secondary: 5,
  primary: 6, trunk: 7, motorway: 8 };

function areaKind(t) {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') return 'water';
  if (t.natural === 'beach' || t.natural === 'sand') return 'sand';
  if (t.leisure === 'pitch' || t.leisure === 'stadium' || t.leisure === 'track') return 'pitch';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (t.landuse === 'farmland' || t.landuse === 'orchard' || t.landuse === 'allotments' || t.landuse === 'vineyard') return 'farm';
  if (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub') return 'wood';
  if (t.leisure || t.landuse || t.natural) return 'green';
  return null;
}

const SHOP_AMENITIES = new Set(['bar', 'restaurant', 'cafe', 'pharmacy', 'bank', 'fast_food', 'pub', 'ice_cream', 'post_office',
  'fuel', 'clinic', 'dentist', 'veterinary', 'driving_school']);
function shopKind(s) {
  if (s === 'supermarket' || s === 'convenience' || s === 'greengrocer' || s === 'butcher' || s === 'bakery' || s === 'pastry' || s === 'deli' || s === 'seafood') return 'food';
  if (s === 'hairdresser' || s === 'beauty') return 'hair';
  return 'shop';
}
// Tipo de edificio para elegir fachada
function buildingKind(t) {
  const b = t.building, a = t.amenity;
  if (b === 'church' || b === 'chapel' || b === 'cathedral' || a === 'place_of_worship') return 'church';
  if (b === 'school' || b === 'university' || b === 'college' || b === 'kindergarten' || a === 'school' || a === 'kindergarten') return 'school';
  if (b === 'industrial' || b === 'warehouse' || b === 'factory' || b === 'hangar') return 'industrial';
  if (b === 'house' || b === 'detached' || b === 'semidetached_house' || b === 'terrace' || b === 'bungalow') return 'house';
  if (b === 'garage' || b === 'garages' || b === 'shed' || b === 'roof' || b === 'hut' || b === 'kiosk') return 'shed';
  if (b === 'retail' || b === 'supermarket' || b === 'commercial' || b === 'office') return 'commercial';
  if (a === 'townhall' || b === 'public' || b === 'civic' || b === 'government' || a === 'hospital' || b === 'hospital' || b === 'sports_hall' || b === 'stadium') return 'public';
  return '';
}

// Altura del edificio en metros (0 = desconocida)
function buildingHeight(t) {
  const h = parseFloat(t.height);
  if (h > 0) return Math.min(h, 120);
  const lv = parseFloat(t['building:levels']);
  if (lv > 0) return Math.min(lv * 3.1 + 0.8, 120);
  const b = t.building;
  if (b === 'garage' || b === 'garages' || b === 'shed' || b === 'roof' || b === 'hut' || b === 'kiosk') return 3.5;
  if (b === 'house' || b === 'detached' || b === 'semidetached_house' || b === 'terrace') return 8;
  if (b === 'industrial' || b === 'warehouse' || b === 'retail' || b === 'supermarket') return 9;
  if (b === 'church' || b === 'cathedral') return 18;
  return 0;
}

function geomToFlat(g) {
  const out = new Array(g.length * 2);
  for (let i = 0; i < g.length; i++) { out[i * 2] = px(g[i].lon); out[i * 2 + 1] = py(g[i].lat); }
  return out;
}

// Une los miembros "outer"/"inner" de una multipolígono en anillos cerrados
function assembleRings(members) {
  const segs = members.filter(m => m.type === 'way' && m.geometry && m.geometry.length > 1)
    .map(m => m.geometry.map(p => [p.lon, p.lat]));
  const rings = [];
  const eq = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (!eq(ring[0], ring[ring.length - 1]) && guard++ < 5000) {
      const end = ring[ring.length - 1];
      let found = -1, rev = false;
      for (let i = 0; i < segs.length; i++) {
        if (eq(segs[i][0], end)) { found = i; break; }
        if (eq(segs[i][segs[i].length - 1], end)) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      let s = segs.splice(found, 1)[0];
      if (rev) s = s.slice().reverse();
      ring = ring.concat(s.slice(1));
    }
    const flat = [];
    for (const p of ring) flat.push(px(p[0]), py(p[1]));
    if (flat.length >= 6) rings.push(flat);
  }
  return rings;
}

// Convierte la respuesta de Overpass en el formato interno del juego
SB.processOSM = function (osm) {
  const map = { roads: [], buildings: [], areas: [], waterLines: [], rails: [], pois: [], places: [], bh: [], bk: [], shops: [], source: 'osm' };
  const parts = [];
  const centroid = (pts) => { let cx = 0, cy = 0; const n = pts.length / 2; for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; } return [cx / n, cy / n]; };
  for (const el of osm.elements || []) {
    const t = el.tags || {};
    if (el.type === 'node') {
      if (!t.name) continue;
      if (t.place) { map.places.push({ x: px(el.lon), y: py(el.lat), name: t.name, big: t.place === 'town' }); continue; }
      if (t.shop || SHOP_AMENITIES.has(t.amenity)) { map.shops.push({ x: px(el.lon), y: py(el.lat), name: t.name, kind: t.shop ? shopKind(t.shop) : t.amenity }); continue; }
      let kind = t.amenity || (t.railway === 'station' ? 'station' : t.tourism) || 'poi';
      map.pois.push({ x: px(el.lon), y: py(el.lat), name: t.name, kind });
      continue;
    }
    if (el.type === 'relation') {
      const kind = areaKind(t);
      if (!kind || !el.members) continue;
      const rings = assembleRings(el.members);
      if (rings.length) map.areas.push({ kind, rings });
      continue;
    }
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const pts = geomToFlat(el.geometry);
    const closed = el.nodes && el.nodes.length > 3 && el.nodes[0] === el.nodes[el.nodes.length - 1];

    if (t.highway) {
      const type = t.highway;
      if (!(type in ROAD_W)) continue;
      if (t.area === 'yes' && closed) { map.areas.push({ kind: 'plaza', rings: [pts] }); continue; }
      let oneway = 0;
      if (t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.junction === 'circular' || type === 'motorway') oneway = 1;
      if (t.oneway === '-1') oneway = -1;
      let w = ROAD_W[type];
      const lanes = parseInt(t.lanes, 10);
      if (CAR_TYPES.has(type) && lanes > 0) w = Math.max(w * 0.6, Math.min(lanes * 3.4 + 1, 20));
      map.roads.push({
        pts, ids: el.nodes, type, w, oneway,
        name: t.name || t.ref || '', car: CAR_TYPES.has(type) && t.access !== 'no' && t.service !== 'parking_aisle' ? 1 : 0,
        rank: ROAD_RANK[type] || 0, tunnel: t.tunnel === 'yes' || t.tunnel === 'building_passage' ? 1 : 0,
        bridge: t.bridge === 'yes' ? 1 : 0,
      });
      continue;
    }
    if (t['building:part'] && closed && !t.building) {
      const h = buildingHeight(t);
      if (h) { const [cx, cy] = centroid(pts); parts.push([cx, cy, h]); }
      continue;
    }
    if (t.building && closed) {
      map.buildings.push(pts);
      map.bh.push(buildingHeight(t));
      map.bk.push(buildingKind(t));
      if (t.name) {
        const [cx, cy] = centroid(pts);
        if (t.shop) map.shops.push({ x: cx, y: cy, name: t.name, kind: shopKind(t.shop) });
        else map.pois.push({ x: cx, y: cy, name: t.name, kind: t.amenity || (t.building === 'church' ? 'place_of_worship' : 'building') });
      }
      continue;
    }
    if (t.shop && t.name && closed) {
      const [cx, cy] = centroid(pts);
      map.shops.push({ x: cx, y: cy, name: t.name, kind: shopKind(t.shop) });
      continue;
    }
    if (t.railway) { if (t.tunnel !== 'yes') map.rails.push(pts); continue; }
    if (t.waterway && t.waterway !== 'riverbank' && !closed) {
      map.waterLines.push({ pts, w: t.waterway === 'river' ? 35 : t.waterway === 'canal' ? 8 : 3 });
      continue;
    }
    const kind = areaKind(t);
    if (kind && closed) {
      map.areas.push({ kind, rings: [pts] });
      if (t.name && (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'stadium' || t.leisure === 'sports_centre' || t.landuse === 'cemetery')) {
        const [cx, cy] = centroid(pts);
        map.pois.push({ x: cx, y: cy, name: t.name, kind: t.leisure === 'stadium' || t.leisure === 'sports_centre' ? 'stadium' : t.landuse === 'cemetery' ? 'cemetery' : 'park' });
      }
    } else if (t.amenity && t.name && closed) {
      const [cx, cy] = centroid(pts);
      map.pois.push({ x: cx, y: cy, name: t.name, kind: t.amenity });
    }
  }
  // alturas de las partes de edificio (Catastro) -> edificio que las contiene
  if (parts.length) {
    const G = 40, grid = new Map();
    map.buildings.forEach((p, i) => {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (let k = 0; k < p.length; k += 2) { a = Math.min(a, p[k]); c = Math.max(c, p[k]); b = Math.min(b, p[k + 1]); d = Math.max(d, p[k + 1]); }
      if ((c - a) * (d - b) > 400000) return;
      for (let x = Math.floor(a / G); x <= Math.floor(c / G); x++) for (let y = Math.floor(b / G); y <= Math.floor(d / G); y++) {
        const k = x + ',' + y; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i);
      }
    });
    for (const [x, y, h] of parts) {
      const l = grid.get(Math.floor(x / G) + ',' + Math.floor(y / G)); if (!l) continue;
      for (const i of l) {
        const p = map.buildings[i]; let inside = false;
        for (let k = 0, j = p.length - 2; k < p.length; j = k, k += 2)
          if ((p[k + 1] > y) !== (p[j + 1] > y) && x < (p[j] - p[k]) * (y - p[k + 1]) / (p[j + 1] - p[k + 1]) + p[k]) inside = !inside;
        if (inside) { if (h > map.bh[i]) map.bh[i] = h; break; }
      }
    }
  }
  map.roads.sort((a, b) => a.rank - b.rank);
  map.bounds = {
    minx: px(SB.BBOX.w), maxx: px(SB.BBOX.e), miny: py(SB.BBOX.n), maxy: py(SB.BBOX.s),
  };
  return map;
};

async function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(id); }
}

SB.downloadMap = async function (onStatus) {
  const body = 'data=' + encodeURIComponent(buildQuery(SB.BBOX));
  let lastErr;
  for (const url of MIRRORS) {
    const host = new URL(url).host;
    try {
      onStatus(`Descargando calles de Sant Boi desde ${host}…`);
      const res = await fetchWithTimeout(url, {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }, 150000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      onStatus('Procesando mapa…');
      const json = await res.json();
      if (!json.elements || json.elements.length < 50) throw new Error('respuesta vacía');
      return SB.processOSM(json);
    } catch (e) {
      lastErr = e;
      console.warn('Overpass', host, e);
    }
  }
  throw lastErr || new Error('sin conexión');
};

// Caché en IndexedDB (el mapa real puede ocupar varios MB, demasiado para localStorage)
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('santboi-gta', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('maps');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
SB.loadCachedMap = async function () {
  try {
    const db = await idb();
    const m = await new Promise((res, rej) => { const r = db.transaction('maps').objectStore('maps').get(CACHE_KEY); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return m && m.roads && m.roads.length ? m : null;
  } catch (e) { return null; }
};
SB.saveCachedMap = async function (map) {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const t = db.transaction('maps', 'readwrite'); t.objectStore('maps').put(map, CACHE_KEY); t.oncomplete = res; t.onerror = () => rej(t.error); });
    return true;
  } catch (e) { return false; }
};
SB.clearCachedMap = async function () {
  try { const db = await idb(); db.transaction('maps', 'readwrite').objectStore('maps').delete(CACHE_KEY); } catch (e) { /* nada */ }
};

// ---------- Mapa de reserva (sin conexión) ----------
// Cuadrícula aproximada inspirada en Sant Boi, por si no se puede descargar OSM.
SB.fallbackMap = function () {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const names = ['Carrer Major', 'Carrer de Jaume I', 'Rambla de Rafael Casanova', 'Carrer de Pau Claris',
    'Carrer de Mallorca', 'Carrer de Lluís Castells', 'Carrer de Francesc Macià', 'Carrer de Sant Josep',
    'Carrer de Barcelona', 'Carrer de Girona', 'Carrer de Lleida', 'Carrer de Tarragona', 'Carrer de Valencia',
    'Carrer de la Pau', 'Carrer de Pi i Margall', 'Carrer de Joan Maragall', 'Avinguda de Catalunya',
    'Carrer de Montserrat', 'Carrer del Mar', 'Carrer de Sant Ramon'];
  const map = { roads: [], buildings: [], areas: [], waterLines: [], rails: [], pois: [], places: [{ x: 0, y: 0, name: 'Sant Boi (mapa aproximado)' }], source: 'fallback' };
  const N = 13, S = 110, off = -N * S / 2;
  const id = (i, j) => i * 1000 + j + 1;
  const X = (i, j) => off + i * S + Math.sin(j * 0.7) * 8;
  const Y = (i, j) => off + j * S + Math.cos(i * 0.9) * 8;
  for (let j = 0; j <= N; j++) {
    const pts = [], ids = [];
    for (let i = 0; i <= N; i++) { pts.push(X(i, j), Y(i, j)); ids.push(id(i, j)); }
    const major = j % 4 === 0;
    map.roads.push({ pts, ids, type: major ? 'secondary' : 'residential', w: major ? 11 : 7.5, oneway: 0,
      name: names[j % names.length], car: 1, rank: major ? 5 : 3 });
  }
  for (let i = 0; i <= N; i++) {
    const pts = [], ids = [];
    for (let j = 0; j <= N; j++) { pts.push(X(i, j), Y(i, j)); ids.push(id(i, j)); }
    const major = i % 4 === 2;
    map.roads.push({ pts, ids, type: major ? 'primary' : 'residential', w: major ? 12 : 7.5, oneway: 0,
      name: names[(i + 7) % names.length], car: 1, rank: major ? 6 : 3 });
  }
  map.roads.sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x0 = X(i, j) + 9, y0 = Y(i, j) + 9, x1 = X(i + 1, j + 1) - 9, y1 = Y(i + 1, j + 1) - 9;
    if ((i === 5 && j === 6) || (i === 9 && j === 3)) {
      map.areas.push({ kind: 'green', rings: [[x0, y0, x1, y0, x1, y1, x0, y1]] });
      continue;
    }
    const cols = 2 + Math.floor(rnd() * 3), rows = 2 + Math.floor(rnd() * 2);
    for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
      if (a > 0 && a < cols - 1 && b > 0 && b < rows - 1) continue; // patio de manzana
      const bx0 = x0 + (x1 - x0) * a / cols, bx1 = x0 + (x1 - x0) * (a + 1) / cols - 1;
      const by0 = y0 + (y1 - y0) * b / rows, by1 = y0 + (y1 - y0) * (b + 1) / rows - 1;
      map.buildings.push([bx0, by0, bx1, by0, bx1, by1, bx0, by1, bx0, by0]);
    }
  }
  const e = off + N * S + 60;
  map.areas.push({ kind: 'water', rings: [[e, off - 200, e + 120, off - 200, e + 140, -off + 200, e + 20, -off + 200]] });
  map.pois.push({ x: X(6, 6) + 55, y: Y(6, 6) + 55, name: 'Ajuntament (aprox.)', kind: 'townhall' });
  map.bounds = { minx: off - 150, maxx: e + 200, miny: off - 150, maxy: -off + 150 };
  return map;
};
