// MARKOV SID — simplified panel UI, screen, glue.
const COLORS = ['#ff3b6b', '#3bd1ff', '#b06bff', '#3bffa0'];
const TNAMES = ['DRUMS', 'BASS', 'LEAD', 'CHORDS'];
const ENGINES = [['CHIP', 'ANALOG', 'FM'], ['CHIP', 'FM'], ['CHIP', 'FM'], ['CHIP', 'FM']];
const PNAMES = { CHIP0: ['TUNE', 'DECAY', 'CRUNCH'], ANALOG0: ['TUNE', 'DECAY', 'PUNCH'], FM0: ['TUNE', 'DECAY', 'METAL'], CHIP: ['WAVE', 'WIDTH', 'WOBBLE'], FM: ['HARMONIC', 'METAL', 'FEEDBACK'] };
const FM_RATIOS = [0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 7];
const tr = (e, a, b, c) => ({ e, p: [a, b, c] });
const KITS = [
  { name: 'C64 CLASSIC', arpHz: 50, trk: [tr('CHIP', 0.4, 0.5, 0.4), tr('CHIP', 0, 0.95, 0.45), tr('CHIP', 0, 0.45, 0.3), tr('CHIP', 0, 0.95, 0.7)] },
  { name: 'DARK CLUB', arpHz: 50, trk: [tr('ANALOG', 0.35, 0.55, 0.7), tr('FM', 0.15, 0.45, 0.35), tr('CHIP', 0.5, 0.5, 0), tr('CHIP', 0, 0.3, 0.5)] },
  { name: 'FM GLASS', arpHz: 50, trk: [tr('FM', 0.5, 0.4, 0.5), tr('FM', 0.15, 0.3, 0.1), tr('FM', 0.6, 0.35, 0.05), tr('FM', 0.4, 0.25, 0)] },
  { name: 'HYPER SAW', arpHz: 60, trk: [tr('ANALOG', 0.5, 0.35, 0.5), tr('CHIP', 0.5, 0.5, 0), tr('CHIP', 0.5, 0.5, 0), tr('CHIP', 0.5, 0.5, 0)] },
  { name: 'BROKEN TOY', arpHz: 33, trk: [tr('CHIP', 0.8, 0.7, 0.8), tr('CHIP', 0.9, 0.5, 0), tr('FM', 0.95, 0.5, 0.2), tr('CHIP', 0.9, 0.5, 0)] },
  { name: 'METAL GRIME', arpHz: 50, trk: [tr('FM', 0.3, 0.7, 0.9), tr('CHIP', 0, 0.3, 0.6), tr('FM', 0.75, 0.8, 0.6), tr('CHIP', 0, 0.25, 0.4)] },
];
const pnames = t => PNAMES[S.trk[t].e + (t === 0 ? '0' : '')] || PNAMES[S.trk[t].e];
function pval(t, i) {
  const T = S.trk[t], v = T.p[i];
  if (t > 0 && T.e === 'CHIP' && i === 0) return ['PULSE', 'SAW', 'TRI'][Math.min(2, Math.floor(v * 3))];
  if (t > 0 && T.e === 'FM' && i === 0) return 'x' + FM_RATIOS[Math.min(8, Math.floor(v * 9))];
  return Math.round(v * 100) + '%';
}

const S = { sel: 1, wild: 0.35, dens: 0.5, dirt: 0.35, fx: 0.3, vol: 0.75, bpm: 132, swing: 0, root: 9, scale: 0, duck: 0.6, arp: [false, false, true, true], page: 'main', frozen: false, brainIdx: 0, kitIdx: 0, kitMod: false, trk: null, oct: 0, playing: false, teach: false };
if (!S.trk) S.trk = JSON.parse(JSON.stringify(KITS[0].trk));
const bank = {};
const genState = { prev: [null, null, null, null] };
let ctx = null, send = () => {}, engCur = null, engNext = null, lastBar = null;
let step = -1, stepTime = 0, popup = null, rerollFlag = false;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const brains = () => bank[S.brainIdx] || (bank[S.brainIdx] = makeBrains(BRAIN_PRESETS[S.brainIdx]));

