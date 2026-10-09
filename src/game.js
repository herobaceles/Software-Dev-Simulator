import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ranks } from './tickets.js';
import { createIDE } from './ide.js';
import { createDesktop } from './desktop.js';
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
const camera = new THREE.PerspectiveCamera(68, 1, 0.05, 500);
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
const METAL = { metalness: 0.25, roughness: 0.35 };

// ───────────────────────── the room ─────────────────────────
const W = 4, D = 3, H = 3; // half-width, half-depth, height
const WIN = { x0: -2.1, x1: 0.9, y0: 0.9, y1: 2.5 };
const wallColor = '#e9d3b8';

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
slab(W * 2 + 0.4, 0.2, D * 2 + 0.4, '#f3e6d2', 0, H + 0.1, 0);
slab(0.2, H, D * 2, wallColor, -W - 0.1, H / 2, 0);
slab(0.2, H, D * 2, wallColor, W + 0.1, H / 2, 0);
slab(W * 2 + 0.4, H, 0.2, wallColor, 0, H / 2, D + 0.1);
// back wall with window opening
slab(WIN.x0 + W, H, 0.2, wallColor, (-W + WIN.x0) / 2, H / 2, -D - 0.1);
slab(W - WIN.x1, H, 0.2, wallColor, (W + WIN.x1) / 2, H / 2, -D - 0.1);
slab(WIN.x1 - WIN.x0, WIN.y0, 0.2, wallColor, (WIN.x0 + WIN.x1) / 2, WIN.y0 / 2, -D - 0.1);
slab(WIN.x1 - WIN.x0, H - WIN.y1, 0.2, wallColor, (WIN.x0 + WIN.x1) / 2, (H + WIN.y1) / 2, -D - 0.1);
// baseboards
for (const [w, d, x, z] of [[W * 2, 0.04, 0, D - 0.02], [W * 2, 0.04, 0, -D + 0.02], [0.04, D * 2, -W + 0.02, 0], [0.04, D * 2, W - 0.02, 0]]) {
  box(w, 0.12, d, '#6b4630', x, 0.06, z);
}

// window frame, glass, curtains, bench
const winCx = (WIN.x0 + WIN.x1) / 2, winCy = (WIN.y0 + WIN.y1) / 2;
const winW = WIN.x1 - WIN.x0, winH = WIN.y1 - WIN.y0;
const frameColor = '#5a3a28';
box(winW + 0.16, 0.08, 0.3, frameColor, winCx, WIN.y0, -D - 0.05);
box(winW + 0.16, 0.08, 0.26, frameColor, winCx, WIN.y1, -D - 0.07);
box(0.08, winH, 0.26, frameColor, WIN.x0, winCy, -D - 0.07);
box(0.08, winH, 0.26, frameColor, WIN.x1, winCy, -D - 0.07);
box(0.05, winH, 0.06, frameColor, winCx, winCy, -D - 0.1);
box(winW, 0.05, 0.06, frameColor, winCx, winCy + 0.25, -D - 0.1);
const glass = new THREE.Mesh(
  new THREE.PlaneGeometry(winW, winH),
  new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.07, roughness: 0.05, depthWrite: false }),
);
glass.position.set(winCx, winCy, -D - 0.1);
room.add(glass);
box(0.45, winH + 0.5, 0.08, '#f6e7d0', WIN.x0 - 0.2, winCy + 0.05, -D + 0.07);
box(0.45, winH + 0.5, 0.08, '#f6e7d0', WIN.x1 + 0.2, winCy + 0.05, -D + 0.07);
box(winW + 1.1, 0.05, 0.05, frameColor, winCx, WIN.y1 + 0.32, -D + 0.07);
const bench = new THREE.Group();
room.add(bench);
box(winW - 0.2, 0.38, 0.5, '#7a5238', winCx, 0.19, -D + 0.27, bench);
box(winW - 0.3, 0.12, 0.46, '#d98f7a', winCx, 0.43, -D + 0.27, bench, { r: 0.055 });
box(0.4, 0.3, 0.14, '#f2c57c', WIN.x0 + 0.4, 0.62, -D + 0.12, bench, { r: 0.065 }).rotation.x = -0.25;
box(0.4, 0.3, 0.14, '#8fb8a8', WIN.x1 - 0.45, 0.62, -D + 0.12, bench, { r: 0.065 }).rotation.x = -0.25;
collide(WIN.x0, WIN.x1, -D, -D + 0.55);

// rug
const rug = add(new THREE.CircleGeometry(1.35, 40), mat('#c8705c'), 0, 0.012, 0.5);
rug.rotation.x = -Math.PI / 2;
const rugIn = add(new THREE.RingGeometry(0.85, 0.95, 40), mat('#f6e2c3'), 0, 0.016, 0.5);
rugIn.rotation.x = -Math.PI / 2;

