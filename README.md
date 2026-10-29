# Dance Next Now — versão HTML

Clone de Just Dance para navegador em **HTML + CSS + JavaScript puro** (sem build, sem Unity),
publicado na **Vercel**, com um conversor em **Python/UnityPy** que extrai a coreografia completa
dos `mapPackage` do Just Dance Next.

- **679 músicas** do `songdb.json`, com busca, categorias e prévia em vídeo + áudio
- **Coreografia completa** buscada no `nohud.jdleaderboards.com` (mesmo fluxo do `jdnextAutomodder_reference.py`)
- **Músicas convertidas:** moves reais, gold moves ("YEAH!"), pictogramas deslizando até o alvo, letra karaokê e escolha de coach
- **3 controles:** celular na mão (acelerômetro/giroscópio), câmera (movimento entre quadros) ou toque no ritmo (tela/ESPAÇO)
- Pontuação estilo JD (13 333, 5 estrelas, SUPERSTAR, MEGASTAR), combo e recordes salvos no navegador
- Funciona em PC, celular deitado e celular em pé

## Estrutura

```
index.html              todas as telas
css/style.css           visual (neon JD Next, responsivo)
js/main.js              troca de telas e teclado
js/select.js            grade de músicas + prévia
js/game.js              partida: vídeo/áudio sincronizados, HUD, pictos, letra, gold
js/results.js           resultado
js/settings*.js         ajustes (localStorage)
js/timing.js            relógio musical (markers), batidas e pontuação
js/input.js             sensor de movimento, câmera, wake lock
js/data.js              songdb, nohud, mapas convertidos, fallback de mídia
data/songdb.min.json    lista compacta de músicas
data/maps/              mapas convertidos (index.json + <Codename>/map.json + pictos.png)
api/proxy.js            Edge Function de reserva para mídia
vercel.json             rewrites /cdn e /nohud
Tools/jdnext_map_converter.py   mapPackage -> data/maps (UnityPy)
Tools/build_songdb.py           songdb.json -> data/songdb.min.json
.github/workflows/convert-maps.yml   conversão de mapas pelo GitHub (dá pra fazer pelo celular)
```

## Publicar na Vercel (dá pra fazer tudo pelo celular)

1. Crie um repositório no GitHub e suba os arquivos desta pasta.
2. Na Vercel: **Add New > Project**, importe o repositório.
   Framework Preset: **Other**. Build Command e Output Directory: vazios. **Deploy.**
3. Pronto. Cada commit no `main` vira um novo deploy automático.

Testar no PC: `npx vercel dev` (os rewrites `/cdn` e `/nohud` só existem no servidor da Vercel;
um `python -m http.server` comum abre a interface, mas não busca as coreografias).

## Converter coreografias (UnityPy)

**Pelo celular:** no GitHub, aba **Actions > "Converter mapas (mapPackage)" > Run workflow**,
digite os codenames (o `mapName` do songdb, ex.: `ChefKids Starships`). O workflow converte, faz commit em
`data/maps/` e a Vercel publica sozinha.

**No PC/Termux:**

```
pip install UnityPy Pillow
python3 Tools/jdnext_map_converter.py ChefKids Starships
python3 Tools/jdnext_map_converter.py --package caminho/mapPackage.bundle
python3 Tools/jdnext_map_converter.py ChefKids --dump        # árvore crua em Tools/.cache/dump/
```

O que sai do bundle:

| No mapPackage | No map.json |
|---|---|
| `MusicTrack` (markers, startBeat, endBeat, videoStartTime) | `timing` |
| `DanceData.MotionClips` | `moves` (início, duração, coach, gold) |
| `DanceData.PictoClips` + sprites do `PictogramAtlas` | `pictos` + `pictos.png` |
| `KaraokeData.Clips` | `lyrics` |
| `GoldEffectClips` / `HideHudClips` | `gold` / `hideHud` |
| `HandDeviceMoveModels` (.msm) | `moves/*.msm` com `--moves` |

Tempos em ticks (24 por batida), convertidos com os markers como na UbiArt/JustDanceEditor:
`tempoÁudio(b) = S(b) − S(startBeat)` e `tempoVídeo = tempoÁudio + S(startBeat) − videoStartTime`.

## Como a mídia é carregada

Vídeo e áudio tocam **direto do CDN da Ubisoft** (não gasta a banda da Vercel). Se o CDN recusar,
o jogo tenta de novo por `/cdn/...` (rewrite da Vercel). O JSON do nohud sempre passa por `/nohud/...`, por causa do CORS.

## Atalhos

Setas para navegar, Enter para dançar, `/` para buscar, Esc para pausar/voltar, ESPAÇO (ou J/F) no modo toque.

## Limitações

- A nota é **por movimento**, pela intensidade e pelo ritmo do seu movimento; não compara o gesto exato
  (para isso seria preciso rodar os classificadores `.msm`).
- Capas são bundles de Switch: os cartões usam a cor da música e a prévia em vídeo.
- Depende do CDN da Ubisoft e do nohud. Se o nohud falhar, dá para jogar a prévia de 30 s.
- iPhone: o sensor é liberado no toque em "DANÇAR!"; vídeo `.webm` exige iOS 17.4+.

Formato do mapPackage conferido em [JustDanceEditor](https://github.com/MrKev312/JustDanceEditor) (MrKev312)
e [Unity2UbiArt](https://github.com/Itaybl14/Unity2UbiArt) (Itaybl14).

Projeto de fã, sem fins lucrativos. Just Dance é marca da Ubisoft. Nenhum vídeo ou música fica hospedado no projeto.
