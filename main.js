const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Set COZY_SMOKE=<dir> to run a self-test that saves screenshots there and quits.
const smokeDir = process.env.COZY_SMOKE;
// keep rendering during the self-test even if the window is covered by another one
if (smokeDir) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// The game is served from app://cozy/ so fetch(), workers and WebAssembly (Pyodide) behave like on a normal origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveApp() {
  protocol.handle('app', (request) => {
    const file = path.normalize(path.join(__dirname, decodeURIComponent(new URL(request.url).pathname)));
    if (!file.startsWith(__dirname + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#1b1420',
    autoHideMenuBar: true,
    title: 'Cozy Dev Sim',
    webPreferences: { backgroundThrottling: !smokeDir },
  });
  win.loadURL('app://cozy/index.html');
  if (smokeDir) runSmoke(win);
}

async function runSmoke(win) {
  const wc = win.webContents;
  wc.on('console-message', (e) => console.log('[renderer]', e.message));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(smokeDir, name + '.png'), img.toPNG());
  };
  const fixed = 'def paginate(items, page, size):\\n    start = (page - 1) * size\\n    print(\'start\', start)\\n    return items[start:start + size]\\n';
  await new Promise((r) => wc.once('did-finish-load', r));
  try {
    for (const [name, js] of Object.entries({
      '1-room': '__cozy.sandbox(); __cozy.look(-0.45, -0.12)',
      '1b-bed-side': '__cozy.look(2.3, -0.12)',
      '1c-sofa-side': '__cozy.look(3.6, -0.15)',
      '1d-door-closed': 'console.log("[walk closed] " + __cozy.probe([[-1, 2.5], [-1, 3.1], [-1, 3.7]])); __cozy.goto(-1, 1.4); __cozy.look(Math.PI, -0.05)',
      '1e-door-open': '__cozy.openDoor()',
      '1f-corridor': 'console.log("[walk open] " + __cozy.probe([[-1, 2.5], [-1, 3.1], [-1, 3.7], [-1, 4.1], [3, 4.1], [5.8, 4.1], [8, 3], [8.9, 0], [-3, 3.1], [4.8, 0], [8.9, -2.4]])); __cozy.goto(-3.5, 4.1); __cozy.look(-Math.PI / 2, -0.03)',
      '1f2-lounge-door-closed': '__cozy.openDoor(false); __cozy.goto(3.2, 4.1); __cozy.look(-Math.PI / 2, -0.03); new Promise((r) => setTimeout(r, 900)).then(() => console.log("[lounge door closed] " + __cozy.probe([[4.9, 4.1], [5.4, 4.1], [5.9, 4.1]])))',
      '1f3-lounge-door-open': '__cozy.openDoor()',
      '1g-lounge': '__cozy.goto(8.6, 2.2); __cozy.look(0.05, -0.12)',
      '1h-friends': '__cozy.goto(8.9, -0.5); __cozy.look(0.75, -0.2); __cozy.use("maya")',
      '1i-lounge-back': '__cozy.goto(7.0, -1.0); __cozy.look(-2.3, -0.1)',
      '1j-sit-with-friends': '__cozy.use("codesk")',
      '1k-home': '__cozy.leave(); __cozy.goto(0, 1.6); __cozy.look(-0.45, -0.12)',
      '2-cat-walking': '__cozy.catGo(-0.6, 1.2); __cozy.look(0.4, -0.5)',
      '3-window': '__cozy.trainAt(-70); __cozy.use("window")',
      '3b-street': '__cozy.gaze(0.15, 0.9)',
      '3c-street-night': '__cozy.setHour(21.5)',
      '3d-reset': '__cozy.setHour(9.2); __cozy.gaze(0, 0)',
      '4-ide-failing': '__cozy.leave(); __cozy.use("pc"); __cozy.ide.solve(document.getElementById("editor").value)',
      '5-ide-passing': `__cozy.ide.solve("${fixed}")`,
      '6-ide-loop': '__cozy.ide.solve("def paginate(items, page, size):\\n    while True:\\n        pass\\n")',
      '7-monitors': `__cozy.ide.solve("${fixed}").then(() => { __cozy.leave(); __cozy.look(-0.75, -0.1); })`,
      '7b-mac-apps': '__cozy.use("pc"); ["safari", "messages", "music", "notes"].forEach(__cozy.desktop.openApp)',
      '8-barista-start': '__cozy.leave(); __cozy.use("coffee")',
      '8b-barista-played': '__cozy.baristaTest().then(() => __cozy.use("coffee"))',
      '9-barista-grind': '__cozy.stage({ ctl: "grind", dose: 9 }, { pf: "grinder" })',
      '10-barista-pull': '__cozy.stage({ ctl: null, dose: 18, tamp: 15, tamped: true, brewing: true }, { pf: "group", cup: "tray" })',
      '10b-barista-steam': '__cozy.stage({ brewing: false, shot: 27, ctl: "steam", temp: 40 }, { jug: "wand" })',
      '11-cup-in-hand': '__cozy.leave(); __cozy.look(-1.2, -0.1)',
      '12-night': '__cozy.setHour(21.5); __cozy.look(-0.3, -0.05)',
      '12b-night-window': '__cozy.trainAt(-60); __cozy.gaze(0, 0.1); __cozy.use("window")',
      '13-fps': 'new Promise((done) => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else { console.log("[fps] " + Math.round(n / 2) + " quality " + __cozy.quality().toFixed(2)); done(); } })(); })',
    })) {
      await wc.executeJavaScript(js);
      await wait(1700);
      await shot(name);
    }
    console.log('[smoke] done');
  } catch (err) {
    console.log('[smoke] FAILED', err);
  }
  app.quit();
}

app.whenReady().then(() => {
  serveApp();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