// ---------- persistence (auto) ----------
function save() {
  try { const b = {}; for (const k in bank) b[k] = bank[k].map(x => x.toJSON()); localStorage.setItem('markovsid4', JSON.stringify({ s: { ...S, playing: false, teach: false }, b })); } catch (e) { }
}
function load() {
  try {
    const raw = localStorage.getItem('markovsid4'); if (!raw) return; const o = JSON.parse(raw);
    Object.assign(S, o.s, { playing: false, teach: false, page: 'main' });
    for (const k in o.b) { const arr = [new DrumBrain(), new NoteBrain(), new NoteBrain(), new NoteBrain()]; o.b[k].forEach((j, i) => arr[i].load(j)); bank[k] = arr; }
  } catch (e) { }
}

// ---------- engine glue ----------
function pushParams() {
  const mutes = [0, 1, 2, 3].map(t => (S.teach && t === S.sel) ? 1 : 0);
  send({ type: 'params', p: { cut: 1, res: 0, dirt: S.dirt, vol: S.vol, duck: S.duck, fx: S.fx, arpHz: KITS[S.kitIdx].arpHz }, bpm: S.bpm, swing: S.swing, mutes });
}
function pushTracks() { send({ type: 'tracks', trk: S.trk }); }
function pushKit() { S.trk = JSON.parse(JSON.stringify(KITS[S.kitIdx].trk)); S.kitMod = false; pushTracks(); pushParams(); }
function makeBar() {
  if (S.frozen && lastBar && !rerollFlag) return JSON.parse(JSON.stringify(lastBar));
  rerollFlag = false;
  const T = 0.2 + S.wild * 2.3, glitch = Math.max(0, S.wild - 0.55) * 1.4;
  lastBar = genBar(brains(), { glitch, temp: [T, T, T, T], dens: [S.dens, S.dens, S.dens, S.dens], root: S.root, scale: S.scale, arp: S.arp }, genState);
  return lastBar;
}
function sendBar() { const b = makeBar(); if (!engCur) engCur = b; else engNext = b; send({ type: 'bar', bar: b }); }
function onMsg(m) {
  if (m.type === 'step') { step = m.step; stepTime = ctx.currentTime; }
  else if (m.type === 'need') sendBar();
  else if (m.type === 'bar') {
    if (engNext) { engCur = engNext; engNext = null; }
    if (S.teach) { const br = brains()[S.sel]; if (br.barSeen.size) br.endBar(); }
  }
}
function setPlay(on) {
  S.playing = on;
  if (on) { if (!engCur) sendBar(); if (engNext) { engCur = engNext; engNext = null; } } else step = -1;
  send({ type: 'play', on });
}
const WORKLET_TAIL = "\nclass P extends AudioWorkletProcessor{constructor(){super();this.e=new Engine(sampleRate,d=>this.port.postMessage(d));this.port.onmessage=ev=>this.e.msg(ev.data);}process(i,o){const L=o[0][0],R=o[0][1]||new Float32Array(L.length);this.e.render(L,R,L.length);return true;}}\nregisterProcessor('msid',P);";
async function powerOn() {
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  let ok = false;
  try {
    const url = URL.createObjectURL(new Blob([Engine.toString() + WORKLET_TAIL], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(ctx, 'msid', { numberOfInputs: 0, outputChannelCount: [2] });
    node.port.onmessage = e => onMsg(e.data); send = d => node.port.postMessage(d); node.connect(ctx.destination); ok = true;
  } catch (e) { console.warn('worklet unavailable, using fallback', e); }
  if (!ok) {
    const eng = new Engine(ctx.sampleRate, m => setTimeout(() => onMsg(m), 0));
    const sp = ctx.createScriptProcessor(1024, 0, 2);
    sp.onaudioprocess = ev => { const L = ev.outputBuffer.getChannelData(0), R = ev.outputBuffer.getChannelData(1); eng.render(L, R, L.length); };
    send = d => eng.msg(d); sp.connect(ctx.destination);
  }
  if (ctx.state !== 'running') await ctx.resume();
  window.__msid = { ok, S };
  pushTracks(); pushParams();
}

// ---------- layouts (design units) ----------
const L = {
  wide: { w: 1000, h: 620,
    screen: [340, 22, 250], kbd: [28, 305, 944, 290], panel: [600, 120, 388, 132],
    enc: { vol: [72, 70], tempo: [200, 70], kit: [72, 160], brain: [200, 160], k0: [632, 70], k1: [736, 70], k2: [840, 70], k3: [944, 70] },
    octd: [34, 222, 76, 40], octu: [124, 222, 76, 40], q: [262, 222],
    btn: i => [608 + (i % 6) * 63.8, i < 6 ? 130 : 192, 56, 52] },
  tall: { w: 500, h: 540,
    screen: [112, 10, 276], panel: [6, 392, 488, 140],
    enc: { kit: [55, 58], brain: [55, 160], tempo: [55, 262], vol: [445, 58], k0: [70, 336], k1: [190, 336], k2: [310, 336], k3: [430, 336] },
    octd: [405, 130, 80, 44], octu: [405, 188, 80, 44], q: [425, 250],
    btn: i => [14 + (i % 6) * 79, i < 6 ? 402 : 466, 72, 56] },
};
let mode = 'wide', scale = 1;
const dev = document.getElementById('dev');
const place = [];
function at(e, fn) { place.push(() => fn(e, L[mode])); return e; }
function mk(cls, html, parent = dev) { const e = document.createElement('div'); e.className = cls; if (html) e.innerHTML = html; parent.appendChild(e); return e; }
function pos(e, x, y, w, h) { e.style.left = x + 'px'; e.style.top = y + 'px'; if (w !== undefined) e.style.width = w + 'px'; if (h !== undefined) e.style.height = h + 'px'; }

// ---------- controls ----------
function showPopup(lines, ms = 900) { popup = { lines, until: performance.now() + ms }; }
function listPopup(title, names, idx) {
  const out = [title]; for (let d = -2; d <= 2; d++) { const i = (idx + d + names.length) % names.length; out.push((d === 0 ? '>' : ' ') + String(i + 1).padStart(2, '0') + ' ' + names[i]); }
  showPopup(out, 1000);
}
function encoder(id, name, onTick, pxPerTick = 8) {
  const lb = at(mk('lbl', name), (e, l) => { const [cx, cy] = l.enc[id]; pos(e, cx - 50, cy - 44); });
  const e = at(mk('enc'), (e, l) => { const [cx, cy] = l.enc[id]; pos(e, cx - 23, cy - 23); });
  let ang = 0, last = null, acc = 0;
  const tick = d => { ang += d * 15; e.style.setProperty('--a', ang + 'deg'); onTick(d); };
  e.addEventListener('pointerdown', ev => { e.setPointerCapture(ev.pointerId); last = ev.clientY; acc = 0; ev.preventDefault(); });
  e.addEventListener('pointermove', ev => {
    if (last === null) return; acc += (last - ev.clientY) / scale; last = ev.clientY;
    while (acc >= pxPerTick) { acc -= pxPerTick; tick(1); } while (acc <= -pxPerTick) { acc += pxPerTick; tick(-1); }
  });
  const end = () => { last = null; }; e.addEventListener('pointerup', end); e.addEventListener('pointercancel', end);
  e.addEventListener('wheel', ev => { ev.preventDefault(); tick(ev.deltaY < 0 ? 1 : -1); }, { passive: false });
  return { e, lb };
}
const btns = {};
function button(id, idx, main, sub, onTap) {
  const b = mk('btn' + (onTap ? '' : ' off'), `${main}<span class="led"></span>${sub ? `<span class="sub">${sub}</span>` : ''}`);
  at(b, (e, l) => pos(e, ...(typeof idx === 'number' ? l.btn(idx) : l[idx])));
  if (onTap) {
    b.addEventListener('pointerdown', ev => { ev.preventDefault(); b.classList.add('down'); });
    const up = ev => { if (!b.classList.contains('down')) return; b.classList.remove('down'); if (ev.type === 'pointerup') onTap(); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  }
  btns[id] = { el: b, led: b.querySelector('.led') };
}

const panel = at(mk(''), (e, l) => pos(e, ...l.panel)); panel.id = 'btnpanel';
const frame = at(mk(''), (e, l) => { const [x, y, s] = l.screen; pos(e, x, y, s, s); }); frame.id = 'screenframe';
const scr = document.createElement('canvas'); scr.id = 'scr'; scr.width = 240; scr.height = 240; frame.appendChild(scr);
const g = scr.getContext('2d');

encoder('kit', 'KIT', d => { S.kitIdx = (S.kitIdx + d + KITS.length) % KITS.length; pushKit(); relabel(); listPopup('KIT', KITS.map(k => k.name), S.kitIdx); save(); }, 16);
encoder('brain', 'BRAIN', d => { S.brainIdx = (S.brainIdx + d + BRAIN_PRESETS.length) % BRAIN_PRESETS.length; if (S.teach) stopTeach(); genState.prev = [null, null, null, null]; rerollFlag = true; listPopup('BRAIN', BRAIN_PRESETS.map(b => b.name), S.brainIdx); save(); }, 16);
encoder('tempo', 'TEMPO', d => { S.bpm = clamp(S.bpm + d, 70, 200); pushParams(); showPopup(['TEMPO', S.bpm + ' BPM'], 700); }, 6);
const volEnc = encoder('vol', 'VOLUME', d => { S.vol = clamp(S.vol + d * 0.04, 0, 1); pushParams(); showPopup(['VOLUME', Math.round(S.vol * 100) + '%'], 700); }, 8);
const KNOBS = [['WILD', 'wild'], ['DENSITY', 'dens'], ['DIRT', 'dirt'], ['VERB+DLY', 'fx']];
const GKNOBS = [['SWING', 'swing'], ['ROOT', 'root'], ['SCALE', 'scale'], ['PUMP', 'duck']];
let holdT = null, holdTurned = false, holdStart = 0, latched = null, engAcc = 0, saveTimer = null;
const editT = () => holdT !== null ? holdT : latched;
const knobEls = KNOBS.map(([n, k], i) => encoder('k' + i, n, d => {
  const et = editT();
  if (et !== null) {
    holdTurned = true; const T = S.trk[et];
    if (i === 0) {
      engAcc += d; if (Math.abs(engAcc) < 3) return;
      const list = ENGINES[et]; T.e = list[(list.indexOf(T.e) + Math.sign(engAcc) + list.length) % list.length]; engAcc = 0; relabel();
    } else T.p[i - 1] = clamp(T.p[i - 1] + d * 0.025, 0, 1);
    S.kitMod = true; pushTracks(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 800);
    return;
  }
  if (S.page === 'glo') {
    if (i === 0) S.swing = clamp(S.swing + d * 0.01, 0, 0.5);
    else if (i === 1) { S.root = (S.root + d + 12) % 12; rerollFlag = true; }
    else if (i === 2) { S.scale = (S.scale + d + SCALES.length) % SCALES.length; rerollFlag = true; }
    else S.duck = clamp(S.duck + d * 0.025, 0, 1);
  } else S[k] = clamp(S[k] + d * 0.025, 0, 1);
  pushParams();
}, 7));
function relabel() {
  const et = editT();
  const names = et !== null ? ['ENGINE', ...pnames(et)] : (S.page === 'glo' ? GKNOBS : KNOBS).map(x => x[0]);
  knobEls.forEach((k, i) => k.lb.textContent = names[i]);
}

button('octd', 'octd', 'OCT−', '', () => { S.oct = clamp(S.oct - 1, -3, 3); showPopup(['OCTAVE', (S.oct > 0 ? '+' : '') + S.oct]); });
button('octu', 'octu', 'OCT+', '', () => { S.oct = clamp(S.oct + 1, -3, 3); showPopup(['OCTAVE', (S.oct > 0 ? '+' : '') + S.oct]); });
[0, 1, 2, 3].forEach(t => {
  button('t' + t, t, ['DRM', 'BAS', 'LED', 'CHD'][t], ['FX', 'SEL', 'ENV', 'LFO'][t], null);
  const b = btns['t' + t].el; b.classList.remove('off');
  b.addEventListener('pointerdown', ev => {
    ev.preventDefault(); b.classList.add('down');
    if (latched !== null && latched !== t) latched = null;
    holdT = t; holdTurned = false; holdStart = performance.now(); engAcc = 0;
    if (S.teach && t !== S.sel) stopTeach(); S.sel = t; pushParams(); relabel();
  });
  const up = ev => {
    if (!b.classList.contains('down')) return; b.classList.remove('down');
    if (holdT === t) {
      const long = performance.now() - holdStart > 450;
      if (latched === t && !long && !holdTurned) latched = null;
      else if (long && !holdTurned) latched = t;
      holdT = null;
    }
    relabel();
  };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
});
button('x4', 4, 'EDIT', '', null);
button('glo', 5, 'GLO', 'global', () => { S.page = S.page === 'glo' ? 'main' : 'glo'; relabel(); });
button('x6', 6, 'HOME', '', null); button('x7', 7, 'SAVE', '', null);
button('arp', 8, 'ARP', '', () => {
  if (S.sel === 0) { showPopup(['NO ARP', 'ON DRUMS'], 700); return; }
  S.arp[S.sel] = !S.arp[S.sel]; rerollFlag = true; save();
  showPopup([TNAMES[S.sel] + ' ARP', S.arp[S.sel] ? 'ON' : 'OFF'], 700);
});
button('seq', 9, 'FREEZE', 'SEQ', () => { S.frozen = !S.frozen; showPopup([S.frozen ? 'FROZEN' : 'EVOLVING'], 700); });
button('play', 10, 'PLAY<br>STOP', '', () => setPlay(!S.playing));
button('rec', 11, 'TEACH', 'REC', () => toggleTeach());

function startTeach() {
  S.teach = true; const br = brains()[S.sel]; br.barSeen = new Set(); if ('prev' in br) br.prev = null;
  if (!S.playing) setPlay(true); pushParams();
  showPopup(['TEACH ' + TNAMES[S.sel], S.sel === 0 ? 'LO=KICK MID=SNR HI=HAT' : 'PLAY YOUR RIFF'], 1400);
}
function stopTeach() { const br = brains()[S.sel]; if (br.barSeen.size) br.endBar(); S.teach = false; pushParams(); save(); showPopup(['LEARNED', br.bars + ' BARS'], 900); }
function toggleTeach() { if (S.teach) stopTeach(); else startTeach(); }

// ---------- keyboard (percent layout, works in both modes) ----------
const kbd = mk(''); kbd.id = 'kbd';
at(kbd, (e, l) => { if (mode === 'wide') { pos(e, ...l.kbd); document.getElementById('dev').appendChild(e); } else { e.style.cssText = ''; document.body.appendChild(e); } });
const BLACK = new Set([1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25]);
const keys = [];
{ let wi = 0;
  for (let i = 0; i < 27; i++) {
    const isB = BLACK.has(i), k = mk('key', '<span class="led"></span>', kbd);
    const PAD = 2, W = (100 - PAD * 2) / 16;
    if (isB) Object.assign(k.style, { left: (PAD + wi * W - W * 0.36) + '%', width: (W * 0.72) + '%', top: '7%', height: '33%' });
    else { Object.assign(k.style, { left: (PAD + wi * W + W * 0.06) + '%', width: (W * 0.88) + '%', top: '44%', height: '51%' }); wi++; }
    keys.push({ el: k, led: k.firstChild, black: isB, white: isB ? -1 : wi - 1, down: false, iv: 0 });
    k.addEventListener('pointerdown', ev => { ev.preventDefault(); k.setPointerCapture(ev.pointerId); keyDown(i); });
    const up = () => keyUp(i); k.addEventListener('pointerup', up); k.addEventListener('pointercancel', up);
  }
}
const lane = i => i < 9 ? 0 : i < 18 ? 1 : 2;
function liveArp(iv) { const sc = SCALES[S.scale].s, pc = ((iv % 12) + 12) % 12; return [0, sc.includes((pc + 3) % 12) ? 3 : 4, 7]; }
function keyDown(i) {
  const K = keys[i]; if (!ctx || K.down) return; K.down = true; K.el.classList.add('down');
  const t = S.sel, iv = K.iv = 5 + i + S.oct * 12 - S.root;
  if (t === 0) send({ type: 'live', track: 0, lane: lane(i), on: true });
  else send({ type: 'live', track: t, note: (t === 1 ? 36 : 48) + S.root + iv, on: true, arp: S.arp[t] ? liveArp(iv) : null, fifth: t === 3 && !S.arp[t] });
  if (S.teach && S.playing && step >= 0) {
    const dur = 60 / S.bpm / 4, s = (ctx.currentTime - stepTime) > dur / 2 ? (step + 1) % 16 : step;
    const br = brains()[t]; if (t === 0) br.add(s, lane(i)); else br.add(s, iv);
  }
}
function keyUp(i) {
  const K = keys[i]; if (!K.down) return; K.down = false; K.el.classList.remove('down');
  const t = S.sel; if (t > 0) send({ type: 'live', track: t, note: (t === 1 ? 36 : 48) + S.root + K.iv, on: false });
}
const WHITE_KEYS = 'zxcvbnm,./qwerty'.split(''), BLACK_KEYS = ['s', 'd', 'f', 'h', 'j', 'l', ';', "'", '3', '4', '6'];
const keyMap = {}; { let w = 0, b = 0; for (let i = 0; i < 27; i++) { if (BLACK.has(i)) keyMap[BLACK_KEYS[b++]] = i; else keyMap[WHITE_KEYS[w++]] = i; } }
window.addEventListener('keydown', e => {
  if (e.repeat || !ctx) return; const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); setPlay(!S.playing); return; }
  if (k === 'enter') { e.preventDefault(); toggleTeach(); return; }
  if (keyMap[k] !== undefined) { e.preventDefault(); keyDown(keyMap[k]); }
});
window.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (keyMap[k] !== undefined) keyUp(keyMap[k]); });

