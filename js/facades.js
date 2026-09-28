// Texturas procedurales de fachadas y atlas de textos (placas de calle y letreros de tiendas)
'use strict';
(function () {
const SB = window.SB;
const S = 128; // una "crujía": una ventana de ancho y un piso de alto

function canvas() { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')]; }
function rnd(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function windowAt(g, x, y, w, h, glass = '#3d4a57') {
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x - 3, y - 3, w + 6, h + 6);
  g.fillStyle = '#d9d4ca'; g.fillRect(x - 2, y - 2, w + 4, h + 4);
  g.fillStyle = glass; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(x + 3, y + 3, w * 0.3, h - 6);
  g.fillStyle = '#9d968c'; g.fillRect(x + w / 2 - 1, y, 2, h);
}
function sill(g, x, y, w) { g.fillStyle = '#a79d90'; g.fillRect(x - 6, y, w + 12, 5); g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x - 6, y + 5, w + 12, 2); }
function slab(g) { g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, S - 6, S, 6); }
function railing(g, x0, x1, y0, y1) {
  g.fillStyle = '#2b2b2b'; g.fillRect(x0, y0, x1 - x0, 3);
  for (let x = x0; x <= x1; x += 7) g.fillRect(x, y0, 2, y1 - y0);
}
function bricks(g, color, mortar) {
  g.fillStyle = color; g.fillRect(0, 0, S, S);
  g.fillStyle = mortar;
  for (let y = 0; y < S; y += 8) {
    g.fillRect(0, y, S, 1.5);
    for (let x = (y / 8) % 2 ? 0 : 8; x < S; x += 16) g.fillRect(x, y, 1.5, 8);
  }
  const r = rnd(color.length * 99 + 7);
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.08})`; g.fillRect(Math.floor(r() * 8) * 16, Math.floor(r() * 16) * 8, 15, 7); }
}

// Pisos superiores. tint = si se tiñe con el color de la fachada del edificio
const UPPER = {
  classic: { tint: true, draw(g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); slab(g);
    windowAt(g, 44, 24, 40, 66);
    g.fillStyle = '#3f6b3c'; g.fillRect(24, 22, 18, 70); g.fillRect(86, 22, 18, 70);
    g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 26; y < 90; y += 6) { g.fillRect(24, y, 18, 2); g.fillRect(86, y, 18, 2); }
    sill(g, 44, 92, 40);
  } },
  balcony: { tint: true, draw(g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    windowAt(g, 42, 14, 44, 92, '#46535f');
    g.fillStyle = '#b3aba0'; g.fillRect(24, 106, 80, 8); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(24, 114, 80, 4);
    railing(g, 26, 102, 80, 106);
  } },
  brick: { tint: false, draw(g) {
    bricks(g, '#a3573b', '#c9a792');
    g.fillStyle = '#d8d2c6'; g.fillRect(28, 20, 72, 74);
    g.fillStyle = '#39485a'; g.fillRect(32, 24, 64, 66);
    g.fillStyle = '#c4c4c4'; g.fillRect(63, 24, 2, 66);
    g.fillStyle = '#c9b89e'; g.fillRect(28, 20, 72, 22); // persiana medio bajada
    g.fillStyle = 'rgba(0,0,0,.15)'; for (let y = 22; y < 42; y += 4) g.fillRect(28, y, 72, 1);
    g.fillStyle = '#d8cfc0'; g.fillRect(24, 94, 80, 6);
  } },
  brickBalcony: { tint: false, draw(g) {
    bricks(g, '#b0664a', '#d2b39f');
    windowAt(g, 40, 12, 48, 94, '#3b4856');
    g.fillStyle = '#9d9489'; g.fillRect(20, 104, 88, 10);
    railing(g, 22, 106, 78, 104);
    g.fillStyle = 'rgba(40,40,40,.5)'; g.fillRect(22, 90, 84, 14);
  } },
  modern: { tint: true, draw(g) {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#5b7a96'; g.fillRect(0, 26, S, 64);
    g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, 30, S, 10);
    g.fillStyle = '#d0d0d0'; for (let x = 0; x < S; x += 32) g.fillRect(x, 26, 3, 64);
    g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(0, 90, S, 4);
  } },
  plaster: { tint: true, draw(g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    const r = rnd(5); for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * S, r() * S, 6, 6); }
    windowAt(g, 46, 34, 36, 44, '#434d56');
    g.fillStyle = '#2d2d2d'; for (let x = 46; x <= 82; x += 9) g.fillRect(x, 32, 2, 48); g.fillRect(44, 54, 40, 2);
    sill(g, 46, 80, 36);
  } },
  blind: { tint: true, draw(g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); slab(g);
    windowAt(g, 36, 16, 56, 86);
    g.fillStyle = '#b8a283'; g.fillRect(36, 16, 56, 46);
    g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 18; y < 62; y += 4) g.fillRect(36, y, 56, 1);
    g.fillStyle = '#c8c0b4'; g.fillRect(28, 102, 72, 6);
    railing(g, 30, 98, 84, 102);
  } },
  stone: { tint: false, draw(g) {
    g.fillStyle = '#c2b193'; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(80,60,40,.35)';
    for (let y = 0; y < S; y += 16) { g.fillRect(0, y, S, 1.5); for (let x = (y / 16) % 2 ? 0 : 20; x < S; x += 40) g.fillRect(x, y, 1.5, 16); }
    g.fillStyle = '#3a3f4a'; g.beginPath(); g.moveTo(52, 104); g.lineTo(52, 48); g.arc(64, 48, 12, Math.PI, 0); g.lineTo(76, 104); g.fill();
    g.fillStyle = '#8a3b2e'; g.fillRect(56, 60, 16, 30);
  } },
  industrial: { tint: false, draw(g) {
    g.fillStyle = '#a4acb1'; g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 8) { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x, 0, 3, S); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + 4, 0, 2, S); }
    g.fillStyle = '#56687a'; g.fillRect(6, 14, 116, 16);
    g.fillStyle = '#c0392b'; g.fillRect(0, S - 10, S, 4);
  } },
  house: { tint: true, draw(g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); slab(g);
    windowAt(g, 46, 28, 36, 58, '#454f58');
    g.fillStyle = '#7a4e2d'; g.fillRect(28, 26, 16, 62); g.fillRect(84, 26, 16, 62);
    g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 30; y < 88; y += 5) { g.fillRect(28, y, 16, 1.5); g.fillRect(84, y, 16, 1.5); }
    sill(g, 46, 86, 36);
    g.fillStyle = '#c0392b'; g.fillRect(40, 96, 48, 8); g.fillStyle = '#3f8b3a'; for (let x = 42; x < 88; x += 8) g.fillRect(x, 88, 5, 8); // macetas
  } },
  school: { tint: false, draw(g) {
    bricks(g, '#c96d3f', '#e2b89c');
    g.fillStyle = '#e6e2d8'; g.fillRect(12, 26, 104, 66);
    g.fillStyle = '#4c6c86'; g.fillRect(16, 30, 96, 58);
    g.fillStyle = '#e6e2d8'; g.fillRect(62, 30, 4, 58); g.fillRect(16, 56, 96, 3);
  } },
};

// Planta baja
function awningShop(color1, color2, glass) {
  return { tint: false, draw(g) {
    g.fillStyle = '#d9d0c1'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#2a2a2a'; g.fillRect(6, 40, 116, 88);
    g.fillStyle = glass; g.fillRect(10, 44, 108, 84);
    g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(14, 48, 30, 76);
    g.fillStyle = '#2a2a2a'; g.fillRect(62, 44, 4, 84);
    for (let x = 0; x < S; x += 16) { g.fillStyle = (x / 16) % 2 ? color1 : color2; g.fillRect(x, 14, 16, 26); }
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, 38, S, 3);
  } };
}
function shutter(seed) {
  return { tint: false, draw(g) {
    g.fillStyle = '#d4cab9'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#8f959a'; g.fillRect(8, 22, 112, 106);
    g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 24; y < S; y += 5) g.fillRect(8, y, 112, 1.5);
    g.fillStyle = '#6d7277'; g.fillRect(8, 18, 112, 6);
    // grafitis
    const r = rnd(seed), cols = ['#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#3498db', '#111'];
    g.lineWidth = 5; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      g.strokeStyle = cols[Math.floor(r() * cols.length)];
      g.beginPath(); let x = 16 + r() * 30, y = 60 + r() * 50; g.moveTo(x, y);
      for (let i = 0; i < 6; i++) { x += 8 + r() * 12; y += (r() - 0.5) * 40; g.lineTo(Math.min(x, 116), Math.max(28, Math.min(y, 124))); }
      g.stroke();
    }
  } };
}
const GROUND = {
  shopRed: awningShop('#c0392b', '#f5f0e6', '#4b5d6e'),
  shopGreen: awningShop('#1e8449', '#f5f0e6', '#56697a'),
  shopBlue: awningShop('#1f4f8b', '#d9d9d9', '#4f5f70'),
  shopOrange: awningShop('#d35400', '#f3c77b', '#5a6a78'),
  shutter1: shutter(11),
  shutter2: shutter(29),
  door: { tint: true, draw(g) {
    g.fillStyle = '#e3dbcd'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#b5ab9c'; g.fillRect(0, S - 20, S, 20);
    g.fillStyle = '#5b3a22'; g.fillRect(44, 40, 40, 88);
    g.fillStyle = '#3d2716'; g.fillRect(48, 46, 14, 36); g.fillRect(66, 46, 14, 36);
    g.fillStyle = '#c9a227'; g.fillRect(76, 88, 4, 4);
    g.fillStyle = '#3d4a57'; g.fillRect(12, 50, 20, 28); g.fillRect(96, 50, 20, 28);
    g.fillStyle = '#2d2d2d'; for (let x = 12; x <= 32; x += 5) { g.fillRect(x, 48, 1.5, 32); g.fillRect(x + 84, 48, 1.5, 32); }
  } },
  garage: { tint: false, draw(g) {
    g.fillStyle = '#cfc6b6'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#7d8185'; g.fillRect(10, 36, 108, 92);
    g.fillStyle = 'rgba(0,0,0,.2)'; for (let y = 38; y < S; y += 10) g.fillRect(10, y, 108, 2);
    g.fillStyle = '#f1c40f'; g.fillRect(10, 30, 108, 6);
    g.fillStyle = '#fff'; g.fillRect(40, 60, 48, 14); g.fillStyle = '#c0392b'; g.fillRect(44, 63, 40, 8);
  } },
};

SB.buildFacades = function (THREE) {
  const make = (def) => {
    const [c, g] = canvas(); def.draw(g);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return { tex: t, tint: def.tint };
  };
  const out = { upper: {}, ground: {} };
  for (const k in UPPER) out.upper[k] = make(UPPER[k]);
  for (const k in GROUND) out.ground[k] = make(GROUND[k]);
  return out;
};

// ---------- Atlas de textos ----------
const CW = 256, CHh = 32, AS = 1024, COLS = AS / CW, ROWS = AS / CHh;
const SIGN_STYLE = {
  street: { bg: '#f4f1e8', fg: '#1a1a1a', border: '#1b2a4a' },
  pharmacy: { bg: '#1e8e3e', fg: '#fff', prefix: '✚ ' },
  bank: { bg: '#1f4f8b', fg: '#fff' },
  bar: { bg: '#7b3f00', fg: '#ffe9c2' }, pub: { bg: '#4a2a0a', fg: '#ffd27a' }, cafe: { bg: '#6d4c41', fg: '#fff' },
  restaurant: { bg: '#8e1b1b', fg: '#fff' }, fast_food: { bg: '#d35400', fg: '#fff' }, ice_cream: { bg: '#f8bbd0', fg: '#6a1b4d' },
  food: { bg: '#2e7d32', fg: '#fff' }, hair: { bg: '#6a1b9a', fg: '#fff' }, fuel: { bg: '#c62828', fg: '#fff' },
  post_office: { bg: '#f9c80e', fg: '#1d3557' }, clinic: { bg: '#fff', fg: '#1e8e3e' }, dentist: { bg: '#e3f2fd', fg: '#0d47a1' },
  shop: { bg: '#263238', fg: '#fff' },
};
class TextAtlas {
  constructor() { this.canvases = []; this.n = 0; this.cache = new Map(); }
  add(text, styleName) {
    const key = styleName + '|' + text;
    if (this.cache.has(key)) return this.cache.get(key);
    const idx = Math.floor(this.n / (COLS * ROWS)), cell = this.n % (COLS * ROWS);
    if (!this.canvases[idx]) { const c = document.createElement('canvas'); c.width = c.height = AS; this.canvases[idx] = c; }
    this.n++;
    const g = this.canvases[idx].getContext('2d');
    const col = cell % COLS, row = Math.floor(cell / COLS), x = col * CW, y = row * CHh;
    const st = SIGN_STYLE[styleName] || SIGN_STYLE.shop;
    g.fillStyle = st.bg; g.fillRect(x, y, CW, CHh);
    if (st.border) { g.strokeStyle = st.border; g.lineWidth = 3; g.strokeRect(x + 2.5, y + 2.5, CW - 5, CHh - 5); }
    const label = (st.prefix || '') + text;
    let size = 22;
    g.font = `bold ${size}px system-ui, Arial, sans-serif`;
    while (g.measureText(label).width > CW - 14 && size > 9) { size--; g.font = `bold ${size}px system-ui, Arial, sans-serif`; }
    g.fillStyle = st.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + CW / 2, y + CHh / 2 + 1);
    const r = { atlas: idx, u0: col / COLS, u1: (col + 1) / COLS, v0: 1 - (row + 1) / ROWS, v1: 1 - row / ROWS };
    this.cache.set(key, r);
    return r;
  }
}
SB.TextAtlas = TextAtlas;
SB.SIGN_RATIO = CW / CHh;
})();
