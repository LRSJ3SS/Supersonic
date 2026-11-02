import { $, el, songColor, fmtTime } from './util.js';
import { CATEGORIES, filterSongs, MapLibrary, setMedia, clearMedia, urls } from './data.js';
import { Settings } from './settings.js';
import { starLabel } from './timing.js';

/** Tela de escolha: grade de cartões + painel com prévia em vídeo/áudio. */
export class SelectScreen {
  constructor(app) {
    this.app = app;
    this.root = $('#select');
    this.grid = $('#grid');
    this.search = $('#search');
    this.video = $('#previewVideo');
    this.audio = $('#previewAudio');
    this.hint = $('#previewHint');
    this.category = 'Todas';
    this.list = [];
    this.index = -1;
    this.coach = 0;
    this.previewTimer = 0;
    this.previewSong = null;

    this.search.addEventListener('input', () => this.applyFilter(true));
    this.search.addEventListener('keydown', e => { if (e.key === 'Enter') this.search.blur(); });
    this.grid.addEventListener('click', e => {
      const card = e.target.closest('.card');
      if (!card) return;
      const i = +card.dataset.i;
      if (i === this.index) this.play(false); // segundo toque = dançar
      else this.select(i, false);
    });
    $('#playBtn').addEventListener('click', () => this.play(false));
    $('#previewBtn').addEventListener('click', () => this.play(true));
    this.video.addEventListener('playing', () => { this.hint.textContent = ''; });
    this.video.addEventListener('error', () => { if (this.previewSong) this.hint.textContent = 'Prévia indisponível'; });
  }

  get current() { return this.list[this.index] || null; }

  buildChips() {
    const chips = $('#chips');
    chips.innerHTML = '';
    for (const c of CATEGORIES) {
      const count = filterSongs(this.app.songs, '', c).length;
      if (c === 'Completas' && !count) continue;
      chips.append(el('button', {
        class: 'chip' + (c === this.category ? ' on' : ''), 'data-c': c,
        onclick: () => { this.category = c; this.applyFilter(true); },
      }, c, el('small', {}, String(count))));
    }
  }

  show() {
    if (!this.list.length) {
      this.buildChips();
      this.applyFilter(false);
      if (this.list.length) this.select(Math.floor(Math.random() * this.list.length), true); // música surpresa
    } else {
      this.select(this.index, true);
    }
  }

  hide() { this.stopPreview(); }

