import { $, el, clamp, clamp01, starRow, setStars, songColor } from './util.js';
import { urls, setMedia, clearMedia, fetchMapAssets, MapLibrary, inSpans } from './data.js';
import { SongTiming, BeatGrid, starsFor } from './timing.js';
import { PlayerScorer, MAX_SCORE } from './player-scorer.js';
import { WakeLock } from './input.js';
import { Settings } from './settings.js';

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const RATING_TEXT = ['X', 'OK', 'GOOD', 'SUPER', 'PERFECT', 'YEAH!'];
const RATING_COLORS = ['var(--red)', 'var(--violet)', 'var(--cyan)', 'var(--green)', 'var(--yellow)', 'var(--gold)'];
const PICTO_POOL = 10;

function waitMedia(media, okEvent, timeoutMs) {
  return new Promise(resolve => {
    if (okEvent === 'canplay' && media.readyState >= 3) return resolve(true);
    if (okEvent === 'loadeddata' && media.readyState >= 2) return resolve(true);
    const done = ok => { clearTimeout(t); media.removeEventListener(okEvent, onOk); media.removeEventListener('error', onErr); resolve(ok); };
    const onOk = () => done(true);
    // o 1º erro pode ser só o CDN recusando: data.setMedia tenta o proxy e marca data-failed se falhar de novo
    const onErr = () => setTimeout(() => { if (media.dataset.failed === '1' || !media.dataset.src) done(false); }, 0);
    const t = setTimeout(() => done(false), timeoutMs);
    media.addEventListener(okEvent, onOk);
    media.addEventListener('error', onErr);
  });
}

