// The in-game editor: a small VS Code look-alike for writing and testing Python.
import { tickets } from './tickets.js';
import { runPython, warmPython, pythonReady } from './python.js';

const $ = (id) => document.getElementById(id);
const PROMPT = 'PS C:\\cozy-app> ';

const FLOW = new Set(['return', 'if', 'elif', 'else', 'for', 'while', 'in', 'import', 'from', 'as', 'pass', 'break', 'continue', 'try', 'except', 'finally', 'raise', 'with', 'yield', 'assert']);
const KEYWORDS = new Set(['def', 'class', 'lambda', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'global', 'nonlocal', 'del']);
const TOKEN = /(#.*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function highlight(code) {
  let out = '', last = 0, prevWord = '';
  for (const m of code.matchAll(TOKEN)) {
    out += escapeHtml(code.slice(last, m.index));
    last = m.index + m[0].length;
    let cls;
    if (m[1]) cls = 'c';
    else if (m[2]) cls = 's';
    else if (m[3]) cls = 'n';
    else if (prevWord === 'def' || prevWord === 'class') cls = 'f';
    else if (FLOW.has(m[4])) cls = 'k2';
    else if (KEYWORDS.has(m[4])) cls = 'k';
    else cls = code[last] === '(' ? 'f' : 'v';
    prevWord = m[4] || '';
    out += `<span class="${cls}">${escapeHtml(m[0])}</span>`;
  }
  return out + escapeHtml(code.slice(last));
}

