import { $, $$ } from './util.js';
import { loadSongDb, MapLibrary } from './data.js';
import { Settings, controlLabel } from './settings.js';
import { SelectScreen } from './select.js';
import { GameScreen } from './game.js';
import { ResultsScreen } from './results.js';
import { SettingsPanel } from './settings-panel.js';

// Dance Next Now — versão HTML. Telas: title → select → game → results.
const app = {
  songs: [],
  current: null,
  show(name) {
    for (const s of $$('.screen')) s.hidden = s.id !== name;
    if (this.current && this.current !== name) this.screens[this.current]?.hide?.();
    this.current = name;
    this.screens[name]?.show?.();
  },
  startGame(song, previewOnly, coach) {
    this.last = { song, previewOnly, coach };
    this.show('game');
    this.game.start(song, previewOnly, coach);
  },
  replay() {
    const l = this.last;
    if (l) this.startGame(l.song, l.previewOnly, l.coach);
  },
  showResults(res) {
    this.show('results');
    this.results.show(res);
  },
  onSettingsClosed() { if (this.current === 'select') this.select.updateDetail(); updateTitleStatus(); },
};

app.select = new SelectScreen(app);
app.game = new GameScreen(app);
app.results = new ResultsScreen(app);
app.settings = new SettingsPanel(app);
app.screens = { title: null, select: app.select, game: null, results: { hide: () => app.results.hide() } };

for (const b of $$('[data-action="settings"]')) b.addEventListener('click', () => app.settings.open());
for (const b of $$('[data-action="back"]')) b.addEventListener('click', () => app.show('title'));
$('#startBtn').addEventListener('click', () => app.show('select'));

function updateTitleStatus() {
  if (!app.songs.length) return;
  const full = MapLibrary.index.size;
  $('#titleStatus').textContent = `${app.songs.length} músicas${full ? ` · ${full} com coreografia completa` : ''} · ${controlLabel(Settings.get('control'))}`;
}

document.addEventListener('keydown', e => {
  if (app.settings.visible) { if (e.key === 'Escape') app.settings.close(); return; }
  let handled = false;
  if (app.current === 'game') handled = app.game.onKey(e);
  else if (app.current === 'select') {
    handled = app.select.onKey(e);
    if (!handled && e.key === 'Escape') { app.show('title'); handled = true; }
  } else if (app.current === 'results' && e.key === 'Escape') { app.show('select'); handled = true; }
  else if (app.current === 'title' && (e.key === 'Enter' || e.key === ' ') && !$('#startBtn').disabled) { app.show('select'); handled = true; }
  if (handled) e.preventDefault();
});

let rafTick = () => { if (app.current === 'select') app.select.tick(); requestAnimationFrame(rafTick); };
requestAnimationFrame(rafTick);

app.show('title');
(async () => {
  try {
    const [songs] = await Promise.all([loadSongDb(), MapLibrary.loadIndex()]);
    app.songs = songs;
    $('#startBtn').disabled = false;
    $('#startBtn').textContent = 'TOQUE PARA DANÇAR';
    updateTitleStatus();
  } catch (e) {
    $('#titleStatus').textContent = `Não foi possível carregar a lista de músicas (${e.message}).`;
  }
})();
