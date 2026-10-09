// The rest of the building outside your unit: a front door, a corridor with an elevator and
// neighbours' doors, and a shared co-working lounge where two friends are coding.
//
// Floor plan (x to the right, z toward the bottom, city side at the top):
//
//   z=-3  ┌────────── condo ──────────┐   ┌──────── lounge ────────┐
//         │                           │   │  desk   desk   desk    │
//   z= 3  └──────[door]───────────────┘   │                        │
//         ══ elevator ══ corridor ════════╧  sofa                  │
//   z= 5  ──────────────────────────────────────────────────────────
//        x=-6        -1                4  5.4                    12.4

const HALL = { minX: -6, maxX: 5.4, minZ: 3.2, maxZ: 5.0 };
const LOUNGE = { minX: 5.4, maxX: 12.4, minZ: -3, maxZ: 5.0 };
const DOOR = { x0: -1.45, x1: -0.55, height: 2.1 };
const LDOOR = { z0: 3.65, z1: 4.55 }; // the lounge door, in the wall at the corridor's east end
const H = 3;
const DESK_Z = -2.45, SEAT_Z = -1.64;
export const CO_DESK = { x: 8.9, z: DESK_Z - 0.1 }; // the free seat between the two friends

const FRIENDS = [
  {
    key: 'maya', name: 'Maya', x: 6.9, shirt: '#d9a441', hair: '#2b1d16', skin: '#c68c5f', bun: true,
    idle: ['Standup is cancelled. Pure coding time!', 'I just named a variable thing2. Do not judge me.', 'Coffee run later? I am buying.', 'This sprint is weirdly calm. I do not trust it.'],
    chat: ['Pull up a chair, the middle desk is yours.', 'Slices stop *before* the end index. Gets me every time.', 'Take breaks. The bug will still be there, sadly.', 'Your last commit was clean. I approved it in ten seconds.'],
  },
  {
    key: 'devon', name: 'Devon', x: 10.9, shirt: '#4f8fbf', hair: '#101014', skin: '#8d5a3b', headphones: true,
    idle: ['Found a bug. It was mine.', 'Tests are green. Suspiciously green.', 'My rubber duck says hi.', 'Ship it. Then nap.'],
    chat: ['Run the tests before you trust your eyes.', 'dict.get(key, 0) is my whole personality.', 'If it works on the first try, be afraid.', 'Good to have you up here. Coding alone is overrated.'],
  },
];
const FAKE_CODE = ['def sync(queue):', '    for job in queue:', '        if job.ready():', '            job.run()', '    return len(queue)', '', 'class Cache:', '    def get(self, key):',
  '        return self.items.get(key)', '', 'def test_sync():', '    assert sync([]) == 0', '', '# TODO: tidy this up', 'def retry(task, tries=3):', '    for _ in range(tries):', '        try:',
  '            return task()', '        except Error:', '            pass'];

