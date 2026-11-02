import { PEER_PREFIX, MAX_PLAYERS, PLAYER_COLORS, randomCode, peerOptions } from './net.js';

/**
 * Sala do lado da TELA (PC). Recebe até 6 celulares, sincroniza o relógio
 * de cada um e repassa as amostras do acelerômetro já no relógio da tela.
 */
export class Room {
  constructor(handlers = {}) {
    this.h = handlers;              // onChange(players), onNav(player, key), onPause(player), onSamples(player, samples)
    this.players = [];              // {slot, key, name, color, conn, connected}
    this.code = null;
    this.status = 'connecting';     // connecting | open | error
    this.state = { screen: 'lobby' };
  }

  async open() {
    let saved = null;
    try { saved = sessionStorage.getItem('dnn.room'); } catch { /* sem armazenamento */ }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = attempt === 0 && saved ? saved : randomCode();
      try {
        await this.listen(code);
        try { sessionStorage.setItem('dnn.room', code); } catch { /* ignore */ }
        return code;
      } catch (e) {
        if (e.type !== 'unavailable-id') { this.status = 'error'; this.error = e.message || String(e); this.h.onChange?.(this.players); throw e; }
      }
    }
    throw new Error('não foi possível criar a sala');
  }

  listen(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS não carregou'));
      const peer = new window.Peer(PEER_PREFIX + code, peerOptions());
      let opened = false;
      peer.on('open', () => {
        opened = true;
        this.peer = peer;
        this.code = code;
        this.status = 'open';
        this.h.onChange?.(this.players);
        resolve(code);
      });
      peer.on('connection', conn => this.accept(conn));
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
      peer.on('error', err => {
        if (!opened) { peer.destroy(); reject(err); return; }
        console.warn('[sala]', err.type, err.message);
      });
    });
  }

  accept(conn) {
    conn.on('data', msg => this.onMessage(conn, msg));
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  onMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'p') { conn.send({ t: 'q', c: msg.c, h: performance.now() }); return; }
    if (msg.t === 'hello') { this.join(conn, msg); return; }
    const p = this.players.find(x => x.conn === conn);
    if (!p) return;
    switch (msg.t) {
      case 'a': {
        // [tempo na tela (ms), x, y, z, tempo, x, y, z, ...] — já convertido pelo celular
        const d = msg.d, out = [];
        for (let i = 0; i + 3 < d.length; i += 4) out.push({ h: d[i], x: d[i + 1], y: d[i + 2], z: d[i + 3] });
        this.h.onSamples?.(p, out);
        p.lastSample = performance.now();
        break;
      }
      case 'nav': this.h.onNav?.(p, msg.k); break;
      case 'pause': this.h.onPause?.(p); break;
      case 'name': p.name = String(msg.name || '').slice(0, 16) || p.name; this.h.onChange?.(this.players); this.welcome(p); break;
    }
  }

  join(conn, msg) {
    const key = String(msg.key || '');
    let p = this.players.find(x => x.key === key);
    if (p) {
      if (p.conn && p.conn !== conn) try { p.conn.close(); } catch { /* ignore */ }
      p.conn = conn; p.connected = true;
    } else {
      const used = new Set(this.players.map(x => x.slot));
      const slot = [...Array(MAX_PLAYERS).keys()].find(i => !used.has(i));
      if (slot === undefined) { conn.send({ t: 'kick', reason: 'A sala está cheia (6 jogadores).' }); setTimeout(() => conn.close(), 500); return; }
      p = { slot, key, color: PLAYER_COLORS[slot], conn, connected: true };
      this.players.push(p);
      this.players.sort((a, b) => a.slot - b.slot);
    }
    p.name = String(msg.name || '').trim().slice(0, 16) || `Jogador ${p.slot + 1}`;
    this.welcome(p);
    conn.send({ t: 'state', ...this.state });
    this.h.onChange?.(this.players);
  }

  welcome(p) { this.send(p, { t: 'welcome', slot: p.slot, color: p.color, name: p.name, code: this.code }); }

  drop(conn) {
    const p = this.players.find(x => x.conn === conn);
    if (!p) return;
    p.connected = false;
    p.conn = null;
    // no lobby, quem sai some da lista; na partida a vaga fica guardada para voltar
    if (this.state.screen !== 'playing') this.players = this.players.filter(x => x !== p);
    this.h.onChange?.(this.players);
  }

  get connected() { return this.players.filter(p => p.connected); }

  send(p, msg) { try { if (p.conn?.open) p.conn.send(msg); } catch { /* ignore */ } }

  broadcast(msg) { for (const p of this.players) this.send(p, msg); }

  setState(state) {
    this.state = state;
    if (state.screen !== 'playing') this.players = this.players.filter(p => p.connected);
    this.broadcast({ t: 'state', ...state });
    this.h.onChange?.(this.players);
  }
}
