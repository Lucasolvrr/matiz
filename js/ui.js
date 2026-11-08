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
  var VIEW_MS = reduceMotion ? 0 : 280;
  var RING = 2 * Math.PI * 26; // circunferência do anel do cronômetro

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
      document.body.dataset.view = next.id.replace('view-', '');
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
    el.statusTotal.textContent = String(game.total);
  }

  /* ---------- Memorização ---------- */

  function renderMemorize() {
    el.memoSwatch.style.background = game.round.target.hex;
    el.timerNum.textContent = String(ColorGame.MEMORIZE_MS / 1000);
    el.timerFill.style.strokeDashoffset = String(RING); // anel vazio; fecha ao longo dos 5 s
    el.status.classList.add('is-timing');
  }

  function tickCountdown() {
    cancelAnimationFrame(rafId);
    function frame() {
      if (game.phase !== 'memorize') return;
      var rem = game.remaining();
      el.timerNum.textContent = String(Math.ceil(rem / 1000));
      el.timerFill.style.strokeDashoffset = String(RING * rem / ColorGame.MEMORIZE_MS);
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
    cells[result.answerIndex].classList.add('is-answer');
    cells[result.pickedIndex].classList.add('is-picked');
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
    el.resFeedback.textContent = r.feedback;
    el.resFeedback.className = 'tier-' + r.tier;
    $('res-round').textContent = 'Rodada ' + r.round + ' de ' + ColorGame.TOTAL_ROUNDS;
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
    el.finalBest.textContent = isRecord ? s.total + ' ★' : String(best);

    var frag = document.createDocumentFragment();
    s.rounds.forEach(function (r) {
      var li = document.createElement('li');
      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = r.round + '.';
      var pair = document.createElement('span');
      pair.className = 'pair';
      pair.title = r.target.hex + ' → ' + r.picked.hex;
      [r.target.hex, r.picked.hex].forEach(function (hex) {
        var i = document.createElement('i');
        i.style.background = hex;
        pair.appendChild(i);
      });
      var label = document.createElement('span');
      label.className = 'label tier-' + r.tier;
      label.textContent = r.feedback;
      var pts = document.createElement('span');
      pts.className = 'pts';
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
        el.timerNum.textContent = '0';
        el.timerFill.style.strokeDashoffset = '0';
        el.status.classList.remove('is-timing');
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
  el.btnNext.addEventListener('click', function () { game.advance(); });

  /* ---------- Inicial ---------- */

  var best = readBest();
  if (best > 0) {
    el.introBest.innerHTML = 'Seu recorde: <b>' + best + '</b> / 500';
    el.introBest.hidden = false;
  }
  views.intro.classList.add('is-active');
})();
