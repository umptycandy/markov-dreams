// MARKOV SID — Markov brains, presets and bar generator.
const SCALES = [
  { name: 'MINOR', s: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'PHRYGIAN', s: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'HARM MIN', s: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'MIN PENT', s: [0, 3, 5, 7, 10] },
  { name: 'DORIAN', s: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'CHROMA', s: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

class NoteBrain {
  constructor() { this.reset(); }
  reset() { this.bars = 0; this.on = new Array(16).fill(0); this.tr = {}; this.uni = {}; this.prev = null; this.barSeen = new Set(); }
  add(step, n) {
    if (!this.barSeen.has(step)) { this.on[step]++; this.barSeen.add(step); }
    this.uni[n] = (this.uni[n] || 0) + 1;
    if (this.prev !== null) { const r = this.tr[this.prev] || (this.tr[this.prev] = {}); r[n] = (r[n] || 0) + 1; }
    this.prev = n;
  }
  endBar() { this.bars++; this.barSeen = new Set(); }
  learnBars(bars) {
    const first = []; for (const b of bars) for (const v of b) if (v !== null) first.push(v);
    for (const b of bars) { b.forEach((v, s) => { if (v !== null) this.add(s, v); }); this.endBar(); }
    if (first.length) this.add(0, first[0]), this.on[0]--; // close loop transition
    this.prev = null; this.barSeen = new Set();
  }
  pOn(s) { return this.bars ? Math.min(1, this.on[s] / this.bars) : 0; }
  toJSON() { return { bars: this.bars, on: this.on, tr: this.tr, uni: this.uni }; }
  load(o) { this.reset(); Object.assign(this, { bars: o.bars, on: o.on, tr: o.tr, uni: o.uni }); }
}
class DrumBrain {
  constructor() { this.reset(); }
  reset() { this.bars = 0; this.on = [0, 1, 2].map(() => new Array(16).fill(0)); this.barSeen = new Set(); }
  add(step, lane) { const k = lane * 16 + step; if (!this.barSeen.has(k)) { this.on[lane][step]++; this.barSeen.add(k); } }
  endBar() { this.bars++; this.barSeen = new Set(); }
  learnBars(bars) { for (const b of bars) { b.forEach((lanes, s) => lanes.forEach((x, l) => { if (x) this.add(s, l); })); this.endBar(); } }
  pOn(l, s) { return this.bars ? Math.min(1, this.on[l][s] / this.bars) : 0; }
  toJSON() { return { bars: this.bars, on: this.on }; }
  load(o) { this.reset(); this.bars = o.bars; this.on = o.on; }
}

// ---- presets: notes are semitones from the root, '.' = rest ----
function parseNotes(str) { return str.trim().split(/\s+/).map(t => t === '.' ? null : parseInt(t, 10)); }
function parseDrums(k, s, h) { const out = []; for (let i = 0; i < 16; i++) out.push([k[i] === 'x' ? 1 : 0, s[i] === 'x' ? 1 : 0, h[i] === 'x' ? 1 : 0]); return out; }

const BRAIN_PRESETS = [
  { name: 'DARK ARP',
    drums: [parseDrums('x.......x.x.....', '....x.......x...', '..x...x...x...x.'), parseDrums('x.......x.....x.', '....x.......x..x', '..x...x...x.x.x.')],
    bass: ['0 . . 0 . . 0 . -2 . . -2 . . -5 .', '0 . . 0 . . 0 . 3 . . 3 . . -2 .'],
    lead: ['12 15 19 24 19 15 12 15 10 14 17 22 17 14 10 14', '12 15 19 24 19 15 12 15 8 12 15 20 15 12 7 10'],
    chord: ['0 . . . . . . . -2 . . . . . . .', '-4 . . . . . . . -2 . . . . . . .'] },
  { name: 'HYPER BASS',
    drums: [parseDrums('x...x...x...x...', '....x.......x...', 'x.xxx.xxx.xxx.xx'), parseDrums('x...x...x...x.x.', '....x.......x.xx', 'x.xxx.xxx.xxx.xx')],
    bass: ['0 12 0 12 0 12 0 12 3 15 3 15 -2 10 -2 10', '0 12 0 12 0 12 0 12 5 17 5 17 3 15 -2 10'],
    lead: ['24 . . . . . 22 . 19 . . . . . . .', '24 . . 27 . . 26 . 22 . . . 19 . . .'],
    chord: ['0 . . . . . . . 3 . . . -2 . . .', '0 . . . . . . . 5 . . . 3 . . .'] },
  { name: 'BROKEN 4/4',
    drums: [parseDrums('x..x..x...x..x..', '....x..x....x...', 'x.x.xx.x.x.x.xx.'), parseDrums('x..x......x.x...', '....x..x....x.x.', 'x.x.x.xxx.x.x.xx')],
    bass: ['0 . . 0 . . 3 . . . 0 . . -2 . .', '0 . . 0 . . 5 . . . 3 . . 7 . .'],
    lead: ['. . 12 . . 15 . . 19 . . . 17 . 15 .', '. . 12 . . 15 . . 22 . 19 . 17 . 15 12'],
    chord: ['. . 0 . . . . . . . 3 . . . . .', '. . 0 . . . . . . . -2 . . . . .'] },
  { name: 'GLASS',
    drums: [parseDrums('x.....x...x.....', '....x.......x...', '..x...x...x...x.')],
    bass: ['0 . . . . . . . -4 . . . -2 . . .', '0 . . . . . . . 3 . . . -2 . . .'],
    lead: ['24 19 15 12 24 19 15 12 22 19 15 10 22 19 15 10', '20 15 12 8 20 15 12 8 19 14 10 7 22 19 14 10'],
    chord: ['0 . . . . . . . -4 . . . -2 . . .'] },
  { name: 'BLANK', drums: [], bass: [], lead: [], chord: [] },
];

function makeBrains(preset) {
  const d = new DrumBrain(); d.learnBars(preset.drums);
  const b = new NoteBrain(); b.learnBars(preset.bass.map(parseNotes));
  const l = new NoteBrain(); l.learnBars(preset.lead.map(parseNotes));
  const c = new NoteBrain(); c.learnBars(preset.chord.map(parseNotes));
  return [d, b, l, c];
}

// ---- generation ----
function quant(n, scale) {
  const pc = ((n % 12) + 12) % 12; let best = 0, bd = 99;
  for (const s of scale) { const d = Math.min(Math.abs(s - pc), 12 - Math.abs(s - pc)); if (d < bd) { bd = d; best = s; } }
  let up = best - pc; if (up > 6) up -= 12; if (up < -6) up += 12; return n + up;
}
function pickWeighted(map, T) {
  const keys = Object.keys(map); if (!keys.length) return null;
  let tot = 0; const w = keys.map(k => { const x = Math.pow(map[k], 1 / T); tot += x; return x; });
  let r = Math.random() * tot; for (let i = 0; i < keys.length; i++) { r -= w[i]; if (r <= 0) return +keys[i]; }
  return +keys[keys.length - 1];
}
function shapeP(p, T, dens) {
  const tb = Math.max(0, Math.min(1, (T - 1) / 1.5)) * 0.35; p = p * (1 - tb) + 0.4 * tb * (p > 0 ? 1 : 0.5);
  if (dens < 0.5) p *= dens * 2; else p = p + (1 - p) * (dens - 0.5) * 2 * 0.55;
  return Math.max(0, Math.min(1, p));
}
// state: {prev:[null,null,null]} carries last note per track between bars
function genBar(brains, S, state) {
  const tracks = [[], [], [], []];
  const G = S.glitch;
  // drums
  const db = brains[0], tD = S.temp[0], dD = S.dens[0];
  for (let s = 0; s < 16; s++) {
    const lanes = [0, 1, 2].map(l => Math.random() < shapeP(db.pOn(l, s), tD, dD) ? 1 : 0);
    const on = lanes.some(x => x);
    let rat = 1; if (on && Math.random() < G * (lanes[2] ? 0.35 : 0.15)) rat = 2 + Math.floor(Math.random() * 3);
    tracks[0].push({ on, k: lanes[0], s: lanes[1], h: lanes[2], rat });
  }
  // bass + lead
  for (const t of [1, 2, 3]) {
    const br = brains[t], T = S.temp[t], dens = S.dens[t];
    const base = (t === 1 ? 36 : 48) + S.root;
    const arpOn = S.arp[t];
    const scale = SCALES[S.scale].s;
    let prev = state.prev[t] ?? null;
    for (let s = 0; s < 16; s++) {
      if (!(Math.random() < shapeP(br.pOn(s), T, dens))) { tracks[t].push({ on: false }); continue; }
      let n = null;
      const row = prev !== null ? br.tr[prev] : null;
      if (T > 1 && Math.random() < (T - 1) * 0.35) {
        const c = prev !== null ? prev : 0; n = c + Math.round((Math.random() * 2 - 1) * 9);
      } else n = pickWeighted(row && Object.keys(row).length ? row : br.uni, T);
      if (n === null) n = 0;
      n = quant(n, scale);
      if (t === 1) n = Math.max(-12, Math.min(19, n)); else if (t === 3) n = Math.max(-7, Math.min(19, n)); else n = Math.max(-5, Math.min(31, n));
      prev = n;
      let rat = 1; if (Math.random() < G * 0.12) rat = 2 + Math.floor(Math.random() * 2);
      let arp = null;
      if (arpOn && (t === 3 || Math.random() < 0.55)) {
        const pc = ((n % 12) + 12) % 12, sc = scale; const third = sc.includes((pc + 3) % 12) ? 3 : 4; const fifth = sc.includes((pc + 7) % 12) ? 7 : (sc.includes((pc + 6) % 12) ? 6 : 7);
        arp = Math.random() < 0.5 ? [0, third, fifth] : [0, third, fifth, 12];
      }
      // tie: hold a note if next step is a rest (bass mostly)
      tracks[t].push({ on: true, n: base + n, iv: n, rat: t === 3 ? 1 : rat, arp, fifth: t === 3 && !arp, len: 1 });
    }
    state.prev[t] = prev;
    // extend lengths into following rests (bass legato feel)
    for (let s = 0; s < 16; s++) { const st = tracks[t][s]; if (!st.on) continue; let L = 1; while (s + L < 16 && !tracks[t][s + L].on && L < (t === 1 ? 2 : t === 3 ? 8 : 1)) L++; st.len = L; }
  }
  // half-bar stutters
  for (let t = 0; t < 3; t++) {
    if (Math.random() < G * 0.22) { for (let s = 8; s < 16; s++) tracks[t][s] = { ...tracks[t][s - 8] }; }
    else if (Math.random() < G * 0.18) { for (let s = 12; s < 16; s++) tracks[t][s] = { ...tracks[t][s - 4] }; }
  }
  return { tracks };
}