// ---------- LEDs ----------
function setLed(led, c) { led.style.background = c || '#8f8b84'; led.style.boxShadow = c ? `0 0 6px ${c}` : 'none'; }
function updateLeds(now) {
  const blink = Math.floor(now / 250) % 2 === 0;
  for (let t = 0; t < 4; t++) setLed(btns['t' + t].led, S.sel === t ? (latched === t && !blink ? null : COLORS[t]) : null);
  setLed(btns.glo.led, S.page === 'glo' ? '#ffffff' : null);
  setLed(btns.arp.led, S.arp[S.sel] ? COLORS[S.sel] : null);
  setLed(btns.play.led, S.playing ? '#38ff6a' : '#ff9a1f');
  setLed(btns.rec.led, S.teach ? (blink ? '#ff2a2a' : '#801010') : null);
  setLed(btns.seq.led, S.frozen ? '#ffc21f' : null);
  setLed(btns.octd.led, S.oct < 0 && (S.oct === -3 || blink) ? '#fff' : null);
  setLed(btns.octu.led, S.oct > 0 && (S.oct === 3 || blink) ? '#fff' : null);
  const bar = engCur && engCur.tracks[S.sel];
  for (const k of keys) {
    let c = null;
    if (k.down) c = COLORS[S.sel];
    else if (!k.black && S.playing && bar) { if (k.white === step) c = '#ffffff'; else if (!S.teach && bar[k.white] && bar[k.white].on) c = COLORS[S.sel] + '99'; }
    k.led.style.background = c || '#5c5953'; k.led.style.boxShadow = c ? `0 0 7px ${c}` : 'none';
  }
}

