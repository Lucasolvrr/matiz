// Executar com: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const CM = require('../js/color.js');
const { ColorGame, generateRound, scoreFor, ROUNDS } = require('../js/game.js');

function seeded(seed) {
  // mulberry32
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('CIEDE2000 confere com os dados de referência de Sharma et al.', () => {
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082]
  ];
  for (const [a, b, expected] of pairs) {
    const d = CM.deltaE2000({ L: a[0], a: a[1], b: a[2] }, { L: b[0], a: b[1], b: b[2] });
    assert.ok(Math.abs(d - expected) < 1e-3, `${d} ≠ ${expected}`);
  }
});

test('conversão sRGB ↔ Lab é estável', () => {
  for (const rgb of [[0, 0, 0], [255, 255, 255], [255, 0, 0], [12, 200, 99], [128, 64, 240]]) {
    assert.deepEqual(CM.labToRgb(CM.rgbToLab(rgb)), rgb);
  }
  assert.equal(CM.labToRgb({ L: 50, a: 120, b: 0 }), null); // fora do gamut
});

test('cada rodada gera 36 cores válidas, únicas e com a resposta exatamente uma vez', () => {
  const rng = seeded(42);
  for (let trial = 0; trial < 40; trial++) {
    for (let r = 0; r < ROUNDS.length; r++) {
      const round = generateRound(r, rng, []);
      assert.equal(round.options.length, 36);
      const hexes = round.options.map((c) => c.hex);
      assert.equal(new Set(hexes).size, 36, 'sem duplicatas');
      assert.equal(hexes.filter((h) => h === round.target.hex).length, 1);
      assert.equal(round.options[round.answerIndex], round.target);
      for (const c of round.options) {
        assert.ok(c.rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
      }
      for (let i = 0; i < 36; i++) {
        for (let j = i + 1; j < 36; j++) {
          assert.ok(CM.deltaE2000(round.options[i].lab, round.options[j].lab) >= 1, 'distinguíveis');
        }
        if (i !== round.answerIndex) {
          assert.ok(CM.deltaE2000(round.target.lab, round.options[i].lab) <= ROUNDS[r].spread + 0.5);
        }
      }
    }
  }
});

test('dificuldade aumenta: distância média às alternativas cai a cada rodada', () => {
  const rng = seeded(7);
  const avg = ROUNDS.map((_, r) => {
    let sum = 0, n = 0;
    for (let k = 0; k < 15; k++) {
      const round = generateRound(r, rng, []);
      round.options.forEach((c, i) => {
        if (i !== round.answerIndex) { sum += CM.deltaE2000(round.target.lab, c.lab); n++; }
      });
    }
    return sum / n;
  });
  for (let i = 1; i < avg.length; i++) assert.ok(avg[i] < avg[i - 1], avg.join(', '));
});

test('pontuação: exata = 100, não exata ≤ 99, decrescente com ΔE', () => {
  for (const cfg of ROUNDS) {
    assert.equal(scoreFor(0, cfg, true), 100);
    assert.ok(scoreFor(0.3, cfg, false) <= 99);
    let prev = 101;
    for (let d = 0.5; d < 60; d += 0.5) {
      const s = scoreFor(d, cfg, false);
      assert.ok(s <= prev && s >= 0);
      prev = s;
    }
  }
  // mesmo erro absoluto pesa mais em rodada difícil
  assert.ok(scoreFor(8, ROUNDS[4], false) < scoreFor(8, ROUNDS[0], false));
});

function fakeClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; },
    clearTimer: () => {},
    advance(ms) {
      t += ms;
      for (const tm of timers.splice(0)) { if (tm.at <= t) tm.fn(); else timers.push(tm); }
    }
  };
}

test('fluxo completo: tempo, bloqueios e pontuação acumulada', () => {
  const clock = fakeClock();
  const game = new ColorGame({ rng: seeded(3), ...clock });
  game.start();
  assert.equal(game.phase, 'ready');
  assert.equal(game.select(0), null, 'não seleciona antes da memorização');

  let expectedTotal = 0;
  for (let r = 0; r < 5; r++) {
    assert.ok(game.beginMemorize());
    assert.equal(game.phase, 'memorize');
    assert.equal(game.select(0), null, 'não seleciona durante a memorização');
    clock.advance(4999);
    assert.equal(game.phase, 'memorize');
    clock.advance(1);
    assert.equal(game.phase, 'guess');

    const idx = r % 2 === 0 ? game.round.answerIndex : (game.round.answerIndex + 1) % 36;
    const res = game.select(idx);
    assert.equal(res.exact, r % 2 === 0);
    if (res.exact) assert.equal(res.score, 100);
    expectedTotal += res.score;
    assert.equal(game.select(idx), null, 'segunda escolha bloqueada');
    assert.equal(game.total, expectedTotal);
    assert.ok(game.advance());
  }
  assert.equal(game.phase, 'final');
  const s = game.summary();
  assert.equal(s.rounds.length, 5);
  assert.equal(s.total, expectedTotal);
  assert.ok(s.total <= 500);

  game.restart();
  assert.equal(game.total, 0);
  assert.equal(game.roundIndex, 0);
});

function neighborAvg(options) {
  let sum = 0, n = 0;
  for (let p = 0; p < 36; p++) {
    const r = Math.floor(p / 6), c = p % 6;
    if (c < 5) { sum += CM.deltaE2000(options[p].lab, options[p + 1].lab); n++; }
    if (r < 5) { sum += CM.deltaE2000(options[p].lab, options[p + 6].lab); n++; }
  }
  return sum / n;
}

test('grade organizada: vizinhas são mais parecidas que num embaralhamento aleatório', () => {
  const rng = seeded(11);
  for (let r = 0; r < ROUNDS.length; r++) {
    let arranged = 0, random = 0;
    for (let k = 0; k < 10; k++) {
      const round = generateRound(r, rng, []);
      arranged += neighborAvg(round.options);
      const shuffled = round.options.slice().sort(() => rng() - 0.5);
      random += neighborAvg(shuffled);
    }
    assert.ok(arranged < random * 0.75, `rodada ${r + 1}: ${arranged / 10} vs ${random / 10}`);
  }
});

test('posição da resposta continua imprevisível', () => {
  const rng = seeded(5);
  const counts = new Array(36).fill(0);
  for (let k = 0; k < 360; k++) counts[generateRound(k % 5, rng, []).answerIndex]++;
  const used = counts.filter((c) => c > 0).length;
  assert.ok(used >= 32, `apenas ${used} posições usadas`);
  assert.ok(Math.max(...counts) < 360 * 0.12, `concentração: ${Math.max(...counts)}`);
});
