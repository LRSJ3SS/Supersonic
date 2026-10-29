import { $, el, clamp, clamp01, starRow, setStars, songColor, sleep } from './util.js';
import { urls, setMedia, clearMedia, fetchMapAssets, MapLibrary, inSpans } from './data.js';
import { SongTiming, BeatGrid, Scorer, RATINGS, R, MAX_SCORE, starsFor } from './timing.js';
import { MotionInput, CameraInput, requestMotionPermission, WakeLock } from './input.js';
import { Settings } from './settings.js';

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const RATING_COLORS = ['var(--red)', 'var(--violet)', 'var(--cyan)', 'var(--green)', 'var(--yellow)', 'var(--gold)'];
const PICTO_POOL = 10;

/** Esperar um evento de mídia (ou erro/tempo esgotado). */
function waitMedia(media, okEvent, timeoutMs) {
  return new Promise(resolve => {
    if (okEvent === 'canplay' && media.readyState >= 3) return resolve(true);
    if (okEvent === 'loadeddata' && media.readyState >= 2) return resolve(true);
    const done = ok => { clearTimeout(t); media.removeEventListener(okEvent, onOk); media.removeEventListener('error', onErr); resolve(ok); };
    const onOk = () => done(true);
    // o primeiro erro pode ser só o CDN direto recusando: data.setMedia tenta o proxy
    // e só marca data-failed quando o proxy também falha
    const onErr = () => setTimeout(() => { if (media.dataset.failed === '1' || !media.dataset.src) done(false); }, 0);
    const t = setTimeout(() => done(false), timeoutMs);
    media.addEventListener(okEvent, onOk);
    media.addEventListener('error', onErr);
  });
}