// ---------- screen: one page ----------
function txt(s, x, y, c, size = 10, align = 'left') { g.fillStyle = c; g.font = `bold ${size}px "Courier New", monospace`; g.textAlign = align; g.fillText(s, x, y); }
function drawGrid() {
  const bar = engCur, top = 20, rh = 44, x0 = 8, cw = 14.1;
  for (let t = 0; t < 4; t++) {
    const y = top + t * rh, c = COLORS[t], muted = S.teach && t === S.sel;
    txt(TNAMES[t] + (t > 0 && S.arp[t] ? ' · ARP' : ''), 8, y + 9, t === S.sel ? c : '#555', 8);
    if (t === S.sel) { g.strokeStyle = c; g.strokeRect(5.5, y + 10.5, 229, rh - 11); }
    for (let s = 0; s < 16; s++) { g.fillStyle = s % 4 === 0 ? '#24222d' : '#17151d'; g.fillRect(x0 + s * cw, y + 12, cw - 2, rh - 15); }
    for (let s = 0; s < 16; s++) {
      const x = x0 + s * cw, st = bar && bar.tracks[t][s], cy = y + 12, ch = rh - 15;
      if (st && st.on) {
        g.globalAlpha = muted ? 0.2 : 1; g.fillStyle = c;
        if (t === 0) { const lh = ch / 3; [st.h, st.s, st.k].forEach((v, l) => { if (v) g.fillRect(x + 1, cy + 1 + l * lh, cw - 4, lh - 2); }); }
        else { const lo = t === 1 ? 24 : t === 3 ? 36 : 40, hi = t === 1 ? 60 : t === 3 ? 72 : 84; const ny = cy + ch - 6 - ((st.n - lo) / (hi - lo)) * (ch - 8); g.fillRect(x + 1, clamp(ny, cy + 1, cy + ch - 6), (cw) * (st.len || 1) - 3, 4); if (st.arp) { g.fillRect(x + 1, clamp(ny, cy + 1, cy + ch - 6) - 3, 2, 2); g.fillRect(x + 5, clamp(ny, cy + 1, cy + ch - 6) - 5, 2, 2); } }
        if (st.rat > 1) { g.fillStyle = '#fff'; for (let r = 0; r < st.rat; r++) g.fillRect(x + 1 + r * 3, cy + ch - 3, 2, 2); }
        g.globalAlpha = 1;
      }
      if (s === step) { g.strokeStyle = '#fff'; g.strokeRect(x - 0.5, cy - 0.5, cw - 1, ch + 1); }
    }
    if (muted) txt('TEACHING · PLAY KEYS', 120, y + rh / 2 + 7, '#fff', 10, 'center');
  }
}
function drawGlobal() {
  const rows = [['SWING', Math.round(50 + S.swing * 50) + '%'], ['ROOT', NOTE_NAMES[S.root]], ['SCALE', SCALES[S.scale].name], ['PUMP', Math.round(S.duck * 100) + '%']];
  txt('GLOBAL', 120, 42, '#fff', 14, 'center');
  rows.forEach((r, i) => { txt(r[0], 24, 76 + i * 30, '#888', 12); txt(r[1], 216, 76 + i * 30, COLORS[i % 4], 15, 'right'); });
}
function drawSound(t) {
  const T = S.trk[t], c = COLORS[t], list = ENGINES[t];
  txt(TNAMES[t] + ' SOUND', 120, 36, c, 12, 'center');
  list.forEach((e, i) => { const on = e === T.e, w = 216 / list.length, x = 12 + i * w;
    g.fillStyle = on ? c : '#1d1b24'; g.fillRect(x + 2, 46, w - 4, 26); txt(e, x + w / 2, 63, on ? '#000' : '#777', 10, 'center'); });
  pnames(t).forEach((n, i) => { const y = 92 + i * 30;
    txt(n, 14, y + 4, '#bbb', 10); txt(pval(t, i), 226, y + 4, '#fff', 10, 'right');
    g.fillStyle = '#2a2833'; g.fillRect(14, y + 10, 212, 8); g.fillStyle = c; g.fillRect(14, y + 10, 212 * T.p[i], 8); });
  txt(latched === t ? 'TAP ' + ['DRM', 'BAS', 'LED', 'CHD'][t] + ' TO CLOSE' : 'KNOB 1 = ENGINE', 120, 188, '#666', 8, 'center');
}
function drawScreen(now) {
  g.fillStyle = '#0a0910'; g.fillRect(0, 0, 240, 240);
  g.fillStyle = '#000'; g.fillRect(0, 0, 240, 17);
  txt(BRAIN_PRESETS[S.brainIdx].name, 4, 12, '#fff', 10);
  txt((S.teach ? '● ' : S.frozen ? 'FRZ ' : '') + S.bpm, 236, 12, S.teach ? '#ff2a2a' : S.frozen ? '#ffc21f' : '#aaa', 10, 'right');
  const et = editT();
  if (et !== null) drawSound(et); else if (S.page === 'glo') drawGlobal(); else drawGrid();
  g.fillStyle = '#000'; g.fillRect(0, 196, 240, 44);
  txt(et === null && S.page === 'glo' ? 'GLOBAL · PRESS GLO TO RETURN' : 'KIT ' + KITS[S.kitIdx].name + (S.kitMod ? '*' : ''), 4, 207, '#888', 8);
  const glo = S.page === 'glo';
  const v = et !== null ? [ENGINES[et].indexOf(S.trk[et].e) / Math.max(1, ENGINES[et].length - 1), ...S.trk[et].p] : glo ? [S.swing * 2, S.root / 11, S.scale / (SCALES.length - 1), S.duck] : [S.wild, S.dens, S.dirt, S.fx];
  const names = et !== null ? ['ENGINE', ...pnames(et)] : (glo ? GKNOBS : KNOBS).map(x => x[0]);
  names.map(n => [n]).forEach(([n], i) => { const x = 4 + i * 59; txt(n, x, 221, '#bbb', 8); g.fillStyle = '#2a2833'; g.fillRect(x, 226, 54, 8); g.fillStyle = COLORS[S.sel]; g.fillRect(x, 226, 54 * v[i], 8); });
  const dmg = S.playing ? Math.max(0, S.wild - 0.5) + S.dirt * 0.25 : 0;
  if (Math.random() < dmg * 0.3) { const y = 20 + Math.random() * 170, h = 2 + Math.random() * 8, dx = (Math.random() * 2 - 1) * 12 * dmg; g.drawImage(scr, 0, y, 240, h, dx, y, 240, h); }
  if (popup && now < popup.until) {
    const n = popup.lines.length, h = 20 + n * 15, y = 108 - h / 2;
    g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillRect(24, y, 192, h); g.strokeStyle = COLORS[S.sel]; g.strokeRect(24.5, y + 0.5, 191, h - 1);
    popup.lines.forEach((l, i) => txt(l, i === 0 || n <= 3 ? 120 : 40, y + 22 + i * 15, i === 0 ? COLORS[S.sel] : '#fff', i === 0 ? 12 : 11, i === 0 || n <= 3 ? 'center' : 'left'));
  }
  g.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < 240; y += 2) g.fillRect(0, y, 240, 1);
}
function loop(now) { drawScreen(now); updateLeds(now); requestAnimationFrame(loop); }

