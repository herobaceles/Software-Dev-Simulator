import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ranks, tickets } from './tickets.js';
import { createIDE } from './ide.js';
import { createDesktop } from './desktop.js';
import { createBuilding } from './building.js';
import { createBarista } from './barista.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ───────────────────────── state ─────────────────────────
const SAVE_KEY = 'cozy-dev-sim-v2';
const FRESH = () => ({
  day: 1, hour: 9, energy: 85, cozy: 40, xp: 0, commits: 0,
  ticket: 0, drafts: {}, coffee: 0, cup: null, raining: false, lampOn: true, radioOn: false,
});
const S = Object.assign(FRESH(), loadSave());

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; }
}
let saveEnabled = true;
function save() {
  if (!saveEnabled) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch { /* storage unavailable */ }
}
setInterval(save, 10000);
addEventListener('beforeunload', save);

const levelOf = (xp) => Math.floor(Math.sqrt(xp / 100));
const rankOf = (xp) => ranks[Math.min(levelOf(xp), ranks.length - 1)];

// ───────────────────────── renderer ─────────────────────────
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// MSAA from `antialias`, plus supersampling when the GPU has room for it. `quality` multiplies the
// display's pixel ratio and is tuned at runtime (see tunePerformance) so the frame rate stays smooth.
const QUALITY_MIN = 0.7, QUALITY_MAX = 1.25;
let quality = 1;
const applyQuality = () => renderer.setPixelRatio(Math.min(devicePixelRatio * quality, 3));
applyQuality();
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8ec9f5');
scene.fog = new THREE.Fog('#8ec9f5', 80, 420);
const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 500);
scene.add(camera); // so things held in hand can be parented to it

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ───────────────────────── helpers ─────────────────────────
const room = new THREE.Group();
scene.add(room);
const colliders = [];
const interactRoots = [];
const interactions = {};

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
}
function add(geo, material, x, y, z, parent = room) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
// furniture: a box with softened edges (pass `r` to override the corner radius)
function box(w, h, d, color, x, y, z, parent = room, { r, ...opts } = {}) {
  const radius = r ?? Math.min(0.03, Math.min(w, h, d) * 0.4);
  return add(new RoundedBoxGeometry(w, h, d, 4, radius), mat(color, opts), x, y, z, parent);
}
// architecture: a plain sharp box
function slab(w, h, d, color, x, y, z) {
  return add(new THREE.BoxGeometry(w, h, d), mat(color), x, y, z);
}
function cyl(rTop, rBottom, h, color, x, y, z, parent = room, opts = {}) {
  return add(new THREE.CylinderGeometry(rTop, rBottom, h, 36), mat(color, opts), x, y, z, parent);
}
function collide(minX, maxX, minZ, maxZ) { colliders.push({ minX, maxX, minZ, maxZ }); }
function interactive(obj, key, label, action) {
  obj.userData.key = key;
  interactRoots.push(obj);
  interactions[key] = { label, action };
}
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  if (draw) draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
// a few soft puffs that rise and fade; returns an update(t, on) function
function steam(parent, x, y, z, count = 4, size = 0.02, alpha = 0.3) {
  const puffs = [];
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(size, 14, 12), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
    parent.add(p);
    puffs.push(p);
  }
  return (t, on) => puffs.forEach((p, i) => {
    const phase = (t * 0.45 + i / count) % 1;
    p.visible = on;
    p.position.set(x + Math.sin(t * 2 + i * 2.1) * 0.012, y + phase * 0.16, z + Math.cos(t * 1.7 + i) * 0.012);
    p.scale.setScalar(0.6 + phase * 1.6);
    p.material.opacity = Math.sin(phase * Math.PI) * alpha;
  });
}
// for flat things mounted on a surface (rugs, posters, screens): nudges them forward in depth so they don't flicker
const DECAL = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
const METAL = { metalness: 0.25, roughness: 0.35 };

// ───────────────────────── the room ─────────────────────────
const W = 4, D = 3, H = 3; // half-width, half-depth, height
const WIN = { x0: -3.2, x1: 0.9, y0: 0.35, y1: 2.72 }; // floor-to-ceiling glass
const wallColor = '#1b1b1f';

// floor
const floorTex = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#9a6842'; g.fillRect(0, 0, w, h);
  for (let row = 0; row < 8; row++) {
    g.fillStyle = `rgba(${row % 2 ? 60 : 255},${row % 2 ? 30 : 220},${row % 2 ? 10 : 170},0.07)`;
    g.fillRect(0, row * 32, w, 32);
    g.fillStyle = 'rgba(50,25,10,0.5)';
    g.fillRect(0, row * 32, w, 2);
    g.fillRect((row * 97) % w, row * 32, 2, 32);
  }
});
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set(4, 3);
const floor = add(new THREE.PlaneGeometry(W * 2, D * 2), mat('#ffffff', { map: floorTex }), 0, 0, 0);
floor.rotation.x = -Math.PI / 2;

// walls + ceiling
slab(W * 2 + 0.4, 0.2, D * 2 + 0.4, '#d9d7d3', 0, H + 0.1, 0);
slab(0.2, H, D * 2, wallColor, -W - 0.1, H / 2, 0);
slab(0.2, H, D * 2, wallColor, W + 0.1, H / 2, 0);
// (the front wall, with its door, is built by building.js)
// back wall with window opening
slab(WIN.x0 + W, H, 0.2, wallColor, (-W + WIN.x0) / 2, H / 2, -D - 0.1);
slab(W - WIN.x1, H, 0.2, wallColor, (W + WIN.x1) / 2, H / 2, -D - 0.1);
slab(WIN.x1 - WIN.x0, WIN.y0, 0.2, wallColor, (WIN.x0 + WIN.x1) / 2, WIN.y0 / 2, -D - 0.1);
slab(WIN.x1 - WIN.x0, H - WIN.y1, 0.2, wallColor, (WIN.x0 + WIN.x1) / 2, (H + WIN.y1) / 2, -D - 0.1);
// baseboards
for (const [w, d, x, z] of [[W * 2, 0.04, 0, D - 0.02], [W * 2, 0.04, 0, -D + 0.02], [0.04, D * 2, -W + 0.02, 0], [0.04, D * 2, W - 0.02, 0]]) {
  box(w, 0.12, d, '#0c0c0e', x, 0.06, z);
}

// window frame, glass, curtains, bench
const winCx = (WIN.x0 + WIN.x1) / 2, winCy = (WIN.y0 + WIN.y1) / 2;
const winW = WIN.x1 - WIN.x0, winH = WIN.y1 - WIN.y0;
const frameColor = '#0e0e10';
box(winW + 0.16, 0.08, 0.3, frameColor, winCx, WIN.y0, -D - 0.05);
box(winW + 0.16, 0.08, 0.26, frameColor, winCx, WIN.y1, -D - 0.07);
box(0.08, winH, 0.26, frameColor, WIN.x0, winCy, -D - 0.07);
box(0.08, winH, 0.26, frameColor, WIN.x1, winCy, -D - 0.07);
for (const k of [1, 2]) box(0.05, winH, 0.06, frameColor, WIN.x0 + (winW * k) / 3, winCy, -D - 0.1); // three tall panes
const glass = new THREE.Mesh(
  new THREE.PlaneGeometry(winW, winH),
  new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.07, roughness: 0.05, depthWrite: false }),
);
glass.position.set(winCx, winCy, -D - 0.1);
room.add(glass);
box(0.45, winH + 0.5, 0.08, '#c9c9cc', WIN.x0 - 0.2, winCy + 0.05, -D + 0.07);
box(0.45, winH + 0.5, 0.08, '#c9c9cc', WIN.x1 + 0.2, winCy + 0.05, -D + 0.07);
box(winW + 1.1, 0.05, 0.05, frameColor, winCx, WIN.y1 + 0.32, -D + 0.07);
const bench = new THREE.Group();
room.add(bench);
box(winW - 0.2, 0.38, 0.5, '#141416', winCx, 0.19, -D + 0.27, bench);
box(winW - 0.3, 0.12, 0.46, '#8c8f96', winCx, 0.43, -D + 0.27, bench, { r: 0.055 });
box(0.4, 0.3, 0.14, '#d9a441', WIN.x0 + 0.4, 0.62, -D + 0.12, bench, { r: 0.065 }).rotation.x = -0.25;
box(0.4, 0.3, 0.14, '#e8e6e2', WIN.x1 - 0.45, 0.62, -D + 0.12, bench, { r: 0.065 }).rotation.x = -0.25;
collide(WIN.x0, WIN.x1, -D, -D + 0.55);

