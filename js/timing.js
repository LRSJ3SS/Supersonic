import { clamp01 } from './util.js';

/**
 * Relógio musical igual à UbiArt/JustDanceEditor:
 * markers[i] = batida i (segundos da onda original); fora da lista, extrapola
 * pela média dos 4 intervalos da ponta. O audio.opus começa no startBeat:
 *   tempoÁudio(b) = S(b) - S(startBeat)
 *   tempoVídeo    = tempoÁudio + S(startBeat) - videoStartTime
 * (Conferido: S(endBeat) - S(startBeat) == mapLength do songdb.)
 */
export class SongTiming {
  constructor(markerSeconds, startBeat = 0, endBeat = 0, videoStartTime = 0) {
    this.m = markerSeconds || [];
    this.startBeat = Math.round(startBeat);
    this.endBeat = Math.round(endBeat) || this.m.length;
    this.videoStartTime = videoStartTime;
  }
  get valid() { return this.m.length >= 2; }
  spacing(a, b) { return (this.m[b] - this.m[a]) / (b - a); }
  get averageInterval() { return this.valid ? this.spacing(0, this.m.length - 1) : 0.5; }
  secondsAtBeat(beat) {
    const m = this.m, n = m.length;
    if (n < 2) return beat * 0.5;
    if (beat < 0) return m[0] + beat * this.spacing(0, Math.min(4, n - 1));
    const i = Math.floor(beat);
    if (i >= n - 1) return m[n - 1] + (beat - (n - 1)) * this.spacing(Math.max(0, n - 5), n - 1);
    return m[i] + (m[i + 1] - m[i]) * (beat - i);
  }
  get origin() { return this.secondsAtBeat(this.startBeat); }
  audioTime(beat) { return this.secondsAtBeat(beat) - this.origin; }
  get videoOffset() { return this.origin - this.videoStartTime; }
  get length() { return this.audioTime(this.endBeat); }

  static fromSong(s) { return new SongTiming(s.beats, s.startBeat, s.endBeat, s.videoStart); }
}

