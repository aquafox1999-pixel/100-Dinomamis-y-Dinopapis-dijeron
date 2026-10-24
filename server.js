'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const ANSWERS_PER_ROUND = 5;

const ROUNDS = [
  {
    "question": "Menciona algo que un papá primerizo teme hacer por primera vez con el bebé.",
    "answers": [
      {
        "text": "Bañarlo",
        "points": 40
      },
      {
        "text": "Cambiarle el pañal",
        "points": 30
      },
      {
        "text": "Cargarlo (sentir que lo rompe)",
        "points": 15
      },
      {
        "text": "Vestirlo o meterle la cabeza en la ropa",
        "points": 10
      },
      {
        "text": "Cortarle las uñas",
        "points": 5
      }
    ]
  },
  {
    "question": "Menciona algo que nunca debe faltar en una pañalera bien equipada.",
    "answers": [
      {
        "text": "Pañales",
        "points": 45
      },
      {
        "text": "Toallitas húmedas",
        "points": 30
      },
      {
        "text": "Muda de ropa limpia",
        "points": 12
      },
      {
        "text": "Biberón o fórmula",
        "points": 8
      },
      {
        "text": "Pomada para rozaduras",
        "points": 5
      }
    ]
  },
  {
    "question": "¿Qué es lo primero que hace un papá cuando el bebé empieza a llorar sin parar?",
    "answers": [
      {
        "text": "Afectuosamente pasárselo a la mamá",
        "points": 42
      },
      {
        "text": "Mecerlo o arrullarlo",
        "points": 28
      },
      {
        "text": "Revisar si el pañal está sucio",
        "points": 15
      },
      {
        "text": "Ofrecerle el chupón o biberón",
        "points": 10
      },
      {
        "text": "Cantarle o hacer ruidos raros",
        "points": 5
      }
    ]
  },
  {
    "question": "Menciona un antojo clásico durante el embarazo.",
    "answers": [
      {
        "text": "Helado",
        "points": 38
      },
      {
        "text": "Chocolates o dulces",
        "points": 26
      },
      {
        "text": "Fruta con chile y limón",
        "points": 18
      },
      {
        "text": "Papas fritas o comida salada",
        "points": 12
      },
      {
        "text": "Pizzas o hamburguesas a medianoche",
        "points": 6
      }
    ]
  },
  {
    "question": "¿Qué es lo que más le preocupa a una mamá al preparar la maleta para el hospital?",
    "answers": [
      {
        "text": "Olvidar la ropa del bebé para salir",
        "points": 35
      },
      {
        "text": "Olvidar los documentos o identificación",
        "points": 28
      },
      {
        "text": "No llevar suficiente ropa cómoda para ella",
        "points": 18
      },
      {
        "text": "Olvidar el cargador del celular",
        "points": 11
      },
      {
        "text": "No llevar suficientes pañales de recién nacido",
        "points": 8
      }
    ]
  },
  {
    "question": "Menciona una frase típica que dice una abuela consentidora cuando ve al bebé.",
    "answers": [
      {
        "text": "\"Tiene hambre, dale de comer\"",
        "points": 40
      },
      {
        "text": "\"Tráelo para acá, no me lo dejes llorar\"",
        "points": 25
      },
      {
        "text": "\"¡Se parece igualito a su papá/mamá!\"",
        "points": 17
      },
      {
        "text": "\"Tiene frío, tápalo bien\"",
        "points": 12
      },
      {
        "text": "\"Conmigo no hace berrinches\"",
        "points": 6
      }
    ]
  }
];

const TOTAL_ROUNDS = ROUNDS.length;

function multiplierFor(round) {
  if (round === 3) return 2;
  if (round === 6) return 3;
  return 1;
}

function buildDeck(offset) {
  const deck = [];
  for (let index = 0; index < TOTAL_ROUNDS; index += 1) {
    deck.push((offset + index) % ROUNDS.length);
  }
  return deck;
}

function initialGame(offset) {
  return {
    phase: 'faceoff', round: 1, scores: { left: 0, right: 0 },
    control: null, faceoffWinner: null, strikes: 0,
    revealed: Array(ANSWERS_PER_ROUND).fill(false),
    bankAnswers: Array(ANSWERS_PER_ROUND).fill(false),
    scored: Array(TOTAL_ROUNDS + 1).fill(false),
    awards: {}, progress: {}, undoByRound: {},
    winner: null, reviewing: false, event: null,
    timerEnabled: false, timer: { remainingMs: 10000, deadline: null, running: false },
    deck: buildDeck(offset || 0)
  };
}

