#!/usr/bin/env python3
"""
Dance Next Now — conversor de mapPackage do Just Dance Next.

Baixa (ou lê) o AssetBundle "mapPackage" de cada música e gera, para o jogo:

    data/maps/<Codename>/map.json    moves, pictos, letra, gold moves, timing
    data/maps/<Codename>/pictos.png  atlas com todos os pictogramas
    data/maps/<Codename>/moves/*.msm (opcional, --moves) classificadores originais
    data/maps/index.json             lista de mapas convertidos

Formato do bundle (confirmado em JustDanceEditor/MrKev312 e Unity2UbiArt):
  MonoBehaviour "MusicTrack": m_structure.MusicTrackStructure
        markers[].VAL (samples a 48 kHz; markers[i] = batida i), startBeat, endBeat, videoStartTime
  MonoBehaviour "<Codename>": SongDesc, KaraokeData.Clips[].KaraokeClip,
        DanceData.MotionClips / PictoClips / GoldEffectClips / HideHudClips,
        HandDeviceMoveModels (nome do move -> TextAsset .msm), PictogramAtlas (SpriteAtlas)
  Tempos dos clips em ticks: 24 ticks = 1 batida.

Uso:
    pip install UnityPy Pillow
    python3 Tools/jdnext_map_converter.py ChefKids Starships
    python3 Tools/jdnext_map_converter.py --package caminho/mapPackage.bundle
    python3 Tools/jdnext_map_converter.py ChefKids --dump      # salva a árvore crua para depuração
"""
import argparse
import json
import os
import sys
import urllib.request

TICKS_PER_BEAT = 24
SAMPLE_RATE = 48000
NOHUD_URL = "https://nohud.jdleaderboards.com/map/{}"
FALLBACK_UNITY = "2021.3.9f1"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "..", "data", "maps")
DEFAULT_SONGDB = os.path.join(HERE, "..", "data", "songdb.min.json")


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- timing
class Timing:
    """Conversão batida -> segundos igual à UbiArt/JustDanceEditor (com extrapolação)."""

    def __init__(self, markers, start_beat=0, end_beat=0, video_start=0.0):
        self.markers = [int(m) for m in markers]
        self.start_beat = int(start_beat)
        self.end_beat = int(end_beat) if end_beat else len(self.markers)
        self.video_start = float(video_start)

    def _spacing(self, a, b):
        return (self.markers[b] - self.markers[a]) / float(b - a)

    def seconds_at_beat(self, beat):
        m = self.markers
        n = len(m)
        if n < 2:
            return beat * 0.5
        if beat < 0:
            return (m[0] + beat * self._spacing(0, min(4, n - 1))) / SAMPLE_RATE
        i = int(beat)
        if i >= n - 1:
            return (m[-1] + (beat - (n - 1)) * self._spacing(max(0, n - 5), n - 1)) / SAMPLE_RATE
        return (m[i] + (m[i + 1] - m[i]) * (beat - i)) / SAMPLE_RATE

    def audio_time(self, beat):
        """Segundos no audio.opus (que começa no startBeat)."""
        return self.seconds_at_beat(beat) - self.seconds_at_beat(self.start_beat)


# ---------------------------------------------------------------- helpers de árvore
def unwrap(item, key):
    """KaraokeClips vêm como {"KaraokeClip": {...}}; outros clips vêm direto."""
    if isinstance(item, dict) and key in item and isinstance(item[key], dict):
        return item[key]
    return item


def as_list(v):
    if v is None:
        return []
    if isinstance(v, dict) and "Array" in v:
        v = v["Array"]
    return list(v) if isinstance(v, (list, tuple)) else []


def active(c):
    return int(c.get("IsActive", 1) or 0) != 0


def beat_of(ticks):
    return round(ticks / TICKS_PER_BEAT, 4)


def is_music_track(tree):
    return isinstance(tree, dict) and "m_structure" in tree


def is_map(tree):
    return isinstance(tree, dict) and "DanceData" in tree


