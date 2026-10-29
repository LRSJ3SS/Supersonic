import { isMobile, clamp } from './util.js';

// Ajustes e recordes ficam no navegador (localStorage), com proteção para
// modo anônimo/armazenamento bloqueado.
const KEY = 'dnn.settings.v1';
const BEST = 'dnn.best.v1';
const defaults = {
  name: 'Dançarino',
  control: isMobile ? 'motion' : 'camera', // motion | camera | tap
  quality: isMobile ? 'MID' : 'HIGH',
  offsetMs: 0,
  videoOffsetMs: 0,
  volume: 1,
  cameraPreview: true,
};

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem armazenamento: fica só na memória */ }
}

const state = { ...defaults, ...read(KEY, {}) };
const best = read(BEST, {});

const limits = { offsetMs: [-1000, 1000], videoOffsetMs: [-2000, 2000], volume: [0, 1] };

export const Settings = {
  get: k => state[k],
  set(k, v) {
    if (limits[k]) v = clamp(Math.round(v * 100) / 100, ...limits[k]);
    if (k === 'name') v = String(v || '').trim().slice(0, 16) || defaults.name;
    state[k] = v;
    write(KEY, state);
    return v;
  },
  bestScore: id => best[id] || 0,
  submitScore(id, score) {
    if (score <= (best[id] || 0)) return false;
    best[id] = score;
    write(BEST, best);
    return true;
  },
};

export const CONTROLS = ['motion', 'camera', 'tap'];
export const QUALITIES = ['LOW', 'MID', 'HIGH', 'ULTRA'];
export const controlLabel = c => ({ motion: 'Celular na mão', camera: 'Câmera', tap: 'Toque no ritmo' })[c] || c;