// bed
const bed = new THREE.Group();
room.add(bed);
box(1.45, 0.3, 2.2, '#6b4630', -3.25, 0.15, 1.8, bed);
box(1.35, 0.22, 2.1, '#fbf3e6', -3.25, 0.4, 1.8, bed, { r: 0.08 });
box(1.44, 0.16, 1.4, '#7f9fc4', -3.25, 0.5, 1.42, bed, { r: 0.07 });
box(1.44, 0.08, 0.25, '#f6e7d0', -3.25, 0.55, 2.1, bed, { r: 0.035 });
box(0.8, 0.16, 0.42, '#ffffff', -3.25, 0.58, 2.55, bed, { r: 0.075 }).rotation.x = 0.12;
box(1.45, 0.95, 0.1, '#6b4630', -3.25, 0.475, 2.93, bed);
collide(-W, -2.52, 0.68, D);
// nightstand + clock
box(0.45, 0.5, 0.45, '#7a5238', -2.2, 0.25, 2.7);
box(0.2, 0.12, 0.08, '#2b2b33', -2.2, 0.56, 2.7, room, { emissive: '#ff7a59', emissiveIntensity: 0.4 });
collide(-2.45, -1.95, 2.45, D);

// desk with dual monitors
const DESK_X = 2.65;
const desk = new THREE.Group();
room.add(desk);
box(2.0, 0.06, 0.8, '#b98558', 2.5, 0.75, -2.55, desk);
for (const [x, z] of [[1.58, -2.87], [3.42, -2.87], [1.58, -2.23], [3.42, -2.23]]) box(0.07, 0.72, 0.07, '#5a3a28', x, 0.36, z, desk);

const ALU = '#d3d5d9', SATIN = { metalness: 0.3, roughness: 0.4 };
function monitor(x, turn) {
  const g = new THREE.Group();
  g.position.set(x, 0, -2.76);
  g.rotation.y = turn;
  desk.add(g);
  // aluminium display on an L-shaped stand
  box(0.22, 0.012, 0.17, ALU, 0, 0.787, 0.01, g, SATIN);
  box(0.13, 0.22, 0.014, ALU, 0, 0.89, -0.04, g, SATIN);
  box(0.84, 0.5, 0.026, ALU, 0, 1.2, -0.003, g, { ...SATIN, r: 0.012 });
  box(0.826, 0.486, 0.01, '#050506', 0, 1.2, 0.009, g, { r: 0.004 });
  const tex = canvasTexture(640, 360);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.45), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.set(0, 1.2, 0.0145);
  g.add(face);
  return tex;
}
const codeScreen = monitor(DESK_X - 0.43, 0.2);
const termScreen = monitor(DESK_X + 0.43, -0.2);
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
cyl(0.17, 0.13, 0.3, '#d98f7a', 1.2, 0.15, -2.65, plant);
for (const [x, y, z, s] of [[0, 0.55, 0, 0.26], [0.14, 0.75, 0.05, 0.2], [-0.13, 0.72, -0.04, 0.2], [0.02, 0.95, 0.02, 0.17]]) {
  add(new THREE.SphereGeometry(s, 20, 16), mat(y > 0.8 ? '#6aab78' : '#5d9c6b'), 1.2 + x, y, -2.65 + z, plant).scale.y = 0.9;
}
collide(1.0, 1.4, -2.85, -2.45);