# ---------------------------------------------------------------- montagem do map.json (puro, testável)
def build_map(codename, map_tree, music_tree, available_pictos=(), song=None):
    st = music_tree["m_structure"]
    st = st.get("MusicTrackStructure", st)
    markers = [m["VAL"] if isinstance(m, dict) else m for m in as_list(st.get("markers"))]
    timing = Timing(markers, st.get("startBeat", 0), st.get("endBeat", 0), st.get("videoStartTime", 0))

    desc = map_tree.get("SongDesc", {}) or {}
    dance = map_tree.get("DanceData", {}) or {}
    karaoke = map_tree.get("KaraokeData", {}) or {}

    moves = []
    for c in as_list(dance.get("MotionClips")):
        c = unwrap(c, "MotionClip")
        if not active(c):
            continue
        moves.append({
            "b": beat_of(c.get("StartTime", 0)),
            "d": beat_of(max(1, c.get("Duration", TICKS_PER_BEAT))),
            "c": int(c.get("CoachId", 0)),
            "g": 1 if int(c.get("GoldMove", 0) or 0) else 0,
            "t": int(c.get("MoveType", 0)),
            "n": c.get("MoveName", ""),
        })
    moves.sort(key=lambda x: (x["b"], x["c"]))

    lookup = {p.lower(): p for p in available_pictos}
    pictos = []
    for c in as_list(dance.get("PictoClips")):
        c = unwrap(c, "PictogramClip")
        if not active(c):
            continue
        name = os.path.splitext(os.path.basename(c.get("PictoPath", "")))[0]
        pictos.append({
            "b": beat_of(c.get("StartTime", 0)),
            "d": beat_of(max(1, c.get("Duration", TICKS_PER_BEAT))),
            "n": lookup.get(name.lower(), name),
        })
    pictos.sort(key=lambda x: x["b"])

    lyrics = []
    for c in as_list(karaoke.get("Clips")):
        c = unwrap(c, "KaraokeClip")
        if not active(c):
            continue
        lyrics.append({
            "b": beat_of(c.get("StartTime", 0)),
            "d": beat_of(max(1, c.get("Duration", 1))),
            "t": c.get("Lyrics", ""),
            "e": 1 if int(c.get("IsEndOfLine", 0) or 0) else 0,
        })
    lyrics.sort(key=lambda x: x["b"])

    def simple(key):
        out = []
        for c in as_list(dance.get(key)):
            c = unwrap(c, key)
            if active(c):
                out.append({"b": beat_of(c.get("StartTime", 0)), "d": beat_of(max(1, c.get("Duration", 1)))})
        return sorted(out, key=lambda x: x["b"])

    coaches = int(desc.get("NumCoach") or (song or {}).get("coaches") or (max([m["c"] for m in moves], default=0) + 1))
    return {
        "version": 1,
        "codename": codename,
        "title": (song or {}).get("title") or desc.get("Title", codename),
        "artist": (song or {}).get("artist") or desc.get("Artist", ""),
        "coaches": coaches,
        "timing": {
            "markers": timing.markers,
            "startBeat": timing.start_beat,
            "endBeat": timing.end_beat,
            "videoStartTime": timing.video_start,
            # duração em segundos do audio.opus usada pelo mapa
            "length": round(timing.audio_time(timing.end_beat), 3),
        },
        "moves": moves,
        "pictos": pictos,
        "lyrics": lyrics,
        "gold": simple("GoldEffectClips"),
        "hideHud": simple("HideHudClips"),
    }


# ---------------------------------------------------------------- atlas de pictos
def pack_atlas(images, cell_h=256, max_width=4096):
    """Empacota em prateleiras de altura fixa. Retorna (PIL.Image, {nome: [x, y, w, h]})."""
    from PIL import Image
    scaled = {}
    for name, img in sorted(images.items()):
        img = img.convert("RGBA")
        bbox = img.getbbox()
        if bbox is None:
            continue
        w, h = img.size
        nw = max(1, round(w * cell_h / h))
        scaled[name] = img.resize((nw, cell_h), Image.LANCZOS) if h != cell_h else img
    rects, x, y, row_w = {}, 0, 0, 0
    pad = 2
    for name, img in scaled.items():
        w = img.size[0]
        if x + w > max_width:
            x, y = 0, y + cell_h + pad
        rects[name] = [x, y, w, cell_h]
        x += w + pad
        row_w = max(row_w, x)
    total_h = y + cell_h if scaled else 1
    atlas = Image.new("RGBA", (max(1, row_w), max(1, total_h)), (0, 0, 0, 0))
    for name, img in scaled.items():
        rx, ry, _, _ = rects[name]
        atlas.paste(img, (rx, ry))
    return atlas, rects


# ---------------------------------------------------------------- leitura do bundle
def read_bundle(path):
    import UnityPy
    try:
        UnityPy.config.FALLBACK_UNITY_VERSION = FALLBACK_UNITY
    except Exception:
        pass
    env = UnityPy.load(path)
    map_tree = music_tree = None
    sprites, textassets, monos = {}, {}, []
    by_path = {}
    for obj in env.objects:
        kind = obj.type.name
        try:
            if kind == "MonoBehaviour":
                tree = obj.read_typetree()
                monos.append(tree)
                if is_map(tree):
                    map_tree = tree
                elif is_music_track(tree):
                    music_tree = tree
            elif kind == "Sprite":
                data = obj.read()
                sprites[data.m_Name] = data.image
            elif kind == "TextAsset":
                data = obj.read()
                raw = data.m_Script
                if isinstance(raw, str):
                    raw = raw.encode("utf-8", "surrogateescape")
                textassets[data.m_Name] = raw
                by_path[obj.path_id] = (data.m_Name, raw)
        except Exception as e:  # um objeto ruim não derruba a conversão
            log(f"   aviso: {kind} ignorado ({e})")
    if map_tree is not None:
        map_tree["_hand_moves"] = hand_move_models(map_tree, by_path)
    return map_tree, music_tree, sprites, textassets, monos


