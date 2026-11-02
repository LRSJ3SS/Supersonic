import { isMobile, clamp } from './util.js';

// Ajustes da TELA e recordes (localStorage), com proteção para modo anônimo.
const KEY = 'dnn.screen.v2';
const BEST = 'dnn.best.v2';
const defaults = {
  quality: isMobile ? 'MID' : 'HIGH',
  axes: 'raw',          // raw = acelerômetro do celular direto (JD Next) | jdnow = rotação 30° do app JD Now
  offsetMs: 0,
  videoOffsetMs: 0,
  volume: 1,
};

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem armazenamento */ }
}

const state = { ...defaults, ...read(KEY, {}) };
const best = read(BEST, {});
const limits = { offsetMs: [-1000, 1000], videoOffsetMs: [-2000, 2000], volume: [0, 1] };

export const Settings = {
  get: k => state[k],
  set(k, v) {
    if (limits[k]) v = clamp(Math.round(v * 100) / 100, ...limits[k]);
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
  /** melhor pontuação da música entre todos os jogadores */
  bestForSong(songId) {
    let top = 0, who = '';
    for (const [k, v] of Object.entries(best)) if (k.startsWith(songId + ':') && v > top) { top = v; who = k.slice(songId.length + 1); }
    return { score: top, name: who };
  },
};

export const QUALITIES = ['LOW', 'MID', 'HIGH', 'ULTRA'];
export const AXES = ['raw', 'flip', 'jdnow'];
export const axesLabel = a => ({ raw: 'JD Next (padrão)', flip: 'Invertido', jdnow: 'JD Now (girado 30°)' })[a] || a;
