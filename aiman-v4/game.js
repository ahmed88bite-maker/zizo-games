// AI MAN v4 — PS1-style city runner built on real CC0 assets (Quaternius / Kenney) + three.js r170
// Only relative paths, no network at runtime. No in-game text (icons/numbers only).
export const BOOK_URL = '#';

import * as THREE from 'three';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { MeshoptDecoder } from './lib/meshopt_decoder.module.js';
import { mergeGeometries } from './lib/BufferGeometryUtils.js';
import { A } from './audio.js';

// ---------------------------------------------------------------- params / env
const Q = new URLSearchParams(location.search);
const AUTOPLAY = Q.get('autoplay') === '1';
const DEMO = Q.get('demo') === '1';
const START_S = Math.max(0, +Q.get('s') || 0); // debug: start distance
const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- math utils
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = V3(), _v2 = V3(), _s = V3(1, 1, 1);
const compose = (x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) => new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz));

// ---------------------------------------------------------------- level constants
const LANE_W = 2.4, LANES = [-LANE_W, 0, LANE_W];
const L = 1850;                       // level length (m)  ≈ 120 s
const CPS = [0, 320, 545, 830, 1040, 1280, 1590]; // checkpoints (respawn points)
const GRAV = 40, JUMP_V = 13.6, FASTFALL_V = -24, SLIDE_T = 0.78;
const speedAt = s => 12 + 6.5 * clamp(s / L, 0, 1);
const ROAD_HALF = 9, WALK_W = 6, BLD_X = ROAD_HALF + WALK_W; // building fronts at ±15
const VIEW_AHEAD = isMobile ? 195 : 225, VIEW_BEHIND = 30;

// ---------------------------------------------------------------- renderer
const canvas = $('c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  $('loadP').textContent = '×'; throw e;
}
const DPR = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
renderer.setPixelRatio(DPR);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
camera.position.set(0, 2.5, 6);

// ---------------------------------------------------------------- sky / fog / lights
const SKY = {
  top: new THREE.Color('#4a63b0'), mid: new THREE.Color('#d99aa6'), hor: new THREE.Color('#ffcf98'),
  glow: new THREE.Color('#ffa860'), gnd: new THREE.Color('#5d4a4c'),
};
scene.fog = new THREE.Fog(SKY.hor.clone(), 55, VIEW_AHEAD - 12);
scene.background = SKY.hor.clone();
function makeSkyMat(forEnv) {
  return new THREE.ShaderMaterial({
    uniforms: {
      top: { value: SKY.top }, mid: { value: SKY.mid }, hor: { value: SKY.hor }, glow: { value: SKY.glow }, gnd: { value: SKY.gnd },
      gdir: { value: V3(-0.32, 0.05, -1).normalize() }, env: { value: forEnv ? 1 : 0 },
    },
    vertexShader: `varying vec3 vD;
void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top, mid, hor, glow, gnd, gdir; uniform float env; varying vec3 vD;
void main(){
  vec3 d = normalize(vD); float h = d.y;
  vec3 c = mix(hor, mid, smoothstep(0.02, 0.25, h));
  c = mix(c, top, smoothstep(0.22, 0.8, h));
  float s = max(dot(d, gdir), 0.0);
  c += glow * (pow(s, 6.0) * 0.45 + pow(s, 60.0) * 0.9 + pow(s, 900.0) * 5.0);
  vec3 g = env > 0.5 ? gnd : hor * 0.95;
  c = mix(c, g, smoothstep(0.0, -0.08, h));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), makeSkyMat(false));
sky.renderOrder = -10; sky.frustumCulled = false;
scene.add(sky);
{ // environment map from the sky (gives glass/cars real reflections)
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), makeSkyMat(true)));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.75;
  pm.dispose();
}
const hemi = new THREE.HemisphereLight('#ffe2bf', '#6a5060', 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffc98a', 4.2);
const SUN_OFF = V3(13, 12, 17);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 24, bottom: -24, near: 1, far: 90 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// ---------------------------------------------------------------- canvas textures
function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  return t;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function starPath(g, cx, cy, R, r, n = 5) { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, q = i % 2 ? r : R; g.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); } g.closePath(); }
const TEX = {
  glow: canvasTex(64, 64, (g, w) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }),
  star: canvasTex(64, 64, g => { starPath(g, 32, 33, 29, 12); g.fillStyle = '#ffe14d'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff8d0'; g.stroke(); }),
  square: canvasTex(16, 16, g => { g.fillStyle = '#fff'; g.fillRect(2, 2, 12, 12); }),
  card: canvasTex(128, 176, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#b8fbff'); gr.addColorStop(0.5, '#2ee6ff'); gr.addColorStop(1, '#1a8cff');
    rr(g, 4, 4, w - 8, h - 8, 16); g.fillStyle = gr; g.fill(); g.lineWidth = 7; g.strokeStyle = '#ffffff'; g.stroke();
    g.fillStyle = '#07405a'; [[24, 34, 80], [24, 58, 60], [24, 82, 72], [24, 106, 44]].forEach(([x, y, l]) => { rr(g, x, y, l, 11, 5); g.fill(); });
    starPath(g, 92, 138, 17, 7, 4); g.fillStyle = '#ffffff'; g.fill();
  }),
  ram: canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#16a34a'; rr(g, 2, 2, w - 4, h - 22, 6); g.fill();
    g.strokeStyle = '#7dffb0'; g.lineWidth = 2; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(10 + i * 28, 10); g.lineTo(18 + i * 28, 66); g.stroke(); }
    g.fillStyle = '#0b1f14'; for (let i = 0; i < 4; i++) { rr(g, 14 + i * 60, 16, 46, 40, 4); g.fill(); }
    g.fillStyle = '#ffd36b'; for (let i = 0; i < 20; i++) g.fillRect(8 + i * 12.4, h - 20, 7, 18);
  }),
  pave: canvasTex(512, 512, (g, w) => {
    g.fillStyle = '#b9a99a'; g.fillRect(0, 0, w, w);
    const R = rng(7);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const c = 168 + R() * 30 | 0; g.fillStyle = `rgb(${c + 12},${c},${c - 14})`; g.fillRect(x * 170 + 4, y * 170 + 4, 162, 162);
      for (let k = 0; k < 220; k++) { g.fillStyle = `rgba(${R() < .5 ? '0,0,0' : '255,255,255'},${R() * .06})`; g.fillRect(x * 170 + R() * 162, y * 170 + R() * 162, 3, 3); }
    }
    g.fillStyle = 'rgba(70,55,50,.55)'; for (let i = 0; i <= 3; i++) { g.fillRect(i * 170 - 2, 0, 6, w); g.fillRect(0, i * 170 - 2, w, 6); }
  }),
  hazard: canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff3b2f'; for (let i = -2; i < 12; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 48, h); g.lineTo(i * 32 + 32, h); g.closePath(); g.fill(); }
  }),
  board: canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#ffb300'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b1b1b';
    for (let i = 0; i < 3; i++) { const x = 40 + i * 70; g.beginPath(); g.moveTo(x, 24); g.lineTo(x + 36, 64); g.lineTo(x, 104); g.lineTo(x + 18, 104); g.lineTo(x + 54, 64); g.lineTo(x + 18, 24); g.closePath(); g.fill(); }
    g.strokeStyle = '#1b1b1b'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  }),
  emblem: canvasTex(128, 128, g => {
    const gr = g.createRadialGradient(64, 64, 10, 64, 64, 62); gr.addColorStop(0, '#d9fbff'); gr.addColorStop(.7, '#2ee6ff'); gr.addColorStop(1, 'rgba(46,230,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
    g.fillStyle = '#ffd84d'; g.beginPath(); g.moveTo(72, 16); g.lineTo(38, 70); g.lineTo(62, 70); g.lineTo(52, 112); g.lineTo(92, 52); g.lineTo(66, 52); g.closePath(); g.fill();
    g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.stroke();
  }),
  book: canvasTex(256, 360, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#3346e8'); gr.addColorStop(.6, '#6a2bd6'); gr.addColorStop(1, '#2a1470');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 0, 22, h);
    g.strokeStyle = '#ffd36b'; g.lineWidth = 10; g.strokeRect(34, 14, w - 48, h - 28);
    starPath(g, w / 2 + 10, h * 0.42, 70, 30); g.fillStyle = '#ffd36b'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#fff6d6'; g.stroke();
    g.fillStyle = '#9fe8ff'; [[70, 260, 120], [86, 290, 88]].forEach(([x, y, l]) => { rr(g, x, y, l, 12, 6); g.fill(); });
  }),
  cloud: canvasTex(256, 128, (g, w, h) => {
    const R = rng(3);
    for (let i = 0; i < 26; i++) { const x = 30 + R() * 196, y = 54 + R() * 40 - Math.abs(x - 128) * 0.12, r = 18 + R() * 30; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  }),
};

// ---------------------------------------------------------------- clouds
const clouds = new THREE.Group(); scene.add(clouds);
{
  const R = rng(11);
  for (let i = 0; i < 9; i++) {
    const m = new THREE.SpriteMaterial({ map: TEX.cloud, color: new THREE.Color().setHSL(0.04 + R() * 0.05, 0.9, 0.8 + R() * 0.1), transparent: true, opacity: 0.75, fog: false, depthWrite: false });
    const sp = new THREE.Sprite(m); const a = -Math.PI / 2 + (R() - 0.5) * 2.2;
    sp.position.set(Math.cos(a) * 520, 60 + R() * 150, Math.sin(a) * 520); sp.scale.set(220 + R() * 160, 70 + R() * 40, 1);
    clouds.add(sp);
  }
}

// ---------------------------------------------------------------- loading
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const FILES = { hero: 294760, anim1: 175548, anim2: 128368, city: 2488736, props: 96820, robot: 168064 };
const loaded = {};
function setLoad(p) { $('loadF').style.width = (p * 100).toFixed(1) + '%'; $('loadP').textContent = Math.floor(p * 100) + '%'; }
function loadAll() {
  const got = {}; const total = Object.values(FILES).reduce((a, b) => a + b, 0);
  const upd = () => setLoad(Math.min(0.99, Object.values(got).reduce((a, b) => a + b, 0) / total));
  return Promise.all(Object.keys(FILES).map(k => new Promise((res, rej) => {
    loader.load(`./assets/${k}.glb`, g => { got[k] = FILES[k]; upd(); loaded[k] = g; res(); },
      e => { if (e && e.loaded) { got[k] = Math.min(e.loaded, FILES[k]) * 0.95; upd(); } }, rej);
  })));
}

// ---------------------------------------------------------------- helpers for assets
const glassMat = new THREE.MeshStandardMaterial({ color: '#2a3f5c', metalness: 0.95, roughness: 0.06, envMapIntensity: 1.6 });
function fixCityMaterials(root) {
  const done = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.material.name === 'MI_Glass') { o.material = glassMat; return; }
    const m = o.material; if (done.has(m)) return; done.add(m);
    m.vertexColors = false;
    if (m.map) m.map.anisotropy = maxAniso;
    if (/FakeInterior/.test(m.name)) { m.emissive = new THREE.Color('#ffd7a8'); m.emissiveMap = m.map; m.emissiveIntensity = 0.32; }
    if (m.name === 'MI_StreetDecals') { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
  });
}
function toFloatGeom(src, matrix) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name); if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  g.applyMatrix4(matrix);
  return g;
}
// bake a multi-mesh object (one material) into one geometry
function bakeObject(obj) {
  obj.updateMatrixWorld(true);
  const inv = obj.matrixWorld.clone().invert(); const gs = []; let mat = null;
  obj.traverse(o => { if (o.isMesh) { gs.push(toFloatGeom(o.geometry, inv.clone().multiply(o.matrixWorld))); mat = mat || o.material; } });
  const g = mergeGeometries(gs); g.computeBoundingBox(); g.computeBoundingSphere();
  return { geo: g, mat };
}
// Instanced pool: one InstancedMesh per sub-mesh of a template, managed as a compact list.
class InstPool {
  constructor(template, max, { cast = false, receive = false, tint = null } = {}) {
    template.updateMatrixWorld(true);
    const inv = template.matrixWorld.clone().invert();
    this.parts = []; this.max = max; this.items = []; this.dirty = true;
    template.traverse(o => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, max);
      im.count = 0; im.castShadow = cast; im.receiveShadow = receive;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const colorize = tint && tint(o.material);
      if (colorize) { im.setColorAt(0, new THREE.Color(1, 1, 1)); }
      scene.add(im);
      this.parts.push({ im, rel: inv.clone().multiply(o.matrixWorld), colorize });
    });
  }
  add(m, c) { if (this.items.length >= this.max) return null; const h = { m, c, i: this.items.length }; this.items.push(h); this.dirty = true; return h; }
  remove(h) { if (!h) return; const last = this.items.pop(); if (last !== h) { this.items[h.i] = last; last.i = h.i; } this.dirty = true; }
  clear() { this.items.length = 0; this.dirty = true; }
  flush() {
    if (!this.dirty) return; this.dirty = false;
    const n = this.items.length;
    for (const p of this.parts) {
      for (let i = 0; i < n; i++) {
        const it = this.items[i]; _m.multiplyMatrices(it.m, p.rel); p.im.setMatrixAt(i, _m);
        if (p.colorize) p.im.setColorAt(i, it.c || WHITE);
      }
      p.im.count = n; p.im.instanceMatrix.needsUpdate = true;
      if (p.im.instanceColor) p.im.instanceColor.needsUpdate = true;
      p.im.boundingSphere = null; p.im.visible = n > 0;
    }
  }
}
const WHITE = new THREE.Color(1, 1, 1);

// sorted stream of world items activated within a window around the player
class Stream {
  constructor(items, on, off) { this.items = items.sort((a, b) => a.s0 - b.s0); this.on = on; this.off = off; this.active = []; this.maxLen = items.reduce((m, it) => Math.max(m, it.s1 - it.s0), 1); }
  update(lo, hi) {
    const its = this.items; let a = 0, b = its.length; const key = lo - this.maxLen;
    while (a < b) { const m = (a + b) >> 1; if (its[m].s0 < key) a = m + 1; else b = m; }
    for (let i = a; i < its.length && its[i].s0 < hi; i++) { const it = its[i]; if (!it.act && it.s1 > lo && !it.dead) { it.act = true; this.active.push(it); this.on(it); } }
    for (let i = this.active.length - 1; i >= 0; i--) { const it = this.active[i]; if (it.dead || !(it.s0 < hi && it.s1 > lo)) { it.act = false; this.off(it); this.active[i] = this.active[this.active.length - 1]; this.active.pop(); } }
  }
  reset() { for (const it of this.active) { it.act = false; this.off(it); } this.active.length = 0; }
}

// ---------------------------------------------------------------- particles
class Particles {
  constructor(max, tex, blending, opacity = 1) {
    this.max = max; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.max_ = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uScale: { value: 400 }, uOpacity: { value: opacity } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale; uniform float uOpacity;
void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); float dz = -mv.z; float sz = min(size, mix(0.5, size, smoothstep(4.0, 10.0, dz))); vA = alpha * uOpacity * smoothstep(1.2, 3.2, dz); gl_PointSize = sz * uScale / max(0.1, dz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); if (gl_FragColor.a < 0.01) discard;
  #include <colorspace_fragment>
}`,
      transparent: true, depthWrite: false, blending,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5;
    scene.add(this.pts);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, color, grav = 0, drag = 0) {
    if (this.n >= this.max) return; const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.life[i] = life; this.max_[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.grav[i] = grav; this.drag[i] = drag; this.size[i] = s0; this.alpha[i] = 1;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.copy(this.n - 1, i); this.n--; continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; }
      const u = 1 - this.life[i] / this.max_[i];
      this.size[i] = lerp(this.s0[i], this.s1[i], u); this.alpha[i] = u < 0.15 ? u / 0.15 : 1 - smooth(0.5, 1, u);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
  }
  copy(a, b) {
    if (a === b) return;
    for (const arr of [this.pos, this.vel, this.col]) { arr[b * 3] = arr[a * 3]; arr[b * 3 + 1] = arr[a * 3 + 1]; arr[b * 3 + 2] = arr[a * 3 + 2]; }
    for (const arr of [this.life, this.max_, this.s0, this.s1, this.grav, this.drag, this.size, this.alpha]) arr[b] = arr[a];
  }
  clear() { this.n = 0; }
}
const FX = {
  dust: new Particles(500, TEX.glow, THREE.NormalBlending, 0.38),
  spark: new Particles(600, TEX.glow, THREE.AdditiveBlending),
  star: new Particles(120, TEX.star, THREE.NormalBlending),
  conf: new Particles(400, TEX.square, THREE.NormalBlending),
};
const C = (h) => new THREE.Color(h);
const COL = { dust: C('#8a7d70'), cyan: C('#5ef3ff'), green: C('#5dff9a'), gold: C('#ffd36b'), white: C('#ffffff'), red: C('#ff5a5a') };
const CONF = ['#ff5a7a', '#ffd36b', '#5ef3ff', '#7dff9a', '#b48bff', '#ff9a3d'].map(C);
function burst(sys, p, n, spd, life, s0, s1, color, grav = 0, drag = 2, up = 0) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, b = Math.acos(rand(-1, 1)), v = spd * rand(0.4, 1);
    sys.emit(p.x, p.y, p.z, Math.sin(b) * Math.cos(a) * v, Math.cos(b) * v * 0.7 + up, Math.sin(b) * Math.sin(a) * v, life * rand(0.6, 1.1), s0, s1, Array.isArray(color) ? color[i % color.length] : color, grav, drag);
  }
}