let deckOffset = 0;
let game = initialGame(deckOffset);
let eventId = 0;

function fire(kind, extra) {
  game.event = Object.assign({ id: ++eventId, kind: kind }, extra || {});
}

function notice(text) { fire('notice', { text: text }); }

function roundData(round) { return ROUNDS[game.deck[(round || game.round) - 1]]; }

function bank() {
  return roundData().answers.reduce(function (total, answer, index) {
    return total + (game.bankAnswers[index] ? answer.points : 0);
  }, 0) * multiplierFor(game.round);
}

function isScored() { return Boolean(game.scored[game.round]); }

function timerRemaining(now) {
  return game.timer.running ? Math.max(0, game.timer.deadline - (now || Date.now())) : game.timer.remainingMs;
}

function timerState() {
  const remaining = timerRemaining();
  return { enabled: game.timerEnabled, editable: !isScored() && !['roundEnd', 'gameOver'].includes(game.phase), running: game.timer.running && remaining > 0,
    remainingMs: remaining, seconds: Math.ceil(remaining / 1000) };
}

function pauseTimer() {
  game.timer.remainingMs = timerRemaining();
  game.timer.deadline = null;
  game.timer.running = false;
}

function resetTimer() {
  if (!game.timerEnabled || isScored() || !['faceoff', 'playing', 'steal'].includes(game.phase)) return;
  game.timer = { remainingMs: 10000, deadline: Date.now() + 10000, running: true };
}

function captureRound() {
  return {
    phase: game.phase, control: game.control, faceoffWinner: game.faceoffWinner,
    strikes: game.strikes, revealed: game.revealed.slice(), bankAnswers: game.bankAnswers.slice(),
    scored: isScored(), award: game.awards[game.round] ? Object.assign({}, game.awards[game.round]) : null,
    winner: game.winner, reviewing: game.reviewing,
    timer: { remainingMs: timerRemaining(), running: false, deadline: null }
  };
}

function saveCurrentRound() { game.progress[game.round] = captureRound(); }

function checkpoint() {
  const history = game.undoByRound[game.round] || (game.undoByRound[game.round] = []);
  history.push(captureRound());
  if (history.length > 100) history.shift();
}

function recalculateScores() {
  game.scores = { left: 0, right: 0 };
  Object.values(game.awards).forEach(function (award) { game.scores[award.side] += award.points; });
}

function restoreRound(snapshot) {
  game.phase = snapshot.phase;
  game.control = snapshot.control;
  game.faceoffWinner = snapshot.faceoffWinner;
  game.strikes = snapshot.strikes;
  game.revealed = snapshot.revealed.slice();
  game.bankAnswers = snapshot.bankAnswers.slice();
  game.scored[game.round] = snapshot.scored;
  if (snapshot.award) game.awards[game.round] = Object.assign({}, snapshot.award);
  else delete game.awards[game.round];
  game.winner = snapshot.winner;
  game.reviewing = snapshot.reviewing;
  game.timer = Object.assign({}, snapshot.timer);
  recalculateScores();
}

function awardTo(side) {
  if (!side || isScored()) return 0;
  const points = bank();
  game.awards[game.round] = { side: side, points: points };
  game.scored[game.round] = true;
  recalculateScores();
  return points;
}

function endGame() {
  const left = game.scores.left, right = game.scores.right;
  game.winner = left === right ? 'tie' : left > right ? 'left' : 'right';
  game.phase = 'gameOver';
  pauseTimer();
  fire('win', { side: game.winner });
}

function resetRoundBoard() {
  game.revealed = Array(ANSWERS_PER_ROUND).fill(false);
  game.bankAnswers = Array(ANSWERS_PER_ROUND).fill(false);
  game.strikes = 0;
  game.control = null;
  game.faceoffWinner = null;
  game.winner = null;
  game.reviewing = false;
  game.timer = { remainingMs: 10000, deadline: null, running: false };
}

function startRound(round) {
  pauseTimer();
  saveCurrentRound();
  game.round = round;
  if (game.progress[round]) restoreRound(game.progress[round]);
  else { resetRoundBoard(); game.phase = 'faceoff'; }
}

function actionUndo() {
  const history = game.undoByRound[game.round];
  if (!history || !history.length) return notice('No hay cambios para deshacer en esta ronda.');
  restoreRound(history.pop());
  fire('restored', { round: game.round });
}

