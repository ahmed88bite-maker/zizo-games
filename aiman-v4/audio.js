// Procedural WebAudio music + SFX for AI MAN (no samples, fully offline)
let ctx = null, master, musicBus, musicLP, sfxBus, NOISE = null, DIST = null;
let muted = false, track = null, step = 0, nextT = 0, timer = null, layers = 4, bpmMul = 1, duck = 1;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const A = {
  get ctx() { return ctx; },
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => { }); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
    musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 9000; musicLP.Q.value = .7;
    musicBus = ctx.createGain(); musicBus.gain.value = .42; musicBus.connect(musicLP); musicLP.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = .8; sfxBus.connect(master);
    const n = ctx.sampleRate * 1.5; NOISE = ctx.createBuffer(1, n, ctx.sampleRate); const d = NOISE.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    DIST = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; DIST[i] = Math.tanh(x * 4); }
    // iOS unlock
    try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(master); s.start(0); } catch (e) { }
    if (ctx.state === 'suspended') ctx.resume().catch(() => { });
    timer = setInterval(sched, 25);
  },
  setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : .8, ctx.currentTime, .05); },
  get muted() { return muted; },
  play(name) { if (track && track.name === name) return; track = TRACKS[name] ? Object.assign({ name }, TRACKS[name]) : null; step = 0; if (ctx) nextT = ctx.currentTime + .08; bpmMul = 1; },
  stop() { track = null; },
  setLayers(n) { layers = n; }, setBpmMul(m) { bpmMul = m; },
  setIntensity(v) { if (musicLP) musicLP.frequency.setTargetAtTime(1400 + 12000 * v * v, ctx.currentTime, .3); },
  duck(v, t = .2) { duck = v; if (musicBus) musicBus.gain.setTargetAtTime(.42 * v, ctx.currentTime, t); },
  detune() { if (!ctx) return; musicLP.frequency.setValueAtTime(500, ctx.currentTime); musicLP.frequency.setTargetAtTime(6000, ctx.currentTime + .25, .25); },
  // seconds until next beat (for syncing stomps)
  untilBeat() { if (!ctx || !track) return 0; const sp = 60 / (track.bpm * bpmMul) / 4; let k = 4 - (step % 4); return Math.max(0, nextT + (k % 4) * sp - ctx.currentTime); },
  sfx(name, a) { if (!ctx || muted) return; const f = SFX[name]; if (f) try { f(ctx.currentTime + .005, a); } catch (e) { } },
};
function sched() {
  if (!ctx || !track) return;
  const sp = 60 / (track.bpm * bpmMul) / 4;
  if (nextT < ctx.currentTime - .2) nextT = ctx.currentTime + .02;
  while (nextT < ctx.currentTime + .12) { try { track.step(step, nextT, layers, sp); } catch (e) { } nextT += sp; step++; }
}
// ---------- voices ----------
function env(g, t, a, peak, dec, sus = 0.0001) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + dec); }
function osc(type, f, t, dur, vol, out = musicBus, opts = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + (opts.glide || dur));
  if (opts.detune) o.detune.value = opts.detune;
  if (opts.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = opts.vib; lg.gain.value = f * .012; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + .05); }
  let node = o;
  if (opts.lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = opts.q || 1; fl.frequency.setValueAtTime(opts.lp, t); if (opts.lpTo) fl.frequency.exponentialRampToValueAtTime(opts.lpTo, t + (opts.lpT || dur)); node.connect(fl); node = fl; }
  if (opts.dist) { const ws = ctx.createWaveShaper(); ws.curve = DIST; node.connect(ws); node = ws; }
  node.connect(g); g.connect(opts.pan != null && ctx.createStereoPanner ? pan(opts.pan, out) : out);
  env(g, t, opts.a || .005, vol, dur); o.start(t); o.stop(t + (opts.a || .005) + dur + .05);
  return o;
}
function pan(p, out) { const s = ctx.createStereoPanner(); s.pan.value = p; s.connect(out); return s; }
function noise(t, dur, vol, type, f, q = 1, out = musicBus, fTo) {
  const s = ctx.createBufferSource(); s.buffer = NOISE; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (fTo) fl.frequency.exponentialRampToValueAtTime(fTo, t + dur);
  const g = ctx.createGain(); s.connect(fl); fl.connect(g); g.connect(out); env(g, t, .002, vol, dur); s.start(t, Math.random() * .8); s.stop(t + dur + .05);
}
const kick = (t, v = .9) => osc('sine', 150, t, .2, v, musicBus, { to: 42, glide: .12 });
const dum = (t, v = .8) => { osc('sine', 120, t, .28, v, musicBus, { to: 62, glide: .18 }); noise(t, .04, .15, 'lowpass', 600); };
const tak = (t, v = .35) => { noise(t, .06, v, 'highpass', 2500); osc('triangle', 820, t, .03, v * .4); };
const hat = (t, v = .12, open) => noise(t, open ? .14 : .03, v, 'highpass', 7500);
const clap = (t, v = .4) => { noise(t, .12, v, 'bandpass', 1500, 1.2); noise(t + .012, .1, v * .6, 'bandpass', 1900, 1.2); };
const snare = (t, v = .35) => { noise(t, .14, v, 'bandpass', 2200, .8); osc('triangle', 190, t, .07, v * .6); };
const metal = (t, v = .25) => { noise(t, .25, v, 'bandpass', 3300, 14); osc('square', 523, t, .14, v * .25, musicBus, { detune: 30 }); osc('square', 741, t, .18, v * .2); };
const taiko = (t, v = .9, f = 90) => { osc('sine', f, t, .45, v, musicBus, { to: f * .45, glide: .3 }); noise(t, .1, .3, 'lowpass', 400); };
const pluck = (t, m, v = .22, d = .25) => osc('sawtooth', mtof(m), t, d, v, musicBus, { lp: 3200, lpTo: 400, lpT: d * .7, q: 3 });
const bass = (t, m, d, v = .35, type = 'triangle', lp) => osc(type, mtof(m), t, d, v, musicBus, lp ? { lp, q: 2 } : {});
const pad = (t, ms, d, v = .05, type = 'triangle') => ms.forEach((m, i) => { osc(type, mtof(m), t, d, v, musicBus, { a: .25, detune: i % 2 ? 7 : -7 }); });
const supersaw = (t, m, d, v = .06, lp = 2600) => [-12, 0, 11].forEach(dt => osc('sawtooth', mtof(m), t, d, v, musicBus, { detune: dt, lp, lpTo: lp * .4, q: 4 }));
const bell = (t, m, v = .1) => { const o = ctx.createOscillator(), mo = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain(); o.frequency.value = mtof(m); mo.frequency.value = mtof(m) * 3.5; mg.gain.setValueAtTime(mtof(m) * 2, t); mg.gain.exponentialRampToValueAtTime(1, t + .6); mo.connect(mg); mg.connect(o.frequency); o.connect(g); g.connect(musicBus); env(g, t, .003, v, .7); o.start(t); mo.start(t); o.stop(t + .8); mo.stop(t + .8); };
const growl = (t, m, d, v = .18) => osc('sawtooth', mtof(m), t, d, v, musicBus, { lp: 900, lpTo: 200, q: 6, dist: true });
const brass = (t, ms, d, v = .07) => ms.forEach(m => [-8, 8].forEach(dt => osc('sawtooth', mtof(m), t, d, v, musicBus, { a: .02, detune: dt, lp: 2400, lpTo: 900 })));
// ---------- tracks (16 steps per bar) ----------
const D = 62, E = 52, Am = 57, CS = 61;
const HIJ = [0, 1, 4, 5, 7, 8, 10, 12], PHR = [0, 1, 3, 5, 7, 8, 10, 12], DOR = [0, 2, 3, 5, 7, 9, 10, 12], HMIN = [0, 2, 3, 5, 7, 8, 11, 12];
const sc = (root, S, deg) => root + S[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);
const TRACKS = {
  city: { bpm: 108, step(i, t, L, sp) { // D Hijaz, maqsum on darbuka, oud plucks
    const s = i % 16, bar = (i >> 4) % 4;
    if (s === 0 || s === 8) dum(t); if (s === 2 || s === 6 || s === 12) tak(t); if (s === 14) tak(t, .2);
    if (s % 2 === 0) hat(t, .06);
    if (L >= 2 && (s === 0 || s === 3 || s === 8 || s === 11)) bass(t, D - 24 + (s >= 8 && bar % 2 ? 7 : 0), sp * 2.5, .32);
    if (L >= 3) { const mel = [[0, 1, 2, 1, 0, -1, 0, 2], [3, 2, 1, 2, 4, 3, 2, 1], [4, 5, 4, 3, 2, 3, 1, 0], [2, 1, 0, 1, 2, 1, 0, 0]][bar]; if (s % 2 === 0) pluck(t, sc(D, HIJ, mel[s >> 1]), .16, .22); }
    if (L >= 4 && s === 0) pad(t, [D - 12, D - 8, D - 5], sp * 16, .035);
    if (L >= 4 && s === 0 && bar === 2) osc('sine', mtof(D + 12 + 7), t, sp * 8, .05, musicBus, { a: .1, vib: 5.5 });
  } },
  factory: { bpm: 124, step(i, t, L, sp) { // E Phrygian industrial
    const s = i % 16, bar = (i >> 4) % 4;
    if (s % 4 === 0) kick(t); if (s === 4 || s === 12) clap(t); if (s % 4 === 2) hat(t, .09); if (s === 10) metal(t);
    if (L >= 2 && s % 2 === 0) bass(t, E - 24 + ([0, 0, 1, 0][bar] && s >= 8 ? 1 : 0), sp * 1.6, .22, 'square', 700);
    if (L >= 3 && [0, 3, 6, 10, 12].includes(s)) osc('square', mtof(sc(E + 12, PHR, [4, 3, 1, 0, 1][[0, 3, 6, 10, 12].indexOf(s)] + (bar === 3 ? 2 : 0))), t, sp * 1.5, .05, musicBus, { lp: 2500 });
    if (L >= 4 && s === 0 && bar % 2 === 0) pad(t, [E - 12, E - 5, E + 1], sp * 32, .03, 'sawtooth');
  } },
  digital: { bpm: 132, step(i, t, L, sp) { // A Dorian synthwave
    const s = i % 16, bar = (i >> 4) % 4;
    if (s % 4 === 0) kick(t, .8); if (s % 2 === 0) hat(t, .07, s % 4 === 2); if (s === 4 || s === 12) snare(t, .3);
    if (bar === 3 && s >= 12) hat(t + sp / 2, .08);
    const chord = [[0, 2, 4], [3, 5, 7], [5, 7, 9], [4, 6, 8]][bar];
    if (L >= 2 && s % 2 === 0) bass(t, sc(Am - 24, DOR, chord[0]), sp * 1.4, s % 4 === 0 ? .14 : .3, 'sawtooth', 600);
    if (L >= 3) supersaw(t, sc(Am, DOR, chord[s % 3] + (s % 8 >= 4 ? 7 : 0)), sp * .9, .025, 1800 + 1200 * Math.sin(i * .2));
    if (L >= 4 && s === 0) { bell(t, sc(Am + 12, DOR, chord[2])); pad(t, chord.map(c => sc(Am - 12, DOR, c)), sp * 16, .03); }
  } },
  escape: { bpm: 150, step(i, t, L, sp) { // C# harmonic minor chase
    const s = i % 16, bar = (i >> 4) % 4;
    if (s === 0 || s === 8) taiko(t); if (s === 4 || s === 12) snare(t, .32); hat(t, s % 2 ? .05 : .08);
    if (bar === 3 && s >= 8) snare(t, .18);
    if (L >= 2 && s % 2 === 0) growl(t, CS - 24 + [0, 0, -4, -5][bar], sp * 1.8);
    if (L >= 3 && s === 0) brass(t, [CS, CS + 3, CS + 7].map(m => m + [0, 0, -4, -5][bar]), sp * 3);
    if (L >= 3 && (s === 10)) brass(t, [CS + 7, CS + 11], sp * 1.5, .05);
    if (L >= 4 && bar === 3 && s === 0) noise(t, sp * 16, .08, 'bandpass', 400, 3, musicBus, 6000);
    if (L >= 4 && s % 4 === 3) pluck(t, sc(CS + 12, HMIN, [0, 2, 4, 6, 7, 6, 4, 2][(i >> 2) % 8]), .08, .15);
  } },
  office: { bpm: 84, step(i, t, L, sp) { // lo-fi office
    const s = i % 16, bar = (i >> 4) % 4; const ch = [[0, 4, 7, 11], [5, 9, 12, 16], [2, 5, 9, 12], [7, 11, 14, 17]][bar];
    if (s === 0 || s === 10) kick(t, .5); if (s === 4 || s === 12) snare(t, .15); if (s % 2 === 0) hat(t, .04);
    if (s % 4 === 0) osc('triangle', mtof(60 + ch[(s >> 2) % 4]), t, sp * 3, .07, musicBus, { lp: 2000 });
    if (s === 0) bass(t, 36 + ch[0], sp * 8, .25);
  } },
};
// ---------- SFX ----------
const SFX = {
  card: (t, c = 0) => { const b = 76 + Math.min(c, 12); osc('square', mtof(b), t, .06, .09, sfxBus, { lp: 5000 }); osc('square', mtof(b + 7), t + .055, .1, .09, sfxBus, { lp: 5000 }); },
  ram: t => { noise(t, .03, .3, 'highpass', 4000, 1, sfxBus); [57, 64, 69].forEach(m => osc('sawtooth', mtof(m), t + .02, .3, .06, sfxBus, { lp: 1800 })); },
  over: t => { noise(t, .7, .3, 'bandpass', 300, 2, sfxBus, 5000); osc('sawtooth', 200, t, .7, .12, sfxBus, { to: 1200, glide: .7, lp: 3000 }); },
  swipe: (t, dir) => noise(t, .12, .18, 'bandpass', 1400, 2, dir && ctx.createStereoPanner ? pan(dir * .6, sfxBus) : sfxBus, 3500),
  jump: t => osc('sine', 380, t, .18, .22, sfxBus, { to: 900, glide: .15 }),
  land: t => { osc('sine', 120, t, .1, .25, sfxBus, { to: 60 }); noise(t, .06, .1, 'lowpass', 500, 1, sfxBus); },
  slide: t => noise(t, .45, .2, 'bandpass', 2500, 1, sfxBus, 600),
  near: t => { noise(t, .1, .15, 'highpass', 5000, 1, sfxBus); osc('sine', 1760, t + .03, .25, .1, sfxBus); },
  hit: t => { noise(t, .35, .5, 'lowpass', 1800, 1, sfxBus, 200); osc('sine', 110, t, .4, .5, sfxBus, { to: 40 }); },
  stumble: t => { osc('square', 300, t, .12, .1, sfxBus, { to: 150 }); noise(t, .15, .3, 'lowpass', 1200, 1, sfxBus); },
  fall: t => osc('sine', 1400, t, 1.2, .15, sfxBus, { to: 180, glide: 1.2 }),
  bonk: t => { osc('square', 520, t, .08, .15, sfxBus, { to: 260 }); osc('sine', 880, t + .08, .25, .1, sfxBus, { vib: 9 }); },
  grab: t => { [0, .12, .24].forEach(d => osc('square', 220, t + d, .08, .1, sfxBus, { to: 150, lp: 1200 })); },
  checkpoint: t => [72, 76, 79, 84].forEach((m, i) => osc('triangle', mtof(m), t + i * .07, .35, .14, sfxBus)),
  respawn: t => noise(t, .6, .25, 'bandpass', 4000, 2, sfxBus, 300),
  honk: t => { osc('square', 392, t, .25, .1, sfxBus, { lp: 1500 }); osc('square', 466, t, .25, .08, sfxBus, { lp: 1500 }); },
  siren: t => { for (let k = 0; k < 4; k++) osc('triangle', k % 2 ? 660 : 880, t + k * .22, .2, .09, sfxBus); },
  press: t => { noise(t, .3, .2, 'highpass', 3000, 1, sfxBus, 800); },
  slam: t => { osc('sine', 80, t, .4, .6, sfxBus, { to: 35 }); noise(t, .2, .4, 'lowpass', 900, 1, sfxBus); },
  laser: t => osc('sawtooth', 1200, t, .5, .08, sfxBus, { to: 300, glide: .5, lp: 3000 }),
  charge: t => osc('sine', 300, t, .9, .07, sfxBus, { to: 1600, glide: .9 }),
  glitch: t => { for (let k = 0; k < 5; k++) noise(t + k * .03, .02, .15, 'bandpass', 500 + Math.random() * 4000, 4, sfxBus); },
  stomp: t => { osc('sine', 60, t, .7, .8, sfxBus, { to: 28 }); noise(t, .5, .35, 'lowpass', 300, 1, sfxBus); },
  boom: t => { noise(t, .9, .6, 'lowpass', 1200, 1, sfxBus, 80); osc('sine', 70, t, .8, .6, sfxBus, { to: 25 }); },
  tap: t => osc('sine', 880, t, .05, .08, sfxBus),
  combo: (t, n) => [0, 4, 7].forEach((d, i) => osc('square', mtof(72 + n + d), t + i * .05, .1, .06, sfxBus, { lp: 4000 })),
  fanfare: t => { [[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79]].forEach((c, i) => c.forEach(m => osc('sawtooth', mtof(m), t + i * .16, i === 3 ? .8 : .14, .05, sfxBus, { lp: 3000 }))); },
  cheer: t => { noise(t, 1.4, .18, 'bandpass', 1200, .6, sfxBus); for (let k = 0; k < 6; k++) osc('triangle', 900 + Math.random() * 500, t + Math.random() * .8, .15, .03, sfxBus, { vib: 8 }); },
  pop: t => { osc('sine', 600, t, .08, .2, sfxBus, { to: 1400 }); noise(t, .05, .2, 'highpass', 3000, 1, sfxBus); },
  flash: t => { noise(t, .15, .3, 'highpass', 6000, 1, sfxBus); osc('sine', 2400, t, .1, .08, sfxBus); },
  whoosh: t => noise(t, .5, .25, 'bandpass', 600, 1.5, sfxBus, 4000),
  sos: t => { for (let k = 0; k < 3; k++) osc('square', 1000, t + k * .14, .08, .08, sfxBus); },
  type: t => { for (let k = 0; k < 6; k++) noise(t + k * .06 + Math.random() * .02, .02, .1, 'highpass', 3000, 1, sfxBus); },
};
