// Arranque: carga del mapa, pantalla de título, entrada y bucle principal
'use strict';
(function () {
const SB = window.SB;
const $ = (id) => document.getElementById(id);
const status = $('status'), playBtn = $('play');
let map = null, game = null;

function setStatus(t, err) { status.textContent = t; status.className = err ? 'err' : ''; }
// durante la descarga se muestra el botón para cambiar de servidor
function showSkip(on) { $('skip').style.display = on ? 'inline-block' : 'none'; }
$('skip').onclick = () => { SB.skipServer(); setStatus('Probando otro servidor…'); };

function ready(m, note) {
  map = m;
  const kind = m.source === 'fallback' ? 'mapa aproximado' : `${m.roads.length} calles y ${m.buildings.length} edificios`;
  setStatus(`${note || 'Mapa listo'}: ${kind}`);
  playBtn.disabled = false;
  playBtn.focus();
}

async function load(force) {
  playBtn.disabled = true;
  $('retry').style.display = 'none';
  // 1) mapa publicado con el juego (data/): rápido y sin depender de Overpass
  setStatus('Buscando el mapa…');
  const manifest = await SB.fetchManifest();
  const cached = force ? null : await SB.loadCachedMap();
  if (manifest) {
    const fecha = new Date(manifest.date).toLocaleDateString('es-ES');
    if (cached && cached.dataDate === manifest.date) { ready(cached, `Mapa de Sant Boi del ${fecha} (guardado)`); return; }
    try {
      const m = await SB.loadPublishedMap(manifest, (t) => setStatus(t));
      SB.saveCachedMap(m);
      ready(m, `Mapa de Sant Boi del ${fecha}`);
      return;
    } catch (e) { console.warn('Mapa publicado', e); }
  }
  // 2) sin mapa publicado (p. ej. abriendo index.html en local): caché o descarga desde Overpass
  if (!force) {
    if (cached) { ready(cached, 'Mapa de Sant Boi (guardado)'); return; }
  } else await SB.clearCachedMap(true);
  try {
    const m = await SB.downloadMap((t, busy) => { setStatus(t); showSkip(!!busy); });
    showSkip(false);
    SB.saveCachedMap(m);
    ready(m, 'Mapa de Sant Boi descargado' + (m.skipped && m.skipped.length ? ` (sin ${m.skipped.join(', ')}: pulsa "Volver a descargar" más tarde)` : ''));
  } catch (e) {
    showSkip(false);
    setStatus('No se pudo descargar el mapa de OpenStreetMap (' + e.message + '). Lo ya descargado se ha guardado: pulsa «Reintentar» para seguir donde se quedó, o juega con el mapa aproximado.', true);
    $('retry').style.display = 'inline-block';
  }
}

$('reload').onclick = () => load(true);
$('retry').onclick = () => load(false);
$('offline').onclick = () => ready(SB.fallbackMap(), 'Sin conexión');
$('file').onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const json = JSON.parse(await f.text());
    const m = SB.processOSM(json);
    if (!m.roads.length) throw new Error('el archivo no tiene calles');
    SB.saveCachedMap(m);
    ready(m, 'Mapa cargado desde archivo');
  } catch (e) { setStatus('Archivo no válido: ' + e.message, true); }
};

playBtn.onclick = start;

