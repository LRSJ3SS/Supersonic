import { $, $$ } from './util.js';
import { Settings, CONTROLS, QUALITIES, controlLabel } from './settings.js';

export class SettingsPanel {
  constructor(app) {
    this.app = app;
    this.root = $('#settings');
    this.root.addEventListener('click', e => { if (e.target === this.root) this.close(); });
    $('#closeSettings').addEventListener('click', () => this.close());
    $('#setName').addEventListener('change', e => Settings.set('name', e.target.value));
    $('#setControl').addEventListener('click', () => {
      Settings.set('control', CONTROLS[(CONTROLS.indexOf(Settings.get('control')) + 1) % CONTROLS.length]);
      this.refresh();
    });
    $('#setQuality').addEventListener('click', () => {
      Settings.set('quality', QUALITIES[(QUALITIES.indexOf(Settings.get('quality')) + 1) % QUALITIES.length]);
      this.refresh();
    });
    $('#setCamPreview').addEventListener('click', () => { Settings.set('cameraPreview', !Settings.get('cameraPreview')); this.refresh(); });
    $('#fullscreenBtn').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
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
    $('#setName').value = Settings.get('name');
    $('#setControl').textContent = controlLabel(Settings.get('control'));
    $('#setQuality').textContent = Settings.get('quality');
    $('#setCamPreview').textContent = Settings.get('cameraPreview') ? 'Sim' : 'Não';
    for (const st of $$('.stepper', this.root)) {
      const k = st.dataset.key, v = Settings.get(k);
      st.querySelector('output').textContent = k === 'volume' ? `${Math.round(v * 100)}%` : `${v > 0 ? '+' : ''}${v} ms`;
    }
    $('#previewAudio').volume = Settings.get('volume') * 0.7;
    $('#gameAudio').volume = Settings.get('volume');
  }

  open() { this.refresh(); this.root.hidden = false; $('#closeSettings').focus(); }
  close() { Settings.set('name', $('#setName').value); this.root.hidden = true; this.app.onSettingsClosed?.(); }
}