// ---------------------------------------------------------------- DOM refs
const ui = {
  hud: $('hud'), score: $('score'), cardV: $('cardV'), ramV: $('ramV'), combo: $('combo'), progF: $('progF'), progHero: $('progHero'),
  hint: $('hint'), speed: $('speed'), flash: $('flash'), white: $('white'), cover: $('cover'), play: $('play'), robot: $('robotBadge'), robotGap: $('robotGap'),
  pauseM: $('pauseM'), final: $('final'), prog: $('prog'),
};
const HINT_SVG = {
  up: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(20,10,40,.45)"/><path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" fill="none" stroke="#ffe36b" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(20,10,40,.45)"/><path d="M12 5v13M6.5 12.5L12 18l5.5-5.5" fill="none" stroke="#ffe36b" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  left: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(20,10,40,.45)"/><path d="M19 12H6M11.5 6.5L6 12l5.5 5.5" fill="none" stroke="#ffe36b" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(20,10,40,.45)"/><path d="M5 12h13M12.5 6.5L18 12l-5.5 5.5" fill="none" stroke="#ffe36b" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  side: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="rgba(20,10,40,.45)"/><path d="M4.5 12h15M8.5 8l-4 4 4 4M15.5 8l4 4-4 4" fill="none" stroke="#ffe36b" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 2.5L23 21.5H1z" fill="#ffcc33" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/><path d="M12 9v6" stroke="#2a1600" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="18.2" r="1.5" fill="#2a1600"/></svg>',
};
const STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2.2l2.9 6.2 6.8.7-5.1 4.6 1.5 6.7L12 17l-6.1 3.4 1.5-6.7L2.3 9.1l6.8-.7z" fill="#ffd36b" stroke="#fff4c8" stroke-width="1"/></svg>';
const STAR_OFF = '<svg viewBox="0 0 24 24"><path d="M12 2.2l2.9 6.2 6.8.7-5.1 4.6 1.5 6.7L12 17l-6.1 3.4 1.5-6.7L2.3 9.1l6.8-.7z" fill="rgba(255,255,255,.18)" stroke="rgba(255,255,255,.4)" stroke-width="1"/></svg>';
let hintKind = '', hintT = 0;
function showHint(kind, t = 1.2) { if (hintKind !== kind) { ui.hint.innerHTML = HINT_SVG[kind] || ''; ui.hint.className = 'on ' + kind; hintKind = kind; } hintT = t; }
function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

// ---------------------------------------------------------------- world objects (built after load)
const W = {}; // pools, templates
const hero = { root: new THREE.Group(), model: null, mixer: null, act: {}, cur: null, scale: 1 };
scene.add(hero.root);
const robot = { pivot: new THREE.Group(), model: null, mixer: null, act: {}, cur: null };
scene.add(robot.pivot); robot.pivot.visible = false;

