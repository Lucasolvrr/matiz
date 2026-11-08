/*
 * game.js — regras e estado do jogo, independentes da interface.
 * A interface apenas observa o estado (on) e chama ações (start, beginMemorize,
 * select, advance, restart). Todas as regras de tempo e bloqueio vivem aqui.
 */
(function (global) {
  'use strict';

  var CM = (typeof module === 'object' && module.exports)
    ? require('./color.js')
    : global.ColorMath;

  var TOTAL_ROUNDS = 5;
  var GRID_SIZE = 36;
  var MEMORIZE_MS = 5000;

  /*
   * Dificuldade por rodada (distâncias em ΔE00):
   *  spread — distância máxima entre a cor original e as alternativas
   *  minSep — separação mínima entre quaisquer duas cores da grade
   * As alternativas ficam mais próximas a cada rodada.
   */
  var ROUNDS = [
    { spread: 30, minSep: 5.0 },
    { spread: 24, minSep: 4.2 },
    { spread: 19, minSep: 3.5 },
    { spread: 14, minSep: 2.8 },
    { spread: 10, minSep: 2.2 }
  ];

  var FEEDBACK = [
    { min: 100, text: 'COR PERFEITA!', tier: 'perfect' },
    { min: 90, text: 'OLHO DE ÁGUIA!', tier: 'eagle' },
    { min: 75, text: 'MUITO BOM!', tier: 'great' },
    { min: 50, text: 'BOM!', tier: 'good' },
    { min: 0, text: 'OLHO RUIM!', tier: 'bad' }
  ];

  var RANKS = [
    { min: 475, text: 'Percepção excepcional' },
    { min: 400, text: 'Memória cromática afiada' },
    { min: 300, text: 'Bom olho para cor' },
    { min: 200, text: 'Ainda calibrando o olhar' },
    { min: 0, text: 'Treine o olhar e tente de novo' }
  ];

  function pickEntry(table, value) {
    for (var i = 0; i < table.length; i++) if (value >= table[i].min) return table[i];
    return table[table.length - 1];
  }

  function pick(table, value) {
    return pickEntry(table, value).text;
  }

  /**
   * Pontuação 0–100 a partir de ΔE00 e da dificuldade da rodada.
   * Curva gaussiana: erros pequenos custam pouco, erros grandes caem rápido.
   * A tolerância k acompanha a dispersão da grade: o mesmo ΔE absoluto pesa
   * mais nas rodadas difíceis, mas acertar o vizinho mais próximo continua
   * valendo ~90 em qualquer rodada. Só a cor exata vale 100.
   */
  function scoreFor(deltaE, roundCfg, exact) {
    if (exact) return 100;
    var k = 4 + roundCfg.spread * 0.35;
    var s = Math.round(100 * Math.exp(-Math.pow(deltaE / k, 2)));
    return Math.max(0, Math.min(99, s));
  }

  /** Precisão perceptual absoluta (independe da rodada): ΔE 0 = 100%, ΔE ≥ 50 = 0%. */
  function precisionFor(deltaE) {
    return Math.max(0, 100 * (1 - deltaE / 50));
  }

  function makeColor(rgb) {
    return { rgb: rgb, hex: CM.rgbToHex(rgb), lab: CM.rgbToLab(rgb) };
  }

  function hueDistance(h1, h2) {
    var d = Math.abs(h1 - h2) % 360;
    return d > 180 ? 360 - d : d;
  }

  /** Cor-alvo aleatória, renderizável, com matiz diferente das rodadas anteriores. */
  function randomTarget(rng, usedHues) {
    for (var attempt = 0; attempt < 5000; attempt++) {
      var lch = {
        L: 38 + rng() * 44,
        C: 22 + rng() * 52,
        h: rng() * 360
      };
      var rgb = CM.labToRgb(CM.lchToLab(lch));
      if (!rgb) continue;
      var fresh = usedHues.every(function (h) { return hueDistance(h, lch.h) >= 40; });
      if (!fresh && attempt < 4000) continue;
      return makeColor(rgb);
    }
    return makeColor([96, 128, 176]);
  }

  function gaussian(rng) {
    var u = 1 - rng();
    var v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Amostra uma cor a uma distância ΔE00 ≈ desired da origem, numa direção
   * aleatória do espaço Lab (varia luminosidade, saturação e matiz juntos).
   * Retorna null se o resultado ficar fora do gamut sRGB.
   */
  function sampleAround(origin, desired, rng) {
    var dL = gaussian(rng) * 0.85;
    var da = gaussian(rng);
    var db = gaussian(rng);
    var n = Math.hypot(dL, da, db) || 1;
    dL /= n; da /= n; db /= n;

    function at(t) {
      return { L: origin.L + dL * t, a: origin.a + da * t, b: origin.b + db * t };
    }

    var lo = 0;
    var hi = desired * 6;
    if (CM.deltaE2000(origin, at(hi)) < desired) return null;
    for (var i = 0; i < 28; i++) {
      var mid = (lo + hi) / 2;
      if (CM.deltaE2000(origin, at(mid)) < desired) lo = mid;
      else hi = mid;
    }
    var lab = at(hi);
    if (lab.L < 2 || lab.L > 98) return null;
    var rgb = CM.labToRgb(lab);
    return rgb ? makeColor(rgb) : null;
  }

  /**
   * Gera as 35 alternativas. Garante: cores válidas em sRGB, nenhum hex repetido,
   * nenhuma igual à original e separação mínima ΔE00 entre todas as cores da grade.
   * As distâncias ao alvo são escalonadas do vizinho mais próximo até spread.
   */
  function generateAlternatives(target, cfg, rng) {
    var count = GRID_SIZE - 1;
    var chosen = [];
    var hexes = {};
    hexes[target.hex] = true;
    var minSep = cfg.minSep;
    var failures = 0;

    while (chosen.length < count) {
      var i = chosen.length;
      var u = Math.pow((i + rng()) / count, 0.85);
      var desired = minSep + (cfg.spread - minSep) * u;
      var c = sampleAround(target.lab, desired, rng);

      var accepted = false;
      if (c && !hexes[c.hex] && CM.deltaE2000(target.lab, c.lab) >= minSep) {
        accepted = true;
        for (var j = 0; j < chosen.length; j++) {
          if (CM.deltaE2000(chosen[j].lab, c.lab) < minSep) { accepted = false; break; }
        }
      }

      if (accepted) {
        chosen.push(c);
        hexes[c.hex] = true;
        failures = 0;
      } else if (++failures > 1500) {
        // Alvo perto da borda do gamut: relaxa a separação aos poucos,
        // nunca abaixo de 1 ΔE00 (limiar aproximado de diferença perceptível).
        minSep = Math.max(1, minSep * 0.9);
        failures = 0;
      }
    }
    return chosen;
  }

  function shuffle(list, rng) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  }

  /**
   * Distância usada para organizar a grade. Prioriza luminosidade e
   * saturação (croma); o matiz pesa menos. Assim, tons de brilho e
   * intensidade parecidos ficam lado a lado e a resposta se camufla.
   */
  function layoutDistance(a, b) {
    var dL = a.lch.L - b.lch.L;
    var dC = a.lch.C - b.lch.C;
    var dh = Math.abs(a.lch.h - b.lch.h) % 360;
    if (dh > 180) dh = 360 - dh;
    var dH = 2 * Math.sqrt(a.lch.C * b.lch.C) * Math.sin((dh / 2) * Math.PI / 180);
    return Math.sqrt(dL * dL + dC * dC + 0.5 * dH * dH);
  }

  /**
   * Arranja as cores na grade 6×6 de forma que vizinhas (horizontal e
   * vertical) sejam parecidas. A cor `pinned` (a resposta) é fixada antes
   * numa posição sorteada uniformemente; as demais partem de uma ordem
   * aleatória e são reorganizadas por recozimento simulado, minimizando a
   * soma das distâncias entre vizinhas. Sem a fixação, a resposta — que é o
   * "centro" do conjunto — iria parar quase sempre no meio da grade.
   */
  function arrangeGrid(colors, rng, pinned) {
    var n = colors.length;
    var side = Math.round(Math.sqrt(n));
    var items = colors.map(function (c) {
      return { color: c, lch: CM.labToLch(c.lab) };
    });

    var dist = [];
    for (var i = 0; i < n; i++) {
      dist.push(new Float64Array(n));
      for (var j = 0; j < i; j++) {
        dist[i][j] = dist[j][i] = layoutDistance(items[i], items[j]);
      }
    }

    var neighbors = [];
    for (var p = 0; p < n; p++) {
      var r = Math.floor(p / side), col = p % side, list = [];
      if (r > 0) list.push(p - side);
      if (r < side - 1) list.push(p + side);
      if (col > 0) list.push(p - 1);
      if (col < side - 1) list.push(p + 1);
      neighbors.push(list);
    }

    // slot[p] = índice da cor na posição p
    var slot = shuffle(colors.map(function (_, k) { return k; }), rng);
    var pinnedIdx = colors.indexOf(pinned);
    var pinPos = Math.floor(rng() * n);
    var cur = slot.indexOf(pinnedIdx);
    slot[cur] = slot[pinPos];
    slot[pinPos] = pinnedIdx;

    // Vizinhas imediatas da resposta pesam mais: as alternativas mais
    // parecidas com ela tendem a ficar encostadas nela (camuflagem).
    var PIN_WEIGHT = 4;
    function localCost(p) {
      var s = 0, nb = neighbors[p];
      for (var k = 0; k < nb.length; k++) {
        var w = (p === pinPos || nb[k] === pinPos) ? PIN_WEIGHT : 1;
        s += w * dist[slot[p]][slot[nb[k]]];
      }
      return s;
    }

    var iterations = 9000;
    var temp = 6;
    var cooling = Math.pow(0.02 / temp, 1 / iterations);
    for (var it = 0; it < iterations; it++, temp *= cooling) {
      var a = Math.floor(rng() * n);
      var b = Math.floor(rng() * n);
      if (a === b || a === pinPos || b === pinPos) continue;
      var before = localCost(a) + localCost(b);
      var t = slot[a]; slot[a] = slot[b]; slot[b] = t;
      var delta = localCost(a) + localCost(b) - before;
      if (delta > 0 && rng() >= Math.exp(-delta / temp)) {
        t = slot[a]; slot[a] = slot[b]; slot[b] = t; // desfaz
      }
    }

    return slot.map(function (k) { return colors[k]; });
  }

  function generateRound(index, rng, usedHues) {
    var cfg = ROUNDS[index];
    var target = randomTarget(rng, usedHues || []);
    var options = arrangeGrid(generateAlternatives(target, cfg, rng).concat([target]), rng, target);
    var answerIndex = options.indexOf(target);
    return {
      number: index + 1,
      config: cfg,
      target: target,
      options: options,
      answerIndex: answerIndex
    };
  }

  /* ------------------------------------------------------------------ */

  function ColorGame(deps) {
    deps = deps || {};
    this.rng = deps.rng || Math.random;
    this.now = deps.now || function () { return performance.now(); };
    this.setTimer = deps.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    this.clearTimer = deps.clearTimer || function (id) { clearTimeout(id); };
    this.listeners = [];
    this._timer = null;
    this.reset();
  }

  ColorGame.TOTAL_ROUNDS = TOTAL_ROUNDS;
  ColorGame.GRID_SIZE = GRID_SIZE;
  ColorGame.MEMORIZE_MS = MEMORIZE_MS;

  ColorGame.prototype.on = function (fn) {
    this.listeners.push(fn);
  };

  ColorGame.prototype._emit = function () {
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](this.phase, this);
  };

  ColorGame.prototype.reset = function () {
    if (this._timer !== null) this.clearTimer(this._timer);
    this._timer = null;
    this.phase = 'idle'; // idle → ready → memorize → guess → result → … → final
    this.roundIndex = -1;
    this.round = null;
    this.results = [];
    this.total = 0;
    this.memorizeEndsAt = 0;
    this._usedHues = [];
  };

  ColorGame.prototype.start = function () {
    this.reset();
    this._nextRound();
  };

  ColorGame.prototype.restart = ColorGame.prototype.start;

  ColorGame.prototype._nextRound = function () {
    this.roundIndex += 1;
    this.round = generateRound(this.roundIndex, this.rng, this._usedHues);
    this._usedHues.push(CM.labToLch(this.round.target.lab).h);
    this.phase = 'ready';
    this._emit();
  };

  /** Inicia os 5 s de memorização. O fim é decidido pelo relógio, não pela renderização. */
  ColorGame.prototype.beginMemorize = function () {
    if (this.phase !== 'ready') return false;
    this.memorizeEndsAt = this.now() + MEMORIZE_MS;
    this.phase = 'memorize';
    this._emit();
    this._scheduleEnd();
    return true;
  };

  ColorGame.prototype._scheduleEnd = function () {
    if (this.phase !== 'memorize') return;
    var self = this;
    var remaining = this.memorizeEndsAt - this.now();
    if (remaining > 0) {
      // Timers podem disparar cedo/tarde; reconfere o relógio a cada disparo.
      this._timer = this.setTimer(function () {
        self._timer = null;
        self._scheduleEnd();
      }, remaining);
      return;
    }
    this.phase = 'guess';
    this._emit();
  };

  ColorGame.prototype.remaining = function () {
    if (this.phase !== 'memorize') return 0;
    return Math.max(0, this.memorizeEndsAt - this.now());
  };

  /** Uma única escolha por rodada; qualquer chamada fora da fase de escolha é ignorada. */
  ColorGame.prototype.select = function (index) {
    if (this.phase !== 'guess') return null;
    if (!(index >= 0 && index < GRID_SIZE)) return null;
    var round = this.round;
    var picked = round.options[index];
    var exact = index === round.answerIndex;
    var deltaE = exact ? 0 : CM.deltaE2000(round.target.lab, picked.lab);
    var score = scoreFor(deltaE, round.config, exact);
    var result = {
      round: round.number,
      target: round.target,
      picked: picked,
      pickedIndex: index,
      answerIndex: round.answerIndex,
      exact: exact,
      deltaE: deltaE,
      precision: precisionFor(deltaE),
      score: score,
      feedback: pick(FEEDBACK, score),
      tier: pickEntry(FEEDBACK, score).tier
    };
    this.results.push(result);
    this.total += score;
    this.phase = 'result';
    this._emit();
    return result;
  };

  ColorGame.prototype.advance = function () {
    if (this.phase !== 'result') return false;
    if (this.roundIndex + 1 >= TOTAL_ROUNDS) {
      this.phase = 'final';
      this._emit();
    } else {
      this._nextRound();
    }
    return true;
  };

  ColorGame.prototype.lastResult = function () {
    return this.results[this.results.length - 1] || null;
  };

  ColorGame.prototype.summary = function () {
    var n = this.results.length;
    var precisionSum = this.results.reduce(function (s, r) { return s + r.precision; }, 0);
    return {
      total: this.total,
      max: TOTAL_ROUNDS * 100,
      averagePrecision: n ? precisionSum / n : 0,
      rounds: this.results.slice(),
      rank: pick(RANKS, this.total)
    };
  };

  var api = {
    ColorGame: ColorGame,
    scoreFor: scoreFor,
    precisionFor: precisionFor,
    generateRound: generateRound,
    ROUNDS: ROUNDS
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.ColorGameLib = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