// rug
const rug = add(new THREE.CircleGeometry(1.35, 40), mat('#3a3a40', DECAL), 0, 0.012, 0.5);
rug.rotation.x = -Math.PI / 2;
const rugIn = add(new THREE.RingGeometry(0.85, 0.95, 40), mat('#8c8f96', { ...DECAL, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 0, 0.018, 0.5);
rugIn.rotation.x = -Math.PI / 2;

// bed
const bed = new THREE.Group();
room.add(bed);
box(1.45, 0.3, 2.2, '#141416', -3.25, 0.15, 1.8, bed);
box(1.35, 0.22, 2.1, '#fbf3e6', -3.25, 0.4, 1.8, bed, { r: 0.08 });
box(1.44, 0.16, 1.4, '#4a4d55', -3.25, 0.5, 1.42, bed, { r: 0.07 });
box(1.44, 0.08, 0.25, '#e8e6e2', -3.25, 0.55, 2.1, bed, { r: 0.035 });
box(0.8, 0.16, 0.42, '#ffffff', -3.25, 0.58, 2.55, bed, { r: 0.075 }).rotation.x = 0.12;
box(1.45, 0.95, 0.1, '#55585f', -3.25, 0.475, 2.93, bed, { r: 0.045 });
collide(-W, -2.52, 0.68, D);
// nightstand + clock
box(0.45, 0.5, 0.45, '#141416', -2.2, 0.25, 2.7);
box(0.2, 0.12, 0.08, '#2b2b33', -2.2, 0.56, 2.7, room, { emissive: '#ff7a59', emissiveIntensity: 0.4 });
collide(-2.45, -1.95, 2.45, D);

// desk with dual monitors
const DESK_X = 2.65;
const desk = new THREE.Group();
room.add(desk);
box(2.0, 0.06, 0.8, '#6e4a32', 2.5, 0.75, -2.55, desk);
for (const [x, z] of [[1.58, -2.87], [3.42, -2.87], [1.58, -2.23], [3.42, -2.23]]) box(0.07, 0.72, 0.07, '#0e0e10', x, 0.36, z, desk);

const ALU = '#d3d5d9', SATIN = { metalness: 0.3, roughness: 0.4 };
function monitor(x, turn, portrait = false) {
  const w = portrait ? 0.5 : 0.84, h = portrait ? 0.84 : 0.5, cy = portrait ? 1.27 : 1.2;
  const g = new THREE.Group();
  g.position.set(x, 0, -2.76);
  g.rotation.y = turn;
  desk.add(g);
  // aluminium display on an L-shaped stand
  box(0.22, 0.012, 0.17, ALU, 0, 0.787, 0.01, g, SATIN);
  box(0.13, cy - 0.78, 0.014, ALU, 0, (cy + 0.78) / 2, -0.04, g, SATIN);
  box(w, h, 0.026, ALU, 0, cy, -0.003, g, { ...SATIN, r: 0.012 });
  box(w - 0.014, h - 0.014, 0.01, '#050506', 0, cy, 0.009, g, { r: 0.004 });
  const tex = canvasTexture(portrait ? 360 : 640, portrait ? 640 : 360);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, h - 0.04 * (h / w)), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, ...DECAL }));
  face.position.set(0, cy, 0.016);
  g.add(face);
  return tex;
}
const codeScreen = monitor(DESK_X - 0.3, 0.12);
const termScreen = monitor(DESK_X + 0.41, -0.32, true);
// Mac mini, keyboard and trackpad
box(0.2, 0.045, 0.2, ALU, 3.3, 0.803, -2.42, desk, { ...SATIN, r: 0.02 });
box(0.9, 0.006, 0.34, '#3a3540', DESK_X - 0.05, 0.784, -2.36, desk, { r: 0.003 });
box(0.44, 0.014, 0.13, ALU, DESK_X - 0.12, 0.794, -2.37, desk, { ...SATIN, r: 0.006 });
box(0.41, 0.004, 0.1, '#f7f7f8', DESK_X - 0.12, 0.802, -2.37, desk, { r: 0.002 });
box(0.15, 0.01, 0.12, '#f1f1f3', DESK_X + 0.22, 0.792, -2.37, desk, { r: 0.005 });
box(0.28, 0.02, 0.2, '#f2c57c', 1.82, 0.79, -2.3, desk).rotation.y = 0.2;
const monitorGlow = new THREE.PointLight('#9fc4ff', 1.8, 4, 2);
monitorGlow.position.set(DESK_X, 1.2, -2.35);
room.add(monitorGlow);
collide(1.5, 3.5, -D, -2.15);

// gaming chair
const chair = new THREE.Group();
chair.position.set(DESK_X, 0, -1.72);
chair.rotation.y = 0.18;
room.add(chair);
{
  const black = '#18181d', red = '#e23b4e';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = box(0.3, 0.035, 0.05, '#101014', Math.cos(a) * 0.15, 0.07, Math.sin(a) * 0.15, chair);
    spoke.rotation.y = -a;
    add(new THREE.SphereGeometry(0.035, 10, 8), mat('#101014'), Math.cos(a) * 0.3, 0.035, Math.sin(a) * 0.3, chair);
  }
  cyl(0.03, 0.03, 0.32, '#55555f', 0, 0.24, 0, chair, METAL);
  box(0.5, 0.1, 0.5, black, 0, 0.46, 0, chair);
  box(0.07, 0.09, 0.5, red, -0.27, 0.5, 0, chair);
  box(0.07, 0.09, 0.5, red, 0.27, 0.5, 0, chair);
  const back = new THREE.Group();
  back.position.set(0, 0.5, 0.25);
  back.rotation.x = 0.1;
  chair.add(back);
  box(0.46, 0.92, 0.09, black, 0, 0.46, 0, back);
  box(0.07, 0.86, 0.1, red, -0.14, 0.46, 0, back);
  box(0.07, 0.86, 0.1, red, 0.14, 0.46, 0, back);
  box(0.08, 0.52, 0.16, black, -0.26, 0.5, -0.04, back);
  box(0.08, 0.52, 0.16, black, 0.26, 0.5, -0.04, back);
  box(0.34, 0.2, 0.11, black, 0, 0.98, 0, back);
  box(0.26, 0.13, 0.07, red, 0, 0.8, -0.07, back);
  box(0.3, 0.14, 0.07, red, 0, 0.2, -0.07, back);
  for (const x of [-0.32, 0.32]) {
    box(0.04, 0.2, 0.04, '#101014', x, 0.58, 0.02, chair);
    box(0.08, 0.03, 0.26, '#101014', x, 0.69, -0.02, chair);
  }
}
collide(DESK_X - 0.3, DESK_X + 0.3, -2.02, -1.4);

// radio
const radio = new THREE.Group();
room.add(radio);
box(0.26, 0.16, 0.11, '#c96f5a', 1.68, 0.86, -2.6, radio);
const speaker = add(new THREE.CircleGeometry(0.05, 16), mat('#3b2a26'), 1.63, 0.86, -2.543, radio);
speaker.castShadow = false;
const radioLed = box(0.03, 0.03, 0.01, '#222', 1.76, 0.9, -2.543, radio, { emissive: '#7CFFB2', emissiveIntensity: 0 });

// floor lamp
const lamp = new THREE.Group();
room.add(lamp);
cyl(0.16, 0.18, 0.04, '#3b2a26', -3.5, 0.02, -2.5, lamp);
cyl(0.02, 0.02, 1.6, '#3b2a26', -3.5, 0.8, -2.5, lamp);
const shade = add(new THREE.CylinderGeometry(0.16, 0.28, 0.34, 20, 1, true),
  mat('#ffe2b0', { emissive: '#ffb86b', emissiveIntensity: 1.2, side: THREE.DoubleSide }), -3.5, 1.7, -2.5, lamp);
shade.castShadow = false;
const lampLight = new THREE.PointLight('#ffc27d', 14, 11, 2);
lampLight.position.set(-3.5, 1.62, -2.5);
room.add(lampLight);
collide(-3.75, -3.25, -2.75, -2.25);

// plant
const plant = new THREE.Group();
room.add(plant);
cyl(0.17, 0.13, 0.3, '#e8e6e2', 1.2, 0.15, -2.65, plant);
for (const [x, y, z, s] of [[0, 0.55, 0, 0.26], [0.14, 0.75, 0.05, 0.2], [-0.13, 0.72, -0.04, 0.2], [0.02, 0.95, 0.02, 0.17]]) {
  add(new THREE.SphereGeometry(s, 20, 16), mat(y > 0.8 ? '#6aab78' : '#5d9c6b'), 1.2 + x, y, -2.65 + z, plant).scale.y = 0.9;
}
collide(1.0, 1.4, -2.85, -2.45);

// bookshelf
box(0.36, 2.0, 1.4, '#141416', 3.8, 1.0, 0.7);
const bookColors = ['#f28b82', '#f2c57c', '#8fb8a8', '#7f9fc4', '#c9a0dc', '#f6e7d0', '#d98f7a'];
for (let s = 0; s < 4; s++) {
  box(0.34, 0.04, 1.34, '#2a2a2f', 3.78, 0.25 + s * 0.48, 0.7);
  let z = 0.1;
  while (z < 1.25) {
    const t = 0.05 + ((s * 7 + z * 31) % 5) * 0.012;
    const h = 0.26 + ((s * 3 + z * 17) % 4) * 0.035;
    box(0.2, h, t, bookColors[Math.floor(s * 2 + z * 13) % bookColors.length], 3.68, 0.27 + s * 0.48 + h / 2, z + t / 2, room, { r: 0.006 });
    z += t + 0.012;
  }
}
collide(3.6, W, 0, 1.4);

// espresso bar (built and run by barista.js; the machine faces into the room, toward -x)
const barista = createBarista({ THREE, room, camera, canvas, kit: { box, cyl, mat, steam, canvasTexture }, onDone: cupReady });
collide(...barista.collider);

// walnut slat panel on the wall beside the bed
for (let i = 0; i < 27; i++) box(0.035, H - 0.24, 0.05, '#6e4a32', -W + 0.02, H / 2 + 0.06, 0.72 + i * 0.085, room, { r: 0.008 });

// sofa against the front wall
const sofa = new THREE.Group();
room.add(sofa);
box(2.0, 0.3, 0.85, '#55585f', 1.1, 0.3, 2.5, sofa, { r: 0.09 });
box(2.0, 0.55, 0.22, '#55585f', 1.1, 0.64, 2.86, sofa, { r: 0.09 });
for (const x of [0.06, 2.14]) box(0.2, 0.42, 0.85, '#4a4d55', x, 0.48, 2.5, sofa, { r: 0.08 });
box(0.46, 0.34, 0.14, '#d9a441', 0.55, 0.66, 2.66, sofa, { r: 0.065 }).rotation.x = 0.25;
box(0.46, 0.34, 0.14, '#e8e6e2', 1.65, 0.66, 2.66, sofa, { r: 0.065 }).rotation.x = 0.25;
for (const [x, z] of [[0.15, 2.15], [2.05, 2.15], [0.15, 2.85], [2.05, 2.85]]) cyl(0.022, 0.018, 0.14, '#0e0e10', x, 0.07, z, sofa);
collide(-0.05, 2.25, 2.05, D);