function buildWorld() {
  const city = loaded.city.scene, props = loaded.props.scene;
  fixCityMaterials(city);
  const get = (root, n) => { const o = root.getObjectByName(n); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrixWorld(true); return o; };
  const brickTint = m => /Brick|Concrete/.test(m.name);
  // buildings
  W.bTypes = ['Building_Small_1', 'Building_Medium_2_001', 'Building_Large_2'].map(n => {
    const t = get(city, n); const b = new THREE.Box3().setFromObject(t);
    return { name: n, pool: new InstPool(t, 40, { tint: brickTint }), minx: b.min.x, maxx: b.max.x, w: b.max.x - b.min.x, h: b.max.y };
  });
  const street = get(city, 'Street_4Lane');
  W.street = new InstPool(street, 64, { receive: true });
  W.planterWide = new InstPool(get(city, 'Sidewalk_Planter'), 40, { receive: true });
  W.planter = new InstPool(get(city, 'Prop_Planter_Single'), 30, { receive: true });
  W.bollard = new InstPool(get(city, 'Prop_Bollard'), 80);
  W.manhole = new InstPool(get(city, 'Prop_ManholeCover'), 30, { receive: true });
  W.ac = new InstPool(get(city, 'Prop_ACUnit'), 60);
  // props (kenney) — single shared colormap material
  const kenMat = (() => { let m; props.traverse(o => { if (o.isMesh && !m) m = o.material; }); return m; })();
  kenMat.roughness = 0.42; kenMat.metalness = 0.15; kenMat.envMapIntensity = 1.2;
  const bakeMesh = name => { const { geo, mat } = bakeObject(get(props, name)); return new THREE.Mesh(geo, mat); };
  W.carMesh = {};
  for (const n of ['sedan', 'taxi', 'suv', 'van', 'police']) W.carMesh[n] = bakeMesh(n);
  W.cone = bakeMesh('cone'); W.barrier = bakeMesh('construction-barrier');
  W.lamp = new InstPool(bakeMesh('light-curved'), 40);
  W.tlight = new InstPool(bakeMesh('traffic-light'), 16);
  W.parked = {}; for (const n of ['sedan', 'taxi', 'suv', 'van']) W.parked[n] = new InstPool(W.carMesh[n], 14, { cast: true });
  // sidewalk slabs (6 x 6 m) with curb
  const walkGeo = new THREE.BoxGeometry(WALK_W, 0.18, 6);
  const walkMat = new THREE.MeshStandardMaterial({ map: TEX.pave, roughness: 0.92, metalness: 0 });
  W.ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#34323a', roughness: 0.95 }));
  W.ground.position.y = -0.04; W.ground.receiveShadow = false; scene.add(W.ground);
  W.walk = new InstPool(new THREE.Mesh(walkGeo, walkMat), 140, { receive: true });
  // trees (stylized, in planters)
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#6b4a32', roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#5e9a3a', roughness: 0.85, flatShading: true });
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 3.0, 6), trunkMat); trunk.position.y = 1.5; tree.add(trunk);
  const crown = new THREE.Mesh(mergeGeometries([
    new THREE.IcosahedronGeometry(1.5, 1).translate(0, 3.9, 0), new THREE.IcosahedronGeometry(1.1, 1).translate(0.8, 3.4, 0.3), new THREE.IcosahedronGeometry(1.05, 1).translate(-0.7, 3.5, -0.4)]), leafMat);
  tree.add(crown);
  W.tree = new InstPool(tree, 40);
  // zebra crossing stripes
  W.zebra = new InstPool(new THREE.Mesh(new THREE.PlaneGeometry(0.7, 4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), 120, { receive: true });
  // lamp glows (instanced additive quads)
  const glowMat = new THREE.MeshBasicMaterial({ map: TEX.glow, color: '#ffc477', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  W.lampGlow = new InstPool(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), glowMat), 40);

  // collectibles
  W.cardMat = new THREE.MeshStandardMaterial({ map: TEX.card, emissive: '#ffffff', emissiveMap: TEX.card, emissiveIntensity: 0.85, roughness: 0.3, metalness: 0.1 });
  W.ramMat = new THREE.MeshStandardMaterial({ map: TEX.ram, emissive: '#ffffff', emissiveMap: TEX.ram, emissiveIntensity: 0.75, roughness: 0.35, metalness: 0.3 });
  W.cardIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.7, 0.05), W.cardMat, 90);
  W.ramIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 0.36, 0.06), W.ramMat, 16);
  W.glowIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: TEX.glow, color: '#ffffff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 110);
  W.glowIM.setColorAt(0, WHITE);
  for (const im of [W.cardIM, W.ramIM, W.glowIM]) { im.count = 0; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); }
  W.cardIM.castShadow = false;

  // obstacle visual factories
  const coneRow = () => { const g = new THREE.Group(); for (const x of [-0.72, 0, 0.72]) { const c = W.cone.clone(); c.scale.setScalar(1.45); c.position.x = x; g.add(c); } return g; };
  const stripe = new THREE.MeshStandardMaterial({ map: TEX.hazard, roughness: 0.5, emissive: '#ffffff', emissiveMap: TEX.hazard, emissiveIntensity: 0.12 });
  const barrier = () => { const g = new THREE.Group(); const b = W.barrier.clone(); b.scale.set(5.5, 7.6, 10); b.rotation.y = Math.PI / 2; g.add(b);
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.05), stripe); p.position.set(0, 0.78, 0.42); g.add(p); const p2 = p.clone(); p2.position.z = -0.42; g.add(p2);
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), W.blinkMat); l.position.set(0.85, 1.08, 0); g.add(l); return g; };
  const hazardMat = new THREE.MeshStandardMaterial({ map: TEX.hazard, roughness: 0.5 });
  const boardMat = new THREE.MeshStandardMaterial({ map: TEX.board, roughness: 0.55, emissive: '#ffffff', emissiveMap: TEX.board, emissiveIntensity: 0.15 });
  const postMat = new THREE.MeshStandardMaterial({ color: '#3a3f4a', roughness: 0.4, metalness: 0.7 });
  const blinkMat = new THREE.MeshBasicMaterial({ color: '#ff4a2a' });
  W.blinkMat = blinkMat;
  const gantry = (wide) => {
    const g = new THREE.Group(); const half = wide ? 3 * LANE_W / 2 + 0.6 : 1.25;
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.6, 0.18), postMat); p.position.set(s * half, 1.8, 0); g.add(p); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.3, 0.22, 0.22), hazardMat); top.position.y = 3.55; g.add(top);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.26, 0.16), hazardMat); beam.position.y = 1.32; g.add(beam);
    const nb = wide ? 3 : 1;
    for (let i = 0; i < nb; i++) { const bd = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.05, 0.08), boardMat); bd.position.set((i - (nb - 1) / 2) * LANE_W, 2.05, 0); g.add(bd); }
    for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), blinkMat); l.position.set(s * (half - 0.25), 1.55, 0.1); g.add(l); }
    return g;
  };
  const gl = () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: '#fff3c8', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75 })); s.scale.setScalar(1.0); return s; };
  const car = (type) => () => {
    const g = new THREE.Group(); const m = W.carMesh[type].clone(); m.castShadow = true; m.scale.setScalar(1.5); g.add(m);
    const hl = new THREE.Group(); hl.visible = false; for (const x of [-0.62, 0.62]) { const s = gl(); s.position.set(x, 0.85, 2.15); hl.add(s); } g.add(hl); g.userData.hl = hl;
    if (type === 'police') {
      const bar = new THREE.Group();
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.25), new THREE.MeshBasicMaterial({ color: '#ff2a3a' }));
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.25), new THREE.MeshBasicMaterial({ color: '#2a7bff' }));
      red.position.set(-0.3, 2.02, -0.1); blue.position.set(0.3, 2.02, -0.1); bar.add(red, blue);
      const rg = gl(), bg = gl(); rg.material = rg.material.clone(); bg.material = bg.material.clone(); rg.material.color.set('#ff3040'); bg.material.color.set('#3a8bff');
      rg.position.set(-0.35, 2.1, -0.1); bg.position.set(0.35, 2.1, -0.1); rg.scale.setScalar(2.6); bg.scale.setScalar(2.6); bar.add(rg, bg);
      g.add(bar); g.userData.siren = { rg, bg };
    }
    return g;
  };
  W.fact = { cones: coneRow, barrier, gantry: () => gantry(false), gantryW: () => gantry(true), sedan: car('sedan'), taxi: car('taxi'), suv: car('suv'), van: car('van'), police: car('police') };
  W.vpool = {};

  // checkpoint gate (arch)
  const archMat = new THREE.MeshBasicMaterial({ color: '#7ff6ff', fog: false });
  W.gateFactory = (final) => {
    const g = new THREE.Group();
    const R = final ? 8.2 : 7.4;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R, final ? 0.32 : 0.22, 8, 48, Math.PI), final ? new THREE.MeshBasicMaterial({ color: '#ffd36b', fog: false }) : archMat);
    g.add(arch);
    const sm = new THREE.SpriteMaterial({ map: TEX.glow, color: final ? '#ffcf5a' : '#5ef3ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i <= 14; i++) { const a = Math.PI * i / 14; const s = new THREE.Sprite(sm); s.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); s.scale.setScalar(final ? 2.6 : 2); g.add(s); }
    const curtain = new THREE.Mesh(new THREE.CircleGeometry(R, 40, 0, Math.PI), new THREE.MeshBasicMaterial({ color: final ? '#ffd36b' : '#5ef3ff', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    g.add(curtain); g.userData.curtain = curtain;
    return g;
  };

  // 3D book (end)
  const bookMats = [new THREE.MeshStandardMaterial({ color: '#f3ead6', roughness: .8 }), new THREE.MeshStandardMaterial({ color: '#2a1470' }),
    new THREE.MeshStandardMaterial({ color: '#f3ead6', roughness: .8 }), new THREE.MeshStandardMaterial({ color: '#f3ead6', roughness: .8 }),
    new THREE.MeshStandardMaterial({ map: TEX.book, emissive: '#ffffff', emissiveMap: TEX.book, emissiveIntensity: 0.45, roughness: 0.35 }), new THREE.MeshStandardMaterial({ color: '#3346e8' })];
  W.book = new THREE.Group();
  const bk = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.86, 0.12), bookMats); W.book.add(bk);
  const bglow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: '#ffcf5a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); bglow.scale.setScalar(2.4); bglow.position.z = -0.1; W.book.add(bglow);
  W.book.visible = false; scene.add(W.book);
}

// ---------------------------------------------------------------- hero setup
function cleanClip(clip) {
  for (const t of clip.tracks) {
    const v = t.values;
    if (t.name === 'root.position') { for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 1] = v[1]; v[i + 2] = v[2]; } }
    else if (t.name === 'pelvis.position') { for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 1] = v[1]; } }
  }
  return clip;
}
function buildHero() {
  const m = loaded.hero.scene;
  m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; o.material.vertexColors = false; if (o.material.map) o.material.map.anisotropy = maxAniso; } });
  const sm = m.getObjectByName('SuperHero_Male'); if (sm) { sm.material.roughness = 0.42; sm.material.envMapIntensity = 1.1; }
  hero.mixer = new THREE.AnimationMixer(m);
  for (const c of [...loaded.anim1.animations, ...loaded.anim2.animations]) { const a = hero.mixer.clipAction(cleanClip(c)); hero.act[c.name] = a; }
  for (const n of ['Jump_Start', 'Jump_Land', 'NinjaJump_Start', 'NinjaJump_Land', 'Slide_Start', 'Slide_Exit', 'Hit_Knockback', 'Hit_Chest', 'Death01', 'Roll']) { const a = hero.act[n]; if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
  hero.act.Idle_Loop.play(); hero.cur = hero.act.Idle_Loop; hero.mixer.update(0.01);
  m.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(m, true);
  const h = b.max.y - b.min.y || 1.8;
  hero.scale = 1.8 / h;
  const model = new THREE.Group(); model.add(m); m.scale.setScalar(hero.scale); m.position.y = -b.min.y * hero.scale;
  hero.inner = m; hero.model = model; hero.root.add(model);
  model.rotation.y = Math.PI; // face -Z (running direction)
  // chest emblem (AI MAN logo glow) attached to the chest bone
  const chest = m.getObjectByName('spine_03');
  if (chest) {
    m.updateMatrixWorld(true);
    const cp = chest.getWorldPosition(V3());
    const em = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshBasicMaterial({ map: TEX.emblem, transparent: true, depthWrite: false }));
    // model is rotated (facing -Z) — compute in model space by temporarily resetting
    model.rotation.y = 0; model.updateMatrixWorld(true);
    chest.getWorldPosition(cp);
    const wb = new THREE.Box3().setFromObject(m, true);
    em.position.set(cp.x, cp.y + 0.06, wb.max.z - 0.015 > cp.z ? Math.min(wb.max.z - 0.02, cp.z + 0.16) : cp.z + 0.14);
    scene.add(em); em.updateMatrixWorld(true); chest.attach(em);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: '#5ef3ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
    halo.scale.setScalar(0.5 / hero.scale); em.add(halo);
    model.rotation.y = Math.PI;
  }
  // dizzy stars
  hero.stars = new THREE.Group(); hero.root.add(hero.stars); hero.stars.visible = false;
  for (let i = 0; i < 5; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.star, depthWrite: false, transparent: true })); s.scale.setScalar(0.32); hero.stars.add(s); }
}
function playA(name, fade = 0.15, ts = 1, t0 = 0) {
  const a = hero.act[name]; if (!a) return;
  a.timeScale = ts;
  if (hero.cur === a && a.isRunning()) return;
  a.reset(); a.time = t0; a.setEffectiveWeight(1); a.play();
  if (hero.cur && hero.cur !== a) hero.cur.crossFadeTo(a, fade, false);
  hero.cur = a;
}
function buildRobot() {
  const m = loaded.robot.scene;
  m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.material.name === 'Main') { o.material.color.set('#e0782a'); o.material.roughness = 0.35; o.material.metalness = 0.3; } } });
  robot.mixer = new THREE.AnimationMixer(m);
  for (const c of loaded.robot.animations) robot.act[c.name] = robot.mixer.clipAction(c);
  robot.act.Running.play(); robot.cur = robot.act.Running; robot.mixer.update(0.01);
  m.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(m, true);
  const s = 7.2 / (b.max.y - b.min.y || 1);
  const inner = new THREE.Group(); inner.add(m); m.scale.multiplyScalar(s); m.position.y = -b.min.y * s;
  inner.rotation.y = Math.PI; robot.model = inner; robot.pivot.add(inner);
  // glowing eyes for menace
  const eye = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: '#ff4030', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  eye.scale.setScalar(2.2); eye.position.set(0, 5.9, -1.1); robot.pivot.add(eye); robot.eye = eye;
}
function robotPlay(n, fade = 0.3) { const a = robot.act[n]; if (!a || robot.cur === a) return; a.reset().play(); if (robot.cur) robot.cur.crossFadeTo(a, fade, false); robot.cur = a; }

