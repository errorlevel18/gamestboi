// Efectos de sonido sintetizados con WebAudio (sin archivos externos)
'use strict';
(function () {
const SB = window.SB;

class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.last = {}; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // motor: dos osciladores suaves (triángulo + subgrave) muy filtrados, con un leve pulso de combustión
      const c = this.ctx;
      this.eng = c.createOscillator(); this.eng.type = 'triangle';
      this.eng2 = c.createOscillator(); this.eng2.type = 'sine';
      this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 220; this.engF.Q.value = 0.4;
      this.engG = c.createGain(); this.engG.gain.value = 0;
      this.puls = c.createOscillator(); this.puls.type = 'sine'; this.puls.frequency.value = 12;
      this.pulsG = c.createGain(); this.pulsG.gain.value = 0;
      this.puls.connect(this.pulsG); this.pulsG.connect(this.engG.gain);
      this.eng.connect(this.engF); this.eng2.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master);
      this.eng.start(); this.eng2.start(); this.puls.start();
      // rodadura y viento: ruido filtrado que sube con la velocidad
      this.road = c.createBufferSource(); this.road.buffer = this.noise; this.road.loop = true;
      this.roadF = c.createBiquadFilter(); this.roadF.type = 'bandpass'; this.roadF.frequency.value = 350; this.roadF.Q.value = 0.6;
      this.roadG = c.createGain(); this.roadG.gain.value = 0;
      this.road.connect(this.roadF); this.roadF.connect(this.roadG); this.roadG.connect(this.master); this.road.start();
      this.gear = 1;
      // sirena
      this.sir = this.ctx.createOscillator(); this.sir.type = 'triangle';
      this.sirG = this.ctx.createGain(); this.sirG.gain.value = 0;
      this.sir.connect(this.sirG); this.sirG.connect(this.master); this.sir.start();
    } catch (e) { this.ctx = null; }
  }

  // Botón de sonido: todo -> sin motor -> silencio
  cycleMode() {
    this.mode = ((this.mode || 0) + 1) % 3;
    this.muted = this.mode === 2;
    this.noEngine = this.mode >= 1;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.mode;
  }
  toggleMute() { return this.cycleMode() === 2; }

  // level: velocidad / velocidad máxima (-1 = a pie); throttle: acelerador (0..1)
  engine(level, siren, throttle = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (level < 0 || this.noEngine) {
      this.engG.gain.setTargetAtTime(0, t, 0.15); this.pulsG.gain.setTargetAtTime(0, t, 0.15);
      this.roadG.gain.setTargetAtTime(level < 0 ? 0 : Math.min(0.05, level * level * 0.06), t, 0.3);
    } else {
      // cambio de marchas: el régimen sube dentro de cada marcha y baja al cambiar
      const G = [0, 0.14, 0.3, 0.48, 0.68, 1.01];
      let g = 1; while (g < 5 && level > G[g]) g++;
      const rpm = Math.max(0, Math.min(1, (level - G[g - 1]) / (G[g] - G[g - 1])));
      const thr = Math.max(0, throttle);
      const f = 34 + rpm * 44 + g * 4;
      this.eng.frequency.setTargetAtTime(f, t, 0.12);
      this.eng2.frequency.setTargetAtTime(f / 2, t, 0.12);
      this.engF.frequency.setTargetAtTime(160 + rpm * 160 + thr * 220, t, 0.15);
      const vol = 0.02 + thr * (0.026 + rpm * 0.016);
      this.engG.gain.setTargetAtTime(vol, t, 0.25);
      this.pulsG.gain.setTargetAtTime(vol * 0.25, t, 0.25);
      this.puls.frequency.setTargetAtTime(8 + rpm * 14, t, 0.2);
      this.roadG.gain.setTargetAtTime(Math.min(0.05, level * level * 0.06), t, 0.3);
    }
    this.sirG.gain.setTargetAtTime(siren ? 0.022 : 0, t, 0.2);
    if (siren) this.sir.frequency.setValueAtTime(Math.sin(t * 4) > 0 ? 960 : 720, t);
  }

  noiseBurst(dur, freq, vol, type = 'lowpass') {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 0.5); s.stop(t + dur);
  }
  tone(freqs, dur, type = 'square', vol = 0.1, gap = 0) {
    const c = this.ctx; let t = c.currentTime;
    for (const fr of freqs) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = fr;
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur);
      t += gap;
    }
  }

  play(name, vol = 1) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < 60) return;
    this.last[name] = now;
    try {
      switch (name) {
        case 'shot': this.noiseBurst(0.12, 2500, 0.5 * vol); break;
        case 'boom': this.noiseBurst(1.2, 300, 1); break;
        case 'crash': this.noiseBurst(0.25, 900, 0.5); break;
        case 'hit': this.noiseBurst(0.1, 500, 0.4); break;
        case 'skid': this.noiseBurst(0.15, 3000, 0.08, 'highpass'); break;
        case 'door': this.noiseBurst(0.08, 700, 0.3); break;
        case 'horn': this.tone([392, 494], 0.35, 'square', 0.06, 0); break;
        case 'cash': this.tone([988, 1319], 0.15, 'square', 0.07, 0.08); break;
        case 'check': this.tone([660, 880], 0.12, 'triangle', 0.12, 0.08); break;
        case 'mission': this.tone([523, 659, 784, 1047], 0.18, 'triangle', 0.12, 0.1); break;
        case 'star': this.tone([880, 660], 0.15, 'sawtooth', 0.06, 0.1); break;
        case 'wasted': this.tone([392, 330, 262, 196], 0.4, 'sawtooth', 0.08, 0.25); break;
        case 'busted': this.tone([330, 311, 294, 262], 0.35, 'square', 0.07, 0.22); break;
      }
    } catch (e) { /* audio opcional */ }
  }
}
// ---------- Música de fondo generada en el navegador ----------
// Tema tranquilo de aire mediterráneo (La menor, 92 bpm): acordes suaves, bajo, percusión ligera y
// una melodía de guitarra punteada que va variando. Se programa por adelantado con el reloj de WebAudio.
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// progresión de 8 compases (notas MIDI de cada acorde, la primera es el bajo)
const PROG = [
  [45, 57, 60, 64, 67],   // Am7
  [50, 57, 60, 62, 65],   // Dm7
  [43, 55, 59, 62, 65],   // G7
  [48, 55, 59, 60, 64],   // Cmaj7
  [41, 57, 60, 64, 65],   // Fmaj7
  [47, 57, 59, 62, 65],   // Bm7b5
  [40, 56, 59, 62, 64],   // E7
  [45, 57, 60, 64, 69],   // Am
];
const SCALE = [69, 72, 74, 76, 79, 81, 84, 86, 88]; // pentatónica de La menor

