// Convierte un recorte de OpenStreetMap en formato OPL (osmium cat -f opl) a los archivos data/<parte>.json
// que usa el juego, con el mismo formato que devolvería Overpass ("out geom") y los mismos filtros
// que las consultas de js/data.js.
//
// Uso (lo hace GitHub Actions):
//   osmium extract -b <bbox> --strategy smart -S types=multipolygon,route cataluna.osm.pbf -o sb.osm.pbf
//   osmium cat sb.osm.pbf -f opl,add_metadata=false -o sb.opl
//   node tools/pbf-to-parts.mjs sb.opl
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ctx = { console, URL, setTimeout, clearTimeout };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), ctx);
const B = ctx.SB.BBOX;

const file = process.argv[2];
if (!file) { console.error('Uso: node tools/pbf-to-parts.mjs recorte.opl'); process.exit(1); }

// ---------- lectura del OPL ----------
const decode = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const nodes = new Map();       // id -> [lat, lon]
const taggedNodes = [];        // nodos con etiquetas
const ways = [];
const rels = [];
const TYPES = { n: 'node', w: 'way', r: 'relation' };

const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const f = line.split(' ');
  const type = f[0][0], id = Number(f[0].slice(1));
  let tags = null, x = null, y = null, nds = null, mem = null;
  for (let i = 1; i < f.length; i++) {
    const k = f[i][0], v = f[i].slice(1);
    if (k === 'T') {
      if (v) { tags = {}; for (const kv of v.split(',')) { const j = kv.indexOf('='); if (j > 0) tags[decode(kv.slice(0, j))] = decode(kv.slice(j + 1)); } }
    } else if (k === 'x') x = v ? Number(v) : null;
    else if (k === 'y') y = v ? Number(v) : null;
    else if (k === 'N') nds = v ? v.split(',').map(s => Number(s.slice(1))) : [];
    else if (k === 'M') mem = v ? v.split(',').map(s => { const a = s.indexOf('@'); return { type: TYPES[s[0]], ref: Number(s.slice(1, a)), role: decode(s.slice(a + 1)) }; }) : [];
  }
  if (type === 'n') {
    if (x === null || y === null) continue;
    nodes.set(id, [y, x]);
    if (tags) taggedNodes.push({ id, lat: y, lon: x, tags });
  } else if (type === 'w') ways.push({ id, tags: tags || {}, nodes: nds || [] });
  else if (type === 'r') rels.push({ id, tags: tags || {}, members: mem || [] });
}
console.log(`Leídos ${nodes.size} nodos, ${ways.length} vías, ${rels.length} relaciones`);

// ---------- utilidades ----------
const round = (v) => Math.round(v * 1e7) / 1e7;
const inBox = (lat, lon, m = 0) => lat >= B.s - m && lat <= B.n + m && lon >= B.w - m && lon <= B.e + m;
const wayById = new Map(ways.map(w => [w.id, w]));
function geom(w) {
  const g = [];
  for (const n of w.nodes) { const c = nodes.get(n); if (!c) return null; g.push({ lat: round(c[0]), lon: round(c[1]) }); }
  return g;
}
const wayTouchesBox = (w) => w.nodes.some(n => { const c = nodes.get(n); return c && inBox(c[0], c[1]); });
const wayEl = (w) => { const g = geom(w); return g && g.length > 1 ? { type: 'way', id: w.id, tags: w.tags, nodes: w.nodes, geometry: g } : null; };
const nodeEl = (n) => ({ type: 'node', id: n.id, lat: round(n.lat), lon: round(n.lon), tags: n.tags });
const re = (s) => new RegExp(s);

// ---------- mismos filtros que las consultas de Overpass ----------
const R = {
  rail: re('^(rail|light_rail|narrow_gauge)$'), waterway: re('^(river|riverbank|canal|stream)$'),
  amenBuild: re('^(townhall|hospital|police|marketplace|place_of_worship|school)$'),
  leisure: re('^(park|garden|pitch|playground|stadium|sports_centre|track|dog_park|nature_reserve)$'),
  landuse: re('^(grass|forest|meadow|farmland|orchard|recreation_ground|cemetery|village_green|allotments|vineyard|flowerbed|plant_nursery)$'),
  natural: re('^(water|wood|scrub|grassland|beach|sand|wetland|heath|tree_row)$'),
  mpNatural: re('^(water|wood|scrub|grassland|heath|wetland)$'),
  mpLanduse: re('^(forest|grass|meadow|farmland|cemetery|orchard|allotments|recreation_ground|village_green)$'),
  mpLeisure: re('^(park|garden|playground|nature_reserve)$'),
  poiAmen: re('^(townhall|hospital|police|fire_station|marketplace|place_of_worship|library|theatre|cinema|university|college|bus_station)$'),
  place: re('^(suburb|neighbourhood|quarter|town)$'), tourism: re('^(museum|attraction|artwork)$'),
  shopAmen: re('^(bar|restaurant|cafe|pharmacy|bank|fast_food|pub|ice_cream|post_office|fuel|clinic|dentist|veterinary|driving_school|kindergarten|school)$'),
  hwNode: re('^(traffic_signals|crossing|bus_stop|street_lamp)$'),
  furniture: re('^(bench|fountain|drinking_water|waste_basket|recycling|waste_disposal|post_box)$'),
};
const has = (t, k, rx) => t[k] !== undefined && (!rx || rx.test(t[k]));

