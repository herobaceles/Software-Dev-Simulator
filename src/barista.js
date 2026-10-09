// Barista minigame: pick a drink, then grind, tamp, pull and (for milk drinks) steam.
// Each step is a meter with a sweet spot; how close you land decides the cup's quality.
const $ = (id) => document.getElementById(id);

const DRINKS = {
  espresso: { name: 'Espresso', milk: false, sips: 2, energy: 14, cozy: 2 },
  americano: { name: 'Americano', milk: false, sips: 4, energy: 7, cozy: 3 },
  latte: { name: 'Latte', milk: true, sips: 4, energy: 6, cozy: 5 },
  cappuccino: { name: 'Cappuccino', milk: true, sips: 4, energy: 6, cozy: 6 },
};

// kind 'hold': the meter climbs while Space is held. kind 'stop': it sweeps on its own and Space stops it.
const STEPS = {
  grind: { title: 'Grind the beans', hint: 'Hold Space to grind. Let go in the green for a fine, even grind.', kind: 'hold', speed: 36, zone: [58, 76], low: 'Too coarse — the shot will run fast.', high: 'Ground to dust — it may turn bitter.', good: 'Fluffy and even. Lovely.' },
  tamp: { title: 'Tamp the puck', hint: 'Press Space when the marker is centred for a level tamp.', kind: 'stop', speed: 130, zone: [41, 59], low: 'A bit lopsided.', high: 'A bit lopsided.', good: 'Flat and firm.' },
  pull: { title: 'Pull the shot', hint: 'Hold Space to extract. Stop in the green — about 27 seconds on a real machine.', kind: 'hold', speed: 24, zone: [62, 80], low: 'Under-extracted: thin and sour.', high: 'Over-extracted: harsh and bitter.', good: 'Syrupy, with a tiger-striped crema.' },
  steam: { title: 'Steam the milk', hint: 'Hold Space to steam. Stop around 60–65°C for silky microfoam.', kind: 'hold', speed: 28, zone: [60, 74], low: 'Lukewarm and flat.', high: 'Scalded — big soapy bubbles.', good: 'Glossy microfoam, like wet paint.' },
};

export function createBarista({ onDone }) {
  // read by the game each frame to drive the 3D machine and sounds
  const state = { open: false, step: 'menu', value: 0, holding: false, drink: null };
  let order = [], scores = [], dir = 1, started = false, pause = 0, decaf = false, result = null;

  const spec = () => STEPS[state.step];

  function render() {
    const s = spec();
    const menu = state.step === 'menu', done = state.step === 'done';
    $('baMenu').style.display = menu ? '' : 'none';
    $('baMeter').style.display = s ? '' : 'none';
    $('baBtn').style.display = menu ? 'none' : '';
    if (menu) {
      $('baStep').textContent = decaf ? 'ESPRESSO BAR · DECAF ONLY (3 CUPS TODAY)' : 'ESPRESSO BAR';
      $('baTitle').textContent = 'What are we making?';
      $('baHint').textContent = 'Pick a drink with the mouse or keys 1–4. Esc to step away.';
      $('baNote').textContent = '';
    } else if (done) {
      $('baStep').textContent = 'ORDER UP';
      $('baTitle').textContent = `${decaf ? 'Decaf ' : ''}${state.drink.name}  ${'★'.repeat(result.stars)}${'☆'.repeat(5 - result.stars)}`;
      $('baHint').textContent = result.stars >= 5 ? 'Café-quality. You could charge for this.' : result.stars >= 3 ? 'A solid, comforting cup.' : 'Drinkable. Practice makes perfect.';
      $('baBtn').textContent = 'Take your cup (Space)';
    } else {
      $('baStep').textContent = `STEP ${order.indexOf(state.step) + 1} OF ${order.length} · ${state.drink.name.toUpperCase()}`;
      $('baTitle').textContent = s.title;
      $('baHint').textContent = s.hint;
      $('baBtn').textContent = s.kind === 'hold' ? 'Hold Space' : 'Press Space';
      $('baZone').style.left = `${s.zone[0]}%`;
      $('baZone').style.width = `${s.zone[1] - s.zone[0]}%`;
    }
  }

  function begin(step) {
    state.step = step;
    state.value = 0;
    state.holding = false;
    started = false;
    dir = 1;
    if (!pause) $('baNote').textContent = '';
    render();
  }
  function finishStep() {
    const s = spec(), v = state.value;
    const miss = v < s.zone[0] ? s.zone[0] - v : v > s.zone[1] ? v - s.zone[1] : 0;
    scores.push(Math.max(0, 1 - miss / 30));
    $('baNote').textContent = miss === 0 ? s.good : v < s.zone[0] ? s.low : s.high;
    $('baNote').className = miss === 0 ? 'good' : 'meh';
    state.holding = false;
    pause = 1.1;
  }
  function advance() {
    const next = order[order.indexOf(state.step) + 1];
    if (next) return begin(next);
    const quality = scores.reduce((a, b) => a + b, 0) / scores.length;
    result = { drink: state.drink, quality, stars: Math.round(1 + quality * 4), decaf };
    state.step = 'done';
    render();
  }

  function choose(key) {
    if (state.step !== 'menu' || !DRINKS[key]) return;
    state.drink = DRINKS[key];
    order = state.drink.milk ? ['grind', 'tamp', 'pull', 'steam'] : ['grind', 'tamp', 'pull'];
    scores = [];
    begin(order[0]);
  }
  function press() {
    if (pause > 0) return;
    if (state.step === 'done') {
      close();
      return onDone(result);
    }
    const s = spec();
    if (!s) return;
    if (s.kind === 'stop') return finishStep();
    state.holding = true;
    started = true;
  }
  function release() {
    if (state.holding && started && pause <= 0) finishStep();
  }

  function open(decafOnly) {
    decaf = decafOnly;
    state.open = true;
    state.drink = null;
    pause = 0;
    $('barista').classList.add('on');
    begin('menu');
  }
  function close() {
    state.open = false;
    state.holding = false;
    state.step = 'menu';
    $('barista').classList.remove('on');
  }

  function update(dt) {
    if (!state.open) return;
    if (pause > 0) {
      pause -= dt;
      if (pause <= 0) { pause = 0; advance(); }
      return;
    }
    const s = spec();
    if (!s) return;
    if (s.kind === 'stop') {
      state.value += dir * s.speed * dt;
      if (state.value >= 100 || state.value <= 0) { state.value = Math.max(0, Math.min(100, state.value)); dir = -dir; }
    } else if (state.holding) {
      state.value = Math.min(100, state.value + s.speed * dt);
      if (state.value >= 100) finishStep();
    }
    $('baFill').style.width = s.kind === 'hold' ? `${state.value}%` : '0';
    $('baMark').style.left = `${state.value}%`;
  }

  // returns true when the key was used
  function key(e, down) {
    if (!state.open) return false;
    if (e.code === 'Space') {
      e.preventDefault();
      if (down && !e.repeat) press();
      if (!down) release();
      return true;
    }
    if (down && state.step === 'menu' && /^Digit[1-4]$/.test(e.code)) {
      choose(Object.keys(DRINKS)[Number(e.code.slice(5)) - 1]);
      return true;
    }
    return false;
  }

  $('baMenu').querySelectorAll('[data-drink]').forEach((b) => b.addEventListener('click', () => choose(b.dataset.drink)));
  $('baBtn').addEventListener('mousedown', press);
  addEventListener('mouseup', release);

  return { state, open, close, update, key, choose, press, release, skipTo: begin };
}
