import { $, $$ } from './util.js';
import { Settings, QUALITIES, AXES, axesLabel } from './settings.js';

export class SettingsPanel {
  constructor(app) {
    this.app = app;
    this.root = $('#settings');
    this.root.addEventListener('click', e => { if (e.target === this.root) this.close(); });
    $('#closeSettings').addEventListener('click', () => this.close());
    $('#setQuality').addEventListener('click', () => {
      Settings.set('quality', QUALITIES[(QUALITIES.indexOf(Settings.get('quality')) + 1) % QUALITIES.length]);
      this.refresh();
    });
    $('#setAxes').addEventListener('click', () => {
      Settings.set('axes', AXES[(AXES.indexOf(Settings.get('axes')) + 1) % AXES.length]);
      this.refresh();
    });
    $('#fullscreenBtn').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    for (const st of $$('.stepper', this.root)) {
      const [minus, plus] = st.querySelectorAll('button');
      const change = d => { Settings.set(st.dataset.key, Settings.get(st.dataset.key) + d * +st.dataset.step); this.refresh(); };
      minus.addEventListener('click', () => change(-1));
      plus.addEventListener('click', () => change(1));
    }
  }

  get visible() { return !this.root.hidden; }

  refresh() {
    $('#setQuality').textContent = Settings.get('quality');
    $('#setAxes').textContent = axesLabel(Settings.get('axes'));
    for (const st of $$('.stepper', this.root)) {
      const k = st.dataset.key, v = Settings.get(k);
      st.querySelector('output').textContent = k === 'volume' ? `${Math.round(v * 100)}%` : `${v > 0 ? '+' : ''}${v} ms`;
    }
    $('#previewAudio').volume = Settings.get('volume') * 0.7;
    $('#gameAudio').volume = Settings.get('volume');
  }

  open() { this.refresh(); this.root.hidden = false; $('#closeSettings').focus(); }
  close() { this.root.hidden = true; this.app.onSettingsClosed?.(); }
}
