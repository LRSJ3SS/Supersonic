// Fontes de "energia" do dançarino: sensor do celular e câmera.
// read() devolve a média desde a última leitura, ou -1 se não chegou nada.

/** Precisa ser chamada dentro de um clique/toque (exigência do iOS). */
export async function requestMotionPermission() {
  if (typeof DeviceMotionEvent === 'undefined') return 'unavailable';
  if (typeof DeviceMotionEvent.requestPermission !== 'function') return 'granted';
  try { return await DeviceMotionEvent.requestPermission(); } catch { return 'denied'; }
}

export class MotionInput {
  constructor() {
    this.sum = 0; this.n = 0; this.last = 0; this.g = [0, 0, 0];
    this.handler = e => this.onMotion(e);
  }
  start() {
    this.sum = 0; this.n = 0;
    window.addEventListener('devicemotion', this.handler);
  }
  stop() { window.removeEventListener('devicemotion', this.handler); }
  get receiving() { return performance.now() - this.last < 1500; }
  onMotion(e) {
    let mag;
    const a = e.acceleration;
    if (a && a.x != null) mag = Math.hypot(a.x, a.y, a.z);
    else {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null) return;
      // passa-alta simples para tirar a gravidade
      this.g = this.g.map((v, i) => 0.9 * v + 0.1 * [g.x, g.y, g.z][i]);
      mag = Math.hypot(g.x - this.g[0], g.y - this.g[1], g.z - this.g[2]);
    }
    const r = e.rotationRate;
    if (r && r.alpha != null) mag += (Math.abs(r.alpha) + Math.abs(r.beta) + Math.abs(r.gamma)) / 360;
    this.sum += mag; this.n++; this.last = performance.now();
  }
  read() {
    if (!this.n) return -1;
    const v = this.sum / this.n;
    this.sum = 0; this.n = 0;
    return v;
  }
}

/** Movimento pela câmera: diferença entre quadros numa imagem 64x48. */
export class CameraInput {
  constructor(videoEl) {
    this.video = videoEl;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64; this.canvas.height = 48;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.prev = null; this.cur = null;
    this.sum = 0; this.n = 0; this.stream = null; this.raf = 0;
  }
  async start(showPreview) {
    this.sum = 0; this.n = 0; this.prev = null;
    if (!this.stream) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('câmera não suportada');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
    }
    this.video.hidden = !showPreview;
    cancelAnimationFrame(this.raf);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.sample(); };
    loop();
  }
  sample() {
    const v = this.video;
    if (v.readyState < 2) return;
    const w = 64, h = 48;
    this.ctx.drawImage(v, 0, 0, w, h);
    const px = this.ctx.getImageData(0, 0, w, h).data;
    const gray = this.cur || (this.cur = new Float32Array(w * h));
    let diff = 0;
    for (let i = 0, j = 0; j < w * h; i += 4, j++) {
      gray[j] = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      if (this.prev) { const d = Math.abs(gray[j] - this.prev[j]); if (d > 12) diff += d; }
    }
    if (this.prev) { this.sum += diff / (w * h * 255); this.n++; }
    const t = this.prev || new Float32Array(w * h);
    this.prev = gray; this.cur = t;
  }
  get receiving() { return !!this.stream && this.video.readyState >= 2; }
  read() {
    if (!this.n) return -1;
    const v = this.sum / this.n;
    this.sum = 0; this.n = 0;
    return v;
  }
  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.hidden = true;
  }
}

/** Mantém a tela acesa durante a dança. */
export const WakeLock = {
  lock: null, want: false,
  async on() {
    this.want = true;
    try { this.lock = await navigator.wakeLock?.request('screen'); } catch { /* sem suporte */ }
  },
  off() { this.want = false; this.lock?.release().catch(() => {}); this.lock = null; },
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && WakeLock.want) WakeLock.on();
});