// ---------------------------------------------------------------- level generation
const LV = { obst: [], items: [], decor: [], events: [], gates: [] };
function genLevel() {
  const R = rng(20251117);
  const pick = a => a[Math.floor(R() * a.length)];
  const O = LV.obst, I = LV.items, D = LV.decor;
  const crossings = [480, 1090, 1450, 1180].sort((a, b) => a - b); // side streets (police ones included)
  // ---------- decor: street tiles, sidewalks, curb props
  const T6 = 6;
  for (let s = -246; s < L + 320; s += T6) {
    const k = Math.round(s / T6), r = rng(k * 7919 + 13);
    const inCross = crossings.some(c => Math.abs(s + 3 - c) < 9);
    D.push({ s0: s, s1: s + T6, pool: 'street', m: compose(0, 0, -(s + 3), Math.PI / 2, 1.012, 1, 1) });
    for (const side of [-1, 1]) {
      if (!inCross) D.push({ s0: s, s1: s + T6, pool: 'walk', m: compose(side * (ROAD_HALF + WALK_W / 2), 0.09 - 0.0, -(s + 3)) });
      if (inCross) continue;
      if (k % 4 === (side > 0 ? 0 : 2)) { // lamp + glow
        D.push({ s0: s, s1: s + 2, pool: 'lamp', m: compose(side * (ROAD_HALF + 0.6), 0.18, -(s + 3), side < 0 ? -Math.PI / 2 : Math.PI / 2, 8) });
        D.push({ s0: s, s1: s + 2, pool: 'lampGlow', m: compose(side * (ROAD_HALF + 0.6 - 1.55), 5.05, -(s + 3), 0, 1) });
      }
      if (k % 4 === (side > 0 ? 2 : 0) && r() < 0.8) { D.push({ s0: s, s1: s + 3, pool: 'planterWide', m: compose(side * (ROAD_HALF + 2.0), 0.18, -(s + 3)) }); D.push({ s0: s, s1: s + 3, pool: 'tree', m: compose(side * (ROAD_HALF + 2.0), 0.4, -(s + 3), r() * 6, 0.85 + r() * 0.35) }); }
      if (r() < 0.25) for (let b = 0; b < 3; b++) D.push({ s0: s, s1: s + 6, pool: 'bollard', m: compose(side * (ROAD_HALF + 0.45), 0.18, -(s + 1 + b * 1.6), 0, 1.15) });
      if (r() < 0.12) D.push({ s0: s, s1: s + 6, pool: 'planter', m: compose(side * (BLD_X - 1.8), 0.18, -(s + 3), 0, 0.9) });
    }
    if (r() < 0.18) D.push({ s0: s, s1: s + 6, pool: 'manhole', m: compose(pick([-4.5, 4.5, -6.5, 6.5]), 0.01, -(s + 3)) });
  }
  // crossings: side street tiles, zebra stripes, traffic lights
  for (const c of crossings) {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) D.push({ s0: c - 9, s1: c + 9, pool: 'street', m: compose(side * (ROAD_HALF + 3 + k * 6), -0.005, -c, 0) });
      D.push({ s0: c - 12, s1: c + 12, pool: 'tlight', m: compose(side * (ROAD_HALF + 0.5), 0.0, -(c + side * 10), side < 0 ? Math.PI : 0, 8.5) });
      // corner sidewalks fill
      D.push({ s0: c - 12, s1: c + 12, pool: 'walk', m: compose(side * (ROAD_HALF + WALK_W / 2), 0.09, -(c + 9.6), 0, 1, 1, 0.2) });
    }
    for (let i = 0; i < 12; i++) D.push({ s0: c + 9, s1: c + 13, pool: 'zebra', m: compose(-7.7 + i * 1.4, 0.012, -(c + 11)) });
    // backdrop buildings at the end of the side street
    for (const side of [-1, 1]) { const bt = pick([0, 1, 2]); D.push({ s0: c - 20, s1: c + 20, pool: 'b' + bt, m: compose(side * 40, 0, -c, side < 0 ? Math.PI / 2 : -Math.PI / 2, 1), c: null }); }
  }
  // buildings on both sides, packed along the street
  const tints = ['#ffffff', '#ffe0cc', '#dbe6ff', '#fff0b8', '#ead6ff', '#d6f5e6', '#ffd0d0'].map(h => new THREE.Color(h));
  for (const side of [-1, 1]) {
    let s = -250; let last = -1;
    while (s < L + 320) {
      const cross = crossings.find(c => s + 4 > c - 11 && s < c + 11);
      if (cross !== undefined) { s = cross + 11; continue; }
      let ti = Math.floor(R() * 3); if (ti === last) ti = (ti + 1 + Math.floor(R() * 2)) % 3; last = ti;
      const bt = W.bTypes[ti]; const w = bt.w;
      const nextCross = crossings.find(c => c - 11 > s && c - 11 < s + w);
      if (nextCross !== undefined) { s = nextCross + 11; continue; }
      const ys = 0.92 + R() * 0.3;
      const z0 = side < 0 ? -(s + w) + bt.maxx : -(s + w) - bt.minx;
      D.push({ s0: s, s1: s + w, pool: 'b' + ti, m: compose(side * BLD_X, 0, z0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 1, ys, 1), c: pick(tints) });
      // AC units on facades
      if (R() < 0.6) for (let k = 0; k < 2; k++) D.push({ s0: s, s1: s + w, pool: 'ac', m: compose(side * (BLD_X - 0.05), 6 + R() * (bt.h * ys - 9), -(s + 2 + R() * (w - 4)), side < 0 ? Math.PI / 2 : -Math.PI / 2, 1.5) });
      s += w + 0.15;
    }
  }
  // parked cars along the curb (decor)
  const carNames = ['sedan', 'taxi', 'suv', 'van'];
  for (const side of [-1, 1]) {
    for (let s = -230; s < L + 300; s += 9 + R() * 26) {
      if (s > -14 && s < 14) continue;
      if (crossings.some(c => Math.abs(s - c) < 16)) continue;
      D.push({ s0: s - 3, s1: s + 3, pool: 'parked_' + pick(carNames), m: compose(side * 7.75, 0, -s, side < 0 ? 0 : Math.PI, 1.5) });
    }
  }

  // ---------- gameplay
  let id = 0;
  const vAt = speedAt;
  const ob = (o) => { o.id = id++; O.push(o); return o; };
  const card = (lane, s, y = 1.0) => I.push({ k: 'card', x: LANES[lane + 1], s, y, s0: s - 1, s1: s + 1 });
  const ram = (lane, s, y = 1.0) => I.push({ k: 'ram', x: LANES[lane + 1], s, y, s0: s - 1, s1: s + 1 });
  const line = (lane, s0, n = 5, sp = 3) => { for (let i = 0; i < n; i++) card(lane, s0 + i * sp); };
  const arc = (lane, sc, withRam) => { for (let i = 0; i < 5; i++) { const u = i / 4 * 2 - 1; const y = 1.0 + 1.5 * (1 - u * u); if (withRam && i === 2) ram(lane, sc + u * 6, y); else card(lane, sc + u * 6, y); } };
  const lowRow = (lane, s, kind) => ob({ t: 'low', v: kind, lane, s, hw: 1.0, hd: kind === 'cones' ? 0.35 : 0.42, y0: 0, y1: kind === 'cones' ? 0.88 : 1.02 });
  const highRow = (lane, s, wide) => ob({ t: 'high', v: wide ? 'gantryW' : 'gantry', lane: wide ? 0 : lane, s, hw: wide ? 3 * LANE_W / 2 + 0.6 : 1.2, hd: 0.2, y0: 1.18, y1: 3.6 });
  const parked = (lane, s) => ob({ t: 'full', v: pick(carNames), lane, s, hw: 1.1, hd: 2.0, y0: 0, y1: 1.95, rot: R() < 0.5 ? Math.PI : 0 });
  const oncoming = (lane, s, k = 0.5) => ob({ t: 'full', v: pick(carNames), lane, s, hw: 1.1, hd: 2.0, y0: 0, y1: 1.95, move: 'oncoming', k, rot: 0 });
  const laneFreeUntil = [0, 0, 0];
  const hints = LV.events;
  // tutorial
  line(0, 25, 6);
  lowRow(0, 80, 'cones'); hints.push({ type: 'hint', kind: 'up', s: 80 }); arc(0, 80);
  highRow(0, 150, true); hints.push({ type: 'hint', kind: 'down', s: 150 }); line(0, 140, 4, 2.6);
  parked(0, 220); hints.push({ type: 'hint', kind: 'side', s: 220 }); line(-1, 205, 5); line(1, 205, 5);
  for (const l of [-1, 0, 1]) lowRow(l, 290, 'barrier'); hints.push({ type: 'hint', kind: 'up', s: 290 }); arc(0, 290, true);

  function rowsBetween(a, b, density = 1) {
    let s = a;
    while (s < b) {
      const d = clamp(s / L, 0, 1), v = vAt(s);
      const gapS = lerp(2.3, 1.25, d) / density;
      s += gapS * v * (0.85 + R() * 0.3);
      if (s > b) break;
      const r = R();
      const freeLanes = [-1, 0, 1].filter(l => laneFreeUntil[l + 1] < s - 6);
      if (freeLanes.length < 3) { // a moving car is coming in some lane: keep it simple
        const l = pick(freeLanes.length ? freeLanes : [0]);
        if (R() < 0.5) lowRow(l, s, R() < 0.5 ? 'cones' : 'barrier'); else line(l, s - 10, 4);
        continue;
      }
      if (r < 0.12 && d > 0.15) { // full-width jump
        for (const l of [-1, 0, 1]) lowRow(l, s, 'barrier'); arc(pick([-1, 0, 1]), s, R() < 0.3);
      } else if (r < 0.24 && d > 0.1) { // full-width slide
        highRow(0, s, true); line(pick([-1, 0, 1]), s - 4, 4, 2.4);
      } else if (r < 0.42 && d > 0.2) { // oncoming car (telegraphed)
        const l = pick([-1, 0, 1]); oncoming(l, s, 0.45 + d * 0.4); laneFreeUntil[l + 1] = s + 95;
        const other = pick([-1, 0, 1].filter(x => x !== l)); line(other, s - 8, 5);
      } else {
        const n = R() < 0.25 + d * 0.55 ? 2 : 1;
        const lanes = [-1, 0, 1].sort(() => R() - 0.5).slice(0, n);
        let fulls = 0;
        for (const l of lanes) {
          const q = R();
          if (q < 0.34) { lowRow(l, s, R() < 0.5 ? 'cones' : 'barrier'); if (R() < 0.5) arc(l, s, R() < 0.25); }
          else if (q < 0.6) highRow(l, s, false);
          else if (fulls < 1) { parked(l, s); fulls++; }
          else lowRow(l, s, 'cones');
        }
        const free = [-1, 0, 1].filter(l => !lanes.includes(l));
        if (free.length && R() < 0.75) line(pick(free), s - 12, 5);
      }
    }
  }
  rowsBetween(320, 540);
  // ROBOT CHASE 1
  LV.events.push({ type: 'robot', s0: 560, s1: 820, front0: 572, front1: 622, trip: 780 });
  line(0, 575, 12, 3.5);
  rowsBetween(630, 770, 0.8);
  rowsBetween(830, 890);
  // CONVOY (3 oncoming cars weaving)
  LV.events.push({ type: 'warn', s: 920 });
  const conv = [[950, 1, 0.3], [985, -1, 1.7], [1020, 0, 3.1]];
  conv.forEach(([sm, fin, ph], i) => ob({ t: 'full', v: ['taxi', 'van', 'suv'][i], lane: fin, s: sm, hw: 1.1, hd: 2.0, y0: 0, y1: 1.95, move: 'swerve', k: 0.55, phase: ph, rot: 0, honk: true }));
  line(-1, 945, 3); line(1, 980, 3); line(-1, 1015, 3);
  rowsBetween(1035, 1070);
  // POLICE crossing 1
  ob({ t: 'full', v: 'police', lane: 0, s: 1090, hw: 2.35, hd: 1.15, y0: 0, y1: 2.0, move: 'police', side: 1, open: -1 });
  line(-1, 1070, 6);
  rowsBetween(1110, 1240);
  // awning/barrier chain
  for (let i = 0; i < 6; i++) { const s = 1290 + i * 22; if (i % 2 === 0) highRow(0, s, true); else for (const l of [-1, 0, 1]) lowRow(l, s, 'barrier'); card(0, s - 9); card(0, s - 6); }
  ram(0, 1290 + 5 * 22, 2.6);
  rowsBetween(1420, 1435);
  ob({ t: 'full', v: 'police', lane: 0, s: 1450, hw: 2.35, hd: 1.15, y0: 0, y1: 2.0, move: 'police', side: -1, open: 1 });
  line(1, 1430, 6);
  rowsBetween(1470, 1590);
  // ROBOT CHASE 2 (finale)
  LV.events.push({ type: 'robot', s0: 1600, s1: 1790, front0: 1612, front1: 1660, trip: 1770 });
  line(0, 1615, 12, 3.5);
  rowsBetween(1665, 1755, 0.85);
  // book-shaped card formation before the finish
  for (let r = 0; r < 6; r++) for (const l of [-1, 0, 1]) if (r === 0 || r === 5 || l !== 0 || r === 2) card(l, 1792 + r * 3.2, 1.0);
  ram(0, 1800, 1.0);
  // checkpoints & finish
  CPS.slice(1).forEach(s => LV.gates.push({ s, final: false }));
  LV.gates.push({ s: L, final: true });
  // sort / bounds for streams
  for (const o of O) { o.s0 = o.s - 30; o.s1 = o.s + 6; }
  // ram every ~15 s in risky spots: sprinkle remaining
  let lastRam = 0;
  for (const o of O) if (o.t === 'low' && o.s - lastRam > 220 && o.lane === 0) { ram(0, o.s, 2.5); lastRam = o.s; }
  LV.totalCards = I.filter(i => i.k === 'card').length;
}
// moving-obstacle kinematics (pure functions of player distance sp — respawn-proof)
function obPose(o, sp, out) {
  const v = speedAt(o.s);
  let x = LANES[o.lane + 1], z = -o.s, ry = o.rot || 0;
  if (o.move === 'oncoming') { z = -o.s - (o.s - sp) * o.k; }
  else if (o.move === 'swerve') {
    z = -o.s - (o.s - sp) * o.k;
    const d = o.s - sp; const dSet = v * 1.1, dW = dSet + 16;
    const weave = Math.sin(d * 0.07 + o.phase) * LANE_W;
    const wv = Math.sin(d * 0.07 + o.phase) ; const t = smooth(dW, dSet, d);
    x = lerp(weave, LANES[o.lane + 1], t);
    ry = (1 - t) * Math.cos(d * 0.07 + o.phase) * -0.35 + (wv * 0);
  } else if (o.move === 'police') {
    const d = o.s - sp; const d0 = v * 3.1, d1 = v * 1.55;
    const fx = -o.open * 1.25;
    const u = smooth(d1, d0, d); // 1 = far (start), 0 = stopped
    x = fx + (o.side * 24 - fx) * u;
    ry = (o.side > 0 ? -Math.PI / 2 : Math.PI / 2) + o.side * 0.45 * (1 - u) * (1 - u);
  }
  out.x = x; out.z = z; out.ry = ry;
  return out;
}
const _pose = { x: 0, z: 0, ry: 0 };
function obBox(o, sp, b) {
  obPose(o, sp, _pose);
  b.x0 = _pose.x - o.hw; b.x1 = _pose.x + o.hw; b.z0 = _pose.z - o.hd; b.z1 = _pose.z + o.hd; b.y0 = o.y0; b.y1 = o.y1;
  return b;
}

