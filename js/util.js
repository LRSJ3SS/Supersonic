// Utilidades pequenas compartilhadas.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const clamp01 = v => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * clamp01(t);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToCss(h, s, v) {
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `rgb(${Math.round(f(5) * 255)}, ${Math.round(f(3) * 255)}, ${Math.round(f(1) * 255)})`;
}

/** Cor do songdb ("#B50055FF") com saturação/brilho ajustados para o tema. */
export function songColor(song, minV = 0.55, maxV = 0.95) {
  const m = /^#?([0-9a-f]{6})/i.exec(song.color || '');
  if (m) {
    const n = parseInt(m[1], 16);
    const [h, s, v] = rgbToHsv((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
    return hsvToCss(h, clamp(s, 0.55, 0.95), clamp(v, minV, maxV));
  }
  let hash = 0;
  for (const ch of song.title || '') hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return hsvToCss(Math.abs(hash % 360) / 360, 0.7, 0.85);
}

const STAR_PATH = 'M12 1.8l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.9l-6.4 3.5L7 14.3l-5.3-5 7.2-.9z';
export function starRow(container, count = 5) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', STAR_PATH);
    svg.append(p);
    container.append(svg);
  }
}
export function setStars(container, filled, superStar) {
  [...container.children].forEach((s, i) => s.classList.toggle('on', i < filled));
  container.classList.toggle('super', !!superStar);
}
