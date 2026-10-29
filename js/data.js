import { SongTiming } from './timing.js';

// ---------------------------------------------------------------- URLs
// Vídeo/áudio tocam direto do CDN da Ubisoft (sem gastar banda da Vercel).
// Se o CDN recusar, cai para o rewrite /cdn/ do vercel.json.
// O JSON do nohud sempre passa por /nohud/ (precisa de CORS).
export const UBI_CDN = 'https://jd-s3.cdn.ubi.com/';
const NOHUD = 'https://nohud.jdleaderboards.com/';

export const urls = {
  cdn: path => (/^https?:/.test(path) ? path : UBI_CDN + path),
  nohudMap: code => `nohud/map/${encodeURIComponent(code)}`,
  proxied(abs) {
    if (abs.startsWith(UBI_CDN)) return 'cdn/' + abs.slice(UBI_CDN.length);
    if (abs.startsWith(NOHUD)) return 'nohud/' + abs.slice(NOHUD.length);
    if (abs.startsWith(location.origin) || !/^https?:/.test(abs)) return abs;
    return 'api/proxy?url=' + encodeURIComponent(abs);
  },
};

/** Liga uma URL a um <video>/<audio>; se falhar direto, tenta pelo proxy. */
export function setMedia(media, abs, { autoplay = false } = {}) {
  media.onerror = null;
  if (!abs) { media.removeAttribute('src'); media.load(); return; }
  const fallback = urls.proxied(abs);
  media.dataset.src = abs;
  delete media.dataset.failed;
  delete media.dataset.triedProxy;
  media.onerror = () => {
    if (media.dataset.src !== abs) return;
    if (media.dataset.triedProxy === abs || fallback === abs) { media.dataset.failed = '1'; return; }
    media.dataset.triedProxy = abs;
    media.src = fallback;
    media.load();
    if (autoplay) media.play().catch(() => {});
  };
  media.src = abs;
  media.load();
}

export function clearMedia(media) {
  media.pause();
  media.onerror = null;
  delete media.dataset.src;
  media.removeAttribute('src');
  media.load();
}

// ---------------------------------------------------------------- songdb
export const CATEGORIES = ['Todas', 'Completas', 'Novas', 'Clássicas', 'Duetos+', 'Extreme', 'Alternativas', 'Kids'];

export async function loadSongDb() {
  const res = await fetch('data/songdb.min.json');
  if (!res.ok) throw new Error(`songdb HTTP ${res.status}`);
  const { songs } = await res.json();
  for (const s of songs) {
    s.beats = (s.beats || []).map(ms => ms / 1000);
    s.tags = s.tags || [];
    s.versionLabel = s.ver >= 2014 ? `JD ${s.ver}` : s.ver > 1 ? `JD ${s.ver}` : 'JD';
    s.coachLabel = ({ 1: 'Solo', 2: 'Dueto', 3: 'Trio' })[s.coaches] || 'Quarteto';
    s.search = `${s.title} ${s.artist} ${s.map}`.toLowerCase();
  }
  return songs;
}

export function filterSongs(songs, query, category) {
  const q = (query || '').trim().toLowerCase();
  return songs.filter(s => {
    switch (category) {
      case 'Completas': if (!MapLibrary.has(s.map)) return false; break;
      case 'Novas': if (s.ver < 2024) return false; break;
      case 'Clássicas': if (!(s.ver > 0 && s.ver < 2018)) return false; break;
      case 'Duetos+': if (s.coaches < 2) return false; break;
      case 'Extreme': if (!s.tags.includes('Extreme')) return false; break;
      case 'Alternativas': if (!s.tags.includes('Alternate')) return false; break;
      case 'Kids': if (!s.tags.some(t => t.startsWith('Kids'))) return false; break;
    }
    return !q || s.search.includes(q);
  });
}

// ---------------------------------------------------------------- nohud (igual ao jdnextAutomodder_reference.py)
const VIDEO_PREFS = {
  ULTRA: ['video_ULTRA.hd.webm', 'video_HIGH.hd.webm', 'video_MID.hd.webm', 'video_LOW.hd.webm'],
  HIGH: ['video_HIGH.hd.webm', 'video_ULTRA.hd.webm', 'video_MID.hd.webm', 'video_LOW.hd.webm'],
  MID: ['video_MID.hd.webm', 'video_HIGH.hd.webm', 'video_LOW.hd.webm', 'video_ULTRA.hd.webm'],
  LOW: ['video_LOW.hd.webm', 'video_MID.hd.webm', 'video_HIGH.hd.webm', 'video_ULTRA.hd.webm'],
};
const assetCache = new Map();