// poster
const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), new THREE.MeshStandardMaterial({
  roughness: 0.9,
  map: canvasTexture(440, 300, (g, w, h) => {
    g.fillStyle = '#2b2440'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffb86b'; g.beginPath(); g.arc(w / 2, h * 0.62, 70, Math.PI, 0); g.fill();
    g.fillStyle = '#f28b82'; g.fillRect(0, h * 0.62, w, h);
    g.fillStyle = '#fdf3e3'; g.font = 'bold 30px Consolas, monospace'; g.textAlign = 'center';
    g.fillText('eat · sleep · code', w / 2, 60);
    g.font = '20px Consolas, monospace'; g.fillText("git commit -m 'stay cozy'", w / 2, h - 28);
  }),
}));
Object.assign(poster.material, DECAL);
poster.position.set(-W + 0.012, 1.75, -0.6);
poster.rotation.y = Math.PI / 2;
room.add(poster);

// recessed ceiling downlights and a warm LED cove above the glass
for (const [x, z] of [[-2.5, -1.3], [0, -1.3], [2.5, -1.3], [-2.5, 1.3], [0, 1.3], [2.5, 1.3]]) {
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.085, 28), new THREE.MeshBasicMaterial({ color: '#ffe9c4' }));
  spot.position.set(x, H - 0.004, z);
  spot.rotation.x = Math.PI / 2;
  room.add(spot);
}
const cove = new THREE.Mesh(new THREE.BoxGeometry(W * 2 - 0.3, 0.03, 0.06), new THREE.MeshBasicMaterial({ color: '#ffcf8f' }));
cove.position.set(0, H - 0.05, -D + 0.09);
room.add(cove);
const ceilingLight = new THREE.PointLight('#ffdcae', 6, 10, 2);
ceilingLight.position.set(0, 2.75, 0.1);
room.add(ceilingLight);

// the rest of the floor: front door, corridor and co-working lounge
const building = createBuilding({
  THREE, room, kit: { box, slab, cyl, mat, add, canvasTexture, collide, interactive }, screenTexture: codeScreen,
  getTicket: () => ide.view().ticket,
  onSit: (desk) => sitAt(desk.x, desk.z, true),
  onChat: () => { S.cozy = clamp(S.cozy + 4, 0, 100); },
  toast,
});

// cat (its nose points along local +x)
const cat = new THREE.Group();
cat.position.set(0.5, 0, 0.9);
cat.rotation.y = -0.6;
room.add(cat);
const catBodyGroup = new THREE.Group();
cat.add(catBodyGroup);
const fur = mat('#e8a55c'), furDark = mat('#c9833f');
const catBody = add(new THREE.SphereGeometry(0.2, 16, 12), fur, 0, 0.12, 0, catBodyGroup);
catBody.scale.set(1.5, 0.75, 1.0);
const catHead = add(new THREE.SphereGeometry(0.11, 14, 10), fur, 0.29, 0.19, 0, catBodyGroup);
for (const dz of [-0.055, 0.055]) add(new THREE.ConeGeometry(0.04, 0.08, 4), furDark, 0.29, 0.3, dz, catBodyGroup);
add(new THREE.SphereGeometry(0.018, 8, 8), mat('#f28b82'), 0.4, 0.18, 0, catBodyGroup);
for (const dz of [-0.045, 0.045]) add(new THREE.SphereGeometry(0.016, 8, 8), mat('#2b2b33'), 0.375, 0.215, dz, catBodyGroup);
const tail = new THREE.Group();
tail.position.set(-0.27, 0.16, 0);
catBodyGroup.add(tail);
const tailFur = add(new THREE.CapsuleGeometry(0.026, 0.22, 6, 14), furDark, -0.12, 0.02, 0, tail);
tailFur.rotation.z = Math.PI / 2 - 0.5;
const catLegs = [[0.17, 0.07], [0.17, -0.07], [-0.17, 0.07], [-0.17, -0.07]].map(([x, z]) => {
  const leg = new THREE.Group();
  leg.position.set(x, 0.14, z);
  cat.add(leg);
  add(new THREE.CapsuleGeometry(0.026, 0.1, 6, 12), furDark, 0, -0.07, 0, leg);
  return leg;
});

// the cup you carry around after brewing
const hand = new THREE.Group();
camera.add(hand);
cyl(0.045, 0.036, 0.085, '#fbf3e6', 0, 0, 0, hand);
const handle = add(new THREE.TorusGeometry(0.026, 0.008, 6, 14), mat('#fbf3e6'), 0.05, 0, 0, hand);
handle.castShadow = false;
const handFill = cyl(0.04, 0.04, 0.004, '#3b2314', 0, 0.038, 0, hand);
const handSteam = steam(hand, 0, 0.05, 0, 3, 0.005, 0.08);
hand.traverse((o) => { o.castShadow = false; });
const HAND_REST = new THREE.Vector3(0.3, -0.27, -0.52), HAND_SIP = new THREE.Vector3(0.06, -0.13, -0.3);
let sipAnim = 0;

// ───────────────────────── the world outside ─────────────────────────
const outside = new THREE.Group();
scene.add(outside);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: '#3f4450', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -22;
outside.add(ground);

// seeded random so the skyline is the same every launch
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// ── The city ──
// Streets form a grid: east-west roads every 40 m (the first one runs right below the window)
// and north-south roads every 48 m. Buildings fill the blocks in between, low-rise in the
// nearest row and rising toward a skyline of towers.
const GROUND_Y = -22;
const ROADS = { z0: -14, zStep: 40, x0: 24, xStep: 48, half: 6, walk: 2.5 };
const ROWS = [
  { h: [6, 15], palette: ['#b9a79a', '#c9b8a6', '#a9a39c', '#c2a48f'] },
  { h: [12, 26], palette: ['#b3a79c', '#a7b0bb', '#c4b7a8', '#9da6b0'] },
  { h: [18, 38], palette: ['#9fb0c4', '#aab4c2', '#b8c0cc', '#8fa3b8'] },
  { h: [26, 54], palette: ['#93a7bf', '#a3b1c4', '#8a9db5', '#b0bccb'] },
  { h: [34, 70], palette: ['#7f93ad', '#8aa0bb', '#96a8bf', '#6f86a3'] },
  { h: [40, 84], palette: ['#7389a6', '#8196b2', '#6b819e', '#8ea1ba'] },
];
const cityBoxes = [];  // [x, y, z, w, h, d, color, style, hasWindows]
const beaconPos = [];  // aircraft warning lights on top of spires
const span = ([lo, hi]) => lo + rnd() * (hi - lo);

function addBuilding(x, z, w, h, d, color) {
  const style = rnd();
  cityBoxes.push([x, GROUND_Y + h / 2, z, w, h, d, color, style, 1]);
  let top = GROUND_Y + h;
  if (h > 26 && rnd() < 0.7) {
    // towers step in near the top, and some carry a spire
    const crown = h * (0.12 + rnd() * 0.15);
    cityBoxes.push([x, top + crown / 2, z, w * 0.62, crown, d * 0.62, color, style, 1]);
    top += crown;
    if (rnd() < 0.6) {
      const spire = 6 + rnd() * 14;
      cityBoxes.push([x, top + spire / 2, z, 0.5, spire, 0.5, '#cfd6e0', 0, 0]);
      beaconPos.push(x, top + spire + 0.4, z);
    }
  } else {
    // rooftop clutter: a plant room and a water tank or stair head
    cityBoxes.push([x + w * 0.18, top + 0.9, z - d * 0.1, w * 0.32, 1.8, d * 0.3, '#8d8d92', 0, 0]);
    if (rnd() < 0.6) cityBoxes.push([x - w * 0.26, top + 0.6, z + d * 0.2, w * 0.16, 1.2, d * 0.18, '#a39c93', 0, 0]);
  }
}

ROWS.forEach((row, r) => {
  const edge = ROADS.half + ROADS.walk;
  const zNear = ROADS.z0 - ROADS.zStep * r - edge, depth = ROADS.zStep - edge * 2;
  for (let k = -7; k <= 6; k++) {
    const xLeft = ROADS.x0 + ROADS.xStep * k + edge, width = ROADS.xStep - edge * 2;
    const nx = rnd() < 0.35 ? 1 : 2, nz = r > 0 && rnd() < 0.4 ? 2 : 1;
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      if (rnd() < 0.07) continue; // leave the odd lot empty as a little plaza
      const lotW = width / nx, lotD = depth / nz;
      const w = lotW - 1.2 - rnd() * 2, d = lotD - 1.2 - rnd() * 2;
      const h = span(row.h) * (rnd() < 0.12 ? 1.3 : 1);
      addBuilding(xLeft + lotW * (ix + 0.5), zNear - lotD * (iz + 0.5), w, h, d, row.palette[(k + 7 + ix + iz) % row.palette.length]);
    }
  }
});

const m4 = new THREE.Matrix4(), col = new THREE.Color(), v3 = new THREE.Vector3(), scale3 = new THREE.Vector3(), noTurn = new THREE.Quaternion();

// Shared by the building and street shaders: they need each pixel's position in the world.
const WORLD_POS_VERTEX = `
  vec4 cityWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    cityWorld = instanceMatrix * cityWorld;
  #endif
  vWPos = (modelMatrix * cityWorld).xyz;
`;
const cityUniforms = { uNight: { value: 0 } };