// ---------------------------------------------------------------- game state
const G = {
  state: 'loading', paused: false, t: 0, ts: 1, freeze: 0, trauma: 0, camMode: 'cover',
  score: 0, cards: 0, rams: 0, hits: 0, combo: 0, mult: 1, lastCP: 0, cpPassed: new Set(), dist: 0,
};
const P = { s: 0, x: 0, lane: 0, y: 0, vy: 0, air: false, slide: 0, wantSlide: false, inv: 0, speedMul: 1, v: 0, hitT: 0, fly: null, zOff: 0, dustT: 0, squash: 0, fastFall: false, leanV: 0, prevX: 0 };
let streams = null;
const activeVis = new Map(); // obstacle id -> group
const gateVis = new Map();
const inBuf = [];

function vget(type) { const p = W.vpool[type] || (W.vpool[type] = []); const g = p.pop() || W.fact[type](); g.visible = true; scene.add(g); return g; }
function vput(type, g) { g.visible = false; scene.remove(g); (W.vpool[type] || (W.vpool[type] = [])).push(g); }

function makeStreams() {
  const poolOf = n => n.startsWith('b') && !n.startsWith('bo') ? W.bTypes[+n.slice(1)].pool : n.startsWith('parked_') ? W.parked[n.slice(7)] : W[n];
  const decor = new Stream(LV.decor, it => { it.h = poolOf(it.pool).add(it.m, it.c); }, it => { poolOf(it.pool).remove(it.h); it.h = null; });
  const obst = new Stream(LV.obst, o => {
    const g = vget(o.v); o.g = g; o.near = false; o.honked = false; o.passed = false;
    if (g.userData.hl) g.userData.hl.visible = !!o.move;
  }, o => { vput(o.v, o.g); o.g = null; });
  const items = new Stream(LV.items, () => { }, () => { });
  const gates = new Stream(LV.gates.map(g => Object.assign(g, { s0: g.s - 260, s1: g.s + 20 })), g => { const v = W.gateFactory(g.final); v.position.set(0, 0, -g.s); scene.add(v); gateVis.set(g, v); }, g => { const v = gateVis.get(g); if (v) scene.remove(v); gateVis.delete(g); });
  streams = { decor, obst, items, gates };
}
function flushPools() {
  for (const bt of W.bTypes) bt.pool.flush();
  for (const k of ['street', 'walk', 'planterWide', 'planter', 'bollard', 'manhole', 'ac', 'lamp', 'lampGlow', 'tlight', 'tree', 'zebra']) W[k].flush();
  for (const k in W.parked) W.parked[k].flush();
}

// ---------------------------------------------------------------- input
function act(a) { if (G.state !== 'run' || G.paused) return; inBuf.push({ a, t: G.t }); }
const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', Space: 'up', ArrowDown: 'down', KeyS: 'down' };
addEventListener('keydown', e => {
  unlockAudio();
  if (KEYS[e.code] && G.state !== 'cover') { e.preventDefault(); if (!e.repeat) act(KEYS[e.code]); }
  else if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  else if ((e.code === 'Enter' || e.code === 'Space') && G.state === 'cover' && !ui.play.disabled) { e.preventDefault(); startGame(); }
});
let tp = null;
canvas.addEventListener('pointerdown', e => { unlockAudio(); tp = { x: e.clientX, y: e.clientY, id: e.pointerId, used: false }; try { canvas.setPointerCapture(e.pointerId); } catch (_) { } });
canvas.addEventListener('pointermove', e => {
  if (!tp || tp.id !== e.pointerId) return;
  const dx = e.clientX - tp.x, dy = e.clientY - tp.y, th = Math.max(24, Math.min(innerWidth, innerHeight) * 0.045);
  if (Math.abs(dx) < th && Math.abs(dy) < th) return;
  if (Math.abs(dx) > Math.abs(dy)) act(dx > 0 ? 'right' : 'left'); else act(dy < 0 ? 'up' : 'down');
  tp.x = e.clientX; tp.y = e.clientY; tp.used = true;
});
const endTouch = e => { if (tp && tp.id === e.pointerId) tp = null; };
canvas.addEventListener('pointerup', endTouch); canvas.addEventListener('pointercancel', endTouch);
for (const ev of ['touchstart', 'touchmove']) document.addEventListener(ev, e => { if (e.target === canvas || e.target === document.body || ev === 'touchmove') e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

let audioOn = false;
function unlockAudio() { if (audioOn) { A.init(); return; } audioOn = true; A.init(); try { if (localStorage.getItem('aiman4_mute') === '1') setMute(true); } catch (_) { } if (G.state === 'run') A.play(G.robotOn ? 'escape' : 'city'); }
function setMute(m) { A.setMuted(m); $('muteWaves').style.display = m ? 'none' : ''; $('muteX').style.display = m ? '' : 'none'; try { localStorage.setItem('aiman4_mute', m ? '1' : '0'); } catch (_) { } }
$('muteBtn').addEventListener('click', e => { e.stopPropagation(); unlockAudio(); setMute(!A.muted); });
$('pauseBtn').addEventListener('click', e => { e.stopPropagation(); togglePause(); });
$('resumeBtn').addEventListener('click', () => togglePause(false));
$('restartBtn').addEventListener('click', () => { togglePause(false); startGame(); });
$('againBtn').addEventListener('click', () => { ui.final.classList.remove('on'); startGame(); });
const bookBtn = $('bookBtn'); bookBtn.href = BOOK_URL;
bookBtn.addEventListener('click', () => { if (audioOn) A.sfx('pop'); });
ui.play.addEventListener('click', e => { e.preventDefault(); unlockAudio(); startGame(); });
function togglePause(force) {
  if (G.state !== 'run' && G.state !== 'hit') return;
  G.paused = force !== undefined ? force : !G.paused;
  ui.pauseM.classList.toggle('on', G.paused);
  if (audioOn) { if (G.paused) A.duck(0.2); else A.duck(1); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) togglePause(true); });

// ---------------------------------------------------------------- game flow
function resetWorldAt(s) {
  if (streams) { streams.obst.reset(); streams.items.reset(); }
  FX.dust.clear(); FX.spark.clear(); FX.star.clear();
  P.s = s; P.x = 0; P.lane = 0; P.y = 0; P.vy = 0; P.air = false; P.slide = 0; P.wantSlide = false; P.fly = null; P.zOff = 0; P.fastFall = false;
  hero.model.rotation.set(0, Math.PI, 0); hero.model.position.set(0, 0, 0); hero.stars.visible = false;
  for (const o of LV.obst) { o.honked = false; o.near = false; o.passed = false; }
  for (const e of LV.events) { e.done = false; e.shown = false; }
  robot.pivot.visible = false; robot.state = null; G.robotOn = false;
  inBuf.length = 0;
}
function startGame() {
  if (G.state === 'loading') return;
  ui.cover.classList.add('gone'); ui.final.classList.remove('on'); ui.pauseM.classList.remove('on');
  ui.hud.classList.add('on');
  Object.assign(G, { state: 'run', paused: false, t: 0, ts: 1, freeze: 0, trauma: 0, camMode: 'behind', score: 0, cards: 0, rams: 0, hits: 0, combo: 0, mult: 1, lastCP: 0, dist: 0 });
  G.cpPassed = new Set();
  for (const it of LV.items) it.dead = false;
  W.book.visible = false;
  resetWorldAt(START_S); placeTraffic(true); G.lastCP = CPS.filter(c => c <= START_S).pop() || 0;
  P.inv = 0; P.speedMul = 0.7;
  playA('Sprint_Loop', 0.25);
  updateHUD(true);
  document.querySelectorAll('.tick').forEach(t => t.classList.remove('ok'));
  if (audioOn) { A.play('city'); A.setLayers(2); A.duck(1); }
  camSnap = true;
}

// ---------------------------------------------------------------- per-frame gameplay
const heroBox = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }, ob_ = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
function changeLane(d) {
  const nl = clamp(P.lane + d, -1, 1); if (nl === P.lane) { G.trauma = Math.max(G.trauma, 0.12); return; }
  P.lane = nl; if (audioOn) A.sfx('swipe', d);
  P.leanV = d;
}
function jump() {
  P.air = true; P.vy = JUMP_V; P.slide = 0; P.wantSlide = false; P.fastFall = false;
  playA('NinjaJump_Start', 0.08, 1.7, 0.22);
  P.squash = -1; if (audioOn) A.sfx('jump');
  footDust(6, 2.5);
}
function startSlide() {
  P.slide = SLIDE_T; P.wantSlide = false;
  playA('Slide_Start', 0.08, 2.2, 0.15);
  if (audioOn) A.sfx('slide');
}
const _fw = V3();
function footContacts() { // a small puff each time a foot plants (detected from the foot bones)
  if (!hero.feet) hero.feet = ['ball_l', 'ball_r'].map(n => ({ b: hero.inner.getObjectByName(n), up: true })).filter(f => f.b);
  for (const f of hero.feet) {
    const y = f.b.getWorldPosition(_fw).y - P.y;
    if (f.up && y < 0.09) { f.up = false; for (let i = 0; i < 2; i++) FX.dust.emit(_fw.x + rand(-0.08, 0.08), 0.06, _fw.z + rand(-0.05, 0.1), rand(-0.4, 0.4), rand(0.3, 0.7), rand(0.5, 1.5), 0.32, 0.12, 0.42, COL.dust, -0.3, 4); }
    else if (!f.up && y > 0.16) f.up = true;
  }
}
function footDust(n, spd) { const p = _v.set(P.x, 0.1, -P.s + P.zOff); burst(FX.dust, p, n, spd * 0.5, 0.35, 0.15, 0.45, COL.dust, -0.4, 4, 0.4); }
function processInput() {
  while (inBuf.length) {
    const b = inBuf[0];
    if (G.t - b.t > 0.14) { inBuf.shift(); continue; }
    if (b.a === 'left') { changeLane(-1); inBuf.shift(); }
    else if (b.a === 'right') { changeLane(1); inBuf.shift(); }
    else if (b.a === 'up') { if (!P.air) { jump(); inBuf.shift(); } else break; }
    else if (b.a === 'down') { if (P.air) { P.vy = Math.min(P.vy, FASTFALL_V); P.wantSlide = true; P.fastFall = true; } else startSlide(); inBuf.shift(); }
    else inBuf.shift();
  }
}
function demoAI() {
  if (!DEMO || G.state !== 'run') return;
  const v = speedAt(P.s);
  const look = v * 1.25 + 6;
  const blocked = (lane, dist0, dist1, kinds) => {
    for (const o of streams.obst.active) {
      if (kinds && !kinds.includes(o.t)) continue;
      // predict where obstacle is when we reach it
      for (let k = 0; k <= 4; k++) {
        const ds = dist0 + (dist1 - dist0) * k / 4;
        obBox(o, P.s + ds, ob_);
        const zH = -(P.s + ds);
        if (ob_.z0 - 0.6 < zH && ob_.z1 + 0.6 > zH && ob_.x0 < LANES[lane + 1] + 0.5 && ob_.x1 > LANES[lane + 1] - 0.5) return o;
      }
    }
    return null;
  };
  if (!P.air && P.slide <= 0 || true) {
    const fullAhead = blocked(P.lane, 0, look, ['full']);
    if (fullAhead) {
      const opts = [P.lane - 1, P.lane + 1, P.lane - 2, P.lane + 2].filter(l => l >= -1 && l <= 1);
      for (const l of opts) {
        const path = Math.abs(l - P.lane) === 2 ? [P.lane + Math.sign(l - P.lane), l] : [l];
        if (path.every(pl => !blocked(pl, 0, look, ['full']))) { act(l < P.lane ? 'left' : 'right'); return; }
      }
    }
  }
  if (!blocked(P.lane, 0, look, null) && Math.abs(P.x - LANES[P.lane + 1]) < 0.2) {
    let best = null;
    for (const it of streams.items.active) { const d = it.s - P.s; if (!it.dead && d > 4 && d < 30 && (!best || d < best.s - P.s)) best = it; }
    if (best) { const bl = LANES.indexOf(best.x) - 1; if (bl !== P.lane && bl >= -1) { const nl = P.lane + Math.sign(bl - P.lane); if (!blocked(nl, 0, look, null)) { act(nl < P.lane ? 'left' : 'right'); return; } } }
  }
  for (const o of streams.obst.active) {
    if (o.t === 'full') continue;
    obBox(o, P.s, ob_);
    const d = -ob_.z1 - P.s; // distance to obstacle near edge
    if (ob_.x0 > P.x + 0.3 || ob_.x1 < P.x - 0.3) continue;
    if (o.t === 'low' && !P.air && d > 0 && d < v * 0.17 + 1.2) { act('up'); return; }
    if (o.t === 'high' && P.slide <= 0.1 && d > 0 && d < v * 0.12 + 1.0) { act(P.air ? 'down' : 'down'); return; }
  }
}
function heroHitbox() {
  const z = -P.s + P.zOff, h = P.slide > 0 ? 0.8 : 1.7;
  heroBox.x0 = P.x - 0.3; heroBox.x1 = P.x + 0.3; heroBox.y0 = P.y + 0.05; heroBox.y1 = P.y + h; heroBox.z0 = z - 0.3; heroBox.z1 = z + 0.3;
}
function overlaps(a, b, zPad = 0) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 - zPad < b.z1 && a.z1 > b.z0; }