const parts = { roads: [], buildings: [], nature: [], places: [], bus: [] };

for (const w of ways) {
  const t = w.tags;
  if (!wayTouchesBox(w)) continue;
  let target = null;
  if (has(t, 'highway') || has(t, 'railway', R.rail) || has(t, 'waterway', R.waterway)) target = 'roads';
  else if (has(t, 'building') || has(t, 'building:part') || (t.name && has(t, 'amenity', R.amenBuild)) || (t.name && has(t, 'shop'))) target = 'buildings';
  else if (has(t, 'leisure', R.leisure) || has(t, 'landuse', R.landuse) || has(t, 'natural', R.natural)) target = 'nature';
  if (!target) continue;
  const el = wayEl(w);
  if (el) parts[target].push(el);
}

for (const n of taggedNodes) {
  if (!inBox(n.lat, n.lon)) continue;
  const t = n.tags;
  if (t.natural === 'tree') { parts.nature.push(nodeEl(n)); continue; }
  const named = !!t.name;
  if ((named && (has(t, 'amenity', R.poiAmen) || t.railway === 'station' || has(t, 'place', R.place) || has(t, 'tourism', R.tourism) || has(t, 'shop') || has(t, 'amenity', R.shopAmen)))
    || has(t, 'highway', R.hwNode) || has(t, 'amenity', R.furniture)) parts.places.push(nodeEl(n));
}

// relaciones: multipolígonos de naturaleza y rutas de bus
for (const r of rels) {
  const t = r.tags;
  if (t.type === 'multipolygon' && (has(t, 'natural', R.mpNatural) || has(t, 'landuse', R.mpLanduse) || has(t, 'leisure', R.mpLeisure) || t.waterway === 'riverbank')) {
    const members = [];
    let touches = false;
    for (const m of r.members) {
      if (m.type !== 'way') continue;
      const w = wayById.get(m.ref); if (!w) continue;
      const g = geom(w); if (!g) continue;
      if (!touches && g.some(p => inBox(p.lat, p.lon))) touches = true;
      members.push({ type: 'way', ref: m.ref, role: m.role, geometry: g });
    }
    if (touches && members.length) parts.nature.push({ type: 'relation', id: r.id, tags: t, members });
  } else if (t.route === 'bus') {
    // como "out geom(bbox)": los puntos fuera del área van como null
    const members = [];
    let touches = false;
    for (const m of r.members) {
      if (m.type === 'way') {
        const w = wayById.get(m.ref); if (!w) continue;
        const g = [];
        for (const nid of w.nodes) { const c = nodes.get(nid); g.push(c && inBox(c[0], c[1]) ? { lat: round(c[0]), lon: round(c[1]) } : null); }
        if (g.some(p => p)) { touches = true; members.push({ type: 'way', ref: m.ref, role: m.role, geometry: g }); }
      } else if (m.type === 'node') {
        const c = nodes.get(m.ref);
        if (c && inBox(c[0], c[1])) members.push({ type: 'node', ref: m.ref, role: m.role, lat: round(c[0]), lon: round(c[1]) });
      }
    }
    if (touches) parts.bus.push({ type: 'relation', id: r.id, tags: t, members });
  }
}

const outDir = path.join(root, 'data');
fs.mkdirSync(outDir, { recursive: true });
const manifest = { date: new Date().toISOString(), bbox: B, source: '© OpenStreetMap contributors (ODbL), vía Geofabrik', parts: {} };
for (const [id, elements] of Object.entries(parts)) {
  const data = JSON.stringify({ elements });
  fs.writeFileSync(path.join(outDir, id + '.json'), data);
  manifest.parts[id] = { elements: elements.length, bytes: data.length };
}
const MIN = Number(process.env.MIN_ELEMENTS || 50);
if (parts.roads.length < MIN || parts.buildings.length < MIN) { console.error('Recorte sospechosamente vacío', manifest.parts); process.exit(1); }
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('Listo:', JSON.stringify(manifest.parts));
