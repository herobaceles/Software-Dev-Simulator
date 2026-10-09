// The Mac-style desktop you see when sitting at the PC: a menu bar, a dock,
// draggable windows, and the small apps that are not the code editor.
import { tickets } from './tickets.js';

const $ = (id) => document.getElementById(id);
const APP_NAMES = { code: 'Code', safari: 'Safari', messages: 'Messages', music: 'Music', notes: 'Notes' };
const REPLIES = ['Sounds good!', 'Take your time, no rush.', 'Ha, same here.', 'Thanks for the update.', 'Go get a coffee first, you earned it.', 'Love that.'];
const TRACKS = ['Rainy Window Refactor', 'Soft Reset', 'Commit & Chill', 'Warm Cache'];

// S: shared save state. onRadio(): the player toggled the music.
export function createDesktop({ S, onRadio }) {
  const wins = [...document.querySelectorAll('#mac .win')];
  const win = (app) => wins.find((w) => w.dataset.app === app);
  let top = 10;

  function focusApp(app) {
    const w = win(app);
    w.style.zIndex = ++top;
    wins.forEach((x) => x.classList.toggle('front', x === w));
    $('macApp').textContent = APP_NAMES[app];
  }
  function openApp(app) {
    win(app).classList.add('open');
    document.querySelector(`#dock [data-open="${app}"]`).classList.add('running');
    focusApp(app);
    if (app === 'messages') renderChat();
    if (app === 'music') renderMusic();
    if (app === 'notes') $('notesText').value = S.notes ?? '';
  }
  function closeApp(app) {
    win(app).classList.remove('open');
    document.querySelector(`#dock [data-open="${app}"]`).classList.remove('running');
  }

  // windows: focus on click, drag by the title bar, red light closes
  wins.forEach((w) => {
    w.addEventListener('mousedown', () => focusApp(w.dataset.app));
    w.querySelector('.lights i').addEventListener('click', (e) => { e.stopPropagation(); closeApp(w.dataset.app); });
    w.querySelector('.bar').addEventListener('mousedown', (e) => {
      if (e.target.closest('.lights, button, input')) return;
      const desk = $('macDesk').getBoundingClientRect(), box = w.getBoundingClientRect();
      const dx = e.clientX - box.left, dy = e.clientY - box.top;
      const move = (m) => {
        w.style.left = `${Math.max(-box.width + 80, Math.min(desk.width - 80, m.clientX - desk.left - dx))}px`;
        w.style.top = `${Math.max(0, Math.min(desk.height - 40, m.clientY - desk.top - dy))}px`;
      };
      const stop = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', stop); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', stop);
    });
  });
  document.querySelectorAll('#dock [data-open]').forEach((b) => b.addEventListener('click', () => openApp(b.dataset.open)));

  // ── Messages ──
  function renderChat() {
    const lines = [];
    for (let i = Math.max(0, S.ticket - 2); i < S.ticket; i++) {
      const t = tickets[i % tickets.length];
      lines.push({ from: 'Maya', text: `Could you pick up ${t.id}? "${t.title}"` }, { me: true, text: 'On it.' },
        { from: 'Devon', text: `${t.id} sailed through QA. Nice one!` });
    }
    const next = tickets[S.ticket % tickets.length];
    lines.push({ from: 'Maya', text: `Next up when you're ready: ${next.id}, "${next.title}". No rush.` });
    lines.push(...(S.chat ?? []));
    const log = $('chatLog');
    log.replaceChildren(...lines.map((m) => {
      const row = document.createElement('div');
      row.className = m.me ? 'msg me' : 'msg';
      if (!m.me) row.appendChild(Object.assign(document.createElement('b'), { textContent: m.from }));
      row.appendChild(Object.assign(document.createElement('span'), { textContent: m.text }));
      return row;
    }));
    log.scrollTop = log.scrollHeight;
  }
  function say(message) {
    S.chat = [...(S.chat ?? []), message].slice(-30);
    renderChat();
  }
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    $('chatInput').value = '';
    say({ me: true, text });
    setTimeout(() => say({ from: Math.random() < 0.5 ? 'Maya' : 'Devon', text: REPLIES[Math.floor(Math.random() * REPLIES.length)] }), 900 + Math.random() * 900);
  });

  // ── Music ──
  let track = 0;
  function renderMusic() {
    $('musicTitle').textContent = TRACKS[track];
    $('musicPlay').textContent = S.radioOn ? '❚❚' : '▶';
    $('musicBars').classList.toggle('playing', !!S.radioOn);
  }
  $('musicPlay').addEventListener('click', () => { onRadio(); renderMusic(); });
  $('musicNext').addEventListener('click', () => { track = (track + 1) % TRACKS.length; renderMusic(); });
  $('musicPrev').addEventListener('click', () => { track = (track + TRACKS.length - 1) % TRACKS.length; renderMusic(); });

  // ── Notes ──
  $('notesText').addEventListener('input', () => { S.notes = $('notesText').value; });

  // ── Safari ──
  document.querySelectorAll('#safariNav [data-page]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#safariNav [data-page]').forEach((x) => x.classList.toggle('act', x === b));
    document.querySelectorAll('#safariPages [data-page]').forEach((p) => { p.hidden = p.dataset.page !== b.dataset.page; });
    $('safariUrl').textContent = `docs.cozy.dev/python/${b.dataset.page}`;
  }));

  return {
    openApp,
    show() { $('mac').classList.add('on'); openApp('code'); },
    hide() { $('mac').classList.remove('on'); },
    setClock(text) { $('macClock').textContent = text; },
  };
}