def hand_move_models(map_tree, by_path):
    """HandDeviceMoveModels: nome do move -> bytes do .msm (classificador do celular)."""
    out = {}
    for item in as_list((map_tree.get("HandDeviceMoveModels") or {}).get("list")):
        key = item.get("Key") if isinstance(item, dict) else None
        val = item.get("Value") if isinstance(item, dict) else None
        if not key or not isinstance(val, dict):
            continue
        hit = by_path.get(val.get("m_PathID"))
        if hit:
            out[key.lower()] = hit[1]
    return out


def is_msm(raw):
    return len(raw) >= 8 and (raw[:4] == b"\x01\x00\x00\x00" or raw[:4] == b"\x00\x00\x00\x01")


def pack_moves(moves_by_name, out_dir):
    """Junta os .msm num único moves.bin. Retorna o índice {nome: [offset, tamanho]}."""
    index, blob = {}, bytearray()
    for name in sorted(moves_by_name):
        raw = moves_by_name[name]
        if not is_msm(raw):
            continue
        while len(blob) % 4:
            blob.append(0)
        index[name.lower()] = [len(blob), len(raw)]
        blob += raw
    if index:
        with open(os.path.join(out_dir, "moves.bin"), "wb") as f:
            f.write(blob)
    return index


def collect_msm(textassets, hand_moves, move_names):
    """Prefere o mapeamento do HandDeviceMoveModels; senão casa pelo nome do arquivo."""
    found = dict(hand_moves or {})
    wanted = {n.lower() for n in move_names}
    for name, raw in textassets.items():
        stem = os.path.splitext(name)[0].lower()
        if stem in wanted and stem not in found and is_msm(raw):
            found[stem] = raw
    return found


def repack(map_dir):
    """Gera moves.bin a partir de uma pasta moves/ já exportada (mapas antigos)."""
    mpath = os.path.join(map_dir, "map.json")
    with open(mpath, encoding="utf-8") as f:
        m = json.load(f)
    mdir = os.path.join(map_dir, "moves")
    files = {}
    for fn in os.listdir(mdir):
        if fn.lower().endswith(".msm"):
            with open(os.path.join(mdir, fn), "rb") as f:
                files[fn] = f.read()
    names = {x["n"] for x in m.get("moves", []) if x.get("t", 0) == 0}
    msm = collect_msm(files, {}, names)
    index = pack_moves(msm, map_dir)
    m["msm"] = {"file": "moves.bin", "index": index}
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, separators=(",", ":"))
    log(f"   {os.path.basename(map_dir)}: {len(index)} classificadores em moves.bin "
        f"({sum(v[1] for v in index.values()) // 1024} KB), {len(names - set(index))} moves sem .msm")
    return index


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "DanceNextNow-converter"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)