/** Batidas já em segundos do áudio que está tocando. */
export class BeatGrid {
  constructor(timing, fromBeat, origin, length, offset) {
    const beats = [];
    for (let b = Math.ceil(fromBeat); b < 100000; b++) {
      const t = timing.secondsAtBeat(b) - origin + offset;
      if (t > length + 0.01) break;
      if (t >= -0.01) beats.push(t);
    }
    this.beats = beats.length ? beats : [0];
    const iv = timing.averageInterval;
    this.interval = iv >= 0.2 && iv <= 2 ? iv : 0.5;
  }
  /** índice da última batida <= t (-1 antes da primeira) */
  indexAt(t) {
    let lo = 0, hi = this.beats.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.beats[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  phase(t) {
    const i = this.indexAt(t), b = this.beats;
    if (i < 0 || i >= b.length - 1) return (((t / this.interval) % 1) + 1) % 1;
    return clamp01((t - b[i]) / (b[i + 1] - b[i]));
  }
}

export const MAX_SCORE = 13333;
export const GOLD_WEIGHT = 3;
export const STAR_THRESHOLDS = [2000, 4000, 6000, 8000, 10000, 11000, 12000]; // 5★, superstar, megastar
export const RATINGS = ['X', 'OK', 'GOOD', 'SUPER', 'PERFECT', 'YEAH!'];
export const R = { X: 0, OK: 1, GOOD: 2, SUPER: 3, PERFECT: 4, YEAH: 5 };
const WEIGHTS = [0, 0.3, 0.55, 0.8, 1];

export const starsFor = score => STAR_THRESHOLDS.filter(t => score >= t).length;
export function starLabel(score) {
  const s = starsFor(score);
  if (s >= 7) return 'MEGASTAR';
  if (s === 6) return 'SUPERSTAR';
  return `${s} ${s === 1 ? 'estrela' : 'estrelas'}`;
}

/**
 * Pontuação estilo Just Dance (máx. 13 333).
 *  - com map.json: usa os MotionClips reais (início/fim/gold) do coach;
 *  - sem mapa: "movimentos" de 2 batidas.
 * A nota vem da intensidade e ritmo do movimento (sensor/câmera) ou da
 * precisão dos toques. Gold move vale 3x e é tudo-ou-nada ("YEAH!").
 */
export class Scorer {
  constructor(grid, mode, windows, realMoves = false) {
    this.grid = grid;
    this.mode = mode;
    this.realMoves = realMoves;
    this.floor = mode === 'camera' ? 0.004 : 0.8;
    this.refInit = mode === 'camera' ? 0.035 : 5.5;
    this.refLevel = this.refInit;
    this.moves = [];
    this.taps = [];
    this.current = 0;
    this.score = 0;
    this.counts = [0, 0, 0, 0, 0, 0];
    this.goldHits = 0; this.goldTotal = 0;
    this.combo = 0; this.bestCombo = 0;
    this.level = 0;
    this.onRated = null;
    this.resetAcc();

    let units = 0;
    for (const w of [...windows].sort((a, b) => a.start - b.start)) {
      if (w.end <= w.start) continue;
      const fb = Math.max(0, grid.indexAt(w.start - 0.05) + 1);
      const lb = Math.min(grid.beats.length - 1, Math.max(fb, grid.indexAt(w.end - 0.05)));
      this.moves.push({ start: w.start, end: w.end, gold: !!w.gold, fb, lb });
      units += w.gold ? GOLD_WEIGHT : 1;
      if (w.gold) this.goldTotal++;
    }
    this.pointsPerUnit = units ? MAX_SCORE / units : 0;
  }

  static beatWindows(grid, first, last, per = 2) {
    const out = [], b = grid.beats;
    let i = 0;
    while (i < b.length && b[i] < first) i++;
    for (; i + per < b.length && b[i + per] <= last; i += per) out.push({ start: b[i], end: b[i + per], gold: false });
    return out;
  }

  get finished() { return this.current >= this.moves.length; }
  get scoreInt() { return Math.min(MAX_SCORE, Math.round(this.score)); }
  resetAcc() { this.sum = 0; this.n = 0; this.onBeatSum = 0; this.onBeatN = 0; }
  target() { return Math.max(this.refInit, this.refLevel * 0.85); }
  levelOf(e) { return clamp01((e - this.floor) / Math.max(1e-4, this.target() - this.floor)); }

  addEnergy(t, e) {
    if (e < 0 || this.finished) return;
    this.level += (this.levelOf(e) - this.level) * 0.3;
    const m = this.moves[this.current];
    if (t < m.start) return;
    this.sum += e; this.n++;
    const g = this.grid, bi = g.indexAt(t);
    if (bi >= 0) {
      const dPrev = t - g.beats[bi];
      const dNext = bi + 1 < g.beats.length ? g.beats[bi + 1] - t : Infinity;
      if (Math.min(dPrev, dNext) < g.interval * 0.25) { this.onBeatSum += e; this.onBeatN++; }
    }
  }

  addTap(t) { this.taps.push(t); }

  update(t, dt = 1 / 60) {
    const late = this.mode === 'tap' ? 0.25 : 0;
    while (!this.finished && t >= this.moves[this.current].end + late) {
      this.rate(this.moves[this.current]);
      this.current++;
      this.resetAcc();
    }
    if (this.mode !== 'tap') this.level = Math.max(0, this.level - dt * 0.5);
  }

  rate(m) {
    let q;
    if (this.mode === 'tap') q = this.rateTaps(m);
    else {
      const avg = this.n ? this.sum / this.n : 0;
      q = clamp01((avg - this.floor) / Math.max(1e-4, this.target() - this.floor));
      const onBeat = this.onBeatN ? this.onBeatSum / this.onBeatN : 0;
      if (avg > this.floor && onBeat > avg * 1.1) q = Math.min(1, q + 0.1); // bônus de ritmo
      if (m.gold) q = Math.min(1, q * 1.1);
      this.refLevel = Math.max(this.refInit, this.refLevel * 0.99, avg);
    }
    let r = q >= 0.85 ? R.PERFECT : q >= 0.65 ? R.SUPER : q >= 0.45 ? R.GOOD : q >= 0.2 ? R.OK : R.X;
    let weight = WEIGHTS[r];
    if (m.gold) {
      const hit = r >= R.GOOD;
      weight = hit ? 1 : 0;
      r = hit ? R.YEAH : R.X;
      if (hit) this.goldHits++;
    }
    this.counts[r]++;
    this.score = Math.min(MAX_SCORE, this.score + this.pointsPerUnit * (m.gold ? GOLD_WEIGHT : 1) * weight);
    if (r >= R.GOOD) { this.combo++; this.bestCombo = Math.max(this.bestCombo, this.combo); } else this.combo = 0;
    this.onRated?.(r, m.gold);
  }

  rateTaps(m) {
    let total = 0, beats = 0;
    for (let b = m.fb; b <= m.lb && b < this.grid.beats.length; b++, beats++) {
      const bt = this.grid.beats[b];
      let best = -1, err = Infinity;
      this.taps.forEach((tp, k) => { const e = Math.abs(tp - bt); if (e < err) { err = e; best = k; } });
      let q = 0;
      if (best >= 0) {
        q = err < 0.07 ? 1 : err < 0.12 ? 0.8 : err < 0.18 ? 0.55 : err < 0.25 ? 0.3 : 0;
        if (q > 0) this.taps.splice(best, 1);
      }
      total += q;
    }
    this.taps = this.taps.filter(x => x >= m.end - 0.25);
    return beats ? total / beats : 0;
  }
}
