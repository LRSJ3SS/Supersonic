import { $, $$, starRow, setStars } from './util.js';
import { PEER_PREFIX, normalizeCode, peerOptions } from './net.js';
import { WakeLock } from './input.js';

// Dance Next Now — CONTROLE (celular). Manda o acelerômetro para a tela e
// mostra a nota de cada movimento.
const G = 9.80665;
const RATING_TEXT = ['X', 'OK', 'GOOD', 'SUPER', 'PERFECT', 'YEAH!'];
const RATING_COLORS = ['var(--red)', 'var(--violet)', 'var(--cyan)', 'var(--green)', 'var(--yellow)', 'var(--gold)'];
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
let key = store.get('dnn.ctl.key', '');
if (!key) { key = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('dnn.ctl.key', key); }

const S = {
  peer: null, conn: null, code: '', name: '', screen: 'lobby',
  offset: 0, syncs: [], buf: [], level: 0, lastMotion: 0, joined: false, retry: 0,
};

// ---------------------------------------------------------------- entrada
const params = new URLSearchParams(location.search);
$('#code').value = normalizeCode(params.get('room') || store.get('dnn.ctl.code', ''));
$('#name').value = store.get('dnn.ctl.name', '');
$('#code').addEventListener('input', e => { e.target.value = normalizeCode(e.target.value); });
$('#joinBtn').addEventListener('click', join);
for (const i of $$('#join input')) i.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

async function join() {
  const code = normalizeCode($('#code').value);
  if (code.length < 4) { msg('Digite o código que aparece na tela'); return; }
  S.code = code;
  S.name = ($('#name').value || '').trim().slice(0, 16) || 'Dançarino';
  store.set('dnn.ctl.code', code);
  store.set('dnn.ctl.name', S.name);
  // dentro do toque: o iOS só libera o sensor aqui
  await startMotion();
  WakeLock.on();
  msg('Conectando...');
  connect();
}

function msg(t) { $('#joinMsg').textContent = t; }

// ---------------------------------------------------------------- conexão
function connect() {
  if (S.peer && !S.peer.destroyed) S.peer.destroy();
  const peer = new window.Peer(peerOptions());
  S.peer = peer;
  peer.on('open', () => {
    const conn = peer.connect(PEER_PREFIX + S.code, { reliable: true, serialization: 'json' });
    S.conn = conn;
    conn.on('open', () => {
      S.retry = 0;
      conn.send({ t: 'hello', name: S.name, key });
      startSync();
    });
    conn.on('data', onMessage);
    conn.on('close', lost);
    conn.on('error', lost);
  });
  peer.on('error', err => {
    if (err.type === 'peer-unavailable') {
      if (S.joined) lost();
      else { msg(`Sala ${S.code} não encontrada. Confira o código na tela.`); show('join'); }
    } else lost();
  });
}

function lost() {
  setLink(false);
  if (!S.joined) { msg('Não foi possível conectar. Tente de novo.'); return; }
  clearTimeout(S.retryTimer);
  S.retryTimer = setTimeout(connect, Math.min(5000, 1000 + 500 * S.retry++));
}

function send(m) { try { if (S.conn?.open) S.conn.send(m); } catch { /* ignore */ } }

function setLink(ok) { $('#link').classList.toggle('ok', ok); }

// relógio: o celular converte o tempo de cada amostra para o relógio da tela
function startSync() {
  clearInterval(S.syncTimer);
  let n = 0;
  const ping = () => { send({ t: 'p', c: performance.now() }); if (++n === 6) { clearInterval(S.syncTimer); S.syncTimer = setInterval(ping, 2000); } };
  ping();
  S.syncTimer = setInterval(ping, 250);
}

function onSync(m) {
  const now = performance.now(), rtt = now - m.c;
  S.syncs.push({ rtt, off: m.h + rtt / 2 - now });
  if (S.syncs.length > 10) S.syncs.shift();
  const best = S.syncs.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  S.offset = best.off;
  S.rtt = best.rtt;
}