export function createBuilding({ THREE, room, kit, screenTexture, getTicket, onSit, onChat, toast }) {
  const { box, slab, cyl, mat, add, canvasTexture, collide, interactive } = kit;
  // for flat things mounted on a surface (signs, screens, rugs): nudges them forward in depth so they don't flicker
  const DECAL = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const WALL = '#1b1b1f', HALL_WALL = '#2a2a2f', LOUNGE_WALL = '#e6e3de', WALNUT = '#6e4a32', BLACK = '#0e0e10', CEILING = '#d9d7d3';

  function label(text, w, h, x, y, z, turn, { bg = '#0e0e10', fg = '#e8e6e2', size = 40, glow = false } = {}) {
    const tex = canvasTexture(256, Math.round((256 * h) / w), (g, cw, ch) => {
      g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
      g.fillStyle = fg; g.font = `600 ${size}px Segoe UI, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, cw / 2, ch / 2 + 2);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glow ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, ...DECAL }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 1, ...DECAL }));
    m.position.set(x, y, z);
    m.rotation.y = turn;
    room.add(m);
    return m;
  }
  // `lift` raises a rug or runner off the floor it lies on, so the two surfaces never fight for the same pixels
  function floor(x0, x1, z0, z1, color, lift = 0) {
    const m = add(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat(color, lift ? DECAL : {}), (x0 + x1) / 2, 0.001 + lift, (z0 + z1) / 2);
    m.rotation.x = -Math.PI / 2;
  }
  function downlight(x, z) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), new THREE.MeshBasicMaterial({ color: '#ffe9c4' }));
    m.position.set(x, H - 0.004, z);
    m.rotation.x = Math.PI / 2;
    room.add(m);
  }
  function plant(x, z, s = 1) {
    cyl(0.17 * s, 0.13 * s, 0.32 * s, '#e8e6e2', x, 0.16 * s, z);
    for (const [dx, dy, dz, r] of [[0, 0.6, 0, 0.27], [0.14, 0.82, 0.05, 0.2], [-0.13, 0.8, -0.04, 0.2], [0.02, 1.02, 0.02, 0.17]]) {
      add(new THREE.SphereGeometry(r * s, 18, 14), mat(dy > 0.8 ? '#6aab78' : '#5d9c6b'), x + dx * s, dy * s, z + dz * s);
    }
    collide(x - 0.2 * s, x + 0.2 * s, z - 0.2 * s, z + 0.2 * s);
  }

  // ── the condo's front wall, now with a doorway ──
  slab(DOOR.x0 + 4.2, H, 0.2, WALL, (DOOR.x0 - 4.2) / 2, H / 2, 3.1);
  slab(4.2 - DOOR.x1, H, 0.2, WALL, (DOOR.x1 + 4.2) / 2, H / 2, 3.1);
  slab(DOOR.x1 - DOOR.x0, H - DOOR.height, 0.2, WALL, (DOOR.x0 + DOOR.x1) / 2, (H + DOOR.height) / 2, 3.1);
  const doorPivot = new THREE.Group();
  doorPivot.position.set(DOOR.x0, 0, 3.1);
  room.add(doorPivot);
  box(DOOR.x1 - DOOR.x0, DOOR.height, 0.05, WALNUT, (DOOR.x1 - DOOR.x0) / 2, DOOR.height / 2, 0, doorPivot, { r: 0.01 });
  for (const side of [-0.05, 0.05]) cyl(0.018, 0.018, 0.12, '#c9ccd1', DOOR.x1 - DOOR.x0 - 0.1, 1.0, side, doorPivot).rotation.z = Math.PI / 2;
  const door = { open: false, swing: 0 };
  interactive(doorPivot, 'door', () => (door.open ? 'Close the door' : 'Open the door'), () => { door.open = !door.open; });
  label('12A', 0.22, 0.11, DOOR.x1 + 0.3, 1.6, 3.205, 0, { size: 64 });

  // ── corridor ──
  floor(HALL.minX, HALL.maxX, HALL.minZ, HALL.maxZ, '#4a4d57');
  floor(-5.6, 5.0, 3.75, 4.45, '#6f6258', 0.006); // carpet runner
  slab(2.0, H, 0.2, HALL_WALL, -5.2, H / 2, 3.1);
  slab(1.1, H, 0.2, HALL_WALL, 4.75, H / 2, 3.1);
  slab(18.8, H, 0.2, HALL_WALL, 3.2, H / 2, 5.1);
  slab(0.2, H, 2.2, HALL_WALL, -6.1, H / 2, 4.1);
  slab(HALL.maxX - HALL.minX + 0.2, 0.2, HALL.maxZ - HALL.minZ + 0.2, CEILING, (HALL.minX + HALL.maxX) / 2, H + 0.1, 4.1);
  for (const x of [-4, -1, 2, 4.6]) downlight(x, 4.1);
  // the neighbours
  [['12B', -4.2], ['12C', 0.6], ['12D', 3.6]].forEach(([unit, x]) => {
    box(0.9, DOOR.height, 0.05, WALNUT, x, DOOR.height / 2, 4.985, room, { r: 0.01 });
    cyl(0.018, 0.018, 0.12, '#c9ccd1', x + 0.35, 1.0, 4.94).rotation.z = Math.PI / 2;
    label(unit, 0.22, 0.11, x + 0.75, 1.6, 4.995, Math.PI, { size: 64 });
  });
  // elevator at the west end
  const lift = new THREE.Group();
  room.add(lift);
  box(0.06, 2.3, 1.3, '#3a3a40', -5.97, 1.15, 4.1, lift, { r: 0.01 });
  for (const z of [3.8, 4.4]) box(0.03, 2.1, 0.56, '#aeb1b7', -5.94, 1.05, z, lift, { metalness: 0.3, roughness: 0.35, r: 0.005 });
  const liftButton = cyl(0.03, 0.03, 0.02, '#f2c57c', -5.95, 1.1, 3.38, lift, { emissive: '#f2c57c', emissiveIntensity: 0.4 });
  liftButton.rotation.z = Math.PI / 2;
  label('12', 0.24, 0.12, -5.93, 2.4, 4.1, Math.PI / 2, { fg: '#ff9f43', size: 60, glow: true });
  interactive(lift, 'lift', 'Call the elevator', () => toast('The elevator hums somewhere far below. Maybe later.'));
  label('CO-WORK LOUNGE  ›', 1.1, 0.2, 4.6, 1.9, 3.205, 0, { bg: '#2a2a2f', size: 26 });
  plant(-5.5, 3.55);
  const hallLight = new THREE.PointLight('#ffdcae', 9, 9, 2);
  hallLight.position.set(-0.5, 2.6, 4.1);
  room.add(hallLight);

  // ── lounge shell: bright walls, timber floor, and its own wall of glass onto the city ──
  floor(LOUNGE.minX, LOUNGE.maxX, LOUNGE.minZ, LOUNGE.maxZ, '#b9a58c');
  slab(0.2, H, 6.4, LOUNGE_WALL, 5.4, H / 2, 0);
  slab(0.2, H, 8.4, LOUNGE_WALL, 12.5, H / 2, 1);
  slab(7.2, 0.2, 8.4, CEILING, 8.9, H + 0.1, 1);
  slab(7.2, 0.35, 0.2, LOUNGE_WALL, 8.9, 0.175, -3.1);
  slab(7.2, 0.28, 0.2, LOUNGE_WALL, 8.9, H - 0.14, -3.1);
  for (let i = 0; i <= 4; i++) box(0.06, 2.37, 0.1, BLACK, 5.55 + i * 1.675, 1.535, -3.1);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 2.37), new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.07, roughness: 0.05, depthWrite: false }));
  glass.position.set(8.9, 1.535, -3.1);
  room.add(glass);
  for (const [x, z] of [[7, -0.5], [10.8, -0.5], [7, 2.8], [10.8, 2.8]]) downlight(x, z);
  // the wall between corridor and lounge, with a glass door
  slab(0.2, H, LDOOR.z0 - HALL.minZ, LOUNGE_WALL, 5.4, H / 2, (HALL.minZ + LDOOR.z0) / 2);
  slab(0.2, H, HALL.maxZ - LDOOR.z1, LOUNGE_WALL, 5.4, H / 2, (LDOOR.z1 + HALL.maxZ) / 2);
  slab(0.2, H - DOOR.height, LDOOR.z1 - LDOOR.z0, LOUNGE_WALL, 5.4, (H + DOOR.height) / 2, (LDOOR.z0 + LDOOR.z1) / 2);
  const loungePivot = new THREE.Group();
  loungePivot.position.set(5.4, 0, LDOOR.z0);
  room.add(loungePivot);
  {
    const width = LDOOR.z1 - LDOOR.z0;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.1, DOOR.height - 0.1), new THREE.MeshStandardMaterial({ color: '#bfe0f5', transparent: true, opacity: 0.22, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    pane.position.set(0, DOOR.height / 2, width / 2);
    pane.rotation.y = Math.PI / 2;
    loungePivot.add(pane);
    for (const z of [0.025, width - 0.025]) box(0.045, DOOR.height, 0.05, BLACK, 0, DOOR.height / 2, z, loungePivot, { r: 0.01 });
    for (const y of [0.025, DOOR.height - 0.025]) box(0.045, 0.05, width, BLACK, 0, y, width / 2, loungePivot, { r: 0.01 });
    for (const side of [-0.05, 0.05]) cyl(0.014, 0.014, 0.5, '#c9ccd1', side, 1.1, width - 0.12, loungePivot);
  }
  const loungeDoor = { open: false, swing: 0 };
  interactive(loungePivot, 'loungeDoor', () => (loungeDoor.open ? 'Close the lounge door' : 'Open the lounge door'), () => { loungeDoor.open = !loungeDoor.open; });
  const loungeLight = new THREE.PointLight('#fff1dc', 14, 12, 2);
  loungeLight.position.set(8.9, 2.6, 0.6);
  room.add(loungeLight);

  // ── the shared workstation: three desks facing the glass ──
  const coDesk = new THREE.Group();
  room.add(coDesk);
  function desk(x, parent, screen) {
    box(1.6, 0.06, 0.75, WALNUT, x, 0.75, DESK_Z, parent);
    for (const [dx, dz] of [[-0.72, -0.3], [0.72, -0.3], [-0.72, 0.3], [0.72, 0.3]]) box(0.06, 0.72, 0.06, BLACK, x + dx, 0.36, DESK_Z + dz, parent);
    box(0.22, 0.012, 0.17, '#d3d5d9', x, 0.787, DESK_Z - 0.2, parent);
    box(0.1, 0.2, 0.014, '#d3d5d9', x, 0.88, DESK_Z - 0.24, parent);
    box(0.8, 0.48, 0.026, '#d3d5d9', x, 1.18, DESK_Z - 0.2, parent, { r: 0.012 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.43), new THREE.MeshBasicMaterial({ map: screen, toneMapped: false, ...DECAL }));
    face.position.set(x, 1.18, DESK_Z - 0.185);
    parent.add(face);
    box(0.42, 0.014, 0.13, '#e9eaec', x, 0.794, DESK_Z + 0.16, parent, { r: 0.006 });
    return face;
  }
  desk(CO_DESK.x, coDesk, screenTexture);
  box(0.46, 0.07, 0.46, '#2a2a2f', CO_DESK.x, 0.46, SEAT_Z, coDesk, { r: 0.03 });
  box(0.44, 0.5, 0.06, '#2a2a2f', CO_DESK.x, 0.78, SEAT_Z + 0.24, coDesk, { r: 0.025 });
  cyl(0.03, 0.03, 0.42, '#55555f', CO_DESK.x, 0.22, SEAT_Z, coDesk);
  cyl(0.26, 0.26, 0.03, '#101014', CO_DESK.x, 0.02, SEAT_Z, coDesk);
  interactive(coDesk, 'codesk', 'Sit and code with your friends', () => onSit(CO_DESK));
  collide(6.05, 11.75, -3, DESK_Z + 0.4);
  collide(CO_DESK.x - 0.28, CO_DESK.x + 0.28, SEAT_Z - 0.26, SEAT_Z + 0.3);

  // ── friends ──
  const friends = FRIENDS.map((spec, index) => {
    const screen = canvasTexture(320, 180);
    const deskGroup = new THREE.Group();
    room.add(deskGroup);
    const face = desk(spec.x, deskGroup, screen);
    cyl(0.04, 0.035, 0.09, index ? '#e8e6e2' : '#f28b82', spec.x + 0.6, 0.825, DESK_Z + 0.1, deskGroup);

    const body = new THREE.Group();
    body.position.set(spec.x, 0, SEAT_Z);
    room.add(body);
    const cloth = mat(spec.shirt), skin = mat(spec.skin), dark = mat('#2a2a2f'), hair = mat(spec.hair);
    box(0.46, 0.07, 0.46, '#2a2a2f', 0, 0.46, 0, body, { r: 0.03 });
    box(0.44, 0.5, 0.06, '#2a2a2f', 0, 0.78, 0.24, body, { r: 0.025 });
    cyl(0.03, 0.03, 0.42, '#55555f', 0, 0.22, 0, body);
    cyl(0.26, 0.26, 0.03, '#101014', 0, 0.02, 0, body);
    for (const side of [-0.1, 0.1]) {
      add(new THREE.CapsuleGeometry(0.065, 0.3, 6, 12), dark, side, 0.56, -0.16, body).rotation.x = Math.PI / 2;
      add(new THREE.CapsuleGeometry(0.055, 0.32, 6, 12), dark, side, 0.3, -0.36, body);
      box(0.1, 0.07, 0.2, '#e8e6e2', side, 0.04, -0.41, body, { r: 0.03 });
    }
    const torso = add(new THREE.CapsuleGeometry(0.16, 0.3, 8, 16), cloth, 0, 0.87, 0, body);
    torso.rotation.x = -0.1;
    const arms = [-1, 1].map((side) => {
      const arm = new THREE.Group();
      arm.position.set(side * 0.2, 1.03, -0.04);
      arm.rotation.set(1.05, 0, side * -0.12);
      body.add(arm);
      add(new THREE.CapsuleGeometry(0.048, 0.36, 6, 12), cloth, 0, -0.2, 0, arm);
      add(new THREE.SphereGeometry(0.05, 12, 10), skin, 0, -0.42, 0, arm);
      return arm;
    });
    const head = new THREE.Group();
    head.position.set(0, 1.22, -0.05);
    body.add(head);
    add(new THREE.SphereGeometry(0.115, 20, 16), skin, 0, 0, 0, head);
    add(new THREE.SphereGeometry(0.122, 20, 16), hair, 0, 0.022, 0.028, head).scale.set(1, 0.95, 1);
    if (spec.bun) add(new THREE.SphereGeometry(0.06, 14, 12), hair, 0, 0.11, 0.1, head);
    if (spec.headphones) {
      add(new THREE.TorusGeometry(0.125, 0.014, 8, 24, Math.PI), dark, 0, 0.02, 0, head);
      for (const side of [-0.125, 0.125]) add(new THREE.SphereGeometry(0.04, 12, 10), dark, side, 0, 0, head).scale.x = 0.6;
    }
    collide(spec.x - 0.28, spec.x + 0.28, SEAT_Z - 0.3, SEAT_Z + 0.3);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    document.body.appendChild(bubble);
    const friend = { spec, body, head, arms, face, screen, bubble, speakFor: 0, scroll: index * 7, here: true };
    interactive(body, spec.key, () => (friend.here ? `Chat with ${spec.name}` : `${spec.name}'s desk`), () => {
      if (!friend.here) return toast(`${spec.name} has gone home for the day. Back at 8.`);
      const ticket = getTicket();
      const lines = [...spec.chat, `Still on ${ticket.id}? You have got this.`];
      say(friend, lines[Math.floor(Math.random() * lines.length)]);
      onChat(spec.name);
    });
    return friend;
  });

  function say(friend, text) {
    friend.bubble.replaceChildren(Object.assign(document.createElement('b'), { textContent: friend.spec.name }), text);
    friend.speakFor = 4.5;
  }
  function drawFriendScreen(friend) {
    const g = friend.screen.image.getContext('2d');
    g.fillStyle = '#1e1e1e'; g.fillRect(0, 0, 320, 180);
    g.fillStyle = '#323233'; g.fillRect(0, 0, 320, 14);
    g.font = '11px Consolas, monospace';
    for (let i = 0; i < 11; i++) {
      const line = FAKE_CODE[(friend.scroll + i) % FAKE_CODE.length];
      g.fillStyle = line.trimStart().startsWith('#') ? '#6a9955' : /^(def|class)/.test(line) ? '#dcdcaa' : '#d4d4d4';
      g.fillText(line, 10, 30 + i * 14);
    }
    friend.screen.needsUpdate = true;
  }
  friends.forEach(drawFriendScreen);

  // ── the rest of the lounge ──
  const couch = new THREE.Group();
  room.add(couch);
  box(2.2, 0.3, 0.85, '#7d8a6a', 10.4, 0.3, 4.45, couch, { r: 0.09 });
  box(2.2, 0.55, 0.22, '#7d8a6a', 10.4, 0.64, 4.82, couch, { r: 0.09 });
  for (const x of [9.26, 11.54]) box(0.2, 0.42, 0.85, '#6c7a5a', x, 0.48, 4.45, couch, { r: 0.08 });
  box(0.46, 0.34, 0.14, '#f2c57c', 9.85, 0.66, 4.62, couch, { r: 0.065 }).rotation.x = 0.25;
  collide(9.15, 11.65, 4.0, LOUNGE.maxZ);
  cyl(0.45, 0.45, 0.05, WALNUT, 10.4, 0.4, 3.3);
  cyl(0.04, 0.04, 0.38, BLACK, 10.4, 0.19, 3.3);
  collide(10.0, 10.8, 2.9, 3.7);
  const rug = add(new THREE.CircleGeometry(1.5, 40), mat('#d8cdbd', DECAL), 10.4, 0.008, 3.5);
  rug.rotation.x = -Math.PI / 2;
  plant(12.0, -2.5, 1.2);
  plant(5.85, 2.75, 1.1);
  // pendant lamps over the desks
  for (const x of [6.9, 8.9, 10.9]) {
    cyl(0.004, 0.004, 0.75, BLACK, x, H - 0.375, -2.2);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 14), new THREE.MeshBasicMaterial({ color: '#ffe2b0' }));
    bulb.position.set(x, H - 0.8, -2.2);
    room.add(bulb);
  }
  // whiteboard with the sprint on it
  const board = canvasTexture(512, 300, (g, w, h) => {
    g.fillStyle = '#fafafa'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9c9cc'; g.lineWidth = 2;
    g.font = 'bold 20px Segoe UI, sans-serif';
    ['TO DO', 'DOING', 'DONE'].forEach((title, i) => {
      g.fillStyle = '#333'; g.fillText(title, 24 + i * 168, 34);
      if (i) { g.beginPath(); g.moveTo(i * 168 + 8, 14); g.lineTo(i * 168 + 8, h - 14); g.stroke(); }
    });
    const notes = [[0, 0, '#ffe08a'], [0, 1, '#ffb3a7'], [0, 2, '#a7d8ff'], [1, 0, '#b9f0c2'], [2, 0, '#ffe08a'], [2, 1, '#a7d8ff'], [2, 2, '#b9f0c2'], [2, 3, '#ffb3a7']];
    notes.forEach(([c, r, color]) => { g.fillStyle = color; g.fillRect(24 + c * 168 + (r % 2) * 70, 52 + Math.floor(r / 2) * 76 + (r % 2) * 8, 62, 62); });
    g.fillStyle = '#d64545'; g.font = 'italic 22px Segoe UI, sans-serif'; g.fillText('ship it friday!', 190, h - 22);
  });
  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.29), new THREE.MeshStandardMaterial({ map: board, roughness: 1, ...DECAL }));
  boardMesh.position.set(12.382, 1.6, 1.2);
  boardMesh.rotation.y = -Math.PI / 2;
  room.add(boardMesh);
  box(0.02, 1.37, 2.28, '#c9ccd1', 12.4, 1.6, 1.2, room, { r: 0.008 });
  label('stay cozy, ship often', 2.0, 0.34, 5.505, 2.0, 0.2, Math.PI / 2, { bg: '#e6e3de', fg: '#e2674a', size: 24 });

  // ── walking ──
  const zones = [
    { minX: -4, maxX: 4, minZ: -3, maxZ: 3 },
    { minX: DOOR.x0, maxX: DOOR.x1, minZ: 2.4, maxZ: 3.9, pad: 0.1, gate: () => door.swing > 0.8 },
    { minX: HALL.minX, maxX: HALL.maxX - 0.1, minZ: HALL.minZ, maxZ: HALL.maxZ },
    { minX: 4.8, maxX: 6.0, minZ: LDOOR.z0, maxZ: LDOOR.z1, pad: 0.1, gate: () => loungeDoor.swing > 0.8 },
    { minX: LOUNGE.minX + 0.1, maxX: LOUNGE.maxX, minZ: LOUNGE.minZ, maxZ: LOUNGE.maxZ },
  ];
  const inLounge = (p) => p.x > LOUNGE.minX && p.z < LOUNGE.maxZ;

  let chatter = 6, redraw = 0;
  const tmp = new THREE.Vector3();
  function update(dt, t, { player, hour, camera, hideBubbles }) {
    door.swing += ((door.open ? 1 : 0) - door.swing) * Math.min(1, dt * 6);
    doorPivot.rotation.y = -door.swing * 1.5;
    loungeDoor.swing += ((loungeDoor.open ? 1 : 0) - loungeDoor.swing) * Math.min(1, dt * 6);
    loungePivot.rotation.y = loungeDoor.swing * 1.5;

    const working = hour >= 8 && hour < 20;
    const near = inLounge(player);
    redraw -= dt;
    chatter -= dt;
    if (near && working && chatter <= 0) {
      const friend = friends[Math.floor(Math.random() * friends.length)];
      say(friend, friend.spec.idle[Math.floor(Math.random() * friend.spec.idle.length)]);
      chatter = 11 + Math.random() * 9;
    }
    friends.forEach((friend, i) => {
      friend.here = working;
      friend.body.visible = working;
      friend.face.visible = working;
      if (working) {
        // typing, with the odd pause to think
        const busy = Math.sin(t * 0.37 + i * 2.1) > -0.55;
        friend.arms.forEach((arm, k) => { arm.rotation.x = 1.05 + (busy ? Math.sin(t * 13 + k * 2.3 + i) * 0.035 : 0); });
        const dx = player.x - friend.spec.x, dz = player.z - SEAT_Z;
        const close = near && Math.hypot(dx, dz) < 2.6 && dz > -0.3;
        const want = close ? Math.max(-1.35, Math.min(1.35, Math.atan2(-dx, -dz))) : Math.sin(t * 0.5 + i) * 0.12;
        friend.head.rotation.y += (want - friend.head.rotation.y) * Math.min(1, dt * 4);
        friend.head.rotation.x = busy && !close ? 0.12 : 0;
        if (near && redraw <= 0) { friend.scroll += busy ? 1 : 0; drawFriendScreen(friend); }
      }
      friend.speakFor = Math.max(0, friend.speakFor - dt);
      const show = friend.speakFor > 0 && working && near && !hideBubbles;
      friend.bubble.classList.toggle('on', show);
      if (show) {
        tmp.set(friend.spec.x, 1.5, SEAT_Z).project(camera);
        friend.bubble.style.left = `${((tmp.x + 1) / 2) * innerWidth}px`;
        friend.bubble.style.top = `${((1 - tmp.y) / 2) * innerHeight}px`;
        if (tmp.z > 1) friend.bubble.classList.remove('on'); // behind the camera
      }
    });
    if (redraw <= 0) redraw = 0.55;
  }

  return { zones, update, inLounge, door, loungeDoor, friends };
}
