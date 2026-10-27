// MARKOV SID — sound engine. Pure JS (no Web Audio), runs in an AudioWorklet or a
// ScriptProcessor fallback, and is written to be ported to C for the FM-1.
// Engines: drums = CHIP | ANALOG | FM ; tonal tracks = CHIP | FM
class Engine {
  constructor(sr, post) {
    this.sr = sr; this.post = post;
    this.playing = false; this.bpm = 132; this.swing = 0;
    this.step = 0; this.sIn = 0; this.stepLen = this.calcLen(0);
    this.cur = null; this.next = null; this.mutes = [0, 0, 0, 0];
    this.frameCtr = 0;
    this.p = { dirt: 0.35, vol: 0.75, duck: 0.6, arpHz: 50, fx: 0.3 };
    // per-track sound: engine name + 3 tone params (0..1)
    this.trk = [{ e: 'CHIP', p: [0.5, 0.5, 0.5] }, { e: 'CHIP', p: [0, 0.9, 0.4] }, { e: 'CHIP', p: [0, 0.5, 0.3] }, { e: 'CHIP', p: [0, 0.9, 0.6] }];
    this.v = [null, this.mkTone(), this.mkTone(), this.mkTone()];
    this.k = { env: 0, pe: 0, ph: 0, mph: 0, nz: this.mkNoise() };
    this.s = { env: 0, ph: 0, mph: 0, hp: 0, nz: this.mkNoise() };
    this.h = { env: 0, ph: 0, mph: 0, prev: 0, hp1: 0, hp2: 0, nz: this.mkNoise() };
    this.duck = 0; this.hold = 0; this.hD = 0; this.hB = 0; this.hF = 0;
    this.sub = [null, null, null, null];
    this.rng = 22222;
    this.initFx();
  }
  // ---------- helpers ----------
  mkNoise() { return { r: 0x7ffff8, out: 0, ph: 0 }; }
  mkTone() { return { ph: 0, ph2: 0, mph: 0, mph2: 0, mprev: 0, menv: 0, freq: 110, env: 0, gate: 0, dec: 0.999, sus: 0.3, rel: 0.999, base: 45, arp: null, arpI: 0, fifth: false, pwmPh: 0, nz: this.mkNoise() }; }
  mtof(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  coef(sec) { return Math.exp(-1 / Math.max(1, sec * this.sr)); }
  rand() { this.rng = (this.rng * 1103515245 + 12345) & 0x7fffffff; return this.rng / 0x7fffffff * 2 - 1; }
  noise(nz) { const r = nz.r; const bit = ((r >> 22) ^ (r >> 17)) & 1; nz.r = ((r << 1) | bit) & 0x7fffff; nz.out = ((nz.r >> 15) & 0xff) / 127.5 - 1; }
  calcLen(step) { const base = this.sr * 60 / this.bpm / 4; return Math.round(step % 2 === 0 ? base * (1 + this.swing) : base * (1 - this.swing)); }
  initFx() {
    const sc = this.sr / 44100;
    this.dl = new Float32Array(Math.ceil(this.sr * 2)); this.dr = new Float32Array(Math.ceil(this.sr * 2)); this.dw = 0; this.dlp = 0; this.drp = 0;
    const mkC = n => ({ b: new Float32Array(Math.round(n * sc)), i: 0, f: 0 });
    this.cL = [1116, 1188, 1277, 1356].map(mkC); this.cR = [1139, 1211, 1300, 1379].map(mkC);
    this.aL = [556, 441].map(mkC); this.aR = [579, 464].map(mkC);
  }
  comb(c, x) { const y = c.b[c.i]; c.f = y * 0.72 + c.f * 0.28; c.b[c.i] = x + c.f * 0.84; if (++c.i >= c.b.length) c.i = 0; return y; }
  allp(a, x) { const y = a.b[a.i]; a.b[a.i] = x + y * 0.5; if (++a.i >= a.b.length) a.i = 0; return y - x; }
  // ---------- messages ----------
  msg(d) {
    switch (d.type) {
      case 'play':
        this.playing = d.on;
        if (d.on) { this.step = 0; this.sIn = 0; this.stepLen = this.calcLen(0); if (this.next) { this.cur = this.next; this.next = null; } this.post({ type: 'need' }); this.startStep(); }
        else for (let t = 1; t < 4; t++) this.v[t].gate = 0;
        break;
      case 'bar': if (!this.cur) this.cur = d.bar; else this.next = d.bar; break;
      case 'params': Object.assign(this.p, d.p); if (d.bpm) this.bpm = d.bpm; if (d.swing !== undefined) this.swing = d.swing; if (d.mutes) this.mutes = d.mutes; break;
      case 'tracks': this.trk = d.trk; break;
      case 'live': this.live(d); break;
    }
  }
  // ---------- triggers ----------
  // per-role envelope shapes (decay, sustain, release in seconds)
  trigTone(t, note, gateSmp, arp, fifth) {
    const v = this.v[t], T = this.trk[t];
    const env = t === 1 ? [0.25, 0.35, 0.06] : t === 2 ? [0.35, 0.3, 0.08] : [0.9, 0.55, 0.3];
    if (T.e === 'FM') { env[0] *= 1.3; env[1] *= 0.8; }
    v.dec = this.coef(env[0]); v.sus = env[1]; v.rel = this.coef(env[2]);
    v.base = note; v.freq = this.mtof(note); v.env = 1; v.menv = 1; v.gate = gateSmp; v.arp = arp; v.arpI = 0; v.fifth = !!fifth && !arp;
  }
  trigKick() { const k = this.k; k.env = 1; k.pe = 1; k.ph = 0; k.mph = 0; this.duck = 1; }
  trigSnare() { this.s.env = 1; this.s.ph = 0; }
  trigHat() { this.h.env = 1; }
  live(d) {
    if (d.track === 0) { if (!d.on) return; if (d.lane === 0) this.trigKick(); else if (d.lane === 1) this.trigSnare(); else this.trigHat(); return; }
    const v = this.v[d.track];
    if (d.on) this.trigTone(d.track, d.note, 1e9, d.arp || null, d.fifth);
    else if (Math.abs(v.base - d.note) < 0.01) v.gate = 0;
  }
  fireTrack(t, st) {
    if (this.mutes[t] || !st || !st.on) return;
    if (t === 0) { if (st.k) this.trigKick(); if (st.s) this.trigSnare(); if (st.h) this.trigHat(); }
    else this.trigTone(t, st.n, (st.len || 1) * this.stepLen * 0.9 / (st.rat || 1), st.arp || null, st.fifth);
  }
  startStep() {
    this.post({ type: 'step', step: this.step });
    if (this.step === 10) this.post({ type: 'need' });
    if (!this.cur) return;
    for (let t = 0; t < 4; t++) {
      const st = this.cur.tracks[t] && this.cur.tracks[t][this.step];
      this.sub[t] = null;
      if (!st || !st.on) continue;
      this.fireTrack(t, st);
      const r = st.rat || 1;
      if (r > 1) this.sub[t] = { st, every: Math.floor(this.stepLen / r), left: r - 1, ctr: 0 };
    }
  }
  // ---------- tonal voices ----------
  toneChip(v, p) {
    const wave = Math.min(2, Math.floor(p[0] * 3)); // pulse / saw / tri
    const inc = v.freq / this.sr; v.ph += inc; if (v.ph >= 1) v.ph -= Math.floor(v.ph);
    let out;
    if (wave === 0) { v.pwmPh += 0.7 / this.sr; const pw = 0.06 + p[1] * 0.44 + p[2] * 0.4 * Math.sin(6.2832 * v.pwmPh); out = v.ph < Math.max(0.03, Math.min(0.97, pw)) ? 1 : -1; }
    else if (wave === 1) out = 2 * v.ph - 1;
    else out = v.ph < 0.5 ? 4 * v.ph - 1 : 3 - 4 * v.ph;
    if (v.fifth) { v.ph2 += inc * 1.4983; if (v.ph2 >= 1) v.ph2 -= 1; out = out * 0.6 + (wave === 1 ? 2 * v.ph2 - 1 : v.ph2 < 0.5 ? 0.6 : -0.6) * 0.6; }
    return out;
  }
  toneFM(v, p, mDec) {
    const RATIOS = [0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 7];
    const ratio = RATIOS[Math.min(RATIOS.length - 1, Math.floor(p[0] * RATIOS.length))];
    const idx = p[1] * 9, fb = p[2] * 1.4, TAU = 6.283185;
    const inc = v.freq / this.sr;
    v.ph += inc; if (v.ph >= 1) v.ph -= 1;
    v.mph += inc * ratio; if (v.mph >= 1) v.mph -= Math.floor(v.mph);
    v.menv *= mDec;
    const m = Math.sin(TAU * v.mph + fb * v.mprev); v.mprev = m;
    const I = idx * (0.3 + 0.7 * v.menv);
    let out = Math.sin(TAU * v.ph + I * m);
    if (v.fifth) { v.ph2 += inc * 1.4983; if (v.ph2 >= 1) v.ph2 -= 1; out = out * 0.65 + Math.sin(TAU * v.ph2 + I * m) * 0.55; }
    return out * 1.15;
  }
  tone(t, mDec) {
    const v = this.v[t]; if (v.env < 1e-4 && v.gate <= 0) return 0;
    const T = this.trk[t];
    const out = T.e === 'FM' ? this.toneFM(v, T.p, mDec) : this.toneChip(v, T.p);
    if (v.gate > 0) { v.gate--; v.env = v.sus + (v.env - v.sus) * v.dec; } else v.env *= v.rel;
    return out * v.env;
  }
  // ---------- drums ----------
  drums(cache) {
    const T = this.trk[0], e = T.e, p = T.p, sr = this.sr, TAU = 6.283185;
    const tune = 0.6 + p[0] * 1.0, D = cache.dDec;
    let kick = 0, rest = 0;
    const k = this.k, s = this.s, h = this.h;
    if (k.env > 1e-4) {
      k.pe *= cache.kPe; k.env *= D.k;
      if (e === 'ANALOG') {
        const f = (44 + 120 * k.pe) * tune; k.ph += f / sr; if (k.ph >= 1) k.ph -= 1;
        let x = Math.sin(TAU * k.ph) + Math.pow(k.pe, 6) * 0.5 * p[2];
        x *= 1 + p[2] * 3; x = x / (1 + Math.abs(x)) * (1 + p[2] * 0.6);
        kick = x * k.env;
      } else if (e === 'FM') {
        const f = (48 + 140 * k.pe) * tune; k.ph += f / sr; if (k.ph >= 1) k.ph -= 1; k.mph += f / sr; if (k.mph >= 1) k.mph -= 1;
        kick = Math.sin(TAU * k.ph + (1 + p[2] * 5) * k.pe * Math.sin(TAU * k.mph)) * k.env;
      } else {
        const f = (42 + 190 * k.pe) * tune; k.ph += f / sr; if (k.ph >= 1) k.ph -= 1;
        const tri = k.ph < 0.5 ? 4 * k.ph - 1 : 3 - 4 * k.ph; kick = Math.max(-1, Math.min(1, tri * 1.8)) * k.env;
      }
      kick *= 0.95;
    }
    if (s.env > 1e-4) {
      s.env *= D.s;
      if (e === 'ANALOG') {
        s.ph += 185 * tune / sr; if (s.ph >= 1) s.ph -= 1;
        const n = this.rand(); s.hp += (n - s.hp) * 0.35; const hp = n - s.hp;
        const body = Math.sin(TAU * s.ph) * Math.pow(s.env, 3);
        rest += (body * 0.6 + hp * 0.7 * (0.5 + p[2] * 0.5)) * s.env * 0.6;
      } else if (e === 'FM') {
        s.ph += 190 * tune / sr; if (s.ph >= 1) s.ph -= 1; s.mph += 190 * tune * 2.41 / sr; if (s.mph >= 1) s.mph -= 1;
        rest += (Math.sin(TAU * s.ph + (2 + p[2] * 7) * s.env * Math.sin(TAU * s.mph)) * 0.6 + this.rand() * 0.25) * s.env * 0.55;
      } else {
        s.nz.ph += (5000 + p[2] * 9000) / sr; while (s.nz.ph >= 1) { s.nz.ph -= 1; this.noise(s.nz); }
        s.ph += 185 * tune / sr; if (s.ph >= 1) s.ph -= 1;
        rest += (s.nz.out * 0.75 + (s.ph < 0.5 ? 0.35 : -0.35) * s.env) * s.env * 0.55;
      }
    }
    if (h.env > 1e-4) {
      h.env *= D.h;
      if (e === 'ANALOG') {
        const n = this.rand(); h.hp1 += (n - h.hp1) * 0.5; const a = n - h.hp1; h.hp2 += (a - h.hp2) * 0.5; const b = a - h.hp2;
        rest += b * h.env * 0.32 * (0.7 + p[0] * 0.3);
      } else if (e === 'FM') {
        const f = 620 * tune; h.ph += f / sr; if (h.ph >= 1) h.ph -= 1; h.mph += f * (3.7 + p[2] * 4.1) / sr; if (h.mph >= 1) h.mph -= Math.floor(h.mph);
        rest += Math.sin(TAU * h.ph + 7 * Math.sin(TAU * h.mph)) * h.env * 0.2;
      } else {
        h.nz.ph += (12000 + p[2] * 12000) / sr; while (h.nz.ph >= 1) { h.nz.ph -= 1; this.noise(h.nz); }
        const hp = h.nz.out - h.prev; h.prev = h.nz.out; rest += hp * h.env * 0.22;
      }
    }
    this.kOut = kick; this.rOut = rest;
  }
  // ---------- render ----------
  render(out, outR, n) {
    const P = this.p, sr = this.sr, dirt = P.dirt;
    const drive = 1 + dirt * 14, q = Math.pow(2, 16 - dirt * 11.5 - 1), holdN = 1 + Math.floor(dirt * dirt * 7);
    const crush = x => { x = x * drive; x = x > 1 ? 1 : x < -1 ? -1 : x; x *= 0.55 / (0.55 + dirt * 0.3); return Math.round(x * q) / q; };
    const fx = P.fx, fb = 0.3 + fx * 0.3, dLen = Math.min(this.dl.length - 1, Math.round(sr * 60 / this.bpm / 4 * 3)), rvIn = 0.028;
    const dp = this.trk[0].p[1], dScale = 0.4 + dp * 1.6, e0 = this.trk[0].e;
    const cache = {
      kPe: this.coef(e0 === 'ANALOG' ? 0.045 : 0.035),
      dDec: { k: this.coef((e0 === 'ANALOG' ? 0.3 : 0.22) * dScale), s: this.coef(0.12 * dScale), h: this.coef(0.035 * dScale) },
    };
    const mDec = this.coef(0.18), dDec = this.coef(0.16);
    const frame = Math.max(1, Math.floor(sr / (P.arpHz || 50)));
    for (let i = 0; i < n; i++) {
      if (this.playing) {
        for (let t = 0; t < 4; t++) { const s = this.sub[t]; if (s && s.left > 0 && ++s.ctr >= s.every) { s.ctr = 0; s.left--; this.fireTrack(t, s.st); } }
        if (++this.sIn >= this.stepLen) {
          this.sIn = 0; this.step = (this.step + 1) % 16;
          if (this.step === 0) { if (this.next) { this.cur = this.next; this.next = null; } this.post({ type: 'bar' }); }
          this.stepLen = this.calcLen(this.step); this.startStep();
        }
      }
      if (++this.frameCtr >= frame) {
        this.frameCtr = 0;
        for (let t = 1; t < 4; t++) { const v = this.v[t]; if (v.arp && v.arp.length) { v.arpI = (v.arpI + 1) % v.arp.length; v.freq = this.mtof(v.base + v.arp[v.arpI]); } }
      }
      this.drums(cache); const kick = this.kOut, rest = this.rOut;
      const bass = this.tone(1, mDec) * 0.42;
      const fxBus = this.tone(2, mDec) * 0.3 + this.tone(3, mDec) * 0.2;
      this.duck *= dDec; const pump = 1 - P.duck * this.duck * 0.85;
      // dirt per bus: drive -> crush -> sample-rate hold
      if (++this.hold >= holdN) { this.hold = 0; this.hD = crush(kick + rest * pump); this.hB = crush(bass); this.hF = crush(fxBus); }
      const m = this.hF;
      // reverb + ping-pong delay on lead + chords only
      let wl = 0, wr = 0;
      if (fx > 0.001) {
        const rp = (this.dw - dLen + this.dl.length) % this.dl.length;
        const oL = this.dl[rp], oR = this.dr[rp];
        this.dlp += (oR - this.dlp) * 0.45; this.drp += (oL - this.drp) * 0.45;
        this.dl[this.dw] = m * fx + this.dlp * fb; this.dr[this.dw] = this.drp * fb; this.dw = (this.dw + 1) % this.dl.length;
        const rin = (m + (oL + oR) * 0.3) * fx * rvIn;
        let rl = 0, rr = 0; for (let c = 0; c < 4; c++) { rl += this.comb(this.cL[c], rin); rr += this.comb(this.cR[c], rin); }
        for (let a = 0; a < 2; a++) { rl = this.allp(this.aL[a], rl); rr = this.allp(this.aR[a], rr); }
        wl = (oL * 0.55 + rl * 1.6 * fx) * pump; wr = (oR * 0.55 + rr * 1.6 * fx) * pump;
      }
      const dry = this.hD + (this.hB + m) * pump, og = P.vol * 0.5;
      const l = (dry + wl) * og, r = (dry + wr) * og;
      out[i] = l > 0.98 ? 0.98 : l < -0.98 ? -0.98 : l; outR[i] = r > 0.98 ? 0.98 : r < -0.98 ? -0.98 : r;
    }
  }
}
