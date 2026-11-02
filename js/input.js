// Mantém a tela acesa durante a dança (tela do PC e celulares).
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