function pyRepr(v) {
  if (v === null) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`;
  return String(v);
}

// S: shared save state. onType: a keystroke landed. onCommit(ticket): tests passed and the player committed.
// onUpdate: something the 3D monitors show has changed.
export function createIDE({ S, onType, onCommit, onUpdate }) {
  const editor = $('editor'), hl = $('hl'), gutter = $('gutter');
  let tab = 'solution', passing = false, lastRun = null;

  const ticket = () => tickets[S.ticket % tickets.length];
  const codeFor = (t = ticket()) => S.drafts[t.id] ?? t.starter;
  const testsFor = (t) => `from solution import ${t.fn}\n\n\n${t.tests.map((c, i) =>
    `def test_case_${i + 1}():\n    assert ${t.fn}(${c.args.map(pyRepr).join(', ')}) == ${pyRepr(c.expect)}\n`).join('\n\n')}`;

  function syncScroll() {
    hl.scrollTop = gutter.scrollTop = editor.scrollTop;
    hl.scrollLeft = editor.scrollLeft;
  }
  function showCursor() {
    const before = editor.value.slice(0, editor.selectionStart).split('\n');
    $('lnCol').textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
  }
  function refreshEditor() {
    hl.innerHTML = highlight(editor.value) + '\n';
    gutter.textContent = editor.value.split('\n').map((_, i) => i + 1).join('\n');
    syncScroll();
    showCursor();
  }
  function setTab(next) {
    tab = next;
    document.querySelectorAll('#ide [data-tab]').forEach((el) => el.classList.toggle('act', el.dataset.tab === tab));
    editor.readOnly = tab === 'tests';
    editor.value = tab === 'tests' ? testsFor(ticket()) : codeFor();
    $('vsCrumbs').textContent = `cozy-app  \u203a  ${tab === 'tests' ? 'test_solution.py' : `solution.py  \u203a  ${ticket().fn}`}`;
    refreshEditor();
  }
  function setPassing(ok, message) {
    passing = ok;
    $('btnCommit').disabled = !ok;
    $('ideStatus').textContent = message ?? (S.energy <= 1 ? '\u26a0 Exhausted: commits earn half XP until you rest' : '\u25cb Tests not run');
  }
  function terminal(lines) {
    const out = $('output');
    out.replaceChildren(...lines.map(([className, textContent]) => Object.assign(document.createElement('div'), { className, textContent })));
    out.scrollTop = out.scrollHeight;
  }

  function open() {
    const t = ticket();
    warmPython();
    lastRun = null;
    $('ideTitle').textContent = `solution.py \u2014 ${t.id} ${t.title} \u2014 Cozy Code`;
    $('ticketDesc').textContent = `${t.id}: ${t.desc}`;
    $('backlog').replaceChildren(...[1, 2, 3].map((k) => {
      const next = tickets[(S.ticket + k) % tickets.length];
      return Object.assign(document.createElement('div'), { className: 'tk', textContent: `${next.id}  ${next.title}` });
    }));
    setTab('solution');
    terminal([['dim', 'Press Ctrl+Enter or \u25b7 to run the tests. print() output shows up here.'], ['cmd', PROMPT]]);
    setPassing(false);
    onUpdate();
  }

  async function runTests() {
    const t = ticket();
    const head = [['cmd', `${PROMPT}python -m pytest test_solution.py`]];
    terminal([...head, ['dim', pythonReady() ? 'collecting ...' : 'Starting Python \u2014 the first run takes a few seconds ...']]);
    const data = await runPython({ code: codeFor(t), fn: t.fn, tests: t.tests });
    if (ticket() !== t) return false;
    const lines = [...head, ...data.logs.map((l) => ['log', l])];
    let passed = 0, total = t.tests.length;
    if (data.error) {
      lines.push(['bad', data.error]);
    } else {
      for (const r of data.results) {
        if (r.ok) passed++;
        lines.push(r.ok ? ['ok', `PASSED  ${r.call}`] : ['bad', `FAILED  ${r.call}\n        expected  ${r.expected}\n        got       ${r.got}`]);
      }
    }
    const ok = !data.error && passed === total;
    lines.push([ok ? 'ok' : 'bad', data.error ? '===== error while loading solution.py =====' : `===== ${passed} passed${passed < total ? `, ${total - passed} failed` : ''} =====`], ['cmd', PROMPT]);
    terminal(lines);
    lastRun = { ok, passed, total, error: data.error };
    setPassing(ok, ok ? `\u2713 ${total}/${total} tests passing \u2014 ready to commit` : data.error ? '\u2717 Error in solution.py' : `\u2717 ${passed}/${total} tests passing`);
    onUpdate();
    return ok;
  }

  function commit() {
    if (!passing) return;
    const t = ticket();
    delete S.drafts[t.id];
    S.ticket++;
    onCommit(t);
    open();
    editor.focus();
  }

  editor.addEventListener('input', () => {
    if (tab !== 'solution') return;
    S.drafts[ticket().id] = editor.value;
    onType();
    if (passing) setPassing(false);
    refreshEditor();
    onUpdate();
  });
  editor.addEventListener('scroll', syncScroll);
  editor.addEventListener('keyup', showCursor);
  editor.addEventListener('click', showCursor);
  editor.addEventListener('keydown', (e) => {
    if (editor.readOnly) return;
    const line = editor.value.slice(0, editor.selectionStart).split('\n').pop();
    // execCommand keeps the textarea's native undo history intact
    if (e.code === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '    ');
    } else if (e.code === 'Enter' && !e.ctrlKey) {
      e.preventDefault();
      const indent = line.match(/^ */)[0] + (/:\s*(#.*)?$/.test(line) ? '    ' : '');
      document.execCommand('insertText', false, '\n' + indent);
    } else if (e.code === 'Backspace' && editor.selectionStart === editor.selectionEnd && /^ +$/.test(line) && line.length % 4 === 0) {
      e.preventDefault();
      editor.setSelectionRange(editor.selectionStart - 4, editor.selectionStart);
      document.execCommand('delete');
    }
  });
  document.querySelectorAll('#ide [data-tab]').forEach((el) => el.addEventListener('click', () => { setTab(el.dataset.tab); editor.focus(); }));
  $('btnRun').addEventListener('click', runTests);
  $('btnRunTests').addEventListener('click', runTests);
  $('btnCommit').addEventListener('click', commit);
  $('btnReset').addEventListener('click', () => {
    delete S.drafts[ticket().id];
    open();
    editor.focus();
  });

  return {
    open, runTests, commit,
    focus: () => editor.focus(),
    blur: () => editor.blur(),
    // what the in-world monitors display
    view: () => ({ ticket: ticket(), code: codeFor(), lastRun }),
    solve(code) {
      setTab('solution');
      editor.value = code;
      editor.dispatchEvent(new Event('input'));
      return runTests();
    },
  };
}