// bookshelf
box(0.36, 2.0, 1.4, '#6b4630', 3.8, 1.0, 0.7);
const bookColors = ['#f28b82', '#f2c57c', '#8fb8a8', '#7f9fc4', '#c9a0dc', '#f6e7d0', '#d98f7a'];
for (let s = 0; s < 4; s++) {
  box(0.34, 0.04, 1.34, '#8a5a3c', 3.78, 0.25 + s * 0.48, 0.7);
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
poster.position.set(-W + 0.01, 1.75, -0.6);
poster.rotation.y = Math.PI / 2;
room.add(poster);

// string lights
const bulbs = [];
for (let i = 0; i < 17; i++) {
  const t = i / 16;
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffd28a' }));
  b.position.set(-3.8 + t * 7.6, 2.82 - Math.sin(t * Math.PI * 4) ** 2 * 0.12, -D + 0.05);
  room.add(b);
  bulbs.push(b);
}
const stringLight = new THREE.PointLight('#ffcf8f', 4, 8, 2);
stringLight.position.set(0, 2.6, -2.3);
room.add(stringLight);

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
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: '#4c6b55', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -22;
outside.add(ground);

// seeded random so the skyline is the same every launch
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

const N_BUILD = 150;
const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), N_BUILD);
const litPositions = [];
const m4 = new THREE.Matrix4(), col = new THREE.Color();
const palette = ['#a9b8cc', '#c9c2d6', '#d8b9a8', '#e2d2b8', '#9fb8b4'];
for (let i = 0; i < N_BUILD; i++) {
  const w = 5 + rnd() * 7, d = 5 + rnd() * 6, z = -60 - rnd() * 140;
  const h = 7 + rnd() * 20 + (rnd() < 0.12 ? 14 : 0);
  const x = (rnd() - 0.5) * (170 + -z * 1.3);
  m4.compose(new THREE.Vector3(x, -22 + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
  buildings.setMatrixAt(i, m4);
  buildings.setColorAt(i, col.set(palette[i % palette.length]));
  const cols = Math.floor(w / 1.6), rows = Math.floor(h / 2.4);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    if (rnd() < 0.42) litPositions.push([x - w / 2 + (c + 0.5) * (w / cols), -22 + 1.6 + r * 2.4, z + d / 2 + 0.06, rnd()]);
  }
}
outside.add(buildings);
const cityLights = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.75, 1.0),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, fog: false, depthWrite: false }),
  litPositions.length,
);
litPositions.forEach(([x, y, z, r], i) => {
  m4.makeTranslation(x, y, z);
  cityLights.setMatrixAt(i, m4);
  cityLights.setColorAt(i, col.set(r < 0.7 ? '#ffd58a' : r < 0.9 ? '#fff1d0' : '#9fd0ff'));
});
outside.add(cityLights);

// hills
for (let i = 0; i < 7; i++) {
  const r = 55 + rnd() * 45;
  const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), new THREE.MeshStandardMaterial({ color: '#4f7a5e', roughness: 1 }));
  hill.position.set(-260 + i * 85 + rnd() * 30, -40, -210 - rnd() * 30);
  hill.scale.y = 0.55 + rnd() * 0.25;
  outside.add(hill);
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
const hemi = new THREE.HemisphereLight('#ffffff', '#8a6a50', 1);
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
  cityLights.material.opacity = clamp(night * 1.2 + (S.raining ? 0.25 : 0), 0, 1);
  cloudMat.color.setScalar(0.18 + day * 0.82).lerp(skyColor, 0.25);
  cloudMat.opacity = S.raining ? 0.95 : 0.8;
  buildings.material.color.setScalar(0.3 + day * 0.7);
  fill.intensity = 0.1 + day * 0.8 * (S.raining ? 0.6 : 1);
  ground.material.color.set('#4c6b55').multiplyScalar(0.3 + day * 0.7);

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
  stringLight.intensity = 5 * evening;
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
const poseCam = new THREE.PerspectiveCamera();
const targetPos = new THREE.Vector3(), targetQuat = new THREE.Quaternion(), lookAt = new THREE.Vector3(), tmpV = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

function blocked(x, z, r = 0.28) {
  if (x < -W + r || x > W - r || z < -D + r || z > D - r) return true;
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
    if (mode === 'window') lookAt.add(tmpV.set(mouse.x * 26, -mouse.y * 12, 0));
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
  return lines[Math.floor(Math.random() * lines.length)] + '   (Esc to step back)';
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
    const reward = Math.round(t.xp * (1 + S.cozy / 200) * (S.energy <= 1 ? 0.5 : 1));
    S.xp += reward;
    S.commits++;
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

// macOS-style wallpaper, menu bar, dock and one window; returns the window's content origin
function macWindow(g, app, title, fill) {
  const wall = g.createLinearGradient(0, 0, 640, 360);
  wall.addColorStop(0, '#2b1f5c'); wall.addColorStop(0.4, '#7a3b8f'); wall.addColorStop(0.7, '#e0637a'); wall.addColorStop(1, '#f6a75c');
  g.fillStyle = wall; g.fillRect(0, 0, 640, 360);
  g.fillStyle = 'rgba(30,20,50,0.45)'; g.fillRect(0, 0, 640, 15);
  g.fillStyle = '#ffffff'; g.font = 'bold 10px Segoe UI, sans-serif'; g.fillText(app, 22, 11);
  g.font = '10px Segoe UI, sans-serif'; g.fillText('File   Edit   View   Window   Help', 60, 11);
  g.beginPath(); g.arc(11, 7.5, 3.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.roundRect(240, 328, 160, 26, 8); g.fill();
  ['#0a66c2', '#f4f6fa', '#1bb83a', '#f9233f', '#fff3a3'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.roundRect(250 + i * 29, 332, 22, 18, 5); g.fill(); });
  g.fillStyle = fill; g.beginPath(); g.roundRect(14, 24, 612, 294, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.roundRect(14, 24, 612, 20, [7, 7, 0, 0]); g.fill();
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(27 + i * 13, 34, 4, 0, Math.PI * 2); g.fill(); });
  g.fillStyle = '#a0a0a0'; g.font = '11px Segoe UI, sans-serif'; g.textAlign = 'center'; g.fillText(title, 320, 38); g.textAlign = 'left';
}

