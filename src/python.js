// Talks to the Pyodide worker: keeps it warm, runs one job at a time, and
// restarts it when the player's code hangs.
const RUN_MS = 5000;
const LOAD_MS = 60000;

let worker = null, ready = false, job = null, seq = 0;

function boot() {
  ready = false;
  worker = new Worker(new URL('./runner.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.ready) {
      ready = true;
      if (job) arm(RUN_MS);
    } else if (data.fatal) {
      crash(`Python failed to start: ${data.fatal}`);
    } else if (job && data.id === job.id) {
      settle(data);
    }
  };
  worker.onerror = (e) => crash(e.message || 'The Python runner crashed.');
}
function arm(ms) {
  clearTimeout(job.timer);
  job.timer = setTimeout(() => {
    worker.terminate();
    boot();
    settle({ error: 'TimeoutError: stopped after 5 seconds — is there an infinite loop?', logs: [] });
  }, ms);
}
function settle(data) {
  const done = job;
  job = null;
  clearTimeout(done.timer);
  done.resolve(data);
}
function crash(message) {
  worker?.terminate();
  worker = null;
  if (job) settle({ error: message, logs: [] });
}

export const pythonReady = () => ready;
export function warmPython() { if (!worker) boot(); }

// payload: { code, fn, tests } -> { results, logs } or { error, logs }
export function runPython(payload) {
  if (job) return job.promise;
  warmPython();
  const id = ++seq;
  const promise = new Promise((resolve) => { job = { id, resolve }; });
  job.promise = promise;
  arm(ready ? RUN_MS : LOAD_MS);
  worker.postMessage({ id, ...payload });
  return promise;
}
