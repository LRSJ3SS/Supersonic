/*
 * Pontuação de um jogador (celular na mão).
 *
 * Com o moves.bin do mapa, cada move é avaliado pelo classificador .msm original
 * (js/msm.js) usando a janela deslizante do JD Now: 7 subjanelas de -75 ms a +75 ms
 * e um "ponteiro" que aprende o atraso do jogador. Sem classificador, cai para
 * uma nota simples pela energia do movimento.
 *
 * Partes portadas do JustDanceEditor (GPL-3.0) — veja js/msm.js.
 */
import { scoreMove, finalMoveRatio, feedbackFor, jdNowTransform } from './msm.js';

export const MAX_SCORE = 13333;
const GOLD_VALUE = 5;
const MARGIN = 0.075, STEP = 0.025;
const LAG = 0.3; // espera a rede entregar as últimas amostras antes de avaliar

const native = s => Math.trunc(s * 1000) / 1000;

export class PlayerScorer {
  /**
   * @param moves [{start, end, gold, name}] em segundos do áudio
   * @param bank Map nome→classificador (pode ser null)
   * @param axes 'raw' (padrão Unity/CoreMotion) | 'flip' (sinais invertidos) | 'jdnow' (rotação do app JD Now)
   */
  constructor(moves, bank, axes = 'raw') {
    this.bank = bank;
    this.axes = axes;
    this.moves = [...moves].sort((a, b) => a.start - b.start).map(m => ({
      ...m, dur: native(m.end - m.start), clf: bank?.get((m.name || '').toLowerCase()) || null,
    }));
    const gold = this.moves.filter(m => m.gold).length;
    this.moveValue = MAX_SCORE / Math.max(1, gold * GOLD_VALUE + (this.moves.length - gold));
    this.withClassifier = this.moves.filter(m => m.clf).length;
    this.samples = [];
    this.current = 0;
    this.pointer = 0.5;
    this.tf = {};
    this.score = 0;
    this.counts = [0, 0, 0, 0, 0, 0];
    this.goldHits = 0; this.goldTotal = gold;
    this.combo = 0; this.bestCombo = 0;
    this.lastLevel = 0;
  }

  get finished() { return this.current >= this.moves.length; }
  get scoreInt() { return Math.min(MAX_SCORE, Math.round(this.score)); }

  /** samples: [{t (segundos do áudio), x, y, z (g)}] */
  addSamples(samples) {
    for (const s of samples) {
      const v = this.axes === 'jdnow' ? jdNowTransform(s, this.tf)
        : this.axes === 'flip' ? { t: s.t, x: -s.x, y: -s.y, z: -s.z } : s;
      // mantém ordenado (pacotes podem chegar fora de ordem)
      if (this.samples.length && v.t < this.samples[this.samples.length - 1].t) {
        let i = this.samples.length - 1;
        while (i > 0 && this.samples[i - 1].t > v.t) i--;
        this.samples.splice(i, 0, v);
      } else this.samples.push(v);
      const dev = Math.abs(Math.hypot(s.x, s.y, s.z) - 1);
      this.lastLevel += (Math.min(1, dev / 1.2) - this.lastLevel) * 0.2;
    }
  }

  /** Avalia os moves que já terminaram. Retorna [{r, gold, ratio, added}] */
  update(t) {
    const out = [];
    while (!this.finished && t >= this.moves[this.current].end + MARGIN + LAG) {
      out.push(this.rate(this.moves[this.current]));
      this.current++;
    }
    // descarta amostras velhas
    const keepFrom = (this.moves[this.current]?.start ?? t) - MARGIN - 1;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].t < keepFrom) drop++;
    if (drop) this.samples.splice(0, drop);
    this.lastLevel *= 0.97;
    return out;
  }

  windowSamples(from, to) {
    const out = [];
    for (const s of this.samples) {
      if (s.t < from) continue;
      if (s.t > to) break;
      out.push(s);
    }
    return out;
  }

  rate(m) {
    let ratio;
    if (m.clf) ratio = this.rateMsm(m);
    else ratio = this.rateEnergy(m);
    const r = feedbackFor(ratio, m.gold);
    let added = 0;
    if (m.gold) { if (r === 5) { added = this.moveValue * GOLD_VALUE; this.goldHits++; } }
    else if (r > 0) added = this.moveValue * ratio;
    this.score = Math.min(MAX_SCORE, this.score + added);
    this.counts[r]++;
    if (r >= 2) { this.combo++; this.bestCombo = Math.max(this.bestCombo, this.combo); } else this.combo = 0;
    return { r, gold: m.gold, ratio, added, name: m.name };
  }

  rateMsm(m) {
    const D = m.dur;
    const subs = [];
    for (let ws = m.start - MARGIN; ws + D <= m.start + D + MARGIN + 1e-6; ws += STEP) subs.push(ws);
    const all = this.windowSamples(m.start - MARGIN, m.start + D + MARGIN);
    const results = subs.map(ws => {
      const pts = [];
      for (const s of all) if (s.t >= ws && s.t <= ws + D) pts.push({ p: (s.t - ws) / D, x: s.x, y: s.y, z: s.z });
      try { return finalMoveRatio(scoreMove(m.clf, pts, D)); } catch { return 0; }
    });
    // ponteiro: usa a subjanela atual e aprende devagar onde o jogador acerta mais
    const sel = Math.min(results.length - 1, Math.max(0, Math.floor(this.pointer * results.length)));
    let best = sel;
    results.forEach((v, i) => { if (v > results[best]) best = i; });
    if (best !== sel) this.pointer = Math.min(1, Math.max(0, (best / results.length + this.pointer * 9) / 10));
    return results[sel];
  }

  /** Sem classificador: nota pela energia (variação da aceleração) dentro do move. */
  rateEnergy(m) {
    const pts = this.windowSamples(m.start, m.end);
    if (pts.length < 3) return 0;
    let dev = 0, jerk = 0;
    for (let i = 0; i < pts.length; i++) {
      dev += Math.abs(Math.hypot(pts[i].x, pts[i].y, pts[i].z) - 1);
      if (i) jerk += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
    }
    dev /= pts.length; jerk /= pts.length - 1;
    const q = Math.min(1, Math.max(0, (dev * 0.6 + jerk * 1.5 - 0.12) / 0.55));
    return q < 0.25 ? 0 : q;
  }
}