// Facades are drawn in the shader from world position, so every building gets windows on all
// sides without a texture per building. `aInfo` = (style 0..1, roof height, has windows).
const facadeMat = new THREE.MeshLambertMaterial();
facadeMat.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = cityUniforms.uNight;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aInfo;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying vec3 vInfo;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>' + WORLD_POS_VERTEX + '  vWNormal = normal;\n  vInfo = aInfo;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying vec3 vInfo;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      float cityGlow = 0.0;
      float cityRnd = 0.0;
      vec3 cityFace = abs(vWNormal);
      if (vInfo.z > 0.5 && cityFace.y < 0.5) {
        float style = vInfo.x;
        float along = cityFace.x > 0.5 ? vWPos.z : vWPos.x;
        float height = vWPos.y - (${GROUND_Y.toFixed(1)});
        // three looks: punched windows, ribbon glazing, and curtain wall
        vec2 size = style < 0.34 ? vec2(2.4, 3.2) : style < 0.67 ? vec2(3.0, 3.4) : vec2(1.5, 3.6);
        vec2 lo = style < 0.34 ? vec2(0.22, 0.28) : style < 0.67 ? vec2(-1.0, 0.38) : vec2(0.06, 0.08);
        vec2 hi = style < 0.34 ? vec2(0.78, 0.80) : style < 0.67 ? vec2(2.0, 0.84) : vec2(0.94, 0.90);
        vec2 cell = vec2(along, height) / size;
        vec2 id = floor(cell), f = fract(cell), fw = fwidth(cell);
        vec2 pane = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
        float cover = (min(hi.x, 1.0) - max(lo.x, 0.0)) * (hi.y - lo.y);
        // far away the grid is finer than a pixel, so blend to its average instead of shimmering
        float detail = 1.0 - smoothstep(0.3, 0.8, max(fw.x, fw.y));
        float parapet = step(vInfo.y - 1.1, vWPos.y);
        float shopfront = 1.0 - step(4.2, height);
        float win = mix(cover, pane.x * pane.y, detail) * (1.0 - parapet);
        cityRnd = fract(sin(dot(id + cityFace.x * 31.0 + style * 57.0, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 glass = mix(vec3(0.12, 0.18, 0.26), vec3(0.40, 0.56, 0.70), cityRnd * 0.7 + 0.2 * style);
        diffuseColor.rgb *= 1.0 - 0.28 * parapet - 0.18 * shopfront;
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.92);
        // a thin shadow line under each floor gives the wall some depth
        diffuseColor.rgb *= 1.0 - 0.12 * detail * (1.0 - smoothstep(0.0, 0.06, f.y)) * (1.0 - parapet);
        float lit = mix(0.24, step(0.74, cityRnd), detail);
        cityGlow = win * max(lit, shopfront * 0.8);
      }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += mix(vec3(1.0, 0.80, 0.48), vec3(0.62, 0.80, 1.0), step(0.95, cityRnd)) * cityGlow * uNight * (0.35 + 0.45 * cityRnd);`);
};
const facadeGeo = new THREE.BoxGeometry(1, 1, 1);
const facadeInfo = new Float32Array(cityBoxes.length * 3);
const buildings = new THREE.InstancedMesh(facadeGeo, facadeMat, cityBoxes.length);
cityBoxes.forEach(([x, y, z, w, h, d, color, style, hasWindows], i) => {
  buildings.setMatrixAt(i, m4.compose(v3.set(x, y, z), noTurn, scale3.set(w, h, d)));
  buildings.setColorAt(i, col.set(color));
  facadeInfo.set([style, y + h / 2, hasWindows], i * 3);
});
facadeGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(facadeInfo, 3));
outside.add(buildings);

const beaconGeo = new THREE.BufferGeometry();
beaconGeo.setAttribute('position', new THREE.Float32BufferAttribute(beaconPos, 3));
const beacons = new THREE.Points(beaconGeo, new THREE.PointsMaterial({ color: '#ff4a3d', size: 4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
outside.add(beacons);

// The street level, also drawn in a shader: asphalt, pavements, lane dashes and zebra crossings.
const streetMat = new THREE.MeshLambertMaterial();
streetMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>' + WORLD_POS_VERTEX);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      float roadHalf = ${ROADS.half.toFixed(1)}, kerb = ${(ROADS.half + ROADS.walk).toFixed(1)};
      float dz = abs(mod(vWPos.z - (${ROADS.z0.toFixed(1)}) + ${(ROADS.zStep / 2).toFixed(1)}, ${ROADS.zStep.toFixed(1)}) - ${(ROADS.zStep / 2).toFixed(1)});
      float dx = abs(mod(vWPos.x - ${ROADS.x0.toFixed(1)} + ${(ROADS.xStep / 2).toFixed(1)}, ${ROADS.xStep.toFixed(1)}) - ${(ROADS.xStep / 2).toFixed(1)});
      float aa = fwidth(vWPos.x) + fwidth(vWPos.z);
      // the cross streets stop at the road below the window instead of running under your building
      float beyond = step(vWPos.z, ${(ROADS.z0 + ROADS.half).toFixed(1)});
      float roadEW = 1.0 - smoothstep(roadHalf - aa, roadHalf + aa, dz);
      float roadNS = (1.0 - smoothstep(roadHalf - aa, roadHalf + aa, dx)) * beyond;
      float road = max(roadEW, roadNS);
      float pavement = max(1.0 - smoothstep(kerb - aa, kerb + aa, dz), (1.0 - smoothstep(kerb - aa, kerb + aa, dx)) * beyond);
      vec3 street = mix(vec3(0.34, 0.37, 0.34), vec3(0.60, 0.59, 0.56), pavement);
      street = mix(street, vec3(0.15, 0.16, 0.18), road);
      float fine = 1.0 - smoothstep(0.12, 0.5, aa);
      float dashEW = (1.0 - smoothstep(0.13, 0.13 + aa, dz)) * step(0.5, fract(vWPos.x / 7.0)) * (1.0 - roadNS);
      float dashNS = (1.0 - smoothstep(0.13, 0.13 + aa, dx)) * step(0.5, fract(vWPos.z / 7.0)) * (1.0 - roadEW) * beyond;
      float zebraEW = roadEW * step(roadHalf + 0.6, dx) * step(dx, roadHalf + 3.4) * step(0.5, fract(vWPos.z / 1.3)) * beyond;
      float zebraNS = roadNS * step(roadHalf + 0.6, dz) * step(dz, roadHalf + 3.4) * step(0.5, fract(vWPos.x / 1.3));
      float paint = max(max(dashEW, dashNS), max(zebraEW, zebraNS) * 0.9) * fine;
      diffuseColor.rgb = mix(street, vec3(0.86, 0.85, 0.80), paint) * diffuse;
      // pools of light under street lamps, spaced along both kerbs
      vec2 lampEW = vec2((fract(vWPos.x / 22.0) - 0.5) * 22.0, dz - roadHalf - 0.8);
      vec2 lampNS = vec2((fract(vWPos.z / 22.0) - 0.5) * 22.0, dx - roadHalf - 0.8);
      float lampPool = max(exp(-dot(lampEW, lampEW) / 26.0), exp(-dot(lampNS, lampNS) / 26.0) * beyond);
      vec3 lampGlow = vec3(1.0, 0.74, 0.42) * lampPool * mix(street, vec3(0.86), paint);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += lampGlow * uNight * 0.75;`);
  shader.uniforms.uNight = cityUniforms.uNight;
  shader.fragmentShader = shader.fragmentShader.replace('varying vec3 vWPos;', 'varying vec3 vWPos;\nuniform float uNight;');
};
ground.material = streetMat;

// Street trees along the road below the window and the boulevard behind it.
const treeSpots = [];
for (const roadZ of [ROADS.z0, ROADS.z0 - ROADS.zStep]) {
  for (const side of [-1, 1]) for (let x = -230; x <= 230; x += 9.5) {
    const nearCrossing = Math.abs(((x - ROADS.x0 + ROADS.xStep * 10.5) % ROADS.xStep) - ROADS.xStep / 2) < ROADS.half + 4;
    if (!nearCrossing || (roadZ === ROADS.z0 && side === 1)) treeSpots.push([x + rnd() * 2, roadZ + side * (ROADS.half + 1.3), 0.8 + rnd() * 0.5]);
  }
}
const treeTops = new THREE.InstancedMesh(new THREE.SphereGeometry(1.7, 12, 10), new THREE.MeshLambertMaterial(), treeSpots.length);
const treeTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 2.4, 8), new THREE.MeshLambertMaterial({ color: '#6b4a35' }), treeSpots.length);
treeSpots.forEach(([x, z, size], i) => {
  treeTops.setMatrixAt(i, m4.compose(v3.set(x, GROUND_Y + 2.4 + size * 1.3, z), noTurn, scale3.set(size, size * 1.15, size)));
  treeTops.setColorAt(i, col.set(['#4f8a57', '#5d9a62', '#467c50'][i % 3]));
  treeTrunks.setMatrixAt(i, m4.makeTranslation(x, GROUND_Y + 1.2, z));
});
outside.add(treeTops, treeTrunks);

// Traffic: each car keeps to its lane and wraps around when it leaves the city.
const cars = [];
const CAR_COLORS = ['#e8e8ea', '#2f3640', '#c0392b', '#2e6fb5', '#f1c40f', '#f1c40f', '#7f8c8d', '#ffffff', '#1e8449'];
function addCars(count, eastWest, roadAt, from, to) {
  for (let i = 0; i < count; i++) {
    const dir = i % 2 ? 1 : -1, bus = rnd() < 0.1;
    cars.push({ eastWest, lane: roadAt + (eastWest ? dir : -dir) * 3, at: from + rnd() * (to - from), from, to, dir, speed: 9 + rnd() * 7, length: bus ? 10.5 : 4.4, height: bus ? 2.9 : 1.45, color: bus ? '#d35400' : CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)] });
  }
}
addCars(16, true, ROADS.z0, -300, 300);
addCars(14, true, ROADS.z0 - ROADS.zStep, -300, 300);
for (let r = 2; r <= 4; r++) addCars(8, true, ROADS.z0 - ROADS.zStep * r, -300, 300);
for (let k = -4; k <= 3; k++) addCars(5, false, ROADS.x0 + ROADS.xStep * k, -250, ROADS.z0);
const carMesh = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.18), new THREE.MeshLambertMaterial(), cars.length);
cars.forEach((car, i) => carMesh.setColorAt(i, col.set(car.color)));
carMesh.frustumCulled = false;
outside.add(carMesh);
const lamps = (color) => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cars.length * 3), 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  points.frustumCulled = false;
  outside.add(points);
  return points;
};
const headlights = lamps('#fff3c4'), taillights = lamps('#ff3b30');

