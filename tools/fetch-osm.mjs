// Descarga el mapa de Sant Boi desde Overpass y lo guarda en data/ para publicarlo con el juego.
// Usa las mismas consultas que el juego (js/data.js). Se ejecuta en GitHub Actions: node tools/fetch-osm.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ctx = { console, URL, setTimeout, clearTimeout };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), ctx);
const SB = ctx.SB;

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Recorta los datos a lo que usa el juego: coordenadas a 7 decimales y sin "bounds"
function compact(json) {
  const round = (v) => Math.round(v * 1e7) / 1e7;
  const g = (a) => a && a.map(p => (p && p.lat != null ? { lat: round(p.lat), lon: round(p.lon) } : null));
  return {
    elements: (json.elements || []).map(el => {
      const o = { type: el.type, id: el.id };
      if (el.tags) o.tags = el.tags;
      if (el.lat != null) { o.lat = round(el.lat); o.lon = round(el.lon); }
      if (el.nodes) o.nodes = el.nodes;
      if (el.geometry) o.geometry = g(el.geometry);
      if (el.members) o.members = el.members.map(m => {
        const mm = { type: m.type, ref: m.ref, role: m.role };
        if (m.geometry) mm.geometry = g(m.geometry);
        if (m.lat != null) { mm.lat = round(m.lat); mm.lon = round(m.lon); }
        return mm;
      });
      return o;
    }),
  };
}

// Una petición a Overpass probando los servidores en orden
async function query(q, label, timeoutMs, maxMirrors = MIRRORS.length) {
  const body = 'data=' + encodeURIComponent(q);
  for (const url of MIRRORS.slice(0, maxMirrors)) {
    const t0 = Date.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(url, { method: 'POST', body, signal: ctl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'gamestboi-map-updater (github.com/errorlevel18/gamestboi)' } });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
      console.log(`  ${label}: ${json.elements.length} elementos desde ${new URL(url).host} en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      return json;
    } catch (e) {
      console.log(`  ${label}: fallo en ${new URL(url).host} tras ${((Date.now() - t0) / 1000).toFixed(0)} s: ${e.message}`);
      await sleep(3000);
    }
  }
  return null;
}

// Si una parte es demasiado pesada, se parte el área en 4 cuadrantes (y cada uno en 4 si hace falta)
async function fetchArea(part, bb, depth, label) {
  const q = SB.partQuery(part, bb).replace('[timeout:90]', '[timeout:120]');
  // con el área entera sólo probamos 2 servidores: si no pueden, mejor trocear que esperar
  const json = await query(q, label, depth === 0 ? 120000 : 130000, depth === 0 ? 2 : MIRRORS.length);
  if (json) return json.elements;
  if (depth >= 2) return null;
  console.log(`  ${label}: demasiado grande, se divide en 4 trozos`);
  const ms = (bb.s + bb.n) / 2, mw = (bb.w + bb.e) / 2, out = [];
  const quads = [{ s: bb.s, w: bb.w, n: ms, e: mw }, { s: bb.s, w: mw, n: ms, e: bb.e }, { s: ms, w: bb.w, n: bb.n, e: mw }, { s: ms, w: mw, n: bb.n, e: bb.e }];
  for (let i = 0; i < 4; i++) {
    const el = await fetchArea(part, quads[i], depth + 1, `${label}.${i + 1}`);
    if (!el) return null;
    out.push(...el);
    await sleep(2000);
  }
  return out;
}

async function fetchPart(part) {
  for (let round = 0; round < 2; round++) {
    const el = await fetchArea(part, SB.BBOX, 0, part.id);
    if (el) {
      const seen = new Set(), elements = [];
      for (const e of el) { const k = e.type[0] + e.id; if (!seen.has(k)) { seen.add(k); elements.push(e); } }
      return { elements };
    }
    await sleep(20000);
  }
  return null;
}

const outDir = path.join(root, 'data');
fs.mkdirSync(outDir, { recursive: true });
const manifest = { date: new Date().toISOString(), bbox: SB.BBOX, source: '© OpenStreetMap contributors (ODbL)', parts: {} };
let failedEssential = false;
for (const part of SB.OSM_PARTS) {
  console.log('Descargando', part.label);
  const json = await fetchPart(part);
  const file = path.join(outDir, part.id + '.json');
  if (!json) {
    console.log(`  ${part.id}: no se pudo descargar`);
    if (part.essential) failedEssential = true;
    // conservamos la versión anterior si existe
    if (fs.existsSync(file)) manifest.parts[part.id] = { elements: JSON.parse(fs.readFileSync(file, 'utf8')).elements.length, stale: true };
    continue;
  }
  const data = JSON.stringify(compact(json));
  fs.writeFileSync(file, data);
  manifest.parts[part.id] = { elements: json.elements.length, bytes: data.length };
  await sleep(3000);
}
if (failedEssential && !Object.keys(manifest.parts).length) { console.error('No se pudo descargar nada'); process.exit(1); }
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('Listo:', JSON.stringify(manifest.parts));
