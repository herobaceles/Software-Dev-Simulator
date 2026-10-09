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
      '2-cat-walking': '__cozy.catGo(-0.6, 1.2); __cozy.look(0.4, -0.5)',
      '3-window': '__cozy.use("window")',
      '4-ide-failing': '__cozy.leave(); __cozy.use("pc"); __cozy.ide.solve(document.getElementById("editor").value)',
      '5-ide-passing': `__cozy.ide.solve("${fixed}")`,
      '6-ide-loop': '__cozy.ide.solve("def paginate(items, page, size):\\n    while True:\\n        pass\\n")',
      '7-monitors': `__cozy.ide.solve("${fixed}").then(() => { __cozy.leave(); __cozy.look(-0.75, -0.1); })`,
      '8-barista-menu': '__cozy.use("coffee")',
      '9-barista-grind': '__cozy.barista.choose("latte"); __cozy.barista.press()',
      '10-barista-pull': '__cozy.skipTo("pull"); __cozy.barista.press()',
      '11-cup-in-hand': '__cozy.giveCup(); __cozy.look(-1.2, -0.1)',
      '12-night': '__cozy.setHour(21.5); __cozy.look(-0.3, -0.05)',
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