function actionFaceoff(side) {
  if (game.phase !== 'faceoff' || isScored()) return;
  checkpoint();
  game.faceoffWinner = side;
  game.control = side;
  game.phase = 'playing';
  fire('faceoff', { side: side });
  if (game.revealed.every(Boolean)) closeRound(side, 'bank');
}

function closeRound(side, kind, extra) {
  const points = awardTo(side);
  pauseTimer();
  fire(kind, Object.assign({ side: side, points: points }, extra || {}));
  game.phase = 'roundEnd';
}

function actionReveal(index) {
  if (!Number.isInteger(index) || index < 0 || index >= ANSWERS_PER_ROUND || game.revealed[index]) return;
  checkpoint();
  game.revealed[index] = true;
  if (isScored() || game.phase === 'roundEnd' || game.phase === 'gameOver') {
    game.reviewing = true;
    fire('reveal-final', { index: index });
    return; // La revelacion de cortesia no cambia el banco ni la puntuacion.
  }
  game.bankAnswers[index] = true;
  resetTimer();
  if (game.phase === 'steal') {
    closeRound(game.control === 'left' ? 'right' : 'left', 'steal', { sound: 'correct' });
    return;
  }
  fire('reveal', { index: index });
  if (game.phase === 'playing' && game.revealed.every(Boolean)) closeRound(game.control, 'bank');
}

function actionStrike() {
  if (!['faceoff', 'playing', 'steal'].includes(game.phase) || isScored()) return;
  checkpoint();
  resetTimer();
  if (game.phase === 'faceoff') { fire('faceoff-error'); return; }
  if (game.phase === 'steal') { closeRound(game.control, 'steal-failed', { sound: 'error' }); return; }
  game.strikes = Math.min(3, game.strikes + 1);
  if (game.strikes === 3) {
    game.phase = 'steal';
    fire('steal-ready', { side: game.control });
  } else fire('strike', { count: game.strikes });
}

function actionUnstrike() {
  if (!['playing', 'steal'].includes(game.phase) || isScored() || game.strikes === 0) return;
  checkpoint();
  game.strikes -= 1;
  game.phase = 'playing';
  fire('strike-undone', { count: game.strikes });
}

function actionSteal() { notice('Resuelve el robo con una respuesta (1-5) o con X si falla.'); }

function actionNext() {
  if (game.phase === 'gameOver') return notice('Partida terminada. Puedes revisar respuestas o volver a rondas anteriores.');
  if (!isScored()) {
    checkpoint();
    if (game.control) {
      closeRound(game.control, 'bank');
      if (game.phase === 'gameOver') return;
    } else {
      game.scored[game.round] = true;
      game.phase = 'roundEnd';
      pauseTimer();
    }
  }
  if (game.round >= TOTAL_ROUNDS) { endGame(); return; }
  startRound(game.round + 1);
  fire('round', { round: game.round });
}

function actionPrev() {
  if (game.round <= 1) return notice('Ya estas en la primera ronda.');
  startRound(game.round - 1);
  fire('round', { round: game.round });
}

function actionRestart() {
  if (isScored() || game.phase === 'gameOver') return notice('Ronda cerrada: usa DESHACER para corregirla.');
  checkpoint();
  resetRoundBoard();
  game.phase = 'faceoff';
  fire('round', { round: game.round });
}

function actionReset() {
  const timerEnabled = game.timerEnabled;
  deckOffset = (deckOffset + TOTAL_ROUNDS) % ROUNDS.length;
  game = initialGame(deckOffset);
  game.timerEnabled = timerEnabled;
  fire('reset');
}

function actionTimer(type, payload) {
  if (type === 'timer-toggle') {
    if (typeof payload.enabled !== 'boolean') return;
    game.timerEnabled = payload.enabled;
    pauseTimer();
    game.timer.remainingMs = 10000;
    return;
  }
  if (!game.timerEnabled || isScored() || ['roundEnd', 'gameOver'].includes(game.phase)) return;
  if (type === 'timer-pause') pauseTimer();
  if (type === 'timer-resume' && !game.timer.running && game.timer.remainingMs > 0) {
    game.timer.deadline = Date.now() + game.timer.remainingMs;
    game.timer.running = true;
  }
  if (type === 'timer-adjust' && [5, -5].includes(payload.seconds)) {
    game.timer.remainingMs = Math.max(0, Math.min(600000, timerRemaining() + payload.seconds * 1000));
    if (game.timer.running) game.timer.deadline = Date.now() + game.timer.remainingMs;
    if (game.timer.remainingMs === 0) pauseTimer();
  }
}