function updateRun(dt) {
  processInput(); demoAI(); processInput();
  P.speedMul = Math.min(1, P.speedMul + dt * 0.1);
  const v = speedAt(P.s) * P.speedMul;
  P.v = v;
  const prevS = P.s; P.s += v * dt; G.dist = P.s;
  P.prevX = P.x;
  P.x = damp(P.x, LANES[P.lane + 1], 15, dt);
  P.leanV = damp(P.leanV, 0, 6, dt);
  // vertical
  if (P.air) {
    P.vy -= GRAV * dt; P.y += P.vy * dt;
    if (P.vy < 4 && hero.cur === hero.act.NinjaJump_Start) playA('NinjaJump_Idle_Loop', 0.2, 1.2);
    if (P.y <= 0) {
      P.y = 0; P.air = false; P.vy = 0; P.squash = 1;
      if (audioOn) A.sfx('land');
      footDust(10, 3); G.trauma = Math.max(G.trauma, P.fastFall ? 0.25 : 0.1); P.fastFall = false;
      if (P.wantSlide) startSlide(); else playA('Sprint_Loop', 0.12, 1, 0.1);
      G.fovKick -= 2.5;
    }
  }
  if (P.slide > 0) {
    P.slide -= dt;
    if (hero.cur === hero.act.Slide_Start && P.slide < SLIDE_T - 0.22) playA('Slide_Loop', 0.12, 1.2);
    if (Math.random() < 0.6) { const p = _v.set(P.x + rand(-0.3, 0.3), 0.1, -P.s + 0.4); FX.spark.emit(p.x, p.y, p.z, rand(-1.5, 1.5), rand(1, 3), rand(1, 4), 0.35, 0.18, 0.05, COL.gold, 8, 1); }
    if (P.slide <= 0) { P.slide = 0; playA('Sprint_Loop', 0.18, 1, 0.2); }
  }
  // running dust
  if (!P.air && P.slide <= 0) footContacts();
  if (hero.cur === hero.act.Sprint_Loop) hero.cur.timeScale = 0.75 + v / 34;
  P.inv = Math.max(0, P.inv - dt);
  // collisions (swept along z)
  heroHitbox(); const sweep = P.s - prevS;
  for (const o of streams.obst.active) {
    obBox(o, P.s, ob_);
    if (P.inv <= 0 && overlaps(heroBox, ob_, sweep)) { hit(o); return; }
    // near miss / pass
    if (!o.passed && ob_.z0 > heroBox.z1) {
      o.passed = true;
      const gap = Math.min(Math.abs(ob_.x0 - heroBox.x1), Math.abs(heroBox.x0 - ob_.x1));
      if (o.t === 'full' && gap < 0.95 && P.inv <= 0) { addScore(25); if (audioOn) A.sfx('near'); G.trauma = Math.max(G.trauma, 0.18); burst(FX.spark, _v.set(P.x, 1.2, -P.s), 10, 4, 0.4, 0.3, 0.05, COL.white); }
      else addScore(5);
    }
    // telegraphs
    if (o.move && !o.honked) {
      const d = o.s - P.s; const lead = o.move === 'police' ? speedAt(o.s) * 3.6 : speedAt(o.s) * 2.4;
      if (d < lead) {
        o.honked = true;
        if (audioOn) A.sfx(o.move === 'police' ? 'siren' : 'honk');
        if (o.move === 'police') showHint(o.open < 0 ? 'left' : 'right', 2.2); else if (o.move === 'swerve') showHint('warn', 1.0);
      }
    }
  }
  // pickups
  for (const it of streams.items.active) {
    if (it.dead) continue;
    const dz = it.s - P.s;
    if (dz < 0.8 && dz > -sweep - 0.8 && Math.abs(it.x - P.x) < 0.85 && it.y > P.y - 0.2 && it.y < P.y + (P.slide > 0 ? 1.4 : 2.1)) collect(it);
  }
  // events
  for (const e of LV.events) {
    if (e.type === 'hint' && !e.shown && e.s - P.s < speedAt(e.s) * 1.25 && e.s > P.s) { e.shown = true; showHint(e.kind, 1.1); }
    if (e.type === 'warn' && !e.shown && e.s - P.s < 10 && e.s > P.s) { e.shown = true; showHint('warn', 1.4); if (audioOn) A.sfx('honk'); }
  }
  updateRobot(dt);
  // checkpoints
  for (const s of CPS) if (s > 0 && P.s >= s && !G.cpPassed.has(s)) passCheckpoint(s);
  if (P.s >= L) finish();
  // distance score
  G.score += v * dt * 0.5 * G.mult;
}
function addScore(n) { G.score += n * G.mult; }
function collect(it) {
  it.dead = true;
  const p = _v.set(it.x, it.y, -it.s);
  G.combo++;
  G.mult = G.combo >= 70 ? 5 : G.combo >= 45 ? 4 : G.combo >= 25 ? 3 : G.combo >= 10 ? 2 : 1;
  if (it.k === 'card') { G.cards++; addScore(10); burst(FX.spark, p, 14, 4, 0.45, 0.45, 0.05, COL.cyan, 0, 3); if (audioOn) A.sfx('card', Math.min(G.combo % 13, 12)); bump(ui.cardV.parentNode); }
  else { G.rams++; addScore(50); burst(FX.spark, p, 26, 6, 0.6, 0.6, 0.05, COL.green, 0, 2.5); burst(FX.star, p, 6, 4, 0.7, 0.4, 0.2, COL.white, 3, 1.5, 2); if (audioOn) A.sfx('ram'); bump(ui.ramV.parentNode); G.trauma = Math.max(G.trauma, 0.1); }
  if (G.mult > 1 && [10, 25, 45, 70].includes(G.combo)) { bump(ui.combo); if (audioOn) A.sfx('combo', G.mult); }
}
function passCheckpoint(s) {
  G.cpPassed.add(s); G.lastCP = s; addScore(200);
  if (audioOn) A.sfx('checkpoint');
  const p = _v.set(P.x, 3, -s);
  for (let i = 0; i < 60; i++) FX.conf.emit(rand(-7, 7), rand(5, 8), -s + rand(-1, 1), rand(-2, 2), rand(0, 4), rand(2, 7), rand(1.2, 2), 0.22, 0.16, CONF[i % CONF.length], 6, 1.2);
  burst(FX.spark, p, 30, 7, 0.6, 0.6, 0.1, COL.cyan);
  const tk = document.querySelector(`.tick[data-s="${s}"]`); if (tk) tk.classList.add('ok');
  if (audioOn) A.setLayers(Math.min(4, 2 + CPS.indexOf(s)));
}
function hit(o) {
  G.state = 'hit'; P.hitT = 0; G.hits++; G.combo = 0; G.mult = 1;
  G.freeze = 0.09; G.trauma = 1; G.ts = 0.3;
  if (audioOn) { A.sfx('hit'); setTimeout(() => A.sfx('bonk'), 160); A.detune(); }
  ui.flash.style.transition = 'none'; ui.flash.style.opacity = 1; requestAnimationFrame(() => { ui.flash.style.transition = 'opacity .6s'; ui.flash.style.opacity = 0; });
  const side = (P.x - (ob_.x0 + ob_.x1) / 2) || rand(-1, 1);
  P.fly = { vx: clamp(side, -1, 1) * 2.5, vy: o.t === 'high' ? 5.5 : 8.5, vz: 6.5, spin: o.t === 'high' ? -9 : 7.5, rot: 0 };
  P.air = true; P.slide = 0;
  playA('Hit_Knockback', 0.05, 0.9);
  const hp = _v.set(P.x, P.y + 1.4, -P.s + 0.4);
  burst(FX.star, hp, 10, 5, 0.9, 0.5, 0.25, COL.white, 6, 1.5, 2);
  burst(FX.spark, hp, 24, 7, 0.4, 0.5, 0.05, COL.gold, 0, 3);
  burst(FX.dust, _v.set(P.x, 0.4, -P.s), 18, 4, 0.5, 0.25, 0.5, COL.dust, -0.5, 3, 0.6);
}
function updateHit(dt) {
  P.hitT += dt;
  const f = P.fly;
  if (f) {
    f.vy -= GRAV * 0.55 * dt; P.y += f.vy * dt; P.x += f.vx * dt; P.zOff += f.vz * dt;
    f.rot += f.spin * dt; hero.model.rotation.x = f.rot;
    if (P.y <= 0 && f.vy < 0) {
      P.y = 0;
      if (Math.abs(f.vy) > 4) { // bounce
        f.vy = -f.vy * 0.35; f.vz *= 0.5; f.spin *= 0.4; G.trauma = Math.max(G.trauma, 0.5); if (audioOn) A.sfx('land');
        burst(FX.dust, _v.set(P.x, 0.3, -P.s + P.zOff), 16, 4, 0.45, 0.2, 0.5, COL.dust, -0.4, 3, 0.6);
      } else {
        P.fly = null; hero.model.rotation.x = 0; playA('Death01', 0.15, 1.6, 1.2); hero.stars.visible = true;
        burst(FX.dust, _v.set(P.x, 0.3, -P.s + P.zOff), 12, 3, 0.45, 0.2, 0.5, COL.dust, -0.4, 3, 0.6);
      }
    }
  }
  if (hero.stars.visible) {
    const n = hero.stars.children.length;
    hero.stars.children.forEach((s, i) => { const a = G.t * 5 + i * Math.PI * 2 / n; s.position.set(Math.cos(a) * 0.45, 0.45 + Math.sin(a * 2) * 0.05, Math.sin(a) * 0.45 - 0.5); });
  }
  if (P.hitT > 1.9 && !P.respawning) { P.respawning = true; ui.white.style.transition = 'opacity .22s'; ui.white.style.opacity = 1; }
  if (P.hitT > 2.15) respawn();
}
function respawn() {
  P.respawning = false;
  resetWorldAt(G.lastCP); placeTraffic(true);
  P.inv = 2.2; P.speedMul = 0.8; G.state = 'run'; G.camMode = 'behind'; camSnap = true;
  playA('Sprint_Loop', 0.1);
  if (audioOn) { A.sfx('respawn'); A.play('city'); }
  ui.white.style.transition = 'opacity .5s'; ui.white.style.opacity = 0;
}
// --- robot chase set-piece
function updateRobot(dt) {
  const ev = LV.events.find(e => e.type === 'robot' && P.s >= e.s0 && P.s < e.s1);
  if (!ev) {
    if (robot.pivot.visible && G.state !== 'finish') { robot.pivot.visible = false; ui.robot.classList.remove('on'); if (G.robotOn && audioOn) A.play('city'); G.robotOn = false; }
    if (G.camMode === 'front') G.camMode = 'behind';
    return;
  }
  const u = P.s - ev.s0;
  if (!robot.pivot.visible) {
    robot.pivot.visible = true; robot.state = 'run'; robot.fall = 0; robot.pivot.rotation.set(0, 0, 0); robotPlay('Running', 0.01);
    robot.act.Running.timeScale = 1.35; robot.stompT = 0; robot.x = P.x;
    G.robotOn = true; ui.robot.classList.add('on'); if (audioOn) { A.play('escape'); A.sfx('stomp'); } showHint('warn', 1.2);
    G.trauma = Math.max(G.trauma, 0.4);
  }
  G.camMode = ((P.s > ev.front0 && P.s < ev.front1) || (P.s > ev.trip - 4 && P.s < ev.trip + 34)) ? 'front' : 'behind';
  if (robot.state === 'run') {
    const gap = u < 30 ? lerp(48, 12, smooth(0, 30, u)) : 11.5 + Math.sin(u * 0.09) * 2.2;
    robot.x = damp(robot.x, P.x * 0.7, 1.6, dt);
    robot.pivot.position.set(robot.x, 0, -P.s + P.zOff + gap);
    robot.gap = gap;
    robot.stompT -= dt;
    if (robot.stompT <= 0) {
      robot.stompT = 0.5;
      const k = clamp(1 - (gap - 8) / 30, 0, 1);
      G.trauma = Math.max(G.trauma, 0.12 + 0.18 * k);
      if (audioOn) A.sfx('stomp');
      burst(FX.dust, _v.set(robot.x + rand(-1.5, 1.5), 0.3, robot.pivot.position.z - 1), 8, 4, 0.9, 0.8, 2.4, COL.dust, -0.3, 2, 1);
    }
    if (P.s >= ev.trip) { robot.state = 'trip'; robot.fall = 0; robot.tripZ = robot.pivot.position.z; robotPlay('Punch', 0.15); }
  } else if (robot.state === 'trip') {
    robot.fall = Math.min(1, robot.fall + dt * 1.5);
    const f = robot.fall * robot.fall;
    robot.pivot.rotation.x = -1.45 * f; robot.pivot.position.z = robot.tripZ - 3 * f;
    if (robot.fall >= 1 && robot.state !== 'down') {
      robot.state = 'down'; G.trauma = 0.9; if (audioOn) A.sfx('boom'); addScore(150);
      burst(FX.dust, _v.set(robot.x, 0.5, robot.tripZ - 6), 40, 9, 1.2, 1, 3.5, COL.dust, -0.3, 2, 1.5);
      burst(FX.star, _v.set(robot.x, 1.5, robot.tripZ - 7), 12, 6, 1.0, 0.8, 0.3, COL.white, 5, 1.5, 3);
    }
  }
  ui.robotGap.style.width = (robot.state === 'run' ? clamp((robot.gap - 6) / 40, 0.05, 1) * 100 : 100) + '%';
  robot.eye.position.set(0, 5.9, -1.1);
}
function finish() {
  G.state = 'finish'; P.finT = 0; G.camMode = 'finish';
  if (audioOn) { A.stop(); A.sfx('fanfare'); setTimeout(() => A.sfx('cheer'), 500); }
  for (let i = 0; i < 160; i++) FX.conf.emit(rand(-8, 8), rand(5, 10), -L + rand(-6, 2), rand(-2, 2), rand(0, 4), rand(-3, 3), rand(1.5, 3), 0.24, 0.18, CONF[i % CONF.length], 5, 1);
  addScore(1000);
}
function updateFinish(dt) {
  P.finT += dt;
  const v = Math.max(0, P.v * (1 - P.finT / 1.1)); P.s += v * dt;
  P.x = damp(P.x, 0, 3, dt); P.lane = 0;
  if (P.air) { P.vy -= GRAV * dt; P.y = Math.max(0, P.y + P.vy * dt); if (P.y <= 0) P.air = false; }
  if (P.finT > 0.9 && hero.cur !== hero.act.Idle_Loop) { playA('Idle_Loop', 0.4); P.slide = 0; }
  // hero turns to camera
  hero.model.rotation.y = lerp(Math.PI, Math.PI - 0.3, smooth(1.0, 2.0, P.finT));
  if (P.finT > 1.2) {
    W.book.visible = true;
    const t = smooth(1.2, 2.2, P.finT);
    W.book.position.set(P.x + 0.05, lerp(0.6, 2.25, t) + Math.sin(G.t * 2) * 0.06, -P.s - 0.7);
    W.book.rotation.set(0, Math.PI + Math.sin(G.t * 1.3) * 0.35 + (1 - t) * 6, 0);
    if (Math.random() < 0.5) FX.spark.emit(W.book.position.x + rand(-0.5, 0.5), W.book.position.y + rand(-0.6, 0.6), W.book.position.z + 0.2, 0, rand(0.3, 1), 0, 0.8, 0.25, 0.02, COL.gold);
  }
  if (P.finT > 1.0 && !robot.pivot.visible && robot.model) {
    robot.pivot.visible = true; robot.pivot.rotation.set(0, 0, 0); robot.state = 'wave';
    robot.pivot.position.set(-5.5, 0, -P.s + 19); robotPlay('Wave', 0.01);
  }
  if (robot.state === 'wave') robot.pivot.position.z = damp(robot.pivot.position.z, -P.s + 15, 2, dt);
  if (P.finT > 2.6 && G.state === 'finish') showFinal();
}
function showFinal() {
  G.state = 'end';
  ui.hud.classList.remove('on');
  $('fScore').textContent = Math.floor(G.score);
  $('fCards').textContent = G.cards; $('fRam').textContent = G.rams; $('fHits').textContent = G.hits;
  const stars = G.hits === 0 ? 3 : G.hits <= 2 ? 2 : 1;
  $('fStars').innerHTML = [0, 1, 2].map(i => (i < stars ? STAR_SVG : STAR_OFF).replace('<svg', `<svg style="animation-delay:${0.2 + i * 0.18}s"`)).join('');
  ui.final.classList.add('on');
  if (audioOn) { A.play('office'); A.setLayers(4); }
}

