// Protocolo entre a tela (PC) e os controles (celulares).
// Conexão P2P por WebRTC usando PeerJS: o servidor público do PeerJS só faz a
// apresentação inicial; depois os dados vão direto entre os aparelhos.
//
// celular → tela: hello {name, key}, p (ping), a (amostras), nav {k}, pause
// tela → celular: welcome {slot, color, name}, q (pong), state {screen, ...},
//                 rate {r, gold, score}, result {...}, kick

export const PEER_PREFIX = 'dancenextnow-v1-';
export const MAX_PLAYERS = 6;
export const PLAYER_COLORS = ['#FF3CAC', '#2BD2FF', '#FFE14D', '#3DFF9A', '#FF8A3D', '#B388FF'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(n = 5) {
  let s = '';
  const r = crypto.getRandomValues(new Uint32Array(n));
  for (const v of r) s += CODE_CHARS[v % CODE_CHARS.length];
  return s;
}

export const normalizeCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

/** Opções do PeerJS. ?peer=host:porta usa um servidor PeerJS próprio (testes/self-host). */
export function peerOptions() {
  const custom = new URLSearchParams(location.search).get('peer');
  const base = { debug: 1 };
  if (!custom) return base;
  const [host, port] = custom.split(':');
  return { ...base, host, port: +(port || 443), path: '/', secure: +(port || 443) === 443 };
}

export function joinUrl(code) {
  const u = new URL('controller.html', location.href);
  u.search = '';
  u.searchParams.set('room', code);
  const peer = new URLSearchParams(location.search).get('peer');
  if (peer) u.searchParams.set('peer', peer);
  return u.toString();
}

/** Desenha um QR code (SVG) num elemento. */
export function drawQr(el, text) {
  if (!window.qrcode) { el.textContent = ''; return; }
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