// ---------- sizing ----------
function fit() {
  const vw = window.innerWidth, vh = window.innerHeight;
  mode = vh > vw * 1.1 ? 'tall' : 'wide';
  document.body.classList.toggle('tall', mode === 'tall');
  const l = L[mode];
  scale = mode === 'tall' ? Math.min(vw / l.w, (vh / 2) / l.h) : Math.min((vw - 16) / l.w, (vh - 28) / l.h, 1.2);
  dev.style.width = l.w + 'px'; dev.style.height = l.h + 'px'; dev.style.transform = `scale(${scale})`;
  const w = document.getElementById('wrap'); w.style.width = l.w * scale + 'px'; w.style.height = l.h * scale + 'px';
  place.forEach(f => f());
}
window.addEventListener('resize', fit);

// ---------- boot ----------
load(); fit(); requestAnimationFrame(loop);
document.getElementById('power').addEventListener('click', async () => { document.getElementById('power').style.display = 'none'; await powerOn(); showPopup(['MARKOV SID', 'PRESS PLAY'], 1500); });
const help = document.getElementById('help');
const qb = document.createElement('button'); qb.id = 'qbtn'; qb.textContent = '?'; dev.appendChild(qb); at(qb, (e, l) => pos(e, ...l.q)); fit();
qb.addEventListener('click', () => help.classList.add('show'));
help.querySelector('.close').addEventListener('click', () => help.classList.remove('show'));