export async function fetchMapAssets(codename, quality = 'HIGH') {
  if (assetCache.has(codename)) return pick(assetCache.get(codename), quality);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let data;
  try {
    const res = await fetch(urls.nohudMap(codename), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`servidor nohud respondeu HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'servidor nohud não respondeu' : e.message);
  } finally { clearTimeout(timer); }
  if (!data || !data.assets) throw new Error("mapa sem campo 'assets'");
  assetCache.set(codename, data.assets);
  return pick(data.assets, quality);
}

function pick(assets, quality) {
  const prefs = VIDEO_PREFS[quality] || VIDEO_PREFS.HIGH;
  const video = prefs.map(k => assets[k]).find(Boolean)
    || Object.entries(assets).find(([k]) => k.startsWith('video') && k.endsWith('.webm') && !k.includes('Preview'))?.[1];
  const audio = assets['audio.opus']
    || Object.entries(assets).find(([k]) => k.startsWith('audio') && !k.includes('Preview'))?.[1];
  if (!video || !audio) throw new Error('esse mapa não tem vídeo/áudio completos no nohud');
  return { video, audio, mapPackage: assets.mapPackage };
}

// ---------------------------------------------------------------- mapas convertidos (Tools/jdnext_map_converter.py)
export function parseMap(json) {
  const tm = json.timing || {};
  const T = new SongTiming((tm.markers || []).map(v => v / 48000), tm.startBeat || 0, tm.endBeat || 0, tm.videoStartTime || 0);
  const span = o => ({ start: T.audioTime(o.b), end: T.audioTime(o.b + (o.d || 1)) });

  const moves = (json.moves || []).map(o => ({ ...span(o), coach: o.c || 0, gold: !!o.g, name: o.n }));
  const atlas = json.atlas || null;
  const pictos = [];
  for (const o of json.pictos || []) {
    const r = atlas?.rects?.[o.n];
    if (!r) continue;
    const p = { ...span(o), name: o.n, rect: r, aspect: r[2] / Math.max(1, r[3]) };
    p.gold = moves.some(m => m.gold && Math.abs(m.start - p.start) < 0.15);
    pictos.push(p);
  }
  const lines = [];
  let line = [];
  for (const o of json.lyrics || []) {
    line.push({ ...span(o), text: o.t || '' });
    if (o.e) { lines.push(line); line = []; }
  }
  if (line.length) lines.push(line);
  return {
    codename: json.codename,
    coaches: Math.max(1, json.coaches || 1),
    timing: T,
    moves, pictos, atlas,
    lines: lines.map(words => ({ words, start: words[0].start, end: words[words.length - 1].end })),
    gold: (json.gold || []).map(span),
    hideHud: (json.hideHud || []).map(span),
    movesFor(coach) {
      const list = moves.filter(m => m.coach === coach);
      return list.length ? list : moves.filter(m => m.coach === (moves[0]?.coach ?? 0));
    },
  };
}

export const inSpans = (spans, t) => spans.some(s => t >= s.start && t < s.end);

export const MapLibrary = {
  index: new Set(),
  cache: new Map(),
  async loadIndex() {
    try {
      const res = await fetch('data/maps/index.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const { maps } = await res.json();
      (maps || []).forEach(m => this.index.add(m.toLowerCase()));
    } catch { /* nenhum mapa convertido ainda */ }
  },
  has(code) { return !!code && this.index.has(code.toLowerCase()); },
  async load(code) {
    if (this.cache.has(code)) return this.cache.get(code);
    const base = `data/maps/${encodeURIComponent(code)}/`;
    const res = await fetch(base + 'map.json');
    if (!res.ok) return null;
    const map = parseMap(await res.json());
    if (map.atlas && map.pictos.length) {
      map.atlasUrl = base + (map.atlas.file || 'pictos.png');
      await new Promise(done => { const img = new Image(); img.onload = img.onerror = done; img.src = map.atlasUrl; });
    }
    this.cache.set(code, map);
    return map;
  },
};
