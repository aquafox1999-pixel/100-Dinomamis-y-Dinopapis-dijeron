(() => {
  'use strict';

  const TEAMS = { left: 'Dinomamis', right: 'Dinopapis' };
  const STORAGE_KEY = 'dinomamis.adminKey';
  const ANSWER_COUNT = 5;
  const STRIKE_COUNT = 3;

  const $ = (id) => document.getElementById(id);

  const el = {
    brand: $('brand'),
    logo: $('logo'),
    teamLeft: $('teamLeft'),
    teamRight: $('teamRight'),
    scoreLeft: $('scoreLeft'),
    scoreRight: $('scoreRight'),
    roundLabel: $('roundLabel'),
    multLabel: $('multLabel'),
    stateChip: $('stateChip'),
    bankValue: $('bankValue'),
    strikesValue: $('strikesValue'),
    question: $('question'),
    answers: $('answers'),
    strikeDots: $('strikeDots'),
    status: $('status'),
    flash: $('flash'),
    banner: $('banner'),
    toast: $('toast'),
    winner: $('winner'),
    winnerTitle: $('winnerTitle'),
    winnerScore: $('winnerScore'),
    conn: $('conn'),
    connText: $('connText'),
    btnF2: $('btnF2'),
    btnFaceoffLeft: $('btnFaceoffLeft'),
    btnFaceoffRight: $('btnFaceoffRight'),
    btnAns1: $('btnAns1'),
    btnAns2: $('btnAns2'),
    btnAns3: $('btnAns3'),
    btnAns4: $('btnAns4'),
    btnAns5: $('btnAns5'),
    btnStrike: $('btnStrike'),
    btnUnstrike: $('btnUnstrike'),
    btnPrev: $('btnPrev'),
    btnNext: $('btnNext'),
    btnStealLeft: $('btnStealLeft'),
    btnStealRight: $('btnStealRight'),
    btnReset: $('btnReset')
  };

  const socket = io();

  let renderedRound = null;
  let revealedSeen = new Set();
  let prevScores = { left: 0, right: 0 };
  let primed = false;
  let lastEventId = 0;
  let bannerTimer = 0;
  let toastTimer = 0;
  let audioReady = false;

  const audioCorrecto = new Audio('audio/correcto.mp3');
  const audioError = new Audio('audio/error.mp3');
  const audioRobo = new Audio('audio/robo.mp3');
  const audioInicio = new Audio('audio/inicio.mp3');

  function unlockAudio() {
    GameEffects.unlockBuzzer();
    if (audioReady) return;
    audioReady = true;
    [audioCorrecto, audioError, audioRobo, audioInicio].forEach((audio) => {
      audio.load();
    });
  }

  function playSound(audio) {
    if (!audioReady) return;
    const clone = audio.cloneNode();
    clone.volume = 1;
    clone.play().catch(() => {});
  }

  function teamName(side) {
    return TEAMS[side] || 'los dos equipos';
  }

  function formatScore(value) {
    return String(value).padStart(3, '0');
  }

  function setConnection(ok) {
    el.conn.classList.toggle('is-ok', ok);
    el.conn.classList.toggle('is-bad', !ok);
    el.connText.textContent = ok ? 'En línea' : 'Sin conexión';
  }

  function showLogin(message) {
    el.login.hidden = false;
    el.loginError.hidden = !message;
    el.loginError.textContent = message || '';
    setTimeout(() => el.loginKey.focus(), 50);
  }

  function buildAnswers() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < ANSWER_COUNT; i += 1) {
      const item = document.createElement('li');
      item.className = 'admin-answer';
      item.dataset.index = String(i);
      item.innerHTML =
        '<span class="admin-answer__num">' + (i + 1) + '.-</span>' +
        '<span class="admin-answer__text"></span>' +
        '<span class="admin-answer__leader"></span>' +
        '<span class="admin-answer__points"></span>';
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
    if (el.strikeDots) el.strikeDots.replaceChildren(fragment);
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
    if (phase === 'faceoff') return 'FASE: CARA A CARA';
    if (phase === 'playing') return 'FASE: JUEGO NORMAL';
    if (phase === 'steal') return 'FASE: ROBO DE PUNTOS';
    if (phase === 'roundEnd') return 'Ronda cerrada';
    if (phase === 'gameOver') return 'Fin del juego';
    return 'En espera';
  }

  function statusText(state) {
    if (state.phase === 'faceoff') return 'Esperando señal: A o L';
    if (state.phase === 'playing') {
      return 'Control: ' + teamName(state.control) + ' · Equis: ' + state.strikes + '/' + STRIKE_COUNT;
    }
    if (state.phase === 'steal') return '¡Robo habilitado!';
    if (state.phase === 'roundEnd') return 'Ronda cerrada · Enter para seguir';
    if (state.phase === 'gameOver') return 'Partida terminada';
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
    el.roundLabel.textContent = 'Ronda ' + state.round + ' de ' + state.totalRounds;
    el.multLabel.textContent = 'x' + state.multiplier;
    el.multLabel.classList.toggle('is-hot', state.multiplier > 1);
    el.stateChip.textContent = phaseLabel(state.phase);
    el.bankValue.textContent = String(state.bank);

    const canAnswer = ['faceoff', 'playing', 'steal', 'roundEnd', 'gameOver'].includes(state.phase);
    $('btnUndo').disabled = !state.canUndo;
    $('btnPrev').disabled = state.round <= 1;
    [el.btnAns1, el.btnAns2, el.btnAns3, el.btnAns4, el.btnAns5].forEach((button, index) => {
      button.disabled = !canAnswer || state.answers[index].revealed;
    });
    el.btnFaceoffLeft.disabled = state.phase !== 'faceoff';
    el.btnFaceoffRight.disabled = state.phase !== 'faceoff';
    el.btnStrike.disabled = !['faceoff', 'playing', 'steal'].includes(state.phase) || state.scored;
    el.btnUnstrike.disabled = !['playing', 'steal'].includes(state.phase) || state.strikes === 0 || state.scored;
    el.btnStealLeft.disabled = true;
    el.btnStealRight.disabled = true;
    const rows = el.answers.children;
    state.answers.forEach((answer, index) => {
      const row = rows[index];
      if (!row) return;
      const textNode = row.querySelector('.admin-answer__text');
      const pointsNode = row.querySelector('.admin-answer__points');
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

    const highlightedSide = state.phase === 'faceoff' ? state.faceoffWinner : state.control;
    el.teamLeft.classList.toggle('has-control', highlightedSide === 'left' && state.phase !== 'gameOver');
    el.teamRight.classList.toggle('has-control', highlightedSide === 'right' && state.phase !== 'gameOver');

    GameEffects.renderStrikes(el.strikeDots, state.strikes);
    GameEffects.renderTimer(state.timer);

    el.strikesValue.textContent = String(state.strikes);

    el.status.textContent = statusText(state);

    const finished = state.phase === 'gameOver' && Boolean(state.winner) && !state.reviewing;
    if (!el.winner) return;
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
    if (!el.flash) return;
    el.flash.classList.remove('is-on');
    void el.flash.offsetWidth;
    el.flash.classList.add('is-on');
  }

  function showToast(text) {
    if (!text) return;
    el.toast.textContent = text;
    el.toast.hidden = false;
    el.toast.classList.remove('is-on');
    void el.toast.offsetWidth;
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove('is-on');
      el.toast.hidden = true;
    }, 2600);
  }

  function handleEvent(event) {
    if (!event) return;
    // La entrega del banco en robo suena incluso si termina la partida.
    if (event.kind === 'steal' || event.kind === 'steal-failed' || event.stealResolved) {
      playSound(audioRobo);
    }
    switch (event.kind) {
      case 'buzzer':
        if (audioReady) GameEffects.playBuzzer();
        break;
      case 'reveal-final':
        break;
      case 'restored':
        showToast('Progreso restaurado.');
        break;
      case 'faceoff-error':
        playSound(audioError);
        break;
      case 'steal-failed':
        showBanner('Robo fallido ? +' + event.points + ' pts para ' + teamName(event.side), event.side);
        playSound(audioError);
        break;
      case 'strike':
        flashStrike();
        showToast('¡Equis ' + event.count + ' de ' + STRIKE_COUNT + '!');
        playSound(audioError);
        break;
      case 'steal-ready':
        flashStrike();
        showToast('¡Tercera equis! Se habilita el robo.');
        playSound(audioError);
        break;
      case 'strike-undone':
        showToast('Equis deshecha.');
        playSound(audioError);
        break;
      case 'faceoff':
        showBanner('¡' + teamName(event.side) + ' tocó primero!', event.side);
        break;
      case 'reveal':
        playSound(audioCorrecto);
        break;
      case 'round':
        showBanner('Ronda ' + event.round, null);
        playSound(audioInicio);
        break;
      case 'steal':
        showBanner('¡Robo de ' + teamName(event.side) + '! +' + event.points + ' pts', event.side);
        playSound(audioCorrecto);
        break;
      case 'bank':
        showBanner('+' + event.points + ' pts para ' + teamName(event.side), event.side);
        playSound(audioCorrecto);
        break;
      case 'win':
        showBanner(event.side === 'tie' ? '¡Empate!' : '¡Ganaron ' + teamName(event.side) + '!', event.side);
        playSound(event.sound === 'error' ? audioError : audioCorrecto);
        break;
      case 'reset':
        showToast('Juego reiniciado.');
        playSound(audioInicio);
        break;
      case 'notice':
        showToast(event.text);
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

  function send(type, extra) {
    if (!socket.connected) {
      showToast('Sin conexión.');
      return;
    }
    socket.emit('action', Object.assign({ type: type }, extra || {}));
  }

  // Botones táctiles del animador
  $('btnBuzzer').addEventListener('click', () => { unlockAudio(); send('buzzer'); });
  $('btnUndo').addEventListener('click', () => send('undo'));
  $('timerEnabled').addEventListener('change', event => send('timer-toggle', { enabled: event.target.checked }));
  $('btnTimerPause').addEventListener('click', event => {
    send(event.currentTarget.dataset.running === 'true' ? 'timer-pause' : 'timer-resume');
  });
  $('btnTimerAdd').addEventListener('click', () => send('timer-adjust', { seconds: 5 }));
  $('btnTimerSubtract').addEventListener('click', () => send('timer-adjust', { seconds: -5 }));

  el.btnF2.addEventListener('click', () => {
    unlockAudio();
    send('restart');
    playSound(audioInicio);
  });

  el.btnFaceoffLeft.addEventListener('click', () => {
    unlockAudio();
    send('faceoff', { side: 'left' });
  });

  el.btnFaceoffRight.addEventListener('click', () => {
    unlockAudio();
    send('faceoff', { side: 'right' });
  });

  el.btnAns1.addEventListener('click', () => {
    unlockAudio();
    send('reveal', { index: 0 });
  });
  el.btnAns2.addEventListener('click', () => {
    unlockAudio();
    send('reveal', { index: 1 });
  });
  el.btnAns3.addEventListener('click', () => {
    unlockAudio();
    send('reveal', { index: 2 });
  });
  el.btnAns4.addEventListener('click', () => {
    unlockAudio();
    send('reveal', { index: 3 });
  });
  el.btnAns5.addEventListener('click', () => {
    unlockAudio();
    send('reveal', { index: 4 });
  });

  el.btnStrike.addEventListener('click', () => {
    unlockAudio();
    send('strike');
  });

  el.btnUnstrike.addEventListener('click', () => {
    unlockAudio();
    send('unstrike');
  });

  el.btnPrev.addEventListener('click', () => {
    unlockAudio();
    send('prev');
  });

  el.btnNext.addEventListener('click', () => {
    unlockAudio();
    send('next');
  });

  el.btnStealLeft.addEventListener('click', () => {
    unlockAudio();
    send('steal', { side: 'left' });
  });

  el.btnStealRight.addEventListener('click', () => {
    unlockAudio();
    send('steal', { side: 'right' });
  });

  el.btnReset.addEventListener('click', () => {
    const confirmed = window.confirm('¿Reiniciar la partida y dejar los puntajes en cero?');
    if (confirmed) {
      unlockAudio();
      send('reset');
      playSound(audioInicio);
    }
  });

  document.addEventListener('keydown', (event) => {
    unlockAudio();
    if (event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]')) {
      return;
    }

    const key = event.key;
    let handled = true;

    if (key >= '1' && key <= '5') {
      send('reveal', { index: Number(key) - 1 });
    } else if (key === ' ' || key === 'Spacebar' || key.toLowerCase() === 'x') {
      send('strike');
    } else if (key === 'Enter') {
      send('next');
    } else if (key === 'ArrowUp') {
      send('prev');
    } else if (key === 'ArrowLeft') {
      send('steal', { side: 'left' });
    } else if (key === 'ArrowRight') {
      send('steal', { side: 'right' });
    } else if (key === 'F2') {
      send('restart');
      playSound(audioInicio);
    } else if (key === 'a' || key === 'A') {
      send('faceoff', { side: 'left' });
    } else if (key === 'l' || key === 'L') {
      send('faceoff', { side: 'right' });
    } else {
      handled = false;
    }

    if (handled) event.preventDefault();
  });

  document.addEventListener('pointerdown', unlockAudio, { once: true });

  socket.on('connect', () => {
    setConnection(true);
    socket.emit('setAdmin');
  });

  socket.on('disconnect', () => {
    setConnection(false);
  });

  socket.on('connect_error', () => {
    setConnection(false);
  });

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
  setConnection(socket.connected);
})();