export class GameScreen {
  constructor(app) {
    this.app = app;
    this.video = $('#gameVideo');
    this.audio = $('#gameAudio');
    this.motion = new MotionInput();
    this.camera = new CameraInput($('#camVideo'));
    this.state = 'idle';
    this.session = 0;
    this.raf = 0;

    starRow($('#hudStars'));
    $('#pauseBtn').addEventListener('click', () => { if (this.state === 'playing') this.pause(); });
    $('#tapZone').addEventListener('pointerdown', () => this.tap());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });

    const lane = $('#lane');
    this.pictoEls = Array.from({ length: PICTO_POOL }, () => { const d = el('div', { class: 'picto', hidden: true }); lane.append(d); return d; });
    window.addEventListener('resize', () => this.measureLane());
  }

  // ------------------------------------------------------------ fluxo
  /** Chamado direto do clique em "DANÇAR!" (gesto do usuário destrava áudio e sensor no iOS). */
  start(song, previewOnly, coach = 0) {
    this.song = song;
    this.previewOnly = previewOnly;
    this.coach = coach;
    this.unlockInGesture();
    this.load();
  }

  restart() { this.unlockInGesture(); this.load(); }

  unlockInGesture() {
    const a = this.audio;
    if (!a.src || a.src.startsWith('data:')) {
      a.src = SILENT_WAV;
      a.play().then(() => a.pause()).catch(() => {});
    }
    if (Settings.get('control') === 'motion') this.motionPermission = requestMotionPermission();
  }

  async load() {
    const id = ++this.session;
    const alive = () => id === this.session;
    this.stopAll(false);
    this.state = 'loading';
    document.body.classList.add('playing');
    this.resetHud();
    const s = this.song;
    this.overlay(s.title, this.previewOnly ? 'Carregando prévia...' : 'Buscando o mapa no servidor...', [['Cancelar', () => this.quit()]], true);

    // ---- de onde vem o vídeo/áudio
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
        this.overlayMsg('Carregando coreografia (moves e pictos)...');
        this.map = await MapLibrary.load(s.map).catch(() => null);
        if (!alive()) return;
        if (this.map?.timing.valid) timing = this.map.timing;
      }
      this.length = timing.valid && timing.length > 5 ? timing.length : (s.len > 5 ? s.len : 240);
    }
    if (!alive()) return;

    // ---- carrega mídia
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

    // ---- controle
    this.mode = Settings.get('control');
    let notice = null;
    if (this.mode === 'motion') {
      const perm = await (this.motionPermission || requestMotionPermission());
      this.motion.start();
      if (perm === 'granted') {
        const t0 = performance.now();
        while (!this.motion.receiving && performance.now() - t0 < 2500 && alive()) await sleep(100);
      }
      if (!this.motion.receiving) {
        this.motion.stop();
        this.mode = 'tap';
        notice = 'Sensor de movimento indisponível: toque na tela ou aperte ESPAÇO no ritmo';
      }
    } else if (this.mode === 'camera') {
      this.overlayMsg('Permita o uso da câmera. Afaste-se até aparecer de corpo inteiro.');
      try {
        await this.camera.start(Settings.get('cameraPreview'));
        const t0 = performance.now();
        while (!this.camera.receiving && performance.now() - t0 < 5000 && alive()) await sleep(100);
        if (!this.camera.receiving) throw new Error();
      } catch {
        this.camera.stop();
        this.mode = 'tap';
        notice = 'Câmera indisponível: toque na tela ou aperte ESPAÇO no ritmo';
      }
    }
    if (!alive()) return;

    // ---- batidas e pontuação
    const offset = Settings.get('offsetMs') / 1000;
    if (this.previewOnly) {
      const entry = s.previewEntry || 0;
      this.grid = new BeatGrid(timing, entry, timing.secondsAtBeat(entry), this.length, offset);
      this.videoOffset = 0; // a prévia em vídeo é cortada no mesmo ponto do áudio
      this.scorer = new Scorer(this.grid, this.mode, Scorer.beatWindows(this.grid, 1 + offset, this.length - 1));
    } else {
      this.grid = new BeatGrid(timing, timing.startBeat, timing.origin, this.length, offset);
      this.videoOffset = timing.videoOffset;
      if (this.map?.moves.length) {
        const coach = clamp(this.coach, 0, this.map.coaches - 1);
        const moves = this.map.movesFor(coach).map(m => ({ start: m.start + offset, end: m.end + offset, gold: m.gold }));
        this.scorer = new Scorer(this.grid, this.mode, moves, true);
      } else {
        const first = Math.max(1, timing.audioTime(0) + offset);
        this.scorer = new Scorer(this.grid, this.mode, Scorer.beatWindows(this.grid, first, this.length - 1.5));
      }
    }
    this.scorer.onRated = (r, gold) => this.onRated(r, gold);
    this.setupMapHud();

    this.hint(notice || ({
      motion: 'Segure o celular na mão direita e siga o coach!',
      camera: 'Dance de corpo inteiro na frente da câmera!',
      tap: 'Toque na tela ou aperte ESPAÇO em cada batida!',
    })[this.mode], 6);
    if (!this.videoOk) this.hint('Vídeo indisponível neste navegador — siga o ritmo da música', 6);
    else if (innerHeight > innerWidth && this.mode !== 'motion') this.hint('Dica: deite o celular para ver o coach maior', 5);

    WakeLock.on();
    this.clock = 0;
    this.hideOverlay();
    this.state = 'starting';
    this.playAudio();
    this.loop();
  }

  playAudio() {
    this.audio.play().catch(err => {
      if (this.state !== 'starting') return;
      this.overlay('Pronto?', 'Toque para começar!', [['COMEÇAR', () => { this.hideOverlay(); this.playAudio(); }, 'pink']]);
      if (err?.name !== 'NotAllowedError') console.warn(err);
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
      if (this.state === 'playing') this.tick(dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  tick(dt) {
    // relógio suave a partir do currentTime do <audio>
    const raw = this.audio.currentTime;
    this.clock += dt;
    const diff = raw - this.clock;
    if (Math.abs(diff) > 0.15) this.clock = raw; else this.clock += diff * 0.1;
    const t = this.clock;

    // vídeo começa em videoStartTime; áudio no startBeat
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

    if (this.mode === 'motion') this.scorer.addEnergy(t, this.motion.read());
    else if (this.mode === 'camera') this.scorer.addEnergy(t, this.camera.read());
    this.scorer.update(t, dt);
    this.tickMapHud(t);
    this.updateHud(t, dt);

    if (this.audio.ended || t >= this.length || (this.scorer.finished && t >= this.length - 1)) this.finish();
  }

  tap() {
    if (this.state !== 'playing' || this.mode !== 'tap') return;
    this.scorer.addTap(this.clock);
    this.tapFlash = 1;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.pause();
    this.video.pause();
    this.overlay('Pausado', `${this.song.title} - ${this.song.artist}` + (this.map ? `\nCoreografia completa · coach ${this.coach + 1}` : ''),
      [['Continuar', () => this.resume(), 'pink'], ['Reiniciar', () => this.restart()], ['Sair', () => this.quit()]]);
  }

  resume() {
    this.hideOverlay();
    this.state = 'starting';
    this.clock = this.audio.currentTime;
    this.playAudio();
  }

  finish() {
    this.state = 'done';
    const score = this.scorer.scoreInt;
    const record = !this.previewOnly && Settings.submitScore(this.song.id, score);
    const result = { song: this.song, scorer: this.scorer, previewOnly: this.previewOnly, record, realMoves: this.scorer.realMoves, mode: this.mode };
    this.stopAll(true);
    this.app.showResults(result);
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
    this.motion.stop();
    this.camera.stop();
    WakeLock.off();
    if (leaving) {
      this.state = this.state === 'done' ? 'done' : 'idle';
      document.body.classList.remove('playing');
      this.hideOverlay();
    }
  }

  onKey(e) {
    if (e.key === 'Escape') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
      else this.quit();
      return true;
    }
    if ([' ', 'j', 'f', 'J', 'F'].includes(e.key)) { this.tap(); return true; }
    return false;
  }

  // ------------------------------------------------------------ HUD
  resetHud() {
    this.shownScore = 0; this.tapFlash = 0; this.lastStars = -1; this.lyricKey = '';
    $('#hudName').textContent = Settings.get('name');
    $('#hudScore').textContent = '0';
    $('#hudBar').style.width = '0%';
    setStars($('#hudStars'), 0, false);
    $('#hudStarLabel').textContent = '';
    $('#feedback').className = 'feedback';
    $('#combo').textContent = '';
    $('#hint').textContent = '';
    $('#progress').style.width = '0%';
    $('#energy').style.height = '0%';
    $('#hudSong').textContent = `${this.song.title}  ·  ${this.song.artist}${this.previewOnly ? '  (prévia)' : ''}`;
    $('#lane').hidden = true;
    $('#lyrics').hidden = true;
    $('#goldLabel').hidden = true;
    $('#goldVignette').classList.remove('on');
  }

  updateHud(t, dt) {
    const sc = this.scorer.scoreInt;
    this.shownScore += (sc - this.shownScore) * Math.min(1, dt * 6);
    if (Math.abs(sc - this.shownScore) < 1) this.shownScore = sc;
    $('#hudScore').textContent = Math.round(this.shownScore);
    $('#hudBar').style.width = `${clamp01(this.shownScore / MAX_SCORE) * 100}%`;
    const st = starsFor(sc);
    if (st !== this.lastStars) {
      this.lastStars = st;
      setStars($('#hudStars'), Math.min(5, st), st >= 6);
      $('#hudStarLabel').textContent = st >= 7 ? 'MEGASTAR' : st === 6 ? 'SUPERSTAR' : '';
    }
    $('#progress').style.width = `${clamp01(t / this.length) * 100}%`;
    const ph = this.grid.phase(t);
    $('#pulse').style.transform = `scale(${0.75 + (1 - ph) ** 2 * 0.35})`;
    this.tapFlash = Math.max(0, (this.tapFlash || 0) - dt * 4);
    const level = this.mode === 'tap' ? this.tapFlash : this.scorer.level;
    $('#energy').style.height = `${clamp01(level) * 100}%`;
    const h = $('#hint');
    if (this.hintUntil && performance.now() > this.hintUntil) { h.textContent = ''; this.hintUntil = 0; }
  }

  onRated(r, gold) {
    const f = $('#feedback');
    f.textContent = RATINGS[r];
    f.style.color = RATING_COLORS[r];
    f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop');
    $('#combo').textContent = this.scorer.combo >= 3 ? `COMBO x${this.scorer.combo}` : '';
    if (gold && r === R.YEAH && navigator.vibrate) navigator.vibrate(60);
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
        if (p.start - this.lead > t) break; // ordenados por início
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
        html = cur.words.map((w, i) => i < sung ? `<span class="sung">${esc(w.text)}</span>` : esc(w.text)).join('');
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