/** Tela da partida. Quem dança são os celulares conectados na sala. */
export class GameScreen {
  constructor(app) {
    this.app = app;
    this.video = $('#gameVideo');
    this.audio = $('#gameAudio');
    this.state = 'idle';
    this.session = 0;
    this.raf = 0;
    this.dancers = [];
    this.anchor = { perf: 0, clock: 0 };

    $('#pauseBtn').addEventListener('click', () => { if (this.state === 'playing') this.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    const lane = $('#lane');
    this.pictoEls = Array.from({ length: PICTO_POOL }, () => { const d = el('div', { class: 'picto', hidden: true }); lane.append(d); return d; });
    window.addEventListener('resize', () => this.measureLane());
  }

  get active() { return ['loading', 'starting', 'playing', 'paused'].includes(this.state); }

  // ------------------------------------------------------------ fluxo
  start(song, previewOnly) {
    this.song = song;
    this.previewOnly = previewOnly;
    this.unlockAudio();
    this.load();
  }

  restart() { this.unlockAudio(); this.load(); }

  unlockAudio() {
    const a = this.audio;
    if (!a.src || a.src.startsWith('data:')) { a.src = SILENT_WAV; a.play().then(() => a.pause()).catch(() => {}); }
  }

  async load() {
    const id = ++this.session;
    const alive = () => id === this.session;
    this.stopAll(false);
    this.state = 'loading';
    document.body.classList.add('playing');
    const s = this.song;
    this.overlay(s.title, this.previewOnly ? 'Carregando prévia...' : 'Buscando o mapa no servidor...', [['Cancelar', () => this.quit()]], true);
    this.app.room.setState({ screen: 'loading', title: s.title, artist: s.artist });

    let timing = SongTiming.fromSong(s);
    let videoUrl, audioUrl;
    this.map = null;
    if (this.previewOnly) {
      videoUrl = urls.cdn(s.pv);
      audioUrl = urls.cdn(s.pa);
      this.length = 30;
    } else {
      try {
        const a = await fetchMapAssets(s.map, Settings.get('quality'));
        videoUrl = a.video; audioUrl = a.audio;
      } catch (e) {
        if (!alive()) return;
        this.state = 'error';
        this.overlay('Ops!', `${e.message}.\nA prévia de 30 segundos ainda funciona.`, [
          ['Jogar prévia', () => { this.previewOnly = true; this.restart(); }, 'pink'],
          ['Tentar de novo', () => this.restart()], ['Voltar', () => this.quit()]]);
        return;
      }
      if (MapLibrary.has(s.map)) {
        this.overlayMsg('Carregando coreografia, pictos e movimentos (.msm)...');
        this.map = await MapLibrary.load(s.map).catch(() => null);
        if (!alive()) return;
        if (this.map?.timing.valid) timing = this.map.timing;
      }
      this.length = timing.valid && timing.length > 5 ? timing.length : (s.len > 5 ? s.len : 240);
    }
    if (!alive()) return;

    this.overlayMsg('Carregando vídeo e música...');
    setMedia(this.audio, audioUrl);
    setMedia(this.video, videoUrl);
    this.audio.volume = Settings.get('volume');
    const [audioOk, videoOk] = await Promise.all([waitMedia(this.audio, 'canplay', 40000), waitMedia(this.video, 'loadeddata', 40000)]);
    if (!alive()) return;
    if (!audioOk) {
      this.state = 'error';
      this.overlay('Sem música', 'Não deu pra carregar o áudio dessa coreografia.\nVerifique a conexão e tente de novo.',
        [['Tentar de novo', () => this.restart(), 'pink'], ['Voltar', () => this.quit()]]);
      return;
    }
    this.videoOk = videoOk;

    // ---- batidas e movimentos
    const offset = Settings.get('offsetMs') / 1000;
    if (this.previewOnly) {
      const entry = s.previewEntry || 0;
      this.grid = new BeatGrid(timing, entry, timing.secondsAtBeat(entry), this.length, offset);
      this.videoOffset = 0;
    } else {
      this.grid = new BeatGrid(timing, timing.startBeat, timing.origin, this.length, offset);
      this.videoOffset = timing.videoOffset;
    }
    const coaches = this.map?.coaches || 1;
    const fallbackMoves = () => {
      const first = this.previewOnly ? 1 : Math.max(1, timing.audioTime(0) + offset);
      const b = this.grid.beats, out = [];
      let i = 0;
      while (i < b.length && b[i] < first) i++;
      for (; i + 2 < b.length && b[i + 2] <= this.length - 1.5; i += 2) out.push({ start: b[i], end: b[i + 2], gold: false, name: '' });
      return out;
    };

    // ---- jogadores: cada celular conectado dança um coach
    const players = this.app.room.connected;
    this.dancers = players.map((p, i) => {
      const coach = i % coaches;
      const moves = this.map?.moves.length
        ? this.map.movesFor(coach).map(m => ({ start: m.start + offset, end: m.end + offset, gold: m.gold, name: m.name }))
        : fallbackMoves();
      const scorer = new PlayerScorer(moves, this.map?.bank || null, Settings.get('axes'));
      return { player: p, coach, scorer, shown: 0, lastStars: -1, el: null };
    });
    this.realMoves = !!(this.map?.bank && this.dancers.some(d => d.scorer.withClassifier));
    this.buildPlayerHud();
    this.setupMapHud();
    this.resetHud();
    for (const d of this.dancers)
      this.app.room.send(d.player, { t: 'state', screen: 'playing', title: s.title, artist: s.artist, coach: d.coach + 1, coaches, msm: this.realMoves });
    this.app.room.state = { screen: 'playing', title: s.title, artist: s.artist };

    this.hint(this.realMoves ? 'Segure o celular na mão direita, com a tela virada para você, e siga o coach!'
      : 'Música sem .msm convertido: nota pela energia do movimento', 6);
    if (!this.videoOk) this.hint('Vídeo indisponível neste navegador — siga o ritmo da música', 6);

    WakeLock.on();
    this.clock = 0;
    this.anchor = { perf: performance.now(), clock: 0 };
    this.hideOverlay();
    this.state = 'starting';
    this.playAudio();
    this.loop();
  }

  playAudio() {
    this.audio.play().catch(() => {
      if (this.state !== 'starting') return;
      this.overlay('Pronto?', 'Clique na tela do computador para começar a música.', [['COMEÇAR', () => { this.hideOverlay(); this.playAudio(); }, 'pink']]);
    });
  }

  loop() {
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const frame = now => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this.state === 'starting' && !this.audio.paused && this.audio.currentTime > 0) this.state = 'playing';
      if (this.state === 'playing') this.tick(dt, now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Amostras do celular chegam com o tempo já no relógio desta tela (performance.now). */
  onSamples(player, samples) {
    if (this.state !== 'playing') return;
    const d = this.dancers.find(x => x.player === player);
    if (!d) return;
    const a = this.anchor;
    d.scorer.addSamples(samples.map(s => ({ t: a.clock + (s.h - a.perf) / 1000, x: s.x, y: s.y, z: s.z })));
  }

  tick(dt, now) {
    const raw = this.audio.currentTime;
    this.clock += dt;
    const diff = raw - this.clock;
    if (Math.abs(diff) > 0.15) this.clock = raw; else this.clock += diff * 0.1;
    const t = this.clock;
    this.anchor = { perf: now, clock: t };

    if (this.videoOk) {
      const vt = t + this.videoOffset + Settings.get('videoOffsetMs') / 1000;
      const v = this.video;
      if (vt >= 0 && v.paused) { v.currentTime = vt; v.play().catch(() => {}); }
      if (!v.paused) {
        const drift = v.currentTime - vt;
        if (Math.abs(drift) > 0.35) { v.currentTime = vt; v.playbackRate = 1; }
        else if (Math.abs(drift) > 0.04) v.playbackRate = clamp(1 - drift * 0.6, 0.94, 1.06);
        else v.playbackRate = 1;
      }
    }

    for (const d of this.dancers) {
      for (const ev of d.scorer.update(t)) {
        this.showFeedback(d, ev);
        this.app.room.send(d.player, { t: 'rate', r: ev.r, gold: ev.gold, score: d.scorer.scoreInt, combo: d.scorer.combo });
      }
    }
    this.tickMapHud(t);
    this.updateHud(t, dt);

    const done = this.dancers.every(d => d.scorer.finished);
    if (this.audio.ended || t >= this.length || (done && t >= this.length - 1)) this.finish();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.pause();
    this.video.pause();
    this.app.room.broadcast({ t: 'state', screen: 'paused', title: this.song.title, artist: this.song.artist });
    this.overlay('Pausado', `${this.song.title} - ${this.song.artist}`,
      [['Continuar', () => this.resume(), 'pink'], ['Reiniciar', () => this.restart()], ['Sair', () => this.quit()]]);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.hideOverlay();
    this.state = 'starting';
    this.clock = this.audio.currentTime;
    for (const d of this.dancers) this.app.room.send(d.player, { t: 'state', screen: 'playing', title: this.song.title, artist: this.song.artist, coach: d.coach + 1, msm: this.realMoves });
    this.playAudio();
  }

  finish() {
    this.state = 'done';
    const ranking = this.dancers.map(d => {
      const score = d.scorer.scoreInt;
      const record = !this.previewOnly && Settings.submitScore(`${this.song.id}:${d.player.name}`, score);
      return { name: d.player.name, color: d.player.color, slot: d.player.slot, coach: d.coach, score, stars: starsFor(score), record,
        counts: d.scorer.counts, goldHits: d.scorer.goldHits, goldTotal: d.scorer.goldTotal, bestCombo: d.scorer.bestCombo, player: d.player };
    }).sort((a, b) => b.score - a.score);
    ranking.forEach((r, i) => {
      r.rank = i + 1;
      this.app.room.send(r.player, { t: 'result', score: r.score, stars: r.stars, rank: r.rank, total: ranking.length, counts: r.counts, gold: [r.goldHits, r.goldTotal], record: r.record });
    });
    this.stopAll(true);
    this.app.showResults({ song: this.song, previewOnly: this.previewOnly, realMoves: this.realMoves, ranking });
  }

  quit() {
    this.session++;
    this.stopAll(true);
    this.app.show('select');
  }

  stopAll(leaving) {
    cancelAnimationFrame(this.raf);
    clearMedia(this.audio);
    clearMedia(this.video);
    this.video.playbackRate = 1;
    WakeLock.off();
    if (leaving) {
      if (this.state !== 'done') this.state = 'idle';
      document.body.classList.remove('playing');
      this.hideOverlay();
    }
  }

  /** Teclado do PC ou controle remoto do celular. */
  onKey(key) {
    if (key === 'Escape' || key === 'back') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'error' || this.state === 'loading') this.quit();
      return true;
    }
    if ((key === 'Enter' || key === 'ok') && this.state === 'paused') { this.resume(); return true; }
    if ((key === 'Enter' || key === 'ok') && !$('#overlay').hidden) { $('#ovButtons .btn')?.click(); return true; }
    return false;
  }

  // ------------------------------------------------------------ HUD dos jogadores
  buildPlayerHud() {
    const box = $('#hudPlayers');
    box.replaceChildren();
    for (const d of this.dancers) {
      const stars = el('span', { class: 'stars' });
      starRow(stars);
      const card = el('div', { class: 'pcard', style: `--pc:${d.player.color}` },
        el('div', { class: 'pc-top' }, el('span', { class: 'pc-name' }, d.player.name), el('span', { class: 'pc-score' }, '0')),
        el('div', { class: 'pc-bar' }, el('div')),
        el('div', { class: 'pc-bottom' }, stars, el('span', { class: 'pc-coach' }, (this.map?.coaches || 1) > 1 ? `Coach ${d.coach + 1}` : '')),
        el('div', { class: 'pc-level' }, el('div')),
        el('div', { class: 'pc-feedback' }));
      d.el = card;
      d.ui = {
        score: card.querySelector('.pc-score'), bar: card.querySelector('.pc-bar > div'), stars,
        level: card.querySelector('.pc-level > div'), fb: card.querySelector('.pc-feedback'),
      };
      box.append(card);
    }
  }

  showFeedback(d, ev) {
    const f = d.ui.fb;
    f.textContent = RATING_TEXT[ev.r];
    f.style.color = RATING_COLORS[ev.r];
    f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop');
  }

  resetHud() {
    this.lyricKey = '';
    $('#hint').textContent = '';
    $('#progress').style.width = '0%';
    $('#hudSong').textContent = `${this.song.title}  ·  ${this.song.artist}${this.previewOnly ? '  (prévia)' : ''}`;
    $('#goldLabel').hidden = true;
    $('#goldVignette').classList.remove('on');
  }

  updateHud(t, dt) {
    for (const d of this.dancers) {
      const sc = d.scorer.scoreInt;
      d.shown += (sc - d.shown) * Math.min(1, dt * 6);
      if (Math.abs(sc - d.shown) < 1) d.shown = sc;
      d.ui.score.textContent = Math.round(d.shown);
      d.ui.bar.style.width = `${clamp01(d.shown / MAX_SCORE) * 100}%`;
      const st = starsFor(sc);
      if (st !== d.lastStars) { d.lastStars = st; setStars(d.ui.stars, Math.min(5, st), st >= 6); }
      d.ui.level.style.width = `${clamp01(d.scorer.lastLevel) * 100}%`;
      d.el.classList.toggle('offline', !d.player.connected);
    }
    $('#progress').style.width = `${clamp01(t / this.length) * 100}%`;
    const ph = this.grid.phase(t);
    $('#pulse').style.transform = `scale(${0.75 + (1 - ph) ** 2 * 0.35})`;
    if (this.hintUntil && performance.now() > this.hintUntil) { $('#hint').textContent = ''; this.hintUntil = 0; }
  }

  hint(text, seconds) {
    $('#hint').textContent = text;
    this.hintUntil = performance.now() + seconds * 1000;
  }

  // ------------------------------------------------------------ pictos, letra, gold
  setupMapHud() {
    const m = this.map;
    const hasPictos = !!(m && m.pictos.length && m.atlasUrl);
    $('#lane').hidden = !hasPictos;
    $('#lyrics').hidden = !(m && m.lines.length);
    $('#lyrics').style.setProperty('--lyric', songColor(this.song, 0.85, 1));
    this.lineCursor = 0;
    this.lead = clamp(this.grid.interval * 3, 1.2, 2.2);
    for (const d of this.pictoEls) { d.hidden = true; d.style.backgroundImage = hasPictos ? `url("${m.atlasUrl}")` : ''; }
    this.measureLane();
  }

  measureLane() {
    const lane = $('#lane'), target = $('#laneTarget');
    this.laneW = lane.clientWidth || 560;
    this.pictoH = target.clientHeight || 148;
    this.targetX = target.offsetLeft || 12;
  }

  tickMapHud(t) {
    const m = this.map;
    if (!m) return;
    const hidden = inSpans(m.hideHud, t);
    $('#lane').classList.toggle('faded', hidden);
    $('#lyrics').classList.toggle('faded', hidden);
    const gold = inSpans(m.gold, t);
    $('#goldVignette').classList.toggle('on', gold);
    $('#goldLabel').hidden = !gold;

    if (!$('#lane').hidden) {
      let used = 0, onTarget = false;
      const H = this.pictoH, atlas = m.atlas;
      for (const p of m.pictos) {
        if (p.start - this.lead > t) break;
        if (t >= p.start && t <= p.end) onTarget = true;
        if (t > p.end + 0.35 || used >= PICTO_POOL) continue;
        const d = this.pictoEls[used++];
        const scale = H / p.rect[3];
        const w = p.rect[2] * scale;
        const travel = this.laneW - this.targetX - w * 0.8;
        const x = t < p.start ? this.targetX + ((p.start - t) / this.lead) * travel : this.targetX;
        const alpha = t > p.end ? clamp01(1 - (t - p.end) / 0.35) : 1;
        const pop = t >= p.start && t < p.start + 0.15 ? 1.12 : 1;
        d.style.width = `${w}px`;
        d.style.height = `${H}px`;
        d.style.backgroundSize = `${atlas.w * scale}px ${atlas.h * scale}px`;
        d.style.backgroundPosition = `${-p.rect[0] * scale}px ${-p.rect[1] * scale}px`;
        d.style.transform = `translateX(${x}px) scale(${pop})`;
        d.style.opacity = alpha;
        d.classList.toggle('gold', p.gold);
        d.hidden = false;
      }
      for (let i = used; i < PICTO_POOL; i++) this.pictoEls[i].hidden = true;
      $('#laneTarget').classList.toggle('on', onTarget);
    }

    if (!$('#lyrics').hidden) {
      const lines = m.lines;
      while (this.lineCursor < lines.length && t > lines[this.lineCursor].end + 0.6) this.lineCursor++;
      const cur = lines[this.lineCursor];
      let key, html = '', next = '';
      if (!cur) key = 'end';
      else if (t < cur.start - 2.5) { key = `w${this.lineCursor}`; next = plain(cur); }
      else {
        const sung = cur.words.filter(w => t >= w.start).length;
        key = `${this.lineCursor}:${sung}`;
        html = cur.words.map((w, i) => (i < sung ? `<span class="sung">${esc(w.text)}</span>` : esc(w.text))).join('');
        next = lines[this.lineCursor + 1] ? plain(lines[this.lineCursor + 1]) : '';
      }
      if (key !== this.lyricKey) {
        this.lyricKey = key;
        $('#lyrics').classList.toggle('empty', !html && !next);
        $('#lyricLine').innerHTML = html;
        $('#lyricNext').textContent = next;
      }
    }
  }

  // ------------------------------------------------------------ overlay
  overlay(title, msg, buttons = [], spinner = false) {
    $('#overlay').hidden = false;
    $('#ovTitle').textContent = title;
    $('#ovMsg').textContent = msg;
    const box = $('#ovButtons');
    box.replaceChildren();
    if (spinner) box.append(el('div', { class: 'spinner', style: 'flex-basis:100%' }));
    buttons.forEach(([label, fn, cls], i) =>
      box.append(el('button', { class: `btn big ${cls || (i === 0 && !spinner ? 'pink' : 'purple')}`, onclick: fn }, label)));
  }
  overlayMsg(msg) { $('#ovMsg').textContent = msg; }
  hideOverlay() { $('#overlay').hidden = true; }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const plain = line => line.words.map(w => w.text).join('');
