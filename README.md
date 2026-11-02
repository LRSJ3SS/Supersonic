# Dance Next Now

Clone de Just Dance **no estilo Just Dance Now**: a **tela** roda no computador/TV e cada
**celular vira um controle** que você segura na mão. Os movimentos são avaliados pelos
classificadores **.msm originais** das coreografias do Just Dance Next.

- **Sala com código + QR code:** até 6 celulares por sala, cada um com cor e coach próprios
- **Controle remoto no celular:** setas e OK para escolher a música, pausar, jogar de novo
- **Nota pelos .msm:** o acelerômetro do celular é comparado ao classificador de cada move
  (perfil JD Next: PERFECT / SUPER / GOOD / OK / X, gold move vale 5x e dá YEAH!)
- **679 músicas** do songdb com prévia em vídeo; vídeo sem HUD do nohud, pictos, letra karaokê e gold moves
- Ranking no fim, na tela e em cada celular

## Como jogar

1. Abra o site no computador. Aparece o **código da sala** e um QR code.
2. No celular, leia o QR (ou abra `/controller.html`), digite seu nome e toque em **ENTRAR**.
   No iPhone, permita o acesso ao sensor de movimento quando pedir.
3. Escolha a música no PC (mouse/teclado) ou pelo controle do celular, e dance segurando o
   celular na **mão direita, com a tela virada para você**.

Músicas com a etiqueta **COMPLETA** têm moves, pictos e .msm convertidos. As outras também
tocam, mas a nota vem só da energia do movimento.

## Como funciona a conexão

Tela e celulares conversam por **WebRTC** (PeerJS). O servidor público do PeerJS só apresenta
os aparelhos; depois os dados vão direto entre eles (ou pelos servidores TURN públicos do PeerJS,
se as redes forem diferentes). Na mesma rede Wi-Fi a latência é menor.

Cada celular sincroniza o relógio com a tela (ping a cada 2 s, menor RTT vence) e manda o
acelerômetro em lotes de 50 ms com o tempo já convertido. A tela avalia cada move ~0,4 s depois
que ele termina, usando a janela deslizante do JD Now (7 subjanelas de −75 ms a +75 ms) e
um ponteiro que aprende o atraso de cada jogador.

Teste com servidor PeerJS próprio: `?peer=host:porta` na URL da tela (o QR leva junto).

## Ajustes da tela

Qualidade do vídeo, sincronia das batidas, atraso do vídeo, volume e **eixos do celular**:
`JD Next (padrão)` usa a convenção dos apps Unity/CoreMotion (em g, deitado com a tela para cima = z −1);
`Invertido` troca os sinais; `JD Now` aplica a rotação de 30° do app JD Now. Se a nota parecer
baixa mesmo dançando certo, teste outro perfil de eixos.

## Converter coreografias (UnityPy)

No GitHub: **Actions > "Converter mapas (mapPackage)" > Run workflow** e digite os codenames
(o `mapName` do songdb, ex.: `Kitipo OneLastTime`). O workflow gera e faz commit em `data/maps/<Codename>/`:

| Arquivo | Conteúdo |
|---|---|
| `map.json` | timing, moves (início, duração, coach, gold, tipo), pictos, letra, gold, hideHud |
| `pictos.png` | atlas com os pictogramas |
| `moves.bin` | todos os classificadores .msm do celular (`HandDeviceMoveModels`) num arquivo só |

Local: `pip install UnityPy Pillow` e `python3 Tools/jdnext_map_converter.py Kitipo`.
Mapas antigos com pasta `moves/`: `python3 Tools/jdnext_map_converter.py --repack data/maps/Kitipo`.

## Estrutura

```
index.html / js/main.js       tela: título com sala, escolha, partida, resultado
controller.html / js/controller.js   controle no celular
js/room.js, js/net.js         sala (PeerJS), protocolo, QR
js/msm.js                     leitor e avaliador .msm (MoveSpace)
js/player-scorer.js           nota de cada jogador (janelas, pontos, combo)
js/game.js                    vídeo/áudio sincronizados, HUD dos jogadores, pictos, letra
js/data.js, js/timing.js      songdb, nohud, mapas convertidos, relógio musical
js/vendor/                    PeerJS 1.5.5 e qrcode-generator 1.4.4 (MIT)
Tools/                        conversor de mapPackage e do songdb
```

## Licença e créditos

O avaliador de .msm (`js/msm.js`, `js/player-scorer.js`) é um port do
[JustDanceEditor](https://github.com/MrKev312/JustDanceEditor) (MrKev312), licenciado sob **GPL-3.0**;
por isso este projeto também é distribuído sob a GPL-3.0 (arquivo `LICENSE`).
Formato do mapPackage conferido também em [Unity2UbiArt](https://github.com/Itaybl14/Unity2UbiArt).

Projeto de fã, sem fins lucrativos. Just Dance é marca da Ubisoft. Nenhum vídeo ou música fica
hospedado no projeto; tudo é carregado dos servidores originais.