// Elevated metro line above the boulevard, with a train that passes every so often.
const METRO = { y: -3, z: ROADS.z0 - ROADS.zStep, speed: 26, length: 600 };
const concrete = new THREE.MeshLambertMaterial({ color: '#8e9199' });
const metro = new THREE.Group();
outside.add(metro);
const deck = new THREE.Mesh(new THREE.BoxGeometry(METRO.length, 0.7, 4.6), concrete);
deck.position.set(0, METRO.y - 0.35, METRO.z);
metro.add(deck);
for (const side of [-2.2, 2.2]) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(METRO.length, 0.8, 0.18), concrete);
  wall.position.set(0, METRO.y + 0.4, METRO.z + side);
  metro.add(wall);
}
const pillarHeight = METRO.y - 0.7 - GROUND_Y;
const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, pillarHeight, 1.2), concrete, Math.floor(METRO.length / 16) + 1);
for (let i = 0; i < pillars.count; i++) pillars.setMatrixAt(i, m4.makeTranslation(-METRO.length / 2 + i * 16, GROUND_Y + pillarHeight / 2, METRO.z));
metro.add(pillars);

const train = new THREE.Group();
metro.add(train);
const trainBody = new THREE.MeshLambertMaterial({ color: '#e4e7ec' });
const trainStripe = new THREE.MeshLambertMaterial({ color: '#e2483d' });
const trainGlass = new THREE.MeshBasicMaterial({ color: '#2c3e55' });
for (let i = -2; i <= 2; i++) {
  const car = new THREE.Group();
  car.position.x = i * 11.2;
  car.add(new THREE.Mesh(new RoundedBoxGeometry(10.8, 2.7, 2.7, 3, 0.35), trainBody));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(10.82, 0.32, 2.74), trainStripe);
  stripe.position.y = -0.55;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.85, 2.76), trainGlass);
  glass.position.y = 0.4;
  car.add(stripe, glass);
  train.add(car);
}
const trainState = { x: -METRO.length / 2, dir: 1, wait: 4 };

function updateMetro(dt, t) {
  const night = 1 - day;
  trainGlass.color.set('#2c3e55').lerp(tmpColor.set('#ffe2a6'), night);
  beacons.material.opacity = night * (Math.sin(t * 2.2) > 0 ? 0.95 : 0.15);
  if (trainState.wait > 0) {
    trainState.wait -= dt;
  } else {
    trainState.x += trainState.dir * METRO.speed * dt;
    if (Math.abs(trainState.x) > METRO.length / 2 + 40) {
      trainState.x = Math.sign(trainState.x) * (METRO.length / 2 + 40);
      trainState.dir = -trainState.dir;
      trainState.wait = 5 + Math.random() * 9;
    }
  }
  // each direction runs on its own track
  train.position.set(trainState.x, METRO.y + 1.55, METRO.z + trainState.dir * 1.05);

  // traffic
  const head = headlights.geometry.attributes.position, tail = taillights.geometry.attributes.position;
  cars.forEach((car, i) => {
    car.at += car.dir * car.speed * dt;
    if (car.at > car.to) car.at = car.from;
    if (car.at < car.from) car.at = car.to;
    const x = car.eastWest ? car.at : car.lane, z = car.eastWest ? car.lane : car.at;
    const y = GROUND_Y + car.height / 2 + 0.1, nose = (car.dir * car.length) / 2;
    carMesh.setMatrixAt(i, m4.compose(v3.set(x, y, z), noTurn, car.eastWest ? scale3.set(car.length, car.height, 1.9) : scale3.set(1.9, car.height, car.length)));
    head.setXYZ(i, car.eastWest ? x + nose : x, y, car.eastWest ? z : z + nose);
    tail.setXYZ(i, car.eastWest ? x - nose : x, y, car.eastWest ? z : z - nose);
  });
  carMesh.instanceMatrix.needsUpdate = true;
  head.needsUpdate = tail.needsUpdate = true;
  headlights.material.opacity = taillights.material.opacity = night;
}

// sun, moon, stars, clouds
const sun = new THREE.Mesh(new THREE.SphereGeometry(9, 20, 20), new THREE.MeshBasicMaterial({ color: '#fff2c2', fog: false }));
const moon = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 20), new THREE.MeshBasicMaterial({ color: '#e6ecff', fog: false }));
outside.add(sun, moon);
const starPos = new Float32Array(900 * 3);
for (let i = 0; i < 900; i++) {
  const th = rnd() * Math.PI * 2, ph = rnd() * Math.PI * 0.5;
  starPos.set([Math.cos(th) * Math.cos(ph) * 400, Math.sin(ph) * 400 - 10, Math.sin(th) * Math.cos(ph) * 400], i * 3);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
outside.add(stars);
const cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, fog: false });
const clouds = [];
for (let i = 0; i < 9; i++) {
  const c = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + rnd() * 5, 10, 8), cloudMat);
    puff.position.set(k * 7 - 10, rnd() * 3, rnd() * 4);
    puff.scale.y = 0.55;
    c.add(puff);
  }
  c.position.set(-200 + rnd() * 400, 38 + rnd() * 30, -150 - rnd() * 60);
  c.userData.speed = 1 + rnd() * 1.5;
  outside.add(c);
  clouds.push(c);
}

// rain
const N_RAIN = 1100;
const rainPos = new Float32Array(N_RAIN * 6);
for (let i = 0; i < N_RAIN; i++) {
  const x = -22 + Math.random() * 44, y = -12 + Math.random() * 28, z = -3.6 - Math.random() * 24;
  rainPos.set([x, y, z, x, y - 0.4, z], i * 6);
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#cfe1ff', transparent: true, opacity: 0.45, fog: false }));
rain.frustumCulled = false;
outside.add(rain);

// lights
const hemi = new THREE.HemisphereLight('#ffffff', '#a39a90', 1);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight('#fff0d6', 3);
sunLight.target.position.set(0, 1, 0);
scene.add(sunLight, sunLight.target);
// soft fill so the skyline isn't a wall of silhouettes when the sun is behind it
const fill = new THREE.DirectionalLight('#ffffff', 1);
fill.position.set(6, 20, 40);
scene.add(fill);

// ───────────────────────── sky / time of day ─────────────────────────
const SKY = [[0, '#0b1026'], [5, '#1a1f4a'], [6.4, '#f4a27a'], [8, '#9fd0f0'], [12, '#8ec9f5'], [16.5, '#a9cdea'],
  [17.8, '#f5b27a'], [18.8, '#d9705f'], [20, '#2a2350'], [24, '#0b1026']].map(([h, c]) => [h, new THREE.Color(c)]);
const skyColor = new THREE.Color(), rainGrey = new THREE.Color('#77808c'), tmpColor = new THREE.Color();
let day = 1; // 0 = night, 1 = full daylight

function updateSky() {
  const h = S.hour;
  let i = 0;
  while (i < SKY.length - 2 && h >= SKY[i + 1][0]) i++;
  skyColor.copy(SKY[i][1]).lerp(SKY[i + 1][1], (h - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]));
  const a = ((h - 6) / 12) * Math.PI;
  day = smooth(-0.12, 0.3, Math.sin(a));
  if (S.raining) skyColor.lerp(tmpColor.copy(rainGrey).multiplyScalar(0.15 + day * 0.85), 0.65);
  scene.background.copy(skyColor);
  scene.fog.color.copy(skyColor);

  sun.position.set(-Math.cos(a) * 170 - 20, Math.sin(a) * 120 - 12, -300);
  moon.position.set(Math.cos(a) * 150 - 30, -Math.sin(a) * 110 + 5, -300);
  sun.visible = !S.raining;
  const night = 1 - day;
  stars.material.opacity = S.raining ? 0 : night * 0.9;
  cityUniforms.uNight.value = clamp(night * 1.2 + (S.raining ? 0.25 : 0), 0, 1);
  cloudMat.color.setScalar(0.18 + day * 0.82).lerp(skyColor, 0.25);
  cloudMat.opacity = S.raining ? 0.95 : 0.8;
  buildings.material.color.setScalar(0.3 + day * 0.7);
  fill.intensity = 0.1 + day * 0.8 * (S.raining ? 0.6 : 1);
  ground.material.color.setScalar(0.3 + day * 0.7);

  const src = Math.sin(a) > -0.05 ? sun.position : moon.position;
  sunLight.position.copy(src).normalize().multiplyScalar(40).add(sunLight.target.position);
  const wet = S.raining ? 0.35 : 1;
  sunLight.intensity = (0.15 + day * 1.5) * wet;
  sunLight.color.set(day > 0.5 ? '#fff0d6' : '#9fb4ff').lerp(tmpColor.set('#ffb07a'), day * (1 - day) * 2.4);
  hemi.intensity = 0.3 + day * 1.0 * (S.raining ? 0.7 : 1);
  hemi.color.copy(skyColor).lerp(tmpColor.set('#ffffff'), 0.4);

  const evening = 0.35 + night * 0.65;
  lampLight.intensity = S.lampOn ? 12 * evening : 0;
  shade.material.emissiveIntensity = S.lampOn ? 0.9 : 0.05;
  ceilingLight.intensity = 9 * evening;
  rain.visible = S.raining;
}

// ───────────────────────── audio ─────────────────────────
let actx = null, rainGain = null, musicGain = null, fxGain = null, fxFilter = null, chordStep = 0, nextChordAt = 0;
const CHORDS = [[174.6, 220, 261.6, 329.6], [164.8, 196, 246.9, 293.7], [146.8, 174.6, 220, 261.6], [130.8, 164.8, 196, 246.9]];
// machine noises per barista step: [filter type, frequency, volume]
const FX = { grind: ['bandpass', 700, 0.35], pull: ['lowpass', 320, 0.12], steam: ['highpass', 3800, 0.1], water: ['bandpass', 1800, 0.06] };

