import { $, $$, el } from './util.js';
import { loadSongDb, MapLibrary } from './data.js';
import { Room } from './room.js';
import { joinUrl, drawQr } from './net.js';
import { SelectScreen } from './select.js';
import { GameScreen } from './game.js';
import { ResultsScreen } from './results.js';
import { SettingsPanel } from './settings-panel.js';

// Dance Next Now — TELA (PC/TV). Os celulares entram pela sala (controller.html).
const app = {
  songs: [],
  current: null,
  show(name) {
    for (const s of $$('.screen')) s.hidden = s.id !== name;
    if (this.current && this.current !== name) this.screens[this.current]?.hide?.();
    this.current = name;
    this.screens[name]?.show?.();
    if (name !== 'game' && name !== 'results') this.room.setState({ screen: name === 'select' ? 'select' : 'lobby' });
    renderPlayers();
  },
  startGame(song, previewOnly) {
    this.last = { song, previewOnly };
    this.show('game');
    this.game.start(song, previewOnly);
  },
  replay() {
    if (!this.last) return;
    if (!this.room.connected.length) { this.show('select'); this.toast('Nenhum celular conectado'); return; }
    this.startGame(this.last.song, this.last.previewOnly);
  },
  showResults(res) {
    this.show('results');
    this.results.show(res);
    this.room.setState({ screen: 'results', title: res.song.title });
  },
  onSettingsClosed() { if (this.current === 'select') this.select.updateDetail(); },
  toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  },
  invite: {
    open() { $('#invite').hidden = false; },
    close() { $('#invite').hidden = true; },
    get visible() { return !$('#invite').hidden; },
  },
};

// ---------------------------------------------------------------- sala
app.room = new Room({
  onChange: () => renderPlayers(),
  onSamples: (p, samples) => app.game.onSamples(p, samples),
  onPause: () => { if (app.current === 'game') app.game.onKey('back'); },
  onNav: (p, key) => handleKey(key, true),
});

function renderPlayers() {
  const room = app.room;
  const players = room.players;
  const chips = () => players.length
    ? players.map(p => el('span', { class: 'pchip' + (p.connected ? '' : ' off'), style: `--pc:${p.color}` }, p.name))
    : [el('span', { class: 'dim' }, room.status === 'open' ? 'Aguardando celulares...' : room.status === 'error' ? `Sala indisponível: ${room.error}` : 'Criando a sala...')];
  $('#titlePlayers').replaceChildren(...chips());
  $('#invitePlayers').replaceChildren(...chips());
  $('#selectPlayers').replaceChildren(...players.filter(p => p.connected).map(p => el('i', { style: `background:${p.color}`, title: p.name })));
  if (app.current === 'select') app.select.updatePlayers();
  updateTitleStatus();
}

function showRoomCode(code) {
  for (const e of $$('#roomCode, .roomCodeText')) e.textContent = code;
  const url = joinUrl(code);
  const pretty = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  $('#joinUrl').textContent = `ou abra ${pretty} e digite o código`;
  $('#inviteUrl').textContent = `ou abra ${pretty} e digite o código`;
  drawQr($('#titleQr'), url);
  drawQr($('#inviteQr'), url);
}

// ---------------------------------------------------------------- telas
app.select = new SelectScreen(app);
app.game = new GameScreen(app);
app.results = new ResultsScreen(app);
app.settings = new SettingsPanel(app);
app.screens = { title: null, select: app.select, game: null, results: { hide: () => app.results.hide() } };

for (const b of $$('[data-action="settings"]')) b.addEventListener('click', () => app.settings.open());
for (const b of $$('[data-action="back"]')) b.addEventListener('click', () => app.show('title'));
for (const b of $$('[data-action="invite"]')) b.addEventListener('click', () => app.invite.open());
for (const b of $$('[data-action="close-invite"]')) b.addEventListener('click', () => app.invite.close());
$('#invite').addEventListener('click', e => { if (e.target.id === 'invite') app.invite.close(); });
$('#startBtn').addEventListener('click', () => app.show('select'));

function updateTitleStatus() {
  if (!app.songs.length) return;
  const full = MapLibrary.index.size;
  const n = app.room.connected.length;
  $('#titleStatus').textContent = `${app.songs.length} músicas${full ? ` · ${full} com coreografia completa` : ''} · ${n} ${n === 1 ? 'celular conectado' : 'celulares conectados'}`;
}

/** Teclas do PC e do controle remoto do celular (left/right/up/down/ok/back). */
function handleKey(key, fromPhone) {
  if (app.settings.visible) { if (key === 'Escape' || key === 'back' || key === 'ok') app.settings.close(); return true; }
  if (app.invite.visible) { if (['Escape', 'back', 'ok', 'Enter'].includes(key)) app.invite.close(); return true; }
  switch (app.current) {
    case 'game': return app.game.onKey(key);
    case 'select':
      if (app.select.onKey(key, fromPhone)) return true;
      if (key === 'Escape' || key === 'back') { app.show('title'); return true; }
      return false;
    case 'results': return app.results.onKey(key);
    case 'title':
      if ((key === 'Enter' || key === ' ' || key === 'ok') && !$('#startBtn').disabled) { app.show('select'); return true; }
      return false;
  }
  return false;
}

document.addEventListener('keydown', e => {
  if (app.current === 'select' && document.activeElement === $('#search') && e.key !== 'Escape') return;
  if (handleKey(e.key, false)) e.preventDefault();
});

const rafTick = () => { if (app.current === 'select') app.select.tick(); requestAnimationFrame(rafTick); };
requestAnimationFrame(rafTick);

app.show('title');
app.room.open().then(showRoomCode).catch(e => { console.error(e); renderPlayers(); });
(async () => {
  try {
    const [songs] = await Promise.all([loadSongDb(), MapLibrary.loadIndex()]);
    app.songs = songs;
    $('#startBtn').disabled = false;
    $('#startBtn').textContent = 'ESCOLHER MÚSICA';
    updateTitleStatus();
  } catch (e) {
    $('#titleStatus').textContent = `Não foi possível carregar a lista de músicas (${e.message}).`;
  }
})();
window.__dnn = app; // depuração
