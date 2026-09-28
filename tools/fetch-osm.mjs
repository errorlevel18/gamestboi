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

async function fetchPart(part) {
  // en Actions podemos esperar más: dejamos al servidor hasta 3 minutos
  const body = 'data=' + encodeURIComponent(SB.partQuery(part).replace('[timeout:90]', '[timeout:180]'));
  for (let round = 0; round < 3; round++) {
    for (const url of MIRRORS) {
      const t0 = Date.now();
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 240000);
        const res = await fetch(url, { method: 'POST', body, signal: ctl.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'gamestboi-map-updater (github.com/errorlevel18/gamestboi)' } });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
        console.log(`  ${part.id}: ${json.elements.length} elementos desde ${new URL(url).host} en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        return json;
      } catch (e) {
        console.log(`  ${part.id}: fallo en ${new URL(url).host}: ${e.message}`);
        await sleep(5000);
      }
    }
    await sleep(30000);
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
