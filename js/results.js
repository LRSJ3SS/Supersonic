import { $, el, starRow, setStars } from './util.js';
import { starLabel } from './timing.js';

const COUNT_LABELS = [['PERFECT', 4, 'var(--yellow)'], ['SUPER', 3, 'var(--green)'], ['GOOD', 2, 'var(--cyan)'], ['OK', 1, 'var(--violet)'], ['X', 0, 'var(--red)']];

export class ResultsScreen {
  constructor(app) {
    this.app = app;
    $('#againBtn').addEventListener('click', () => app.replay());
    $('#otherBtn').addEventListener('click', () => app.show('select'));
  }

  show(res) {
    const { song, previewOnly, realMoves, ranking } = res;
    $('#rTitle').textContent = song.title;
    $('#rArtist').textContent = song.artist + (previewOnly ? '  ·  prévia de 30s' : '');
    const list = $('#rRanking');
    list.replaceChildren();
    this.rows = ranking.map(r => {
      const stars = el('span', { class: 'stars' });
      starRow(stars);
      const scoreEl = el('span', { class: 'rk-score' }, '0');
      const counts = COUNT_LABELS.map(([k, i, c]) => el('span', { style: `color:${c}` }, `${k} ${r.counts[i]}`));
      if (r.goldTotal) counts.push(el('span', { style: 'color:var(--gold)' }, `GOLD ${r.goldHits}/${r.goldTotal}`));
      const li = el('li', { class: 'rk', style: `--pc:${r.color}` },
        el('span', { class: 'rk-pos' }, `${r.rank}º`),
        el('div', { class: 'rk-main' },
          el('div', { class: 'rk-name' }, r.name, r.record ? el('em', {}, ' NOVO RECORDE!') : null),
          el('div', { class: 'rk-counts' }, counts)),
        el('div', { class: 'rk-right' }, scoreEl, stars, el('span', { class: 'rk-label' }, starLabel(r.score).toUpperCase())));
      list.append(li);
      return { r, scoreEl, stars };
    });
    $('#rExtra').textContent = realMoves ? 'Nota pelos classificadores .msm originais da coreografia' : 'Nota pela energia do movimento (música sem .msm convertido)';

    const start = performance.now(), dur = 2000;
    cancelAnimationFrame(this.raf);
    const step = now => {
      const k = Math.min(1, (now - start) / dur), e = 1 - (1 - k) ** 3;
      for (const row of this.rows) {
        const v = Math.round(row.r.score * e);
        row.scoreEl.textContent = v;
        const st = row.r.stars * e;
        setStars(row.stars, Math.min(5, Math.floor(st)), row.r.stars >= 6 && k === 1);
      }
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    setTimeout(() => $('#againBtn').focus(), 50);
  }

  hide() { cancelAnimationFrame(this.raf); }

  onKey(key) {
    if (key === 'Enter' || key === 'ok') { this.app.replay(); return true; }
    if (key === 'Escape' || key === 'back') { this.app.show('select'); return true; }
    return false;
  }
}