function start() {
  if (!map || game) return;
  setStatus('Construyendo Sant Boi…');
  setTimeout(() => {
    const world = new SB.World(map);
    const hud = {
      money: $('money'), stars: $('stars'), hp: $('hp'), car: $('carbox'), speed: $('speed'), carName: $('carName'), carHp: $('carHp'),
      mini: $('mini'), zone: $('zone'), street: $('street'), mission: $('mission'), missionTitle: $('mTitle'), missionText: $('mText'),
      timer: $('timer'), reward: $('reward'), msg: $('msg'), big: $('big'), pause: $('pause'),
    };
    game = new SB.Game(world, $('game'), hud);
    window.game = game;
    game.init3d = () => {
      if (game.r3d) return;
      if (!window.THREE) { game.r3dError = 'no se pudo cargar Three.js'; return; }
      if (!SB.webglAvailable()) { game.r3dError = 'el navegador no tiene WebGL activado'; return; }
      try { game.r3d = new SB.Renderer3D(world, $('game3d')); game.r3d.resize(); }
      catch (e) { console.warn('Sin 3D', e); game.r3dError = e && e.message ? e.message : String(e); game.r3d = null; }
    };
    game.init3d();
    let pref = '3d';
    try { pref = localStorage.getItem('santboi-view') || '3d'; } catch (e) { /* nada */ }
    game.setView(pref === '3d');
    game.audio.unlock();
    try { applySound(parseInt(localStorage.getItem('santboi-sound') || '0', 10) || 0); } catch (e) { /* nada */ }
    $('title').style.display = 'none';
    $('hud').classList.add('on');
    if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) $('touch').classList.add('on');
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      // subpasos para que la física sea estable
      const n = dt > 0.025 ? 2 : 1;
      for (let i = 0; i < n; i++) { game.update(dt / n); if (i < n - 1) game.pressed = {}; }
      game.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, 30);
}

// ---------- teclado ----------
addEventListener('keydown', (e) => {
  if (!game) { if (e.code === 'Enter' && !playBtn.disabled) start(); return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!e.repeat) game.pressed[e.code] = true;
  game.keys[e.code] = true;
  game.audio.unlock();
});
addEventListener('keyup', (e) => { if (game) game.keys[e.code] = false; });
addEventListener('blur', () => { if (game) { game.keys = {}; game.paused = true; } });
addEventListener('resize', () => { if (game) game.resize(); });
// sonido: todo -> sin motor -> silencio (se recuerda entre partidas)
const SOUND_ICONS = ['🔊', '🔉', '🔇'], SOUND_TIPS = ['Sonido: todo', 'Sonido: sin motor', 'Sonido: silencio'];
function applySound(mode) {
  if (!game) return;
  while ((game.audio.mode || 0) !== mode) game.audio.cycleMode();
  $('mute').textContent = SOUND_ICONS[mode]; $('mute').title = SOUND_TIPS[mode];
}
$('mute').onclick = () => {
  if (!game) return;
  const mode = game.audio.cycleMode();
  $('mute').textContent = SOUND_ICONS[mode]; $('mute').title = SOUND_TIPS[mode];
  game.msg(SOUND_TIPS[mode], 1.5);
  try { localStorage.setItem('santboi-sound', String(mode)); } catch (e) { /* nada */ }
};

// ---------- controles táctiles ----------
const stick = $('stick'), knob = $('knob');
let stickId = null;
function stickMove(t) {
  const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = (t.clientX - cx) / (r.width / 2), dy = (t.clientY - cy) / (r.height / 2);
  const d = Math.hypot(dx, dy); if (d > 1) { dx /= d; dy /= d; }
  knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
  if (game) { game.touch.jx = dx; game.touch.jy = dy; game.touch.active = true; }
}
stick.addEventListener('touchstart', (e) => { e.preventDefault(); stickId = e.changedTouches[0].identifier; stickMove(e.changedTouches[0]); if (game) game.audio.unlock(); }, { passive: false });
stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === stickId) stickMove(t); }, { passive: false });
const stickEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === stickId) { stickId = null; knob.style.transform = ''; if (game) { game.touch.jx = 0; game.touch.jy = 0; } } };
stick.addEventListener('touchend', stickEnd); stick.addEventListener('touchcancel', stickEnd);
const hold = (el, on, off) => {
  el.addEventListener('touchstart', (e) => { e.preventDefault(); if (game) { game.touch.active = true; on(); } }, { passive: false });
  el.addEventListener('touchend', (e) => { e.preventDefault(); if (game && off) off(); }, { passive: false });
};
hold($('tFire'), () => { game.touch.fire = true; }, () => { game.touch.fire = false; });
hold($('tEnter'), () => { game.pressed.KeyE = true; });
hold($('tMap'), () => { game.pressed.KeyM = true; });
hold($('tCam'), () => { game.pressed.KeyC = true; });
$('cam').onclick = () => { if (game) game.pressed.KeyC = true; };
$('infoBtn').onclick = () => { if (game) game.showInfo(); };
$('infoClose').onclick = () => { $('info').style.display = 'none'; };

load(false);
})();