function initAudio() {
  if (actx) return;
  actx = new AudioContext();
  const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = actx.createBufferSource();
  noise.buffer = buf; noise.loop = true;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
  rainGain = actx.createGain(); rainGain.gain.value = 0;
  noise.connect(lp).connect(rainGain).connect(actx.destination);
  fxFilter = actx.createBiquadFilter();
  fxGain = actx.createGain(); fxGain.gain.value = 0;
  noise.connect(fxFilter).connect(fxGain).connect(actx.destination);
  noise.start();
  const mlp = actx.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 900;
  musicGain = actx.createGain(); musicGain.gain.value = 0.05;
  mlp.connect(musicGain).connect(actx.destination);
  musicGain.input = mlp;
}
function note(freq, at, len, type, peak) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + Math.min(0.5, len * 0.3));
  g.gain.linearRampToValueAtTime(0, at + len);
  o.connect(g).connect(musicGain.input);
  o.start(at); o.stop(at + len + 0.05);
}
function updateAudio() {
  if (!actx) return;
  const target = S.raining ? (mode === 'window' ? 0.16 : 0.08) : 0;
  rainGain.gain.value += (target - rainGain.gain.value) * 0.05;
  const fx = FX[barista.state.sound];
  if (fx) { fxFilter.type = fx[0]; fxFilter.frequency.value = fx[1]; }
  fxGain.gain.value += ((fx ? fx[2] : 0) - fxGain.gain.value) * 0.2;
  if (S.radioOn && actx.currentTime > nextChordAt - 0.2) {
    const at = Math.max(actx.currentTime, nextChordAt);
    const chord = CHORDS[chordStep++ % CHORDS.length];
    chord.forEach((f) => note(f, at, 4.3, 'triangle', 0.5));
    for (let k = 0; k < 4; k++) if (Math.random() < 0.7) note(chord[Math.floor(Math.random() * 4)] * 2, at + k + Math.random() * 0.1, 0.9, 'sine', 0.6);
    nextChordAt = at + 4;
  }
}

// ───────────────────────── player ─────────────────────────
const player = { pos: new THREE.Vector3(0, 1.6, 1.6), yaw: 0, pitch: -0.05, bob: 0 };
const keys = new Set();
let mode = 'walk'; // walk | pc | window | sleep | barista
let arrived = true;
const mouse = { x: 0, y: 0 };
const POSES = {
  pc: { pos: new THREE.Vector3(DESK_X, 1.32, -1.7), look: new THREE.Vector3(DESK_X, 1.17, -2.8) },
  window: { pos: new THREE.Vector3(winCx, 1.55, -2.35), look: new THREE.Vector3(winCx, 3, -40) },
  sleep: { pos: new THREE.Vector3(-3.25, 0.9, 2.3), look: new THREE.Vector3(-2.2, 2.9, -1.5) },
  barista: { pos: new THREE.Vector3(2.72, 1.36, 2.24), look: new THREE.Vector3(3.75, 1.1, 2.24) },
};
// sit at a desk whose top is centred on (x, z); `friends` is true at the shared workstation
let withFriends = false;
function sitAt(x, z, friends) {
  POSES.pc.pos.set(x, 1.32, z + 0.85);
  POSES.pc.look.set(x, 1.17, z - 0.25);
  withFriends = friends;
  setMode('pc');
}
const poseCam = new THREE.PerspectiveCamera();
const targetPos = new THREE.Vector3(), targetQuat = new THREE.Quaternion(), lookAt = new THREE.Vector3(), tmpV = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

function blocked(x, z, r = 0.28) {
  // you can stand anywhere inside one of the building's walkable areas (a doorway only counts while its door is open)
  const inside = building.zones.some((a) => {
    const pad = a.pad ?? r;
    return (!a.gate || a.gate()) && x > a.minX + pad && x < a.maxX - pad && z > a.minZ + pad && z < a.maxZ - pad;
  });
  if (!inside) return true;
  return colliders.some((c) => x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r);
}

function updatePlayer(dt) {
  if (mode === 'walk') {
    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    if (f || s) {
      const speed = (keys.has('ShiftLeft') ? 3.4 : 2.1) * (S.energy < 10 ? 0.6 : 1) * dt / Math.hypot(f, s);
      const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
      const dx = (-sin * f + cos * s) * speed, dz = (-cos * f - sin * s) * speed;
      if (!blocked(player.pos.x + dx, player.pos.z)) player.pos.x += dx;
      if (!blocked(player.pos.x, player.pos.z + dz)) player.pos.z += dz;
      player.bob += dt * 9;
    }
    targetPos.copy(player.pos);
    targetPos.y += Math.sin(player.bob) * 0.025;
    targetQuat.setFromEuler(euler.set(player.pitch, player.yaw, 0));
  } else {
    const p = POSES[mode];
    targetPos.copy(p.pos);
    lookAt.copy(p.look);
    if (mode === 'window') {
      // the mouse steers your gaze; moving it down leans you toward the glass so you can see the street
      const down = Math.max(0, mouse.y);
      targetPos.z -= down * 0.55;
      targetPos.y += down * 0.08;
      const pitch = 0.04 - mouse.y * (mouse.y > 0 ? 1.15 : 0.35), yaw = mouse.x * 0.6;
      lookAt.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(10).add(targetPos);
    }
    poseCam.position.copy(targetPos);
    poseCam.lookAt(lookAt);
    targetQuat.copy(poseCam.quaternion);
  }
  if (mode === 'walk' && arrived) {
    camera.position.copy(targetPos);
    camera.quaternion.copy(targetQuat);
  } else {
    const k = 1 - Math.exp(-dt * 5);
    camera.position.lerp(targetPos, k);
    camera.quaternion.slerp(targetQuat, k);
    if (camera.position.distanceTo(targetPos) < 0.03) arrived = true;
  }
}

// ───────────────────────── cat ─────────────────────────
const catAI = { state: 'sit', timer: 3, target: new THREE.Vector3(), purr: 0 };