function stateFor(role) {
  const data = roundData();
  return {
    phase: game.phase, round: game.round, totalRounds: TOTAL_ROUNDS,
    multiplier: multiplierFor(game.round), scores: Object.assign({}, game.scores),
    control: game.control, faceoffWinner: game.faceoffWinner, strikes: game.strikes,
    winner: game.winner, reviewing: game.reviewing, scored: isScored(), bank: bank(),
    canUndo: Boolean((game.undoByRound[game.round] || []).length),
    awarded: game.awards[game.round] || null, timer: timerState(),
    question: data.question,
    answers: data.answers.map(function (answer, index) {
      const visible = role === 'admin' || game.revealed[index];
      return { revealed: game.revealed[index], text: visible ? answer.text : null, points: visible ? answer.points : null };
    }),
    event: game.event
  };
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 20000
});

require('./cards')(app, io);

function publicBase(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  return req.protocol + '://' + req.get('host');
}

function broadcast() {
  io.to('admins').emit('state', stateFor('admin'));
  io.to('viewers').emit('state', stateFor('viewer'));
}

const timerInterval = setInterval(function () {
  if (!game.timerEnabled || !game.timer.running) return;
  if (timerRemaining() === 0) pauseTimer();
  io.emit('timer', timerState());
}, 250);
timerInterval.unref();
server.on('close', function () { clearInterval(timerInterval); });

function viewerCount() {
  const room = io.sockets.adapter.rooms.get('viewers');
  return room ? room.size : 0;
}

function emitPresence() {
  io.to('admins').emit('presence', { viewers: viewerCount() });
}

io.on('connection', function (socket) {
  socket.data.isAdmin = false;
  socket.join('viewers');
  socket.emit('state', stateFor('viewer'));
  emitPresence();

  socket.on('setAdmin', function () {
    socket.data.isAdmin = true;
    socket.leave('viewers');
    socket.join('admins');
    socket.emit('admin:ok');
    socket.emit('state', stateFor('admin'));
    emitPresence();
  });

  socket.on('action', function (payload) {
    if (!socket.data.isAdmin) return;
    const type = payload && payload.type;
    const side = payload && payload.side === 'right' ? 'right' : 'left';
    const index = payload && Number.isInteger(payload.index) ? payload.index : -1;

    switch (type) {
      case 'undo':
        actionUndo();
        break;
      case 'buzzer':
        fire('buzzer');
        break;
      case 'timer-toggle':
      case 'timer-pause':
      case 'timer-resume':
      case 'timer-adjust':
        actionTimer(type, payload);
        break;
      case 'reveal':
        actionReveal(index);
        break;
      case 'strike':
        actionStrike();
        break;
      case 'next':
        actionNext();
        break;
      case 'prev':
        actionPrev();
        break;
      case 'steal':
        actionSteal(side);
        break;
      case 'restart':
        actionRestart();
        break;
      case 'faceoff':
        actionFaceoff(side);
        break;
      case 'reset':
        actionReset();
        break;
      case 'unstrike':
        actionUnstrike();
        break;
      default:
        return;
    }
    saveCurrentRound();
    broadcast();
  });

  socket.on('disconnect', function () {
    emitPresence();
  });
});

app.get('/', function (req, res) {
  if (req.query.upload === 'true' || req.query.upload === '1') {
    return res.redirect('/upload');
  }
  const wantsAdmin = req.query.admin === 'true' || req.query.admin === '1';
  res.sendFile(path.join(__dirname, 'public', wantsAdmin ? 'index.html' : 'viewer.html'));
});

app.get('/admin', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/viewer', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

app.get('/healthz', function (req, res) {
  res.json({ ok: true, round: game.round, phase: game.phase });
});

app.get('/api/config', function (req, res) {
  const base = publicBase(req);
  res.set('Cache-Control', 'no-store');
  res.json({
    viewerUrl: base + '/',
    adminUrl: base + '/?admin=true'
  });
});

app.get('/api/qr.png', async function (req, res) {
  try {
    const base = publicBase(req);
    const target = req.query.target === 'admin' ? base + '/?admin=true' : base + '/';
    const buffer = await QRCode.toBuffer(target, {
      type: 'png',
      width: 640,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#081326', light: '#ffffff' }
    });
    res.type('png').set('Cache-Control', 'no-store').send(buffer);
  } catch (error) {
    res.status(500).end();
  }
});

app.use(express.static(path.join(__dirname, 'public'), { index: false, extensions: ['html'] }));

server.listen(PORT, '0.0.0.0', function () {
  console.log('Servidor listo en el puerto ' + PORT);
});