// ---------------------------------------------------------------- mensagens da tela
function onMessage(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'q': onSync(m); break;
    case 'welcome':
      S.joined = true;
      setLink(true);
      document.documentElement.style.setProperty('--me', m.color);
      $('#meBadge').textContent = `P${m.slot + 1}`;
      $('#meName').textContent = m.name;
      $('#meRoom').textContent = `Sala ${m.code || S.code}`;
      show('room');
      break;
    case 'state': setScreen(m); break;
    case 'rate': {
      const f = $('#fb');
      f.textContent = RATING_TEXT[m.r];
      f.style.color = RATING_COLORS[m.r];
      f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop');
      $('#score').textContent = m.score;
      $('#combo').textContent = m.combo >= 3 ? `COMBO x${m.combo}` : '';
      if (navigator.vibrate) navigator.vibrate(m.r === 5 ? [40, 30, 60] : m.r >= 4 ? 25 : 0);
      break;
    }
    case 'result': {
      S.screen = 'results';
      $('#rRank').textContent = m.total > 1 ? `${m.rank}º de ${m.total}` : 'Resultado';
      $('#rScore').innerHTML = `<span>${m.score}</span><small>pontos</small>`;
      starRow($('#rStars'));
      setStars($('#rStars'), Math.min(5, m.stars), m.stars >= 6);
      $('#rRecord').textContent = m.stars >= 7 ? 'MEGASTAR!' : m.stars === 6 ? 'SUPERSTAR!' : m.record ? 'Novo recorde!' : '';
      const c = m.counts || [];
      $('#rCounts').textContent = `PERFECT ${c[4] || 0} · SUPER ${c[3] || 0} · GOOD ${c[2] || 0} · OK ${c[1] || 0} · X ${c[0] || 0}` + (m.gold?.[1] ? ` · GOLD ${m.gold[0]}/${m.gold[1]}` : '');
      pane('vResult');
      break;
    }
    case 'kick': msg(m.reason || 'Você saiu da sala.'); S.joined = false; show('join'); break;
  }
}

function setScreen(m) {
  const prev = S.screen;
  S.screen = m.screen;
  switch (m.screen) {
    case 'loading':
      $('#loadingMsg').textContent = m.title ? `${m.title} · ${m.artist}` : 'Preparando a música...';
      pane('vLoading');
      break;
    case 'playing':
      $('#playSong').textContent = `${m.title} · ${m.artist}`;
      $('#playCoach').textContent = m.coaches > 1 ? `Você dança o coach ${m.coach}` : '';
      if (prev !== 'paused' && prev !== 'playing') { $('#fb').textContent = ''; $('#combo').textContent = ''; $('#score').textContent = '0'; }
      pane('vPlay');
      break;
    case 'paused': pane('vPaused'); break;
    case 'results': if ($('#vResult').hidden) pane('vResult'); break;
    case 'select': $('#lobbyMsg').textContent = 'Escolha a música — use as setas e OK'; pane('vLobby'); break;
    default: $('#lobbyMsg').textContent = 'Aguardando a tela...'; pane('vLobby');
  }
}

// ---------------------------------------------------------------- sensor
async function startMotion() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try { await DeviceMotionEvent.requestPermission(); } catch { /* segue: pode já estar liberado */ }
  }
  window.removeEventListener('devicemotion', onMotion);
  window.addEventListener('devicemotion', onMotion);
}

/**
 * Convenção dos apps de Just Dance (Unity/CoreMotion): em g, celular deitado
 * com a tela para cima dá z = -1. O navegador (padrão W3C) dá z = +9.8 m/s²,
 * então invertemos; o Safari do iOS já vem com o sinal trocado.
 */
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const s = isIOS ? 1 / G : -1 / G;
  const x = a.x * s, y = a.y * s, z = a.z * s;
  S.lastMotion = performance.now();
  const dev = Math.abs(Math.hypot(x, y, z) - 1);
  S.level += (Math.min(1, dev / 1.2) - S.level) * 0.25;
  if (S.screen === 'playing') S.buf.push(+(e.timeStamp + S.offset).toFixed(1), +x.toFixed(4), +y.toFixed(4), +z.toFixed(4));
}

setInterval(() => {
  if (S.buf.length) { send({ t: 'a', d: S.buf }); S.buf = []; }
}, 50);

setInterval(() => {
  $('#meter').style.width = `${Math.round(S.level * 100)}%`;
  S.level *= 0.9;
  const ok = performance.now() - S.lastMotion < 1500;
  $('#sensorMsg').textContent = ok ? (S.rtt ? `ok · ${Math.round(S.rtt)} ms` : 'ok') : 'sem sinal do sensor';
  $('#sensorMsg').classList.toggle('bad', !ok);
}, 100);

// ---------------------------------------------------------------- botões
for (const b of $$('[data-k]')) {
  b.addEventListener('click', () => {
    const k = b.dataset.k;
    if (k === 'back' && S.screen === 'playing') send({ t: 'pause' });
    else send({ t: 'nav', k });
    if (navigator.vibrate) navigator.vibrate(10);
  });
}

// ---------------------------------------------------------------- views
function show(id) {
  $('#join').hidden = id !== 'join';
  $('#room').hidden = id !== 'room';
}
function pane(id) { for (const p of $$('.pane')) p.hidden = p.id !== id; }

if (params.get('room') && store.get('dnn.ctl.name', '')) $('#joinBtn').focus();