function pathClear(from, to) {
  for (let i = 1; i <= 14; i++) {
    const k = i / 14;
    if (blocked(from.x + (to.x - from.x) * k, from.z + (to.z - from.z) * k, 0.2)) return false;
  }
  return true;
}
function catGo(x, z) {
  catAI.target.set(x, 0, z);
  if (!pathClear(cat.position, catAI.target)) return false;
  catAI.state = 'walk';
  return true;
}
function updateCat(dt, t) {
  catAI.purr = Math.max(0, catAI.purr - dt);
  let stride = 0;
  if (catAI.state === 'walk') {
    const dx = catAI.target.x - cat.position.x, dz = catAI.target.z - cat.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.04) {
      catAI.state = Math.random() < 0.4 ? 'sleep' : 'sit';
      catAI.timer = 4 + Math.random() * 9;
    } else {
      const step = Math.min(dist, 0.65 * dt);
      cat.position.x += (dx / dist) * step;
      cat.position.z += (dz / dist) * step;
      const want = Math.atan2(-dz, dx);
      const turn = ((want - cat.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      cat.rotation.y += turn * Math.min(1, dt * 7);
      stride = 1;
    }
  } else {
    catAI.timer -= dt;
    if (catAI.timer <= 0 && catAI.purr <= 0) {
      // sometimes come and keep you company, otherwise wander
      const visit = Math.random() < 0.35;
      const base = mode === 'pc' ? POSES.pc.pos : player.pos;
      const x = visit ? base.x + (Math.random() - 0.5) * 1.6 : -3.4 + Math.random() * 6.8;
      const z = visit ? base.z + 0.4 + Math.random() * 0.8 : -2.2 + Math.random() * 4.8;
      if (!catGo(x, z)) catAI.timer = 0.2;
    }
  }
  // pose: up on its legs when walking, a loaf when resting
  const up = catAI.state === 'walk' ? 1 : 0;
  catBodyGroup.position.y += (up * 0.1 + Math.abs(Math.sin(t * 9)) * 0.012 * stride - catBodyGroup.position.y) * Math.min(1, dt * 8);
  catLegs.forEach((leg, i) => {
    leg.visible = catBodyGroup.position.y > 0.03;
    leg.rotation.z = stride * Math.sin(t * 9 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.55;
  });
  const asleep = catAI.state === 'sleep';
  catHead.position.y += ((asleep ? 0.1 : 0.19) - catHead.position.y) * Math.min(1, dt * 4);
  catBody.scale.y = 0.75 + Math.sin(t * (catAI.purr ? 7 : asleep ? 1.1 : 1.8)) * 0.03;
  tail.rotation.y = Math.sin(t * (stride ? 5 : 1.4)) * (asleep ? 0.05 : 0.45);
  tail.rotation.z = stride ? -0.5 : 0.1;
}

// ───────────────────────── interactions ─────────────────────────
const raycaster = new THREE.Raycaster();
raycaster.far = 2.7;
const center = new THREE.Vector2(0, 0);
let focusKey = null;

function findFocus() {
  if (mode !== 'walk') return null;
  raycaster.setFromCamera(center, camera);
  const hit = raycaster.intersectObjects(interactRoots, true)[0];
  if (!hit) return null;
  let o = hit.object;
  while (o && !o.userData.key) o = o.parent;
  return o ? o.userData.key : null;
}

function setMode(next) {
  mode = next;
  arrived = false;
  if (next !== 'walk' && document.pointerLockElement) document.exitPointerLock();
  if (next === 'pc') desktop.show(); else desktop.hide();
  document.body.classList.toggle('at-pc', next === 'pc');
  $('caption').classList.toggle('on', next === 'window');
  $('crosshair').style.display = next === 'walk' ? '' : 'none';
  if (next === 'pc') {
    ide.open();
    setTimeout(ide.focus, 350);
  } else {
    ide.blur();
  }
  if (next !== 'barista' && barista.state.open) barista.close();
  $('hud').style.opacity = next === 'barista' ? 0.35 : '';
  if (next === 'window') $('caption').textContent = windowCaption();
  refreshHint();
}
function refreshHint() {
  $('clickHint').style.display = mode === 'walk' && !document.pointerLockElement ? '' : 'none';
  $('help').style.display = mode === 'walk' ? '' : 'none';
}
function leave() { if (mode === 'pc' || mode === 'window' || mode === 'barista') setMode('walk'); }

function windowCaption() {
  const night = day < 0.3, dusk = day >= 0.3 && day < 0.9;
  const lines = S.raining
    ? ['Rain taps softly on the glass. Nothing needs you right now.', 'The city blurs behind the rain. Deadlines feel very far away.']
    : night
      ? ['A thousand little windows, each one somebody’s evening.', 'The city hums quietly. Somewhere out there, a build just passed.']
      : dusk
        ? ['The sky is doing that thing again. You should look more often.', 'Golden hour. Even the legacy code looks nice in this light.']
        : ['Clouds drift by at exactly zero story points per sprint.', 'Sunlight on the rooftops. Your eyes thank you for the break.'];
  return lines[Math.floor(Math.random() * lines.length)] + '   (look down to see the street · Esc to step back)';
}

function newDay() {
  S.day++;
  S.coffee = 0;
  S.raining = Math.random() < 0.4;
}

let sleeping = false;
function sleep() {
  if (sleeping) return;
  sleeping = true;
  const nap = S.hour >= 9 && S.hour < 18;
  setMode('sleep');
  setTimeout(() => { $('fadeText').textContent = nap ? 'a little nap…' : 'zzz…'; $('fade').classList.add('on'); }, 1100);
  setTimeout(() => {
    if (nap) {
      S.hour += 2;
      S.energy = clamp(S.energy + 35, 0, 100);
    } else {
      if (S.hour >= 9) newDay();
      S.hour = 7;
      S.energy = 100;
      S.cozy = clamp(S.cozy + 15, 0, 100);
    }
    $('fadeText').textContent = nap ? 'That helped.' : `Day ${S.day} · ${S.raining ? 'a rainy morning' : 'a bright morning'}`;
    save();
  }, 2900);
  setTimeout(() => { $('fade').classList.remove('on'); setMode('walk'); sleeping = false; }, 5000);
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3300);
}

// ───────────────────────── coffee ─────────────────────────
function cupReady({ name, quality, stars, sips, energy, cozy, milk, note, decaf }) {
  const strength = 0.5 + quality;
  S.cup = { name: (decaf ? 'Decaf ' : '') + name, stars, sips, energy: decaf ? 0 : energy * strength, cozy: cozy * strength, milk };
  S.coffee++;
  toast(`☕ ${S.cup.name} ${'★'.repeat(stars)} — ${note}. Press Q to sip.`);
  save();
  setMode('walk');
}

function sip() {
  if (!S.cup || sipAnim > 0 || (mode !== 'walk' && mode !== 'window')) return;
  sipAnim = 1;
  S.energy = clamp(S.energy + S.cup.energy, 0, 100);
  S.cozy = clamp(S.cozy + S.cup.cozy, 0, 100);
  if (--S.cup.sips <= 0) {
    toast(`Last sip of the ${S.cup.name.toLowerCase()}. Ahh.`);
    setTimeout(() => { S.cup = null; }, 1200);
  }
}

function updateCoffee(dt, t) {
  barista.update(dt, t);
  // the cup in your hand
  hand.visible = !!S.cup && (mode === 'walk' || mode === 'window');
  if (hand.visible) {
    sipAnim = Math.max(0, sipAnim - dt / 1.4);
    const lift = Math.sin((1 - sipAnim) * Math.PI) * (sipAnim > 0 ? 1 : 0);
    hand.position.lerpVectors(HAND_REST, HAND_SIP, lift);
    hand.position.y += Math.sin(player.bob) * 0.006;
    hand.rotation.set(lift * 0.85, -0.5, 0);
    handFill.material.color.set(S.cup.milk ? '#c69a6d' : '#3b2314');
    handSteam(t, sipAnim === 0);
  }
}

// ───────────────────────── the PC ─────────────────────────
const ide = createIDE({
  S,
  onType() { S.energy = clamp(S.energy - 0.03, 0, 100); },
  onCommit(t) {
    const before = levelOf(S.xp);
    const reward = Math.round(t.xp * (1 + S.cozy / 200) * (S.energy <= 1 ? 0.5 : 1) * (withFriends ? 1.2 : 1));
    S.xp += reward;
    S.commits++;
    if (withFriends) toast('Maya and Devon cheer from the next desks. +20% XP for coding together.');
    toast(`✓ ${t.id} merged · +${reward} XP`);
    if (levelOf(S.xp) > before) toast(`★ Promoted to ${rankOf(S.xp)}!`);
    save();
  },
  onUpdate: drawScreens,
});
function toggleRadio() {
  S.radioOn = !S.radioOn;
  initAudio();
  toast(S.radioOn ? '♪ lo-fi beats to refactor to' : 'Music off');
}
const desktop = createDesktop({ S, onRadio: toggleRadio });

// macOS-style wallpaper, menu bar, dock and one window, sized to whichever display it is drawn on
function macWindow(g, app, title, fill) {
  const w = g.canvas.width, h = g.canvas.height;
  const wall = g.createLinearGradient(0, 0, w, h);
  wall.addColorStop(0, '#2b1f5c'); wall.addColorStop(0.4, '#7a3b8f'); wall.addColorStop(0.7, '#e0637a'); wall.addColorStop(1, '#f6a75c');
  g.fillStyle = wall; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(30,20,50,0.45)'; g.fillRect(0, 0, w, 15);
  g.fillStyle = '#ffffff'; g.font = 'bold 10px Segoe UI, sans-serif'; g.fillText(app, 22, 11);
  g.font = '10px Segoe UI, sans-serif'; g.fillText('File   Edit   View   Window   Help', 30 + app.length * 6.5, 11);
  g.beginPath(); g.arc(11, 7.5, 3.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.roundRect(w / 2 - 80, h - 32, 160, 26, 8); g.fill();
  ['#0a66c2', '#f4f6fa', '#1bb83a', '#f9233f', '#fff3a3'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.roundRect(w / 2 - 70 + i * 29, h - 28, 22, 18, 5); g.fill(); });
  g.fillStyle = fill; g.beginPath(); g.roundRect(12, 24, w - 24, h - 66, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.roundRect(12, 24, w - 24, 20, [7, 7, 0, 0]); g.fill();
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(25 + i * 13, 34, 4, 0, Math.PI * 2); g.fill(); });
  g.fillStyle = '#a0a0a0'; g.font = '11px Segoe UI, sans-serif'; g.textAlign = 'center'; g.fillText(title, w / 2, 38); g.textAlign = 'left';
}

function drawScreens() {
  const { ticket, code, lastRun } = ide.view();

  // main display (landscape): the editor
  let g = codeScreen.image.getContext('2d');
  macWindow(g, 'Code', `solution.py — ${ticket.id}`, '#1e1e1e');
  g.fillStyle = '#007acc'; g.fillRect(12, 306, 616, 12);
  g.font = '14px Consolas, monospace';
  code.trimEnd().split('\n').slice(0, 14).forEach((line, i) => {
    g.fillStyle = '#858585'; g.fillText(String(i + 1).padStart(2), 22, 64 + i * 17);
    g.fillStyle = line.trimStart().startsWith('#') ? '#6a9955' : /^\s*(def|class)\b/.test(line) ? '#dcdcaa' : '#d4d4d4';
    g.fillText(line.slice(0, 66), 52, 64 + i * 17);
  });
  codeScreen.needsUpdate = true;

  // second display (portrait): a tall terminal
  g = termScreen.image.getContext('2d');
  macWindow(g, 'Terminal', 'cozy-app — zsh', '#151517');
  g.font = '12px Consolas, monospace';
  const rows = [['#cccccc', `% git switch ${ticket.id.toLowerCase()}`], ['#7f7f7f', `Switched to branch '${ticket.id.toLowerCase()}'`], ['', ''],
    ['#cccccc', '% python -m pytest -q']];
  if (!lastRun) rows.push(['#7f7f7f', 'waiting for a test run ...']);
  else if (lastRun.error) rows.push(['#f14c4c', 'error while loading solution.py']);
  else rows.push([lastRun.ok ? '#23d18b' : '#f14c4c', `${lastRun.passed} passed, ${lastRun.total - lastRun.passed} failed`]);
  rows.push(['', ''], ['#cccccc', '% git log --oneline']);
  for (let i = S.ticket - 1; i >= Math.max(0, S.ticket - 12); i--) {
    const done = tickets[i % tickets.length];
    rows.push(['#3b8eea', `${(0x9e3779b1 * (i + 7) >>> 8).toString(16).slice(0, 7)} ${done.id} ${done.title}`.slice(0, 46)]);
  }
  if (S.ticket === 0) rows.push(['#7f7f7f', '(no commits yet)']);
  rows.push(['', ''], ['#cccccc', `% uptime`], ['#7f7f7f', `day ${S.day}, ${S.commits} commit${S.commits === 1 ? '' : 's'} shipped`], ['', ''], ['#cccccc', '% _']);
  rows.slice(0, 28).forEach(([color, text], i) => { g.fillStyle = color || '#cccccc'; g.fillText(text, 22, 64 + i * 18); });
  termScreen.needsUpdate = true;
}

// ───────────────────────── things you can use ─────────────────────────
interactive(bed, 'bed', () => (S.hour >= 9 && S.hour < 18 ? 'Take a nap' : 'Go to bed'), sleep);
interactive(glass, 'window', 'Gaze out the window', () => setMode('window'));
interactive(bench, 'window', 'Gaze out the window', () => setMode('window'));
interactive(desk, 'pc', 'Sit down and code', () => sitAt(DESK_X, -2.55, false));
interactive(chair, 'pc', 'Sit down and code', () => sitAt(DESK_X, -2.55, false));
interactive(lamp, 'lamp', () => (S.lampOn ? 'Turn lamp off' : 'Turn lamp on'), () => { S.lampOn = !S.lampOn; });
interactive(radio, 'radio', () => (S.radioOn ? 'Turn radio off' : 'Play lo-fi radio'), toggleRadio);
interactive(barista.group, 'coffee', () => (S.cup ? 'Finish your cup first (Q to sip)' : 'Brew a coffee'), () => {
  if (S.cup) return toast('You already have a cup in hand — press Q to sip.');
  setMode('barista');
  barista.open(S.coffee >= 3);
});
interactive(cat, 'cat', 'Pet the cat', () => {
  S.cozy = clamp(S.cozy + 10, 0, 100);
  catAI.purr = 2.5;
  catAI.state = 'sit';
  catAI.timer = 5;
  toast('♥ purrrr… (+10 coziness)');
});
interactive(plant, 'plant', 'Water the plant', () => { S.cozy = clamp(S.cozy + 3, 0, 100); toast('The plant looks pleased.'); });