function drawScreens() {
  const { ticket, code, lastRun } = ide.view();
  const MONO = '14px Consolas, monospace';

  // left display: the editor
  let g = codeScreen.image.getContext('2d');
  macWindow(g, 'Code', `solution.py — ${ticket.id}`, '#1e1e1e');
  g.fillStyle = '#007acc'; g.fillRect(14, 306, 612, 12);
  g.font = MONO;
  code.trimEnd().split('\n').slice(0, 14).forEach((line, i) => {
    g.fillStyle = '#858585'; g.fillText(String(i + 1).padStart(2), 22, 64 + i * 17);
    g.fillStyle = line.trimStart().startsWith('#') ? '#6a9955' : /^\s*(def|class)\b/.test(line) ? '#dcdcaa' : '#d4d4d4';
    g.fillText(line.slice(0, 66), 52, 64 + i * 17);
  });
  codeScreen.needsUpdate = true;

  // right display: a terminal
  g = termScreen.image.getContext('2d');
  macWindow(g, 'Terminal', 'cozy-app — zsh', '#151517');
  g.font = MONO;
  const rows = [['#cccccc', `% git switch ${ticket.id.toLowerCase()}`], ['#cccccc', '% python -m pytest -q']];
  if (!lastRun) rows.push(['#7f7f7f', 'waiting for a test run ...']);
  else if (lastRun.error) rows.push(['#f14c4c', 'error while loading solution.py']);
  else rows.push([lastRun.ok ? '#23d18b' : '#f14c4c', `${lastRun.passed} passed, ${lastRun.total - lastRun.passed} failed`]);
  rows.push(['#cccccc', ''], ['#cccccc', '% git log --oneline | wc -l'], ['#3b8eea', String(S.commits)], ['#cccccc', '% _']);
  rows.forEach(([color, text], i) => { g.fillStyle = color; g.fillText(text, 26, 68 + i * 21); });
  termScreen.needsUpdate = true;
}

// ───────────────────────── things you can use ─────────────────────────
interactive(bed, 'bed', () => (S.hour >= 9 && S.hour < 18 ? 'Take a nap' : 'Go to bed'), sleep);
interactive(glass, 'window', 'Gaze out the window', () => setMode('window'));
interactive(bench, 'window', 'Gaze out the window', () => setMode('window'));
interactive(desk, 'pc', 'Sit down and code', () => setMode('pc'));
interactive(chair, 'pc', 'Sit down and code', () => setMode('pc'));
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

// Once a second, trade resolution for frame rate: drop quality quickly when frames run slow,
// and creep back up only after several steady seconds.
const perf = { frames: 0, time: 0, steady: 0 };
function tunePerformance(frameSeconds) {
  if (frameSeconds > 0.5) { perf.frames = perf.time = 0; return; } // the window was hidden or stalled
  perf.frames++;
  perf.time += frameSeconds;
  if (perf.time < 1) return;
  const fps = perf.frames / perf.time;
  perf.frames = perf.time = 0;
  if (fps < 52 && quality > QUALITY_MIN) {
    quality = Math.max(QUALITY_MIN, quality * 0.85);
    perf.steady = 0;
    applyQuality();
  } else if (fps >= 58 && ++perf.steady >= 6 && quality < QUALITY_MAX) {
    quality = Math.min(QUALITY_MAX, quality * 1.08);
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
    const gain = mode === 'window' ? 2 : -0.04 + (S.radioOn ? 0.03 : 0) + (S.raining ? 0.02 : 0);
    S.cozy = clamp(S.cozy + dt * gain, 0, 100);
  }

  updateSky();
  updatePlayer(dt);
  updateCat(dt, t);
  updateCoffee(dt, t);
  focusTimer -= dt;
  if (focusTimer <= 0) { focusKey = findFocus(); focusTimer = 0.08; }

  // little bits of life
  bulbs.forEach((b, i) => b.material.color.setHSL(0.1, 0.9, 0.62 + Math.sin(t * 1.5 + i) * 0.08));
  radioLed.material.emissiveIntensity = S.radioOn ? 2 : 0;
  monitorGlow.intensity = 1.6 + Math.sin(t * 3) * 0.15;
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