def fetch_package(codename, cache_dir):
    os.makedirs(cache_dir, exist_ok=True)
    dest = os.path.join(cache_dir, f"{codename}_mapPackage.bundle")
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    req = urllib.request.Request(NOHUD_URL.format(codename), headers={"User-Agent": "DanceNextNow-converter"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    url = (data.get("assets") or {}).get("mapPackage")
    if not url:
        raise RuntimeError("nohud não tem 'mapPackage' para esse codename")
    log(f"   baixando {url}")
    download(url, dest)
    return dest


def load_songdb(path):
    try:
        with open(path, encoding="utf-8") as f:
            return {s["map"]: s for s in json.load(f)["songs"]}
    except (OSError, ValueError, KeyError):
        return {}


# ---------------------------------------------------------------- conversão
def convert(codename, package, args, songdb):
    map_tree, music_tree, sprites, textassets, monos = read_bundle(package)
    hand_moves = map_tree.pop("_hand_moves", {}) if map_tree else {}
    if args.dump:
        dump_dir = os.path.join(args.cache, "dump", codename or "bundle")
        os.makedirs(dump_dir, exist_ok=True)
        for i, t in enumerate(monos):
            name = t.get("m_Name") or f"mono{i}"
            with open(os.path.join(dump_dir, f"{name}.json"), "w", encoding="utf-8") as f:
                json.dump(t, f, ensure_ascii=False, indent=1, default=str)
        log(f"   árvore crua salva em {dump_dir}")
    if map_tree is None or music_tree is None:
        raise RuntimeError("MonoBehaviour do mapa ou MusicTrack não encontrado (rode com --dump e confira)")

    codename = codename or map_tree.get("MapName") or map_tree.get("m_Name") or "Map"
    out_dir = os.path.join(args.out, codename)
    os.makedirs(out_dir, exist_ok=True)

    m = build_map(codename, map_tree, music_tree, sprites.keys(), songdb.get(codename))

    used = {p["n"] for p in m["pictos"]}
    picto_imgs = {n: img for n, img in sprites.items() if n in used} or sprites
    if picto_imgs:
        size = args.picto_size
        atlas, rects = pack_atlas(picto_imgs, size)
        while atlas.size[1] > 4096 and size > 64:  # limite seguro de textura no WebGL do celular
            size = int(size * 0.8)
            atlas, rects = pack_atlas(picto_imgs, size)
        atlas.save(os.path.join(out_dir, "pictos.png"), optimize=True)
        m["atlas"] = {"file": "pictos.png", "w": atlas.size[0], "h": atlas.size[1], "rects": rects}
    missing = sorted(used - set(picto_imgs))
    if missing:
        log(f"   aviso: {len(missing)} pictos sem imagem (ex.: {missing[:3]})")

    hand_names = {x["n"] for x in m["moves"] if x.get("t", 0) == 0}
    msm = collect_msm(textassets, hand_moves, hand_names)
    index = pack_moves(msm, out_dir)
    m["msm"] = {"file": "moves.bin", "index": index}
    log(f"   {len(index)} classificadores .msm em moves.bin ({len(hand_names - set(index))} moves sem .msm)")

    if args.raw_moves:
        mdir = os.path.join(out_dir, "moves")
        os.makedirs(mdir, exist_ok=True)
        for name, raw in textassets.items():
            fname = name if "." in name else name + ".msm"
            with open(os.path.join(mdir, fname), "wb") as f:
                f.write(raw)

    with open(os.path.join(out_dir, "map.json"), "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, separators=(",", ":"))

    gold = sum(1 for x in m["moves"] if x["g"])
    log(f"   ok: {len(m['moves'])} moves ({gold} gold), {len(m['pictos'])} pictos, "
        f"{len(m['lyrics'])} sílabas, {len(m.get('atlas', {}).get('rects', {}))} imagens no atlas")
    return codename


def update_index(out_dir):
    names = sorted(d for d in os.listdir(out_dir)
                   if os.path.isfile(os.path.join(out_dir, d, "map.json")))
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"version": 1, "maps": names}, f, separators=(",", ":"))
    return names


def main(argv=None):
    ap = argparse.ArgumentParser(description="Converte mapPackage do JD Next para o Dance Next Now")
    ap.add_argument("codenames", nargs="*", help="codenames (mapName do songdb), ex.: ChefKids")
    ap.add_argument("--package", help="usar um .bundle local em vez de baixar")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--songdb", default=DEFAULT_SONGDB)
    ap.add_argument("--cache", default=os.path.join(HERE, ".cache"))
    ap.add_argument("--picto-size", type=int, default=256, help="altura dos pictos no atlas (px)")
    ap.add_argument("--raw-moves", action="store_true", help="também salva cada TextAsset (.msm/.gesture) solto em moves/")
    ap.add_argument("--moves", action="store_true", help=argparse.SUPPRESS)  # compatibilidade: moves.bin agora é sempre gerado
    ap.add_argument("--repack", nargs="+", metavar="PASTA", help="gera moves.bin a partir de pastas de mapa com moves/")
    ap.add_argument("--dump", action="store_true", help="salva as MonoBehaviours cruas em JSON")
    args = ap.parse_args(argv)

    if args.repack:
        for d in args.repack:
            repack(d)
        return 0
    if not args.codenames and not args.package:
        ap.error("informe um ou mais codenames ou --package")
    os.makedirs(args.out, exist_ok=True)
    songdb = load_songdb(args.songdb)

    failures = 0
    jobs = [(None, args.package)] if args.package else [(c, None) for c in args.codenames]
    for codename, package in jobs:
        label = codename or os.path.basename(package)
        log(f"== {label}")
        try:
            pkg = package or fetch_package(codename, args.cache)
            convert(codename, pkg, args, songdb)
        except Exception as e:
            failures += 1
            log(f"   ERRO: {e}")
    names = update_index(args.out)
    log(f"\n{len(names)} mapa(s) no índice: {args.out}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