class Music {
  constructor(sfx) {
    this.sfx = sfx; this.on = false; this.bpm = 92; this.bar = 0; this.step = 0;
    this.seed = 7; this.melNote = 3;
  }
  rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  start() {
    const c = this.sfx.ctx; if (!c || this.on) return;
    this.on = true;
    if (!this.bus) {
      this.bus = c.createGain(); this.bus.gain.value = 0;
      // un toque de eco para que suene más amplio
      const delay = c.createDelay(1); delay.delayTime.value = 60 / this.bpm * 0.75;
      const fb = c.createGain(); fb.gain.value = 0.25;
      const wet = c.createGain(); wet.gain.value = 0.18;
      this.bus.connect(this.sfx.master); this.bus.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(this.sfx.master);
      this.padF = c.createBiquadFilter(); this.padF.type = 'lowpass'; this.padF.frequency.value = 900; this.padF.connect(this.bus);
    }
    this.bus.gain.setTargetAtTime(this.level || 1.0, c.currentTime, 1.5);
    this.next = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 100);
  }
  stop() {
    if (!this.on) return;
    this.on = false; clearInterval(this.timer);
    const c = this.sfx.ctx; if (c && this.bus) this.bus.gain.setTargetAtTime(0, c.currentTime, 0.4);
  }
  // más baja en pausa, normal jugando
  setLevel(v) { this.level = v; const c = this.sfx.ctx; if (c && this.bus && this.on) this.bus.gain.setTargetAtTime(v, c.currentTime, 0.5); }

  schedule() {
    const c = this.sfx.ctx, e8 = 60 / this.bpm / 2;
    while (this.next < c.currentTime + 0.4) {
      const t = this.next, st = this.step, chord = PROG[this.bar % 8];
      const swing = st % 2 ? e8 * 0.12 : 0, tt = t + swing;
      if (st === 0) this.pad(chord, t, e8 * 8);
      // bajo: tiempos 1 y 3, y un paso en la última corchea
      if (st === 0 || st === 4) this.bass(NOTE(chord[0]), tt, e8 * 1.8);
      if (st === 7) this.bass(NOTE(chord[0] + 7), tt, e8 * 0.9, 0.6);
      // percusión suave
      if (st === 0 || st === 4) this.kick(t);
      if (st === 2 || st === 6) this.rim(tt);
      this.hat(tt, st % 2 ? 0.5 : 1);
      // melodía: sólo en algunas vueltas y con silencios, para que no canse
      const section = Math.floor(this.bar / 8) % 4;
      if (section !== 0 && this.rnd() < (section === 2 ? 0.55 : 0.38)) {
        this.melNote = Math.max(0, Math.min(SCALE.length - 1, this.melNote + Math.round((this.rnd() - 0.5) * 3)));
        let n = SCALE[this.melNote];
        if (st === 0) n = chord[2] + 12; // al empezar el compás, nota del acorde
        this.pluck(NOTE(n), tt, e8 * (this.rnd() < 0.3 ? 3 : 1.5));
      }
      // arpegio de guitarra en la primera sección
      if (section === 0 && st % 2 === 0) this.pluck(NOTE(chord[1 + (st / 2) % 4] + 12), tt, e8 * 2, 0.55);
      this.next += e8;
      this.step = (st + 1) % 8;
      if (this.step === 0) this.bar++;
    }
  }
  env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  pad(chord, t, dur) {
    const c = this.sfx.ctx;
    for (const n of chord.slice(1)) for (const det of [-6, 6]) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = NOTE(n); o.detune.value = det;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.012, t + 0.6); g.gain.setValueAtTime(0.012, t + dur - 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
      o.connect(g); g.connect(this.padF); o.start(t); o.stop(t + dur + 0.4);
    }
  }
  bass(f, t, dur, v = 1) {
    const c = this.sfx.ctx, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 400;
    this.env(g, t, 0.02, 0.09 * v, dur);
    o.connect(lp); lp.connect(g); g.connect(this.bus); o.start(t); o.stop(t + dur + 0.05);
  }
  pluck(f, t, dur, v = 1) {
    const c = this.sfx.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.3);
    this.env(g, t, 0.005, 0.05 * v, Math.max(0.35, dur));
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.bus); o.start(t); o2.start(t); o.stop(t + dur + 0.4); o2.stop(t + dur + 0.4);
  }
  kick(t) {
    const c = this.sfx.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.15);
    this.env(g, t, 0.004, 0.14, 0.25);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.3);
  }
  noiseHit(t, type, freq, peak, dur) {
    const c = this.sfx.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.sfx.noise; f.type = type; f.frequency.value = freq;
    this.env(g, t, 0.002, peak, dur);
    s.connect(f); f.connect(g); g.connect(this.bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  rim(t) { this.noiseHit(t, 'bandpass', 1800, 0.05, 0.08); }
  hat(t, v) { this.noiseHit(t, 'highpass', 7000, 0.018 * v, 0.04); }
}

SB.Music = Music;
SB.Sfx = Sfx;
})();
