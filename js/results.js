import { $, el, starRow, setStars } from './util.js';
import { Settings, controlLabel } from './settings.js';
import { starsFor, starLabel, R } from './timing.js';

export class ResultsScreen {
  constructor(app) {
    this.app = app;
    starRow($('#rStars'));
    $('#againBtn').addEventListener('click', () => app.replay());
    $('#otherBtn').addEventListener('click', () => app.show('select'));
  }

  show(res) {
    const { song, scorer, previewOnly, record, realMoves, mode } = res;
    this.final = scorer.scoreInt;
    $('#rTitle').textContent = song.title;
    $('#rArtist').textContent = song.artist + (previewOnly ? '  ·  prévia de 30s' : '');
    $('#rRecord').textContent = record ? 'NOVO RECORDE!' : previewOnly ? '' : `Recorde: ${Settings.bestScore(song.id)}`;
    const c = scorer.counts;
    const items = [['PERFECT', c[R.PERFECT], 'var(--yellow)'], ['SUPER', c[R.SUPER], 'var(--green)'], ['GOOD', c[R.GOOD], 'var(--cyan)'],
      ['OK', c[R.OK], 'var(--violet)'], ['X', c[R.X], 'var(--red)']];
    if (scorer.goldTotal) items.push(['GOLD', `${scorer.goldHits}/${scorer.goldTotal}`, 'var(--gold)']);
    $('#rCounts').replaceChildren(...items.map(([k, v, col]) => el('span', { style: `color:${col}` }, `${k} ${v}`)));
    $('#rExtra').textContent = [realMoves ? 'Coreografia completa' : null, `Maior combo: ${scorer.bestCombo}`,
      `Controle: ${controlLabel(mode)}`, `Dançarino: ${Settings.get('name')}`].filter(Boolean).join('  ·  ');
    $('#rStarLabel').textContent = '';
    setStars($('#rStars'), 0, false);

    // contagem do placar subindo
    const start = performance.now(), dur = 2200;
    cancelAnimationFrame(this.raf);
    const step = now => {
      const k = Math.min(1, (now - start) / dur);
      const v = Math.round(this.final * (1 - (1 - k) ** 3));
      $('#rScore').textContent = v;
      const st = starsFor(v);
      setStars($('#rStars'), Math.min(5, st), st >= 6);
      if (k < 1) this.raf = requestAnimationFrame(step);
      else $('#rStarLabel').textContent = starLabel(this.final).toUpperCase();
    };
    this.raf = requestAnimationFrame(step);
    setTimeout(() => $('#againBtn').focus(), 50);
  }

  hide() { cancelAnimationFrame(this.raf); }
}