// ───────────────────────── input ─────────────────────────
addEventListener('keydown', (e) => {
  if (mode === 'pc') {
    if (e.code === 'Escape') leave();
    else if (e.code === 'Enter' && e.ctrlKey) { e.preventDefault(); ide.runTests(); }
    return;
  }
  if (mode === 'barista') {
    if (e.code === 'Escape') leave();
    return;
  }
  if (e.code === 'KeyQ') sip();
  if (mode === 'window') {
    if (e.code === 'Escape' || e.code === 'KeyE') leave();
    return;
  }
  keys.add(e.code);
  if (e.code === 'KeyE' && focusKey) interactions[focusKey].action();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('click', () => {
  initAudio();
  if (mode === 'walk' && !document.pointerLockElement) canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', refreshHint);
addEventListener('mousemove', (e) => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = (e.clientY / innerHeight) * 2 - 1;
  if (mode === 'walk' && document.pointerLockElement) {
    player.yaw -= e.movementX * 0.0022;
    player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.4, 1.4);
  }
});
$('macLeave').addEventListener('click', leave);
$('mac').addEventListener('mousedown', initAudio);

// ───────────────────────── HUD ─────────────────────────
function updateHUD() {
  const h = Math.floor(S.hour), m = Math.floor((S.hour % 1) * 60);
  const time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  $('clock').textContent = `Day ${S.day} · ${time}`;
  desktop.setClock(`Day ${S.day}  ${time}`);
  $('weather').textContent = S.raining ? 'Rainy — perfect coding weather' : day < 0.3 ? 'Clear night' : day < 0.9 ? 'Golden hour' : 'Clear skies';
  $('energyFill').style.width = `${S.energy}%`;
  $('energyNum').textContent = Math.round(S.energy);
  $('cozyFill').style.width = `${S.cozy}%`;
  $('cozyNum').textContent = Math.round(S.cozy);
  const lvl = levelOf(S.xp), lo = lvl * lvl * 100, hi = (lvl + 1) * (lvl + 1) * 100;
  $('rank').textContent = rankOf(S.xp);
  $('xpNum').textContent = `${S.xp} / ${hi} XP`;
  $('xpFill').style.width = `${((S.xp - lo) / (hi - lo)) * 100}%`;
  $('commits').textContent = `${S.commits} commit${S.commits === 1 ? '' : 's'} shipped`;
  $('cupInfo').textContent = S.cup ? `☕ ${S.cup.name} ${'★'.repeat(S.cup.stars)} · ${S.cup.sips} sip${S.cup.sips === 1 ? '' : 's'} left (Q)` : '';

  const prompt = $('prompt');
  if (focusKey) {
    const label = interactions[focusKey].label;
    prompt.replaceChildren(Object.assign(document.createElement('kbd'), { textContent: 'E' }), typeof label === 'function' ? label() : label);
  }
  prompt.classList.toggle('on', !!focusKey);
}

// ───────────────────────── loop ─────────────────────────
let lastFrame = performance.now(), elapsed = 0;
let hudTimer = 0, focusTimer = 0;

// Trade resolution for frame rate, but rarely, because every change is visible as a brief shimmer:
// step down only after three slow seconds in a row (a one-off hitch such as Python loading is ignored),
// step back up only after fifteen smooth ones, and never climb back to a setting that already proved too heavy.
const perf = { frames: 0, time: 0, slow: 0, steady: 0, raised: false, ceiling: QUALITY_MAX };
function tunePerformance(frameSeconds) {
  if (frameSeconds > 0.5) { perf.frames = perf.time = 0; return; } // the window was hidden or stalled
  perf.frames++;
  perf.time += frameSeconds;
  if (perf.time < 1) return;
  const fps = perf.frames / perf.time;
  perf.frames = perf.time = 0;
  if (fps < 50) {
    perf.steady = 0;
    if (++perf.slow >= 3 && quality > QUALITY_MIN) {
      if (perf.raised) perf.ceiling = quality * 0.99;
      quality = Math.max(QUALITY_MIN, quality * 0.85);
      perf.slow = 0;
      applyQuality();
    }
    return;
  }
  perf.slow = 0;
  if (fps >= 58 && ++perf.steady >= 15 && quality * 1.08 <= perf.ceiling) {
    quality *= 1.08;
    perf.raised = true;
    perf.steady = 0;
    applyQuality();
  }
}

function tick() {
  const now = performance.now();
  tunePerformance((now - lastFrame) / 1000);
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  elapsed += dt;
  const t = elapsed;

  // one real second = one game minute
  if (!sleeping) {
    S.hour += dt / 60;
    if (S.hour >= 24) { S.hour -= 24; newDay(); }
    S.energy = clamp(S.energy - dt * 0.1, 0, 100);
    const gain = mode === 'window' ? 2 : -0.04 + (S.radioOn ? 0.03 : 0) + (S.raining ? 0.02 : 0) + (building.inLounge(player.pos) ? 0.3 : 0);
    S.cozy = clamp(S.cozy + dt * gain, 0, 100);
  }

  updateSky();
  updatePlayer(dt);
  updateCat(dt, t);
  updateMetro(dt, t);
  updateCoffee(dt, t);
  building.update(dt, t, { player: player.pos, hour: S.hour, camera, hideBubbles: mode !== 'walk' });
  focusTimer -= dt;
  if (focusTimer <= 0) { focusKey = findFocus(); focusTimer = 0.08; }

  // little bits of life
  radioLed.material.emissiveIntensity = S.radioOn ? 2 : 0;
  for (const c of clouds) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 230) c.position.x = -230;
  }
  if (S.raining) {
    for (let i = 0; i < N_RAIN; i++) {
      let y = rainPos[i * 6 + 1] - dt * 17;
      if (y < -12) y += 28;
      rainPos[i * 6 + 1] = y;
      rainPos[i * 6 + 4] = y - 0.4;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  updateAudio();

  hudTimer -= dt;
  if (hudTimer <= 0) { updateHUD(); hudTimer = 0.15; }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

drawScreens();
setMode('walk');
arrived = true;
tick();

// hooks used by the smoke test in main.js
window.__cozy = {
  S, ide, barista, desktop, leave, catGo,
  quality: () => quality,
  goto(x, z) { player.pos.x = x; player.pos.z = z; },
  openDoor(open = true) { building.door.open = building.loungeDoor.open = open; },
  probe: (points) => points.map(([x, z]) => (blocked(x, z) ? 'X' : 'ok')).join(' '),
  gaze(x, y) { mouse.x = x; mouse.y = y; },
  trainAt(x) { trainState.x = x; trainState.wait = 0; },
  look(yaw, pitch) { player.yaw = yaw; player.pitch = pitch; },
  use(key) { interactions[key].action(); },
  setHour(h) { S.hour = h; },
  // jump the espresso bar to a given moment, for screenshots
  stage(patch, locs = {}) {
    Object.assign(barista.state, patch);
    for (const [name, loc] of Object.entries(locs)) barista.items[name].loc = loc;
  },
  // plays a whole espresso through real mouse events, to prove the drag-and-drop works
  async baristaTest() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const at = (x, y, z) => {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { clientX: ((v.x + 1) / 2) * innerWidth, clientY: ((1 - v.y) / 2) * innerHeight, button: 0, bubbles: true };
    };
    const fire = (type, where) => (type === 'mousedown' ? canvas : window).dispatchEvent(new MouseEvent(type, where));
    const grab = (name) => { const p = barista.items[name].group.position; fire('mousemove', at(p.x, p.y, p.z)); fire('mousedown', at(p.x, p.y, p.z)); };
    const carry = async (name, y, z, hold = 150) => { grab(name); await wait(60); fire('mousemove', at(3.5, y, z)); await wait(hold); fire('mouseup', {}); await wait(350); };
    const drag = (name, loc) => carry(name, barista.spots[name][loc][1], barista.spots[name][loc][2]);
    const press = async (x, y, z, hold) => { fire('mousemove', at(x, y, z)); fire('mousedown', at(x, y, z)); await wait(hold); fire('mouseup', {}); await wait(100); };
    const st = barista.state, log = [];
    await drag('pf', 'grinder'); log.push('pf@' + barista.items.pf.loc);
    await press(3.68, 1.12, 2.038, 3000); log.push('dose=' + st.dose.toFixed(1));
    await drag('pf', 'mat'); log.push('pf@' + barista.items.pf.loc);
    await carry('tamper', 1.05, 1.68, 1700); log.push('tamp=' + st.tamp.toFixed(1) + ' tamped=' + st.tamped);
    await drag('pf', 'group'); log.push('pf@' + barista.items.pf.loc);
    await drag('cup', 'tray'); log.push('cup@' + barista.items.cup.loc);
    await press(3.617, 1.285, 2.47, 80); log.push('brewing=' + st.brewing);
    await wait(5300);
    await press(3.617, 1.285, 2.47, 80); log.push('shot=' + st.shot.toFixed(1));
    grab('cup'); await wait(60);
    fire('mousemove', { clientX: innerWidth / 2, clientY: innerHeight * 0.93 }); await wait(150);
    fire('mouseup', {}); await wait(100);
    log.push('served=' + JSON.stringify(S.cup));
    console.log('[barista-test] ' + log.join(' | '));
  },
  giveCup() { leave(); S.cup = { name: 'Latte', stars: 4, sips: 4, energy: 8, cozy: 6, milk: true }; },
  // wipe the save and start from a fresh morning without writing anything back
  sandbox() {
    saveEnabled = false;
    localStorage.removeItem(SAVE_KEY);
    Object.assign(S, FRESH());
  },
};
