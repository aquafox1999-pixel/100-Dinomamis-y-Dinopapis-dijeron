(() => {
  'use strict';

  const TEAMS = { left: 'Dinomamis', right: 'Dinopapis' };
  const ANSWER_COUNT = 5;
  const STRIKE_COUNT = 3;
  const SOUND_KEY = 'dinomamis.sound';

  const $ = (id) => document.getElementById(id);

  const el = {
    brand: $('brand'),
    logo: $('logo'),
    teamLeft: $('teamLeft'),
    teamRight: $('teamRight'),
    scoreLeft: $('scoreLeft'),
    scoreRight: $('scoreRight'),
    roundLabel: $('roundLabel'),
    stateChip: $('stateChip'),
    bankValue: $('bankValue'),
    roundStatus: $('roundStatus'),
    question: $('question'),
    answers: $('answers'),
    strikeDots: $('strikeDots'),
    status: $('status'),
    flash: $('flash'),
    banner: $('banner'),
    winner: $('winner'),
    winnerTitle: $('winnerTitle'),
    winnerScore: $('winnerScore'),
    conn: $('conn'),
    connText: $('connText'),
    soundBtn: $('soundBtn')
  };

  const socket = io();

  const carousel = document.getElementById('cardCarousel');
  const cardImages = carousel ? Array.from(carousel.querySelectorAll('img')) : [];
  let cards = [];
  let cardIndex = -1;
  let visibleLayer = 0;
  let cardTimer = 0;
  let cardsRequest = 0;
  let cardTransition = 0;

  function showCard(index) {
    if (!cards.length || !carousel || cardImages.length < 2) return;
    cardIndex = index % cards.length;
    const name = cards[cardIndex];
    const transition = ++cardTransition;
    const preload = new Image();
    preload.onload = () => {
      if (transition !== cardTransition) return;
      const nextLayer = 1 - visibleLayer;
      const next = cardImages[nextLayer];
      next.src = preload.src;
      next.alt = 'Tarjeta para los invitados';
      next.removeAttribute('aria-hidden');
      cardImages[visibleLayer].setAttribute('aria-hidden', 'true');
      cardImages[visibleLayer].alt = '';
      carousel.hidden = false;
      // Asegura un cuadro inicial antes de comenzar el fundido.
      requestAnimationFrame(() => {
        if (transition !== cardTransition) return;
        next.classList.add('is-visible');
        cardImages[visibleLayer].classList.remove('is-visible');
        visibleLayer = nextLayer;
      });
    };
    preload.onerror = () => {
      // Si una tarjeta no existe, se intenta la siguiente en el proximo turno.
    };
    preload.src = '/img/tarjetas/' + encodeURIComponent(name);
  }

  async function refreshCards() {
    if (!carousel || cardImages.length < 2) return;
    const request = ++cardsRequest;
    try {
      const response = await fetch('/cards.json', { cache: 'no-store' });
      if (!response.ok) return;
      const list = await response.json();
      if (request !== cardsRequest || !Array.isArray(list)) return;
      const current = cards[cardIndex];
      cards = [...new Set(list.filter(name => typeof name === 'string' &&
        !/[\\/]/.test(name) && /\.(png|jpe?g|gif|webp)$/i.test(name)))];
      clearInterval(cardTimer);
      ++cardTransition;
      if (!cards.length) {
        carousel.hidden = true;
        cardIndex = -1;
        cardImages.forEach(img => img.classList.remove('is-visible'));
        return;
      }
      cardIndex = cards.indexOf(current);
      if (cardIndex < 0) {
        carousel.hidden = true;
        cardImages.forEach(img => img.classList.remove('is-visible'));
      }
      if (cardIndex < 0 || carousel.hidden) showCard(Math.max(0, cardIndex));
      if (cards.length > 1) cardTimer = setInterval(() => showCard(cardIndex + 1), 10000);
    } catch (error) {
      // Conserva las tarjetas actuales si se pierde la conexion.
    }
  }
  socket.on('cards:updated', refreshCards);
  socket.on('connect', refreshCards);
  refreshCards();

  let renderedRound = null;
  let revealedSeen = new Set();
  let prevScores = { left: 0, right: 0 };
  let primed = false;
  let lastEventId = 0;
  let bannerTimer = 0;
  let audioReady = false;

  let soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (_) {}

  const audioCorrecto = new Audio('audio/correcto.mp3');
  const audioError = new Audio('audio/error.mp3');
  const audioRobo = new Audio('audio/robo.mp3');
  const audioInicio = new Audio('audio/inicio.mp3');

  function teamName(side) {
    return TEAMS[side] || 'los dos equipos';
  }

  function formatScore(value) {
    return String(value).padStart(3, '0');
  }

  function setConnection(ok) {
    el.conn.classList.toggle('is-ok', ok);
    el.conn.classList.toggle('is-bad', !ok);
    el.connText.textContent = ok ? 'En vivo' : 'Reconectando…';
  }

  function updateSoundButton() {
    el.soundBtn.textContent = soundOn ? 'Sonido: ON' : 'Sonido: OFF';
    el.soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  }

  function unlockAudio() {
    if (soundOn) GameEffects.unlockBuzzer();
    if (!soundOn || audioReady) return;
    audioReady = true;
    [audioCorrecto, audioError, audioRobo, audioInicio].forEach((audio) => {
      audio.load();
    });
  }

  function playSound(audio) {
    if (!soundOn || !audioReady) return;
    const clone = audio.cloneNode();
    clone.volume = 1;
    clone.play().catch(() => {});
  }

  function playReveal() {
    playSound(audioCorrecto);
  }

  function playStrike() {
    playSound(audioError);
  }

  function playFaceoff() {
    playSound(audioInicio);
  }

  function playSteal() {
    playSound(audioRobo);
  }

  function playWin() {
    playSound(audioCorrecto);
  }

  function buildAnswers() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < ANSWER_COUNT; i += 1) {
      const item = document.createElement('li');
      item.className = 'answer';
      item.dataset.index = String(i);
      item.innerHTML =
        '<span class="answer__num">' + (i + 1) + '.-</span>' +
        '<span class="answer__text"></span>' +
        '<span class="answer__leader"></span>' +
        '<span class="answer__points"></span>';
      fragment.appendChild(item);
    }
    el.answers.replaceChildren(fragment);
  }

  function buildStrikes() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < STRIKE_COUNT; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'strike-dot';
      fragment.appendChild(dot);
    }
    el.strikeDots.replaceChildren(fragment);
  }

  function bumpScore(node, value, previous) {
    node.textContent = formatScore(value);
    if (value !== previous) {
      node.classList.remove('is-bump');
      void node.offsetWidth;
      node.classList.add('is-bump');
    }
  }

  function phaseLabel(phase) {
    if (phase === 'faceoff') return 'Cara a cara';
    if (phase === 'playing') return 'En juego';
    if (phase === 'steal') return 'Robo';
    if (phase === 'roundEnd') return 'Fin de ronda';
    if (phase === 'gameOver') return 'Fin del juego';
    return 'En espera';
  }

  function statusText(state) {
    if (state.phase === 'faceoff') return 'Esperá la señal…';
    if (state.phase === 'playing') {
      return 'Turno de ' + teamName(state.control) + ' · Equis ' + state.strikes + '/' + STRIKE_COUNT;
    }
    if (state.phase === 'steal') return '¡Oportunidad de robo!';
    if (state.phase === 'roundEnd') return 'Fin de la ronda';
    if (state.phase === 'gameOver') return '¡Gracias por jugar!';
    return '';
  }

  function render(state) {
    if (!state) return;

    if (renderedRound !== state.round) {
      buildAnswers();
      renderedRound = state.round;
      revealedSeen = new Set();
    }

    el.question.textContent = state.question;
    el.roundLabel.textContent = 'Ronda ' + state.round + '/' + state.totalRounds;
    el.stateChip.textContent = phaseLabel(state.phase);
    el.bankValue.textContent = String(state.bank);

    if (state.phase === 'faceoff') {
      el.roundStatus.textContent = 'Ronda no iniciada';
    } else if (state.phase === 'playing') {
      el.roundStatus.textContent = 'Ronda ' + state.round + ' en juego';
    } else if (state.phase === 'steal') {
      el.roundStatus.textContent = '¡Robo de Puntos!';
    } else if (state.phase === 'roundEnd') {
      el.roundStatus.textContent = 'Ronda cerrada';
    } else if (state.phase === 'gameOver') {
      el.roundStatus.textContent = 'Fin del juego';
    }

    const rows = el.answers.children;
    state.answers.forEach((answer, index) => {
      const row = rows[index];
      if (!row) return;
      const textNode = row.querySelector('.answer__text');
      const pointsNode = row.querySelector('.answer__points');
      textNode.textContent = answer.text == null ? '' : answer.text;
      pointsNode.textContent = answer.points == null ? '?' : String(answer.points);
      row.classList.toggle('is-revealed', answer.revealed);
      row.classList.toggle('is-pending', !answer.revealed);
      row.classList.toggle('is-locked', answer.text == null);

      if (answer.revealed && !revealedSeen.has(index)) {
        revealedSeen.add(index);
        row.classList.remove('just-revealed');
        void row.offsetWidth;
        row.classList.add('just-revealed');
        setTimeout(() => row.classList.remove('just-revealed'), 560);
      } else if (!answer.revealed) {
        revealedSeen.delete(index);
        row.classList.remove('just-revealed');
      }
    });

    bumpScore(el.scoreLeft, state.scores.left, prevScores.left);
    bumpScore(el.scoreRight, state.scores.right, prevScores.right);
    prevScores = { left: state.scores.left, right: state.scores.right };

    el.teamLeft.classList.toggle('has-control', state.control === 'left' && state.phase !== 'gameOver');
    el.teamRight.classList.toggle('has-control', state.control === 'right' && state.phase !== 'gameOver');

    GameEffects.renderStrikes(el.strikeDots, state.strikes);
    GameEffects.renderTimer(state.timer);

    el.status.textContent = statusText(state);

    const finished = state.phase === 'gameOver' && Boolean(state.winner) && !state.reviewing;
    el.winner.classList.toggle('is-on', finished);
    el.winner.setAttribute('aria-hidden', finished ? 'false' : 'true');
    if (finished) {
      el.winnerTitle.textContent = state.winner === 'tie'
        ? '¡Empate!'
        : '¡Ganaron ' + teamName(state.winner) + '!';
      el.winnerScore.textContent = state.scores.left + ' — ' + state.scores.right;
    }
  }

  function showBanner(text, side) {
    el.banner.textContent = text;
    el.banner.classList.remove('is-on', 'is-left', 'is-right');
    if (side === 'left' || side === 'right') el.banner.classList.add('is-' + side);
    void el.banner.offsetWidth;
    el.banner.classList.add('is-on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.banner.classList.remove('is-on'), 2400);
  }

  function flashStrike() {
    el.flash.classList.remove('is-on');
    void el.flash.offsetWidth;
    el.flash.classList.add('is-on');
  }

  function handleEvent(event) {
    if (!event) return;
    // La entrega del banco en robo suena incluso si termina la partida.
    if (event.kind === 'steal' || event.kind === 'steal-failed' || event.stealResolved) {
      playSound(audioRobo);
    }
    switch (event.kind) {
      case 'buzzer':
        if (soundOn && audioReady) GameEffects.playBuzzer();
        break;
      case 'reveal-final':
        break;
      case 'restored':
        showBanner('Progreso restaurado', null);
        break;
      case 'reveal':
        playReveal();
        break;
      case 'faceoff-error':
        playStrike();
        break;
      case 'steal-failed':
        showBanner('Robo fallido ? +' + event.points + ' pts para ' + teamName(event.side), event.side);
        playStrike();
        break;
      case 'strike':
        flashStrike();
        playStrike();
        break;
      case 'steal-ready':
        flashStrike();
        playStrike();
        break;
      case 'faceoff':
        showBanner('¡' + teamName(event.side) + ' tocó primero!', event.side);
        playFaceoff();
        break;
      case 'steal':
        showBanner('¡Robo de ' + teamName(event.side) + '! +' + event.points + ' pts', event.side);
        playReveal();
        break;
      case 'bank':
        showBanner('+' + event.points + ' pts para ' + teamName(event.side), event.side);
        break;
      case 'round':
        showBanner('Ronda ' + event.round, null);
        playSound(audioInicio);
        break;
      case 'win':
        showBanner(event.side === 'tie' ? '¡Empate!' : '¡Ganaron ' + teamName(event.side) + '!', event.side);
        if (event.sound === 'error') playStrike();
        else playWin();
        break;
      default:
        break;
    }
  }

  function receiveState(state) {
    render(state);
    if (!primed) {
      primed = true;
      lastEventId = state.event ? state.event.id : 0;
      return;
    }
    if (state.event && state.event.id !== lastEventId) {
      lastEventId = state.event.id;
      handleEvent(state.event);
    }
  }

  el.soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (_) {}
    updateSoundButton();
    unlockAudio();
    if (soundOn) playReveal();
  });

  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });

  socket.on('connect', () => setConnection(true));
  socket.on('disconnect', () => setConnection(false));
  socket.on('connect_error', () => setConnection(false));
  socket.on('state', receiveState);
  socket.on('timer', GameEffects.renderTimer);

  if (el.logo) {
    const markLogo = () => {
      if (el.logo.naturalWidth > 0) el.brand.classList.add('has-logo');
    };
    el.logo.addEventListener('load', markLogo);
    el.logo.addEventListener('error', () => el.brand.classList.remove('has-logo'));
    if (el.logo.complete) markLogo();
  }

  buildAnswers();
  buildStrikes();
  updateSoundButton();
  setConnection(socket.connected);
})();
