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
      // motor
      this.eng = this.ctx.createOscillator(); this.eng.type = 'sawtooth';
      this.engF = this.ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 400;
      this.engG = this.ctx.createGain(); this.engG.gain.value = 0;
      this.eng.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master); this.eng.start();
      // sirena
      this.sir = this.ctx.createOscillator(); this.sir.type = 'triangle';
      this.sirG = this.ctx.createGain(); this.sirG.gain.value = 0;
      this.sir.connect(this.sirG); this.sirG.connect(this.master); this.sir.start();
    } catch (e) { this.ctx = null; }
  }

  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.5; return this.muted; }

  engine(level, siren) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (level < 0) this.engG.gain.setTargetAtTime(0, t, 0.1);
    else {
      this.engG.gain.setTargetAtTime(0.06 + level * 0.05, t, 0.1);
      this.eng.frequency.setTargetAtTime(45 + level * 140, t, 0.08);
      this.engF.frequency.setTargetAtTime(300 + level * 900, t, 0.1);
    }
    this.sirG.gain.setTargetAtTime(siren ? 0.035 : 0, t, 0.2);
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
SB.Sfx = Sfx;
})();
