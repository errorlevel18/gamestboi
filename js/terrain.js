// Relieve del terreno: altura (m) en cualquier punto del mapa a partir de SB.ELEVATION
'use strict';
(function () {
const SB = window.SB;

class Terrain {
  constructor(E) {
    this.ok = !!E;
    if (!E) return;
    const bin = atob(E.data), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const raw = new Uint16Array(u8.buffer);
    this.w = E.w; this.h = E.h; this.step = E.step; this.minx = E.minx; this.miny = E.miny;
    const f = new Float32Array(raw.length);
    let mn = Infinity;
    for (let i = 0; i < raw.length; i++) { f[i] = raw[i] / 10 - 10; if (f[i] < mn) mn = f[i]; }
    // altura relativa: el punto más bajo (el Llobregat) es 0
    for (let i = 0; i < f.length; i++) f[i] -= mn;
    this.base = mn;
    this.data = f;
  }

  // Altura con interpolación bilineal (fuera del área se usa el borde)
  at(x, y) {
    if (!this.ok) return 0;
    let fx = (x - this.minx) / this.step, fy = (y - this.miny) / this.step;
    fx = fx < 0 ? 0 : fx > this.w - 1.001 ? this.w - 1.001 : fx;
    fy = fy < 0 ? 0 : fy > this.h - 1.001 ? this.h - 1.001 : fy;
    const ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, d = this.data, W = this.w, i = iy * W + ix;
    return (d[i] * (1 - ax) + d[i + 1] * ax) * (1 - ay) + (d[i + W] * (1 - ax) + d[i + W + 1] * ax) * ay;
  }

  // Pendiente en la dirección (dx, dy) normalizada
  slope(x, y, dx, dy) {
    return (this.at(x + dx * 2, y + dy * 2) - this.at(x - dx * 2, y - dy * 2)) / 4;
  }
}

SB.Terrain = Terrain;
})();
