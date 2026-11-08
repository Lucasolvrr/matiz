# matiz

Jogo de memória cromática: memorize uma cor por 5 segundos e encontre-a entre 36 tons parecidos. 5 rodadas, até 500 pontos.

## Rodar

Abra `index.html` no navegador. Não há build nem dependências.

Tipografia: **Gliker** (domínio público, arquivos em `fonts/`) nos títulos e destaques; **Figtree** (Google Fonts) nos textos e elementos funcionais.

## Testes

```sh
node --test tests/game.test.js
```

## Estrutura

| Arquivo | Papel |
|---|---|
| `js/color.js` | sRGB ↔ CIELAB/LCh e diferença CIEDE2000 (ΔE00) |
| `js/game.js` | Regras e estado: geração das rodadas, cronômetro, bloqueios, pontuação |
| `js/ui.js` | Interface; só renderiza o estado e repassa ações ao jogo |
| `styles.css` | Visual |

## Como funciona

- **Cor-alvo:** sorteada em LCh (L 38–82, C 22–74), sempre dentro do gamut sRGB e com matiz a pelo menos 40° das rodadas anteriores.
- **Alternativas:** 35 cores amostradas em direções aleatórias do espaço Lab (luminosidade, saturação e matiz variam juntos), com distâncias ΔE00 escalonadas de `minSep` até `spread`. Nenhuma duplicata, todas renderizáveis e separadas entre si por pelo menos `minSep` (nunca menos de 1 ΔE00).
- **Organização da grade:** a resposta é fixada numa posição sorteada uniformemente; as outras 35 cores são reorganizadas (recozimento simulado) para que vizinhas tenham luminosidade e saturação parecidas, com peso extra nas vizinhas imediatas da resposta. Resultado: a grade forma degradês suaves e a cor certa se camufla entre as mais parecidas com ela, sem que sua posição fique previsível.
- **Dificuldade:** `spread`/`minSep` caem de 30/5 na rodada 1 para 10/2,2 na rodada 5.
- **Pontuação:** a cor exata vale 100. Qualquer outra vale `round(100 · e^-(ΔE/k)²)`, limitado a 99, com `k = 4 + 0,35 · spread`. O mesmo erro custa mais nas rodadas difíceis, e o vizinho mais próximo vale cerca de 86–90 pontos em qualquer rodada.
- **Precisão:** medida absoluta, `100 · (1 − ΔE/50)`.
- **Tempo:** os 5 s começam quando a cor está totalmente visível. O fim é decidido por `performance.now()` dentro de `game.js`, não pela animação. Escolhas fora da fase de identificação, ou uma segunda escolha, são ignoradas pelo motor do jogo.