  applyFilter(keep) {
    const prev = keep ? this.current : null;
    this.list = filterSongs(this.app.songs, this.search.value, this.category);
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.c === this.category));
    const frag = document.createDocumentFragment();
    this.list.forEach((s, i) => {
      const full = MapLibrary.has(s.map);
      const tag = full ? el('span', { class: 'tag full' }, 'COMPLETA')
        : s.tags.includes('Alternate') ? el('span', { class: 'tag' }, 'ALT')
        : s.tags.includes('Extreme') ? el('span', { class: 'tag' }, 'EXTREME') : null;
      frag.append(el('button', { class: 'card', 'data-i': i, role: 'option', style: `--c:${songColor(s)}` },
        el('span', { class: 'ver' }, s.versionLabel), tag,
        el('span', { class: 't' }, s.title), el('span', { class: 'a' }, s.artist)));
    });
    this.grid.replaceChildren(frag);
    if (!this.list.length) this.grid.append(el('div', { class: 'empty' }, 'Nenhuma música encontrada'));
    const idx = prev ? this.list.indexOf(prev) : -1;
    this.index = -1;
    this.select(idx >= 0 ? idx : 0, true);
  }

  select(i, scroll) {
    if (!this.list.length) { this.index = -1; this.updateDetail(); return; }
    i = Math.max(0, Math.min(this.list.length - 1, i));
    this.grid.querySelector('.card.sel')?.classList.remove('sel');
    const changed = i !== this.index;
    this.index = i;
    const card = this.grid.children[i];
    card?.classList.add('sel');
    if (scroll) card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.updateDetail();
  }

  updateDetail() {
    const s = this.current;
    if (!s) {
      $('#dTitle').textContent = 'Nenhuma música'; $('#dArtist').textContent = 'Tente outra busca';
      $('#dBadges').textContent = ''; $('#dBest').textContent = '';
      this.stopPreview();
      return;
    }
    const full = MapLibrary.has(s.map);
    $('#dTitle').textContent = s.title;
    $('#dArtist').textContent = s.artist;
    $('#dBadges').textContent = [full ? 'COREOGRAFIA COMPLETA' : null, s.versionLabel, s.coachLabel,
      `Dificuldade ${s.diff}/4`, `Esforço ${s.sweat}/3`, fmtTime(s.len)].filter(Boolean).join('  ·  ');
    const best = Settings.bestForSong(s.id);
    $('#dBest').textContent = best.score ? `Recorde: ${best.score} · ${best.name} (${starLabel(best.score)})` : 'Ainda sem recorde';
    $('#dColor').style.background = songColor(s);
    this.updatePlayers();

    if (s !== this.previewSong) {
      this.stopPreview();
      this.hint.textContent = 'Carregando prévia...';
      this.previewTimer = setTimeout(() => this.startPreview(s), 350);
    }
  }

  startPreview(s) {
    this.previewSong = s;
    setMedia(this.video, urls.cdn(s.pv), { autoplay: true });
    setMedia(this.audio, urls.cdn(s.pa), { autoplay: true });
    this.audio.volume = Settings.get('volume') * 0.7;
    this.video.play().catch(() => {});
    this.audio.play().catch(() => { this.hint.textContent = this.hint.textContent || 'Toque para ouvir'; });
  }

  stopPreview() {
    clearTimeout(this.previewTimer);
    this.previewSong = null;
    clearMedia(this.video);
    clearMedia(this.audio);
  }

  /** mantém o vídeo da prévia colado no áudio */
  tick() {
    if (!this.previewSong || this.audio.paused || this.video.paused) return;
    const drift = this.video.currentTime - this.audio.currentTime;
    if (Math.abs(drift) > 0.3 && this.audio.currentTime > 0.2) this.video.currentTime = this.audio.currentTime;
  }

  /** Mostra quem vai dançar e com qual coach. */
  updatePlayers() {
    const s = this.current;
    const players = this.app.room?.connected || [];
    const box = $('#dPlayers');
    if (!players.length) {
      box.textContent = 'Nenhum celular conectado — clique em SALA para convidar';
      box.classList.add('warn');
      return;
    }
    box.classList.remove('warn');
    const coaches = s && MapLibrary.has(s.map) ? Math.max(1, s.coaches) : 1;
    box.replaceChildren(...players.map((p, i) => el('span', { class: 'pchip', style: `--pc:${p.color}` },
      p.name + (coaches > 1 ? ` · coach ${(i % coaches) + 1}` : ''))));
  }

  play(previewOnly) {
    const s = this.current;
    if (!s) return;
    if (!this.app.room?.connected.length) { this.app.toast('Conecte pelo menos um celular na sala para dançar'); this.app.invite.open(); return; }
    this.stopPreview();
    this.app.startGame(s, previewOnly);
  }

  columns() {
    const cols = getComputedStyle(this.grid).gridTemplateColumns.split(' ').length;
    return Math.max(1, cols);
  }

  /** Teclado do PC (fromPhone=false) ou controle remoto do celular. */
  onKey(key, fromPhone = false) {
    if (!fromPhone && document.activeElement === this.search) return false;
    const map = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', ok: 'Enter', back: 'Escape' };
    key = map[key] || key;
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: this.columns(), ArrowUp: -this.columns() };
    if (key in moves) { this.select(this.index + moves[key], true); return true; }
    if (key === 'Enter') { this.play(false); return true; }
    if (key === '/') { this.search.focus(); return true; }
    return false;
  }
}
