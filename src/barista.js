// Hands-on espresso bar. Nothing is chosen from a menu: you drag the portafilter to the
// grinder, dose, tamp, lock it in, place a cup, pull the shot, and optionally add hot water
// or steam and pour milk. What ends up in the cup decides the drink and its quality.
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const BAR_X = 3.6, GROUP_Z = 2.45, GRIND_Z = 1.98, MAT_Z = 1.68, WAND_Z = 2.63;
const DRAG_X = 3.5; // the vertical plane things slide on while you carry them
// where each movable thing can rest
const SPOTS = {
  pf: { group: [BAR_X, 1.155, GROUP_Z], grinder: [3.63, 1.05, GRIND_Z], mat: [3.56, 0.975, MAT_Z] },
  cup: { top: [3.82, 1.405, 2.36], tray: [BAR_X, 1.005, GROUP_Z] },
  jug: { counter: [3.56, 0.99, 2.84], wand: [BAR_X, 0.995, WAND_Z] },
  tamper: { rest: [3.74, 0.962, 1.62] },
};
const TARGET = { dose: [17, 19], tamp: [13, 18], shot: [25, 30], temp: [58, 68] };

export function createBarista({ THREE, room, camera, canvas, kit, onDone }) {
  const { box, cyl, mat, steam, canvasTexture } = kit;
  const METAL = { metalness: 0.25, roughness: 0.35 };
  const bar = new THREE.Group();
  room.add(bar);

  // ── fixed furniture ──
  box(0.6, 0.9, 1.45, '#141416', 3.7, 0.45, 2.225, bar);
  box(0.64, 0.04, 1.49, '#f1f0ee', 3.7, 0.92, 2.225, bar);
  box(0.32, 0.36, 0.46, '#d5d7db', 3.8, 1.14, GROUP_Z, bar, METAL);
  box(0.36, 0.05, 0.5, '#2b2b33', 3.8, 1.345, GROUP_Z, bar);
  box(0.12, 0.07, 0.16, '#9a9da3', BAR_X, 1.21, GROUP_Z, bar, METAL);
  box(0.2, 0.03, 0.44, '#2b2b33', BAR_X, 0.955, GROUP_Z, bar);
  const wand = cyl(0.008, 0.008, 0.2, '#d5d7db', BAR_X + 0.01, 1.15, WAND_Z, bar, METAL);
  wand.rotation.z = -0.12;
  cyl(0.008, 0.008, 0.07, '#d5d7db', BAR_X, 1.2, GROUP_Z - 0.035, bar, METAL);
  box(0.16, 0.012, 0.2, '#2b2b33', 3.56, 0.946, MAT_Z, bar);
  const grinderBody = box(0.16, 0.3, 0.18, '#2b2b33', 3.78, 1.09, GRIND_Z, bar);
  cyl(0.08, 0.05, 0.14, '#6b4630', 3.78, 1.31, GRIND_Z, bar, { transparent: true, opacity: 0.75 });
  box(0.12, 0.03, 0.05, '#9a9da3', 3.67, 1.12, GRIND_Z, bar, METAL);
  box(0.09, 0.012, 0.1, '#9a9da3', 3.66, 1.022, GRIND_Z, bar, METAL);

  // ── controls you click or hold ──
  const pickables = [];
  function control(name, mesh) {
    mesh.userData.ba = name;
    pickables.push(mesh);
    return mesh;
  }
  function knob(name, color, y, z, x = 3.632) {
    const k = cyl(0.026, 0.026, 0.03, color, x, y, z, bar, { emissive: color, emissiveIntensity: 0.15 });
    k.rotation.z = Math.PI / 2;
    return control(name, k);
  }
  const brewBtn = knob('brew', '#f2c57c', 1.285, GROUP_Z + 0.02);
  const waterKnob = knob('water', '#6cc7ff', 1.285, GROUP_Z - 0.17);
  const steamKnob = knob('steam', '#e9eaec', 1.285, GROUP_Z + 0.17);
  const grindBtn = knob('grind', '#7CFFB2', 1.12, GRIND_Z + 0.058, 3.695);

  function display(y, z, x) {
    const tex = canvasTexture(128, 56);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.037), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    face.position.set(x, y, z);
    face.rotation.y = -Math.PI / 2;
    bar.add(face);
    let shown = null;
    return (text) => {
      if (text === shown) return;
      shown = text;
      const g = tex.image.getContext('2d');
      g.fillStyle = '#10151a'; g.fillRect(0, 0, 128, 56);
      g.fillStyle = '#7CFFB2'; g.font = 'bold 30px Consolas, monospace'; g.textAlign = 'center';
      g.fillText(text, 64, 39);
      tex.needsUpdate = true;
    };
  }
  const shotDisplay = display(1.285, GROUP_Z - 0.075, 3.638);
  const doseDisplay = display(1.19, GRIND_Z, 3.698);

  // ── things you carry ──
  const items = {};
  function item(name, loc) {
    const group = new THREE.Group();
    group.position.fromArray(SPOTS[name][loc]);
    group.userData.ba = name;
    bar.add(group);
    pickables.push(group);
    items[name] = { group, loc };
    return group;
  }
  const pf = item('pf', 'group');
  cyl(0.042, 0.036, 0.035, '#55555f', 0, 0, 0, pf, METAL);
  box(0.17, 0.028, 0.028, '#18181d', -0.115, 0, 0, pf);
  const grounds = cyl(0.036, 0.036, 0.012, '#4a2c17', 0, 0.014, 0, pf);

  const cup = item('cup', 'top');
  cyl(0.042, 0.032, 0.07, '#fbf3e6', 0, 0, 0, cup);
  const cupHandle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 8, 18), mat('#fbf3e6'));
  cupHandle.position.set(0, 0, 0.045);
  cupHandle.rotation.y = Math.PI / 2;
  cup.add(cupHandle);
  const liquid = cyl(0.037, 0.037, 0.004, '#3b2314', 0, 0, 0, cup);
  // spare cups warming on top of the machine
  cyl(0.042, 0.032, 0.07, '#fbf3e6', 3.82, 1.405, 2.5, bar);
  cyl(0.042, 0.032, 0.07, '#fbf3e6', 3.72, 1.405, 2.56, bar);

  const jug = item('jug', 'counter');
  cyl(0.045, 0.04, 0.1, '#d5d7db', 0, 0, 0, jug, METAL);
  box(0.012, 0.07, 0.05, '#d5d7db', 0, 0, 0.065, jug, METAL);
  const jugMilk = cyl(0.041, 0.041, 0.004, '#fffaf0', 0, 0.02, 0, jug);

  const tamper = item('tamper', 'rest');
  cyl(0.034, 0.034, 0.018, '#c9ccd1', 0, 0, 0, tamper, METAL);
  cyl(0.016, 0.02, 0.06, '#8a5a3c', 0, 0.04, 0, tamper);
  const tamperTop = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), mat('#8a5a3c'));
  tamperTop.position.y = 0.08;
  tamper.add(tamperTop);

  // ── streams and steam ──
  const pour = (r, h, color, x, y, z) => { const m = cyl(r, r, h, color, x, y, z, bar); m.visible = false; return m; };
  const shotStream = pour(0.005, 0.1, '#4a2c17', BAR_X, 1.085, GROUP_Z);
  const waterStream = pour(0.004, 0.13, '#cfe8ff', BAR_X, 1.1, GROUP_Z - 0.03);
  const groundsStream = pour(0.008, 0.05, '#4a2c17', 3.63, 1.085, GRIND_Z);
  const milkStream = pour(0.005, 0.09, '#fffaf0', BAR_X, 1.085, GROUP_Z + 0.02);
  const wandSteam = steam(bar, BAR_X, 1.05, WAND_Z, 5, 0.022);
  const cupSteam = steam(bar, BAR_X, 1.05, GROUP_Z, 3, 0.012, 0.2);

  // ── state ──
  const st = { open: false, held: null, ctl: null, brewing: false, pressing: false, pouring: false, decaf: false };
  let flash = '', flashFor = 0, guideTimer = 0;
  function reset() {
    Object.assign(st, { held: null, ctl: null, brewing: false, pressing: false, pouring: false,
      dose: 0, tamp: 0, tamped: false, shot: 0, water: 0, milk: 0, jugMilk: 1, temp: 5 });
    items.pf.loc = 'group'; items.cup.loc = 'top'; items.jug.loc = 'counter'; items.tamper.loc = 'rest';
    for (const [name, it] of Object.entries(items)) it.group.position.fromArray(SPOTS[name][it.loc]);
  }
  const shotLevel = () => Math.min(0.3, (st.shot / 27) * 0.27);
  const level = () => shotLevel() + st.water + st.milk;
  const say = (text) => { flash = text; flashFor = 2.6; };

  function hint() {
    const at = (name) => items[name].loc;
    if (st.dose < 1) return at('pf') === 'grinder' ? 'Hold the green button on the grinder. Aim for about 18 g.' : 'Drag the portafilter out of the machine and over to the grinder.';
    if (at('pf') === 'grinder' && !st.tamped) return 'Happy with the dose? Carry the portafilter to the tamping mat on the left.';
    if (!st.tamped) return at('pf') === 'mat' ? 'Drag the tamper onto the coffee and keep holding to press. About 15 kg.' : 'Carry the portafilter to the tamping mat on the left.';
    if (at('pf') !== 'group') return 'Lock the portafilter back into the group head.';
    if (at('cup') !== 'tray') return 'Take a warm cup from the top of the machine and set it on the drip tray.';
    if (st.brewing) return 'Extracting… click the amber button again to stop. 25–30 s is the sweet spot.';
    if (st.shot < 1) return 'Click the amber button to start the shot.';
    return 'Drag the cup toward you to take it. Or hold the blue knob for hot water, or steam the milk jug under the wand and pour it in.';
  }

  // ── mouse ──
  const ndc = new THREE.Vector2(), ray = new THREE.Raycaster(), hit = new THREE.Vector3();
  const dragPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -DRAG_X);
  function pick() {
    ray.setFromCamera(ndc, camera);
    let o = ray.intersectObjects(pickables, true)[0]?.object;
    while (o && !o.userData.ba) o = o.parent;
    return o?.userData.ba;
  }
  function nearest(name, reach = 0.17) {
    const p = items[name].group.position;
    let best = null, bestDist = reach;
    for (const [loc, [, y, z]] of Object.entries(SPOTS[name])) {
      const d = Math.hypot(p.y - y, p.z - z);
      if (d < bestDist) { best = loc; bestDist = d; }
    }
    return best;
  }
  function toggleBrew() {
    if (st.brewing) { st.brewing = false; return; }
    if (st.dose < 1) return say('There is no coffee in the portafilter yet.');
    if (!st.tamped) return say('Tamp the coffee first or the water will rush straight through.');
    if (items.pf.loc !== 'group') return say('The portafilter is not locked into the machine.');
    if (items.cup.loc !== 'tray') return say('Put a cup under the group head first!');
    if (st.shot > 0) return say('That puck is spent. One shot per portafilter.');
    st.brewing = true;
  }
  function onDown(e) {
    if (!st.open || e.button !== 0) return;
    const name = pick();
    if (!name) return;
    if (name === 'brew') return toggleBrew();
    if (items[name]) {
      if (st.brewing && (name === 'pf' || name === 'cup')) return say('Stop the shot before moving that.');
      st.held = name;
    } else {
      st.ctl = name;
      if (name === 'grind' && items.pf.loc !== 'grinder') say('Hold the portafilter under the grinder first.');
      if (name === 'steam' && items.jug.loc !== 'wand') say('Set the milk jug under the steam wand first.');
      if (name === 'water' && items.cup.loc !== 'tray') say('Put a cup on the drip tray first.');
    }
  }
  function onMove(e) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (st.open) canvas.style.cursor = st.held ? 'grabbing' : pick() ? 'grab' : 'default';
  }
  function onUp() {
    st.ctl = null;
    const name = st.held;
    if (!name) return;
    st.held = null;
    const it = items[name];
    if (name === 'tamper') {
      if (st.pressing) st.tamped = true;
    } else if (name === 'cup' && ndc.y < -0.45 && st.shot > 1) {
      return serve();
    } else if (!st.pouring) {
      // drop where the mouse is right now, even if no frame has been drawn since it last moved
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(dragPlane, hit)) it.group.position.set(DRAG_X, clamp(hit.y, 0.97, 1.65), clamp(hit.z, 1.5, 2.95));
      it.loc = nearest(name) ?? it.loc;
    }
    st.pressing = st.pouring = false;
  }
  canvas.addEventListener('mousedown', onDown);
  addEventListener('mousemove', onMove);
  addEventListener('mouseup', onUp);

  // ── the drink ──
  function serve() {
    const miss = (v, [lo, hi], tolerance) => Math.max(0, 1 - (v < lo ? lo - v : v > hi ? v - hi : 0) / tolerance);
    const milky = st.milk > 0.05;
    const scores = [miss(st.dose, TARGET.dose, 5), miss(st.tamp, TARGET.tamp, 10), miss(st.shot, TARGET.shot, 12)];
    if (milky) scores.push(miss(st.temp, TARGET.temp, 15));
    const quality = scores.reduce((a, b) => a + b, 0) / scores.length;
    const name = milky
      ? (st.water > 0.1 ? 'White Americano' : st.milk < 0.2 ? 'Macchiato' : st.milk < 0.45 ? 'Cappuccino' : 'Latte')
      : st.water > 0.15 ? 'Americano' : 'Espresso';
    const small = name === 'Espresso' || name === 'Macchiato';
    const note = st.shot < TARGET.shot[0] ? 'a touch sour — the shot ran short'
      : st.shot > TARGET.shot[1] ? 'a little bitter — the shot ran long'
        : milky && st.temp > TARGET.temp[1] ? 'the milk got scalded'
          : milky && st.temp < TARGET.temp[0] ? 'the milk is lukewarm'
            : quality > 0.9 ? 'balanced, sweet and syrupy' : 'pleasant and comforting';
    const result = { name, quality, stars: Math.round(1 + quality * 4), sips: small ? 2 : 4, energy: small ? 14 : 7, cozy: milky ? 5.5 : 3, milk: milky, note, decaf: st.decaf };
    close();
    onDone(result);
  }

  function open(decaf) {
    reset();
    st.open = true;
    st.decaf = decaf;
    flash = decaf ? 'Three cups already today, so this one is decaf.' : '';
    flashFor = decaf ? 3.5 : 0;
    $('barista').classList.add('on');
  }
  function close() {
    st.open = false;
    st.held = st.ctl = st.sound = null;
    st.brewing = false;
    canvas.style.cursor = '';
    $('barista').classList.remove('on');
    reset();
  }

  const cold = new THREE.Color('#3b2314'), milkTone = new THREE.Color('#e3c7a0'), waterTone = new THREE.Color('#5a3a22');
  function update(dt, t) {
    // carried things follow the mouse; everything else settles into its spot
    for (const [name, it] of Object.entries(items)) {
      const g = it.group;
      let tilt = 0;
      if (st.open && st.held === name) {
        ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(dragPlane, hit)) g.position.set(DRAG_X, clamp(hit.y, 0.97, 1.65), clamp(hit.z, 1.5, 2.95));
        if (name === 'tamper') {
          st.pressing = items.pf.loc === 'mat' && st.dose >= 1 && Math.abs(hit.z - MAT_Z) < 0.11 && hit.y < 1.2;
          if (st.pressing) {
            st.tamp = Math.min(30, st.tamp + 9 * dt);
            g.position.set(3.56, 1.012 - Math.min(st.tamp, 20) * 0.0005, MAT_Z);
          }
        }
        if (name === 'jug') {
          const overCup = items.cup.loc === 'tray' && Math.abs(hit.z - GROUP_Z - 0.06) < 0.13 && hit.y > 1.03 && hit.y < 1.4;
          st.pouring = overCup && st.shot > 1 && st.jugMilk > 0.02 && level() < 1;
          if (overCup) g.position.set(BAR_X, 1.15, GROUP_Z + 0.1);
          if (st.pouring) {
            const amount = Math.min(0.2 * dt, 1 - level());
            st.milk += amount;
            st.jugMilk -= amount * 1.3;
            tilt = -1.05;
          }
        }
      } else {
        tmp.fromArray(SPOTS[name][it.loc]);
        g.position.lerp(tmp, 1 - Math.exp(-dt * 14));
      }
      g.rotation.x += (tilt - g.rotation.x) * Math.min(1, dt * 10);
    }
    if (!st.open) return;

    const settled = (name, loc) => items[name].loc === loc && st.held !== name;
    const grinding = st.ctl === 'grind' && settled('pf', 'grinder');
    const watering = st.ctl === 'water' && settled('cup', 'tray') && level() < 1;
    const steaming = st.ctl === 'steam' && settled('jug', 'wand');
    if (grinding) {
      st.dose = Math.min(26, st.dose + 6 * dt);
      st.tamp = 0;
      st.tamped = false;
    }
    if (watering) st.water += Math.min(0.2 * dt, 1 - level());
    if (steaming) st.temp = Math.min(96, st.temp + 13 * dt);
    if (st.brewing) {
      st.shot += dt * 5;
      if (st.shot >= 45) st.brewing = false;
    }
    st.sound = grinding ? 'grind' : steaming ? 'steam' : st.brewing ? 'pull' : watering ? 'water' : null;

    // what you can see
    grinderBody.position.x = 3.78 + (grinding ? Math.sin(t * 90) * 0.004 : 0);
    groundsStream.visible = grinding;
    grounds.visible = st.dose > 0.3;
    grounds.scale.y = st.tamped || st.pressing ? 0.6 : 0.4 + st.dose / 18;
    grounds.material.color.set(st.shot > 1 ? '#2a1a10' : '#4a2c17');
    shotStream.visible = st.brewing;
    waterStream.visible = watering;
    milkStream.visible = st.pouring;
    const lv = level();
    liquid.visible = lv > 0.01;
    liquid.position.y = -0.03 + lv * 0.058;
    liquid.scale.setScalar(0.86 + lv * 0.14);
    liquid.material.color.copy(cold).lerp(waterTone, clamp(st.water * 2, 0, 1)).lerp(milkTone, clamp((st.milk / Math.max(lv, 0.01)) * 1.5, 0, 1));
    jugMilk.position.y = -0.04 + st.jugMilk * 0.07;
    jugMilk.visible = st.jugMilk > 0.03;
    wandSteam(t, steaming);
    cupSteam(t, lv > 0.05 && settled('cup', 'tray'));
    brewBtn.material.emissiveIntensity = st.brewing ? 1.6 : 0.15;
    grindBtn.material.emissiveIntensity = grinding ? 1.6 : 0.3;
    steamKnob.rotation.x = steaming ? t * 3 : 0;
    waterKnob.rotation.x = watering ? t * 3 : 0;
    shotDisplay(`${Math.floor(st.shot)}s`);
    doseDisplay(`${st.dose.toFixed(1)}g`);

    // guidance (text only needs refreshing a few times a second)
    flashFor = Math.max(0, flashFor - dt);
    guideTimer -= dt;
    if (guideTimer > 0) return;
    guideTimer = 0.1;
    $('baHint').textContent = flashFor > 0 ? flash : hint();
    $('baHint').classList.toggle('warn', flashFor > 0);
    const chip = (id, text, value, range) => {
      const el = $(id);
      el.textContent = text;
      el.className = value <= 0 ? '' : value >= range[0] && value <= range[1] ? 'good' : 'off';
    };
    chip('baDose', `Dose ${st.dose.toFixed(1)} g`, st.dose, TARGET.dose);
    chip('baTamp', `Tamp ${st.tamp.toFixed(0)} kg`, st.tamp, TARGET.tamp);
    chip('baShot', `Shot ${st.shot.toFixed(0)} s`, st.shot, TARGET.shot);
    chip('baMilk', `Milk ${st.temp.toFixed(0)}°C`, st.temp > 6 ? st.temp : 0, TARGET.temp);
  }
  const tmp = new THREE.Vector3();

  reset();
  return { state: st, items, open, close, update, collider: [3.4, 4, 1.5, 3], group: bar, spots: SPOTS };
}