// ---------------------------------------------------------------- HUD
let hudScore = -1;
function buildTicks() { for (const s of CPS.slice(1)) { const t = document.createElement('div'); t.className = 'tick'; t.dataset.s = s; t.style.left = (s / L * 100) + '%'; ui.prog.appendChild(t); } }
function updateHUD(force) {
  const sc = Math.floor(G.score);
  if (sc !== hudScore || force) { hudScore = sc; ui.score.textContent = sc; }
  ui.cardV.textContent = G.cards; ui.ramV.textContent = G.rams;
  const p = clamp(P.s / L, 0, 1); ui.progF.style.width = (p * 100) + '%'; ui.progHero.style.left = (p * 100) + '%';
  ui.combo.textContent = '×' + G.mult; ui.combo.classList.toggle('on', G.mult > 1);
}

// ---------------------------------------------------------------- camera
let camSnap = true, camW = 1, camH = 1;
const CO = { th: 0, r: 6, h: 2.6 }, camLook = V3(0, 1, -10); // orbit offset around the hero (th=0 → behind)
G.fovKick = 0;
function camParams() {
  const a = camW / camH; const t = smooth(0.55, 1.3, a);
  const hfov = 66; const vfovNeeded = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov / 2)) / a) * 180 / Math.PI;
  return { fov: clamp(vfovNeeded, 52, 74), dist: lerp(7.2, 5.4, t), height: lerp(3.3, 2.55, t), look: lerp(9, 11, t), lookY: lerp(1.0, 1.25, t), portrait: 1 - t };
}
function updateCamera(dt, rdt) {
  const cp = camParams();
  const hx = P.x, hz = -P.s + P.zOff;
  let th, r, h, lx, ly, lz, rate;
  if (G.camMode === 'front') { th = 2.95; r = 8.6 + cp.portrait * 2; h = 2.1; lx = 0; ly = 2.6; lz = 6; rate = 2.6; }
  else if (G.camMode === 'finish') { th = Math.PI - 0.22; r = 5.0 + cp.portrait * 1.2; h = 1.4; lx = 0; ly = 1.5; lz = 0; rate = 2.2; }
  else if (G.camMode === 'cover') { th = Math.PI + Math.sin(G.t * 0.25) * 0.55; r = 4.6 + cp.portrait * 0.7; h = 1.45; lx = 0; ly = 1.15 - cp.portrait * 0.15; lz = 0; rate = 3; }
  else {
    const heroY = P.air ? P.y * 0.45 : 0;
    th = 0; r = cp.dist; h = cp.height + heroY - (P.slide > 0 ? 0.3 : 0); lx = 0; ly = cp.lookY + heroY * 0.6; lz = -cp.look; rate = 9;
    if (G.state === 'hit') { r = cp.dist + 1.5; h += 0.6; }
  }
  if (camSnap) { CO.th = th; CO.r = r; CO.h = h; camLook.set(lx, ly, lz); camSnap = false; }
  else {
    CO.th = damp(CO.th, th, rate, rdt); CO.r = damp(CO.r, r, rate, rdt); CO.h = damp(CO.h, h, Math.max(rate, 6), rdt);
    camLook.x = damp(camLook.x, lx, rate, rdt); camLook.y = damp(camLook.y, ly, Math.max(rate, 6), rdt); camLook.z = damp(camLook.z, lz, rate, rdt);
  }
  const vo = G.camMode === 'finish' ? smooth(0.5, 2.2, P.finT || 0) * lerp(0.2, 0.27, cp.portrait) : 0;
  if (Math.abs(vo - (camera.userData.vo || 0)) > 1e-4) { camera.userData.vo = vo; if (vo > 0) camera.setViewOffset(camW, camH, 0, camH * vo, camW, camH); else camera.clearViewOffset(); }
  camera.position.set(hx + Math.sin(CO.th) * CO.r, CO.h, hz + Math.cos(CO.th) * CO.r);
  camera.lookAt(hx + camLook.x, camLook.y, hz + camLook.z);
  // lean + shake
  const lean = -P.leanV * 0.05; camera.rotateZ(lean);
  G.trauma = Math.max(0, G.trauma - rdt * 1.6);
  const sh = G.trauma * G.trauma;
  if (sh > 0.001) { const t = performance.now() * 0.001; camera.position.x += sh * 0.35 * Math.sin(t * 61.3); camera.position.y += sh * 0.3 * Math.sin(t * 47.1 + 1); camera.rotateZ(sh * 0.04 * Math.sin(t * 53.7 + 2)); }
  G.fovKick = damp(G.fovKick, 0, 5, rdt);
  const speedF = G.state === 'run' ? clamp((P.v - 12) / 7, 0, 1) * 7 : 0;
  const fov = cp.fov + speedF + G.fovKick + (P.air && G.state === 'run' ? 2.5 : 0);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = damp(camera.fov, fov, 6, rdt); camera.updateProjectionMatrix(); }
  if (W.ground) W.ground.position.set(0, -0.04, hz - 200);
  sky.position.copy(camera.position); clouds.position.set(camera.position.x, 0, camera.position.z);
  // sun + shadow camera follow the hero
  sun.target.position.set(P.x * 0.5, 0, hz - 12); sun.position.copy(sun.target.position).add(SUN_OFF);
}

