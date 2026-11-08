/*
 * ui.js — interface. Apenas renderiza o estado do ColorGame e repassa ações;
 * nenhuma regra de jogo (tempo, pontuação, bloqueio) é decidida aqui.
 */
(function () {
  'use strict';

  var ColorGame = window.ColorGameLib.ColorGame;
  var game = new ColorGame();

  var REVEAL_MS = 1300;
  var BEST_KEY = 'matiz.best';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var VIEW_MS = reduceMotion ? 0 : 180;
  var CRITICAL_MS = 2000; // célula de tempo inverte e pisca nos 2 s finais
  var DARK_VIEWS = { result: true, final: true }; // camadas por cima do jogo

  function $(id) { return document.getElementById(id); }

  var views = {
    intro: $('view-intro'),
    memorize: $('view-memorize'),
    guess: $('view-guess'),
    result: $('view-result'),
    final: $('view-final')
  };

  var el = {
    status: $('status'),
    statusRound: $('status-round'),
    statusTotal: $('status-total'),
    memoSwatch: $('memo-swatch'),
    timerFill: $('timer-fill'),
    timerNum: $('timer-num'),
    grid: $('grid'),
    resTarget: $('res-target'),
    resPicked: $('res-picked'),
    resTargetHex: $('res-target-hex'),
    resPickedHex: $('res-picked-hex'),
    resFeedback: $('res-feedback'),
    resScore: $('res-score'),
    resPrecision: $('res-precision'),
    resDelta: $('res-delta'),
    btnNext: $('btn-next'),
    finalTotal: $('final-total'),
    finalRank: $('final-rank'),
    finalPrecision: $('final-precision'),
    finalBest: $('final-best'),
    finalRounds: $('final-rounds'),
    introBest: $('intro-best')
  };

  /* Cada mudança de fase incrementa o token; callbacks assíncronos antigos
     (transições, revelação) são descartados se o jogo foi reiniciado. */
  var token = 0;
  var rafId = 0;

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function fmt(n, digits) {
    return n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function readBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; }
  }

  function writeBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* armazenamento indisponível */ }
  }

  var viewTimer = 0;
  var shownTimer = 0;

  /* Troca de etapa com fade. Uma troca nova cancela qualquer troca pendente,
     então reinícios no meio de uma transição nunca deixam telas sobrepostas. */
  function showView(next, onShown) {
    clearTimeout(viewTimer);
    clearTimeout(shownTimer);
    var leaving = Object.keys(views)
      .map(function (k) { return views[k]; })
      .filter(function (v) { return v !== next && !v.hidden; });
    leaving.forEach(function (v) { v.classList.remove('is-active'); });

    viewTimer = setTimeout(function () {
      leaving.forEach(function (v) { v.hidden = true; });
      if (next.hidden) {
        next.hidden = false;
        void next.offsetWidth; // força reflow para a transição de entrada
      }
      var name = next.id.replace('view-', '');
      document.body.dataset.view = name;
      document.body.dataset.theme = DARK_VIEWS[name] ? 'dark' : 'light';
      $('btn-howto').hidden = name !== 'intro';
      next.classList.add('is-active');
      shownTimer = setTimeout(function () { if (onShown) onShown(); }, VIEW_MS);
    }, leaving.length ? VIEW_MS * 0.6 : 0);
  }

  function updateStatus() {
    var playing = game.phase !== 'idle' && game.phase !== 'final';
    el.status.hidden = !playing;
    $('btn-restart').hidden = !playing;
    if (!playing) return;
    el.statusRound.textContent = game.round.number + '/' + ColorGame.TOTAL_ROUNDS;
    if (el.statusTotal.textContent !== String(game.total)) {
      el.statusTotal.textContent = String(game.total);
      el.statusTotal.classList.remove('tick');
      void el.statusTotal.offsetWidth;
      el.statusTotal.classList.add('tick');
    }
  }

  var gainTimer = 0;
  function showGain(score) {
    var gain = $('status-gain');
    gain.textContent = '+' + score;
    gain.classList.add('is-on');
    clearTimeout(gainTimer);
    gainTimer = setTimeout(function () { gain.classList.remove('is-on'); }, 600);
  }

  /* Barra de tempo: avança em degraus de 100 ms (50 segmentos). */
  function setTimer(rem) {
    var steps = Math.ceil(rem / 100);
    el.timerNum.textContent = String(Math.ceil(rem / 1000));
    $('timer-meta').textContent = fmt(steps / 10, 1) + ' s';
    el.timerFill.style.width = (steps / (ColorGame.MEMORIZE_MS / 100) * 100) + '%';
    $('hud-time').classList.toggle('is-critical', rem > 0 && rem <= CRITICAL_MS);
  }

  /* ---------- Memorização ---------- */

  function renderMemorize() {
    el.memoSwatch.style.background = game.round.target.hex;
    setTimer(ColorGame.MEMORIZE_MS);
  }

  function tickCountdown() {
    cancelAnimationFrame(rafId);
    function frame() {
      if (game.phase !== 'memorize') return;
      setTimer(game.remaining());
      rafId = requestAnimationFrame(frame);
    }
    frame();
  }

  /* ---------- Grade ---------- */

  function renderGrid() {
    var frag = document.createDocumentFragment();
    game.round.options.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.dataset.index = String(i);
      b.style.background = c.hex;
      b.setAttribute('aria-label', 'Opção ' + (i + 1) + ' de ' + ColorGame.GRID_SIZE);
      frag.appendChild(b);
    });
    el.grid.className = 'grid';
    el.grid.replaceChildren(frag);
    var stamp = $('stamp');
    stamp.className = 'stamp';
    stamp.textContent = '';
  }

  el.grid.addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (!cell) return;
    var result = game.select(Number(cell.dataset.index));
    if (!result) return; // fora da fase de escolha ou já respondido
    reveal(result);
  });

  function reveal(result) {
    var t = token;
    var cells = el.grid.children;
    el.grid.classList.add('is-locked', 'is-revealed');
    var answer = cells[result.answerIndex];
    answer.classList.add('is-answer');
    cells[result.pickedIndex].classList.add('is-picked');

    // ✱ em caixa satélite na resposta certa
    var star = document.createElement('span');
    star.className = 'cell-star';
    star.setAttribute('aria-hidden', 'true');
    star.innerHTML = '<svg class="star"><use href="#i-star"/></svg>';
    answer.appendChild(star);

    // carimbo: acerto exato com extrusão; erro só com contorno
    var stamp = $('stamp');
    stamp.textContent = result.exact ? 'Acertou!' : 'Errou!';
    stamp.className = 'stamp is-on ' + (result.exact ? 't-extrude' : 'is-miss');
    showGain(result.score);
    setTimeout(function () {
      if (t !== token) return;
      renderResult(result);
      showView(views.result, function () { el.btnNext.focus({ preventScroll: true }); });
    }, reduceMotion ? 600 : REVEAL_MS);
  }

  /* ---------- Resultado ---------- */

  function renderResult(r) {
    el.resTarget.style.background = r.target.hex;
    el.resPicked.style.background = r.picked.hex;
    el.resTargetHex.textContent = r.target.hex;
    el.resPickedHex.textContent = r.picked.hex;
    // a última palavra do veredito recebe a extrusão (uma por tela)
    var words = r.feedback.split(' ');
    var last = document.createElement('span');
    last.className = 't-extrude';
    last.textContent = words.pop();
    el.resFeedback.replaceChildren(document.createTextNode(words.length ? words.join(' ') + ' ' : ''), last);
    $('res-round').textContent = 'Rodada ' + pad(r.round);
    el.resScore.textContent = '+' + r.score;
    el.resPrecision.innerHTML = fmt(r.precision, 0) + '<small>%</small>';
    el.resDelta.textContent = fmt(r.deltaE, 1);
    $('btn-next-label').textContent = r.round >= ColorGame.TOTAL_ROUNDS ? 'Ver resultado' : 'Próxima rodada';
  }

  function renderFinal() {
    var s = game.summary();
    var best = readBest();
    var isRecord = s.total > best;
    if (isRecord) writeBest(s.total);

    el.finalTotal.textContent = String(s.total);
    el.finalRank.textContent = s.rank;
    el.finalPrecision.innerHTML = fmt(s.averagePrecision, 0) + '<small>%</small>';
    el.finalBest.textContent = String(isRecord ? s.total : best);

    var topScore = Math.max.apply(null, s.rounds.map(function (r) { return r.score; }));
    var topMarked = false;
    var frag = document.createDocumentFragment();
    s.rounds.forEach(function (r) {
      var li = document.createElement('li');
      if (!topMarked && r.score === topScore) { li.className = 'is-top'; topMarked = true; }
      var n = document.createElement('span');
      n.className = 'meta';
      n.textContent = pad(r.round);
      var pair = document.createElement('span');
      pair.className = 'pair-sw';
      pair.title = 'Original ' + r.target.hex + ', sua escolha ' + r.picked.hex;
      [r.target.hex, r.picked.hex].forEach(function (hex) {
        var i = document.createElement('i');
        i.style.background = hex;
        pair.appendChild(i);
      });
      var label = document.createElement('span');
      label.className = 'eyebrow';
      label.textContent = r.feedback;
      var pts = document.createElement('span');
      pts.className = 'stat';
      pts.textContent = String(r.score);
      li.append(n, pair, label, pts);
      frag.appendChild(li);
    });
    el.finalRounds.replaceChildren(frag);
  }

  /* ---------- Reação às fases do jogo ---------- */

  game.on(function (phase) {
    token++;
    updateStatus();

    switch (phase) {
      case 'ready':
        cancelAnimationFrame(rafId);
        renderMemorize();
        // O relógio de 5 s só começa quando a cor está totalmente visível.
        showView(views.memorize, function () { game.beginMemorize(); });
        break;
      case 'memorize':
        tickCountdown();
        break;
      case 'guess':
        cancelAnimationFrame(rafId);
        setTimer(0);
        el.memoSwatch.style.background = 'transparent'; // remove a referência por completo
        renderGrid();
        showView(views.guess);
        break;
      case 'final':
        renderFinal();
        showView(views.final);
        break;
    }
  });

  /* ---------- Botões ---------- */

  $('btn-start').addEventListener('click', function () { game.start(); });
  $('btn-again').addEventListener('click', function () { game.restart(); });
  $('btn-restart').addEventListener('click', function () { game.restart(); });
  $('btn-howto').addEventListener('click', function () {
    var rules = $('rules');
    rules.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    rules.focus({ preventScroll: true });
  });
  el.btnNext.addEventListener('click', function () { game.advance(); });

  /* Logo: volta à tela inicial. A partida em andamento é descartada
     (game.reset() também cancela o cronômetro de memorização). */
  $('btn-home').addEventListener('click', function () {
    token++; // invalida revelações e transições pendentes
    cancelAnimationFrame(rafId);
    game.reset();
    updateStatus();
    renderBest();
    showView(views.intro);
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  /* ---------- Inicial ---------- */

  function renderBest() {
    var best = readBest();
    el.introBest.hidden = best <= 0;
    if (best > 0) el.introBest.innerHTML = 'Seu recorde: <b>' + best + '</b> / 500';
  }

  renderBest();
  views.intro.classList.add('is-active');
})();
