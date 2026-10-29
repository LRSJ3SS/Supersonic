#!/usr/bin/env python3
"""
Converte o songdb.json do Just Dance Next (formato completo, ~6 MB) no
songdb.min.json compacto usado pelo Dance Next Now.

Uso:
    python3 Tools/build_songdb.py caminho/songdb.json
Saída:
    data/songdb.min.json
"""
import json
import os
import sys

CDN_PREFIX = "https://jd-s3.cdn.ubi.com/"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "songdb.min.json")


def strip_cdn(url):
    """Guarda só o caminho; o jogo prefixa com /cdn/ (proxy da Vercel)."""
    return url[len(CDN_PREFIX):] if url and url.startswith(CDN_PREFIX) else (url or "")


def main(src):
    with open(src, encoding="utf-8") as f:
        db = json.load(f)

    songs = []
    for map_id, s in db.items():
        assets = s.get("assets", {})
        trk = {}
        try:
            trk = json.loads(s.get("assetsMetadata", {}).get("audioPreviewTrk") or "{}")
        except ValueError:
            pass
        markers = trk.get("Markers") or []
        # marcadores vêm em samples a 48 kHz -> milissegundos
        beats_ms = [int(round(m / 48.0)) for m in markers]
        songs.append({
            "id": map_id,
            "map": s.get("mapName", ""),
            "title": s.get("title", ""),
            "artist": s.get("artist", ""),
            "coaches": s.get("coachCount", 1),
            "diff": s.get("difficulty", 1),
            "sweat": s.get("sweatDifficulty", 1),
            "len": round(float(s.get("mapLength") or 0), 3),
            "ver": s.get("originalJDVersion", 0),
            "color": s.get("lyricsColor", "#FFFFFFFF"),
            "tags": [t for t in s.get("tags", []) if not t.startswith("songpack_")],
            "pv": strip_cdn(assets.get("videoPreview_MID.vp8.webm") or assets.get("videoPreview_LOW.vp8.webm")),
            "pa": strip_cdn(assets.get("audioPreview.opus")),
            "startBeat": trk.get("StartBeat", 0),
            "endBeat": trk.get("EndBeat", 0),
            "videoStart": trk.get("VideoStartTime", 0),
            "previewEntry": trk.get("PreviewEntry", 0),
            "beats": beats_ms,
        })

    songs.sort(key=lambda x: x["title"].lower())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "songs": songs}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(songs)} músicas -> {os.path.normpath(OUT)} ({os.path.getsize(OUT)//1024} KB)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("uso: build_songdb.py songdb.json")
    main(sys.argv[1])