// ---------------------------------------------------------------- ambient traffic (outer lanes, purely visual)
const traffic = [];
function initTraffic() {
  const types = ['sedan', 'taxi', 'suv', 'van'];
  for (let i = 0; i < 6; i++) {
    const dir = i % 2 ? 1 : -1; // +1: oncoming (left lane), -1: same direction (right lane)
    const t = types[i % 4]; const g = W.fact[t](); g.userData.hl.visible = dir > 0; g.rotation.y = dir > 0 ? 0 : Math.PI; scene.add(g);
    traffic.push({ g, dir, x: dir > 0 ? -5.3 : 5.3, z: 0, v: dir > 0 ? rand(13, 17) : rand(7, 10) });
  }
  placeTraffic(true);
}
function placeTraffic(all) {
  const hz = -P.s;
  traffic.forEach((c, i) => { if (all) c.z = hz - 20 - i * 35 - rand(0, 20); });
}
function updateTraffic(dt) {
  const hz = -P.s + P.zOff;
  for (const c of traffic) {
    c.z += c.dir * c.v * dt;
    if (c.z > hz + 25 || c.z < hz - VIEW_AHEAD) c.z = hz - rand(110, VIEW_AHEAD - 20);
    const cross = LV.obst.find(o => o.move === 'police' && Math.abs(-o.s - c.z) < 12);
    c.g.visible = !cross;
    c.g.position.set(c.x, 0, c.z);
  }
}

// ---------------------------------------------------------------- visuals per frame
const _mm = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _sc = V3(), _pp = V3(), _eu = new THREE.Euler();
function updateVisuals(dt) {
  // hero transform
  hero.root.position.set(P.x, P.y, -P.s + P.zOff);
  // squash & stretch
  P.squash = damp(P.squash, 0, 9, dt);
  const sq = P.squash; const sy = 1 - sq * 0.12, sxz = 1 + sq * 0.08;
  hero.model.scale.set(sxz, sy, sxz);
  if (G.state === 'run') hero.model.rotation.z = clamp((P.prevX - P.x) * 0.9, -0.22, 0.22);
  hero.model.visible = !(P.inv > 0 && Math.floor(G.t * 14) % 2 === 0 && G.state === 'run');
  // obstacles
  for (const o of streams.obst.active) {
    obPose(o, P.s, _pose);
    o.g.position.set(_pose.x, 0, _pose.z);
    const heroZ = -P.s + P.zOff, behindHero = _pose.z - o.hd > heroZ + 0.4, inLine = _pose.x + o.hw > P.x - 1.3 && _pose.x - o.hw < P.x + 1.3;
    o.g.visible = G.camMode !== 'behind' || (!(behindHero && inLine) && _pose.z - o.hd < camera.position.z - 1.3); // nothing between camera and hero
    o.g.rotation.y = _pose.ry + (o.v === 'gantry' || o.v === 'gantryW' || o.v === 'cones' || o.v === 'barrier' ? 0 : 0) + (o.move ? 0 : (o.rot || 0));
    if (o.move === 'oncoming' || o.move === 'swerve') o.g.rotation.y = _pose.ry;
    const sr = o.g.userData.siren;
    if (sr) { const ph = Math.floor(G.t * 8) % 2; sr.rg.visible = ph === 0; sr.bg.visible = ph === 1; }
    if (o.g.userData.hl && o.move) { const d = o.s - P.s; o.g.userData.hl.children.forEach(s => s.scale.setScalar(d < speedAt(o.s) * 2.6 && Math.floor(G.t * 10) % 2 ? 1.5 : 0.9)); }
  }
  W.blinkMat.color.setRGB(Math.floor(G.t * 3) % 2 ? 1 : 0.25, 0.15, 0.08);
  // gates shimmer
  for (const [g, v] of gateVis) { v.visible = G.camMode !== 'behind' || g.s > P.s - 0.5; const c = v.userData.curtain; c.material.opacity = 0.1 + 0.06 * Math.sin(G.t * 4); }
  // collectibles
  let nc = 0, nr = 0, ng = 0;
  const t = G.t;
  for (const it of streams.items.active) {
    if (it.dead) continue;
    const bob = Math.sin(t * 3 + it.s) * 0.08;
    const near = G.camMode === 'front' ? smooth(P.s + 5.5, P.s + 2.5, it.s) * (it.s > P.s ? 1 : 0) : 0; const isc = 1 - near;
    if (isc < 0.02) continue;
    if (G.camMode === 'behind' && it.s < P.s - 0.3 && Math.abs(it.x - P.x) < 1.3) continue; // missed items behind the hero
    _pp.set(it.x, it.y + bob, -it.s);
    _qq.setFromEuler(_eu.set(0, t * 3 + it.s * 0.3, 0));
    if (it.k === 'card' && nc < 90) { _mm.compose(_pp, _qq, _sc.set(isc, isc, isc)); W.cardIM.setMatrixAt(nc++, _mm); }
    else if (it.k === 'ram' && nr < 16) { _mm.compose(_pp, _qq, _sc.set(isc, isc, isc)); W.ramIM.setMatrixAt(nr++, _mm); }
    if (ng < 110) {
      const s = (it.k === 'ram' ? 1.9 : 1.25) * isc;
      _mm.compose(_pp.set(it.x, it.y + bob, -it.s + 0.05), camera.quaternion, _sc.set(s, s, s)); W.glowIM.setMatrixAt(ng, _mm);
      W.glowIM.setColorAt(ng, it.k === 'ram' ? COL.green : COL.cyan); ng++;
    }
  }
  W.cardIM.count = nc; W.ramIM.count = nr; W.glowIM.count = ng;
  W.cardIM.instanceMatrix.needsUpdate = W.ramIM.instanceMatrix.needsUpdate = W.glowIM.instanceMatrix.needsUpdate = true;
  if (W.glowIM.instanceColor) W.glowIM.instanceColor.needsUpdate = true;
  // speed lines & HUD hint timer
  const sp = G.state === 'run' ? clamp((P.v - 14.5) / 4, 0, 1) : 0;
  ui.speed.style.opacity = (sp * 0.5).toFixed(3);
  if (sp > 0) ui.speed.style.transform = `rotate(${(Math.random() * 3).toFixed(2)}deg)`;
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) { ui.hint.className = ''; hintKind = ''; } }
  if (robot.pivot.visible) robot.eye.material.opacity = 0.7 + 0.3 * Math.sin(G.t * 10);
}

// ---------------------------------------------------------------- main loop
let last0 = performance.now(), last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60, dbgT = 0, frame = 0;
function resize() {
  const w = innerWidth, h = innerHeight; camW = w; camH = h;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.userData.vo = -1; camera.updateProjectionMatrix();
  const sc = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  for (const k in FX) FX[k].mat.uniforms.uScale.value = sc;
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); G.paused = true; });
canvas.addEventListener('webglcontextrestored', () => location.reload());

function loop() {
  const now = performance.now();
  let rdt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsAcc += rdt; fpsN++; G.worst = Math.max(G.worst || 0, now - last0); last0 = now; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (G.state === 'loading') { renderer.render(scene, camera); return; }
  if (G.paused) rdt = 0;
  let dt = rdt;
  if (G.freeze > 0) { G.freeze -= rdt; dt = 0; }
  G.ts = damp(G.ts, 1, G.state === 'hit' ? 1.2 : 4, rdt);
  dt *= G.ts;
  G.t += dt;
  if (G.state === 'run') updateRun(dt);
  else if (G.state === 'hit') updateHit(dt);
  else if (G.state === 'finish') updateFinish(dt);
  else if (G.state === 'end') { updateFinish(dt); }
  else if (G.state === 'cover') { /* idle */ }
  hero.mixer.update(dt);
  if (G.state !== 'cover') updateTraffic(dt);
  if (robot.mixer && robot.pivot.visible) robot.mixer.update(dt);
  // streams (cheap) & pools
  streams.decor.update(P.s - (G.state === 'cover' ? 190 : VIEW_BEHIND), P.s + (G.state === 'cover' ? 40 : VIEW_AHEAD));
  streams.obst.update(P.s - 12, P.s + VIEW_AHEAD - 20);
  streams.items.update(P.s - 6, P.s + 190);
  streams.gates.update(P.s - 20, P.s + 260);
  flushPools();
  updateVisuals(dt);
  updateCamera(dt, G.paused ? 0 : rdt);
  for (const k in FX) FX[k].update(dt);
  if (G.state === 'run' || G.state === 'hit') updateHUD();
  if (audioOn && G.state === 'run') A.setIntensity(clamp((P.v - 10) / 9, 0.3, 1));
  renderer.render(scene, camera);
  frame++;
  dbgT -= rdt;
  if (dbgT <= 0) { dbgT = 0.5; window.__dbg = { state: G.state, s: Math.round(P.s), lane: P.lane, fps: Math.round(fps), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, hits: G.hits, cards: G.cards, rams: G.rams, score: Math.floor(G.score), cam: G.camMode, worstMs: Math.round(G.worst || 0) }; G.worst = 0; }
}

// ---------------------------------------------------------------- boot
resize();
renderer.setAnimationLoop(loop);
loadAll().then(() => {
  buildWorld(); buildHero(); buildRobot(); genLevel(); makeStreams(); buildTicks(); initTraffic();
  G.state = 'cover'; G.camMode = 'cover'; P.s = -8; camSnap = true;
  hero.model.rotation.y = Math.PI - 0.35; // face the cover camera
  setLoad(1);
  $('load').style.visibility = 'hidden';
  ui.play.disabled = false;
  // pre-compile shaders to avoid first-frame hitches
  const warm = Object.keys(W.fact).map(t => [t, vget(t)]); const gw = W.gateFactory(false), gf = W.gateFactory(true); scene.add(gw, gf);
  warm.forEach(([, g], i) => g.position.set(0, 0, -20 - i * 3)); W.book.visible = true; robot.pivot.visible = true;
  try { renderer.compile(scene, camera); } catch (_) { }
  warm.forEach(([t, g]) => vput(t, g)); scene.remove(gw, gf); W.book.visible = false; robot.pivot.visible = false;
  window.__aiman = { start: startGame, G, P, sun, hero, camera, scene, THREE, FX };
  if (AUTOPLAY) startGame();
}).catch(err => {
  console.warn('load failed', err);
  $('loadP').textContent = '×';
});
