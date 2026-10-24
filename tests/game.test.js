'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const logic = source.slice(source.indexOf('const ANSWERS_PER_ROUND'), source.indexOf('const app = express();'));

function engine() {
  let now = 100000;
  const context = vm.createContext({ Date: { now: () => now } });
  vm.runInContext(logic, context);
  return {
    run: code => vm.runInContext(code, context),
    value: code => JSON.parse(JSON.stringify(vm.runInContext(code, context))),
    advance: ms => { now += ms; }
  };
}

test('Seis preguntas, seis rondas y control manual sin bloquear respuestas', () => {
  const e = engine();
  assert.equal(e.run('ROUNDS.length'), 6);
  assert.equal(e.run('TOTAL_ROUNDS'), 6);
  e.run('actionReveal(0); actionReveal(1)');
  assert.equal(e.run('bank()'), 70);
  assert.equal(e.run('game.phase'), 'faceoff');
  e.run("actionFaceoff('right')");
  assert.equal(e.run('game.control'), 'right');
  assert.equal(e.run('game.phase'), 'playing');
});

test('revelar al cerrar un robo no altera banco ni puntajes, incluso al superar 300 puntos', () => {
  for (const winsGame of [false, true]) {
    const e = engine();
    if (winsGame) e.run("game.awards[2]={side:'right',points:250};recalculateScores()");
    e.run("actionReveal(0);actionFaceoff('left');actionStrike();actionStrike();actionStrike();actionReveal(1)");
    const scores = e.value('game.scores');
    const bank = e.run('bank()');
    assert.equal(bank, 70);
    assert.equal(e.run('game.phase'), 'roundEnd');
    e.run('actionReveal(2);actionReveal(3);actionReveal(4)');
    assert.equal(e.run('game.revealed.every(Boolean)'), true);
    assert.equal(e.run('bank()'), bank);
    assert.deepEqual(e.value('game.scores'), scores);
    assert.equal(e.run('game.reviewing'), true);
  }
});

test('robo fallido conserva puntos y permite mostrar respuestas restantes', () => {
  const e = engine();
  e.run("actionReveal(0);actionFaceoff('left');actionStrike();actionStrike();actionStrike();actionStrike();actionReveal(1)");
  assert.deepEqual(e.value('game.scores'), { left: 40, right: 0 });
  assert.equal(e.run('bank()'), 40);
  assert.equal(e.run('game.strikes'), 3);
  assert.equal(e.run('game.revealed[1]'), true);
});

test('volver a rondas conserva tablero, equis y puntuacion sin entregar puntos otra vez', () => {
  const e = engine();
  e.run("actionReveal(0);actionFaceoff('left');actionStrike();actionStrike();actionStrike();actionReveal(1);actionReveal(3)");
  const board = e.value('captureRound()');
  e.run("actionNext();actionReveal(2);actionFaceoff('left');actionStrike();actionPrev()");
  assert.deepEqual(e.value('captureRound()'), board);
  assert.deepEqual(e.value('game.scores'), { left: 0, right: 70 });
  e.run('actionNext()');
  assert.equal(e.run('game.round'), 2);
  assert.equal(e.run('game.strikes'), 1);
  assert.equal(e.run('game.revealed[2]'), true);
  assert.equal(e.run('game.phase'), 'playing');
  e.run('actionNext();actionPrev();actionNext()');
  assert.deepEqual(e.value('game.scores'), { left: 12, right: 70 });
});

test('deshacer revierte entrega equivocada sin borrar puntos de otras rondas', () => {
  const e = engine();
  e.run("actionReveal(0);actionFaceoff('left');actionStrike();actionStrike();actionStrike();actionReveal(1);actionNext();actionReveal(0);actionFaceoff('left');actionNext();actionPrev();actionPrev();actionUndo()");
  assert.equal(e.run('game.phase'), 'steal');
  assert.equal(e.run('game.strikes'), 3);
  assert.equal(e.run('game.revealed[1]'), false);
  assert.deepEqual(e.value('game.scores'), { left: 45, right: 0 });
  e.run('actionStrike()');
  assert.deepEqual(e.value('game.scores'), { left: 85, right: 0 });
});

test('deshacer INICIAR restaura el progreso previo de la ronda', () => {
  const e = engine();
  e.run("actionReveal(2);actionFaceoff('right');actionStrike();actionRestart();actionUndo()");
  assert.equal(e.run('game.phase'), 'playing');
  assert.equal(e.run('game.control'), 'right');
  assert.equal(e.run('game.strikes'), 1);
  assert.equal(e.run('game.revealed[2]'), true);
});

test('cronometro: activar, reiniciar, pausar, reanudar, ajustar y detener en cero', () => {
  const e = engine();
  e.run("actionTimer('timer-toggle',{enabled:true});actionReveal(0)");
  assert.equal(e.run('timerState().seconds'), 10);
  e.advance(3200);
  assert.equal(e.run('timerState().seconds'), 7);
  e.run('actionStrike()');
  assert.equal(e.run('timerState().seconds'), 10);
  assert.equal(e.run('game.strikes'), 0);
  e.advance(2000);
  e.run("actionTimer('timer-pause',{})");
  e.advance(50000);
  assert.equal(e.run('timerState().seconds'), 8);
  e.run("actionTimer('timer-adjust',{seconds:5})");
  assert.equal(e.run('timerState().seconds'), 13);
  e.run("actionTimer('timer-adjust',{seconds:-5});actionTimer('timer-resume',{})");
  e.advance(9000);
  assert.equal(e.run('timerState().seconds'), 0);
  e.run('pauseTimer()');
  assert.equal(e.run('game.timer.running'), false);
  e.run('actionReveal(1)');
  assert.equal(e.run('timerState().seconds'), 10);
  e.run("actionTimer('timer-toggle',{enabled:false});actionReveal(2)");
  assert.equal(e.run('game.timer.running'), false);
});

test('navegar guarda el tiempo restante y lo restaura pausado', () => {
  const e = engine();
  e.run("actionTimer('timer-toggle',{enabled:true});actionReveal(0)");
  e.advance(4000);
  e.run('startRound(2)');
  e.advance(20000);
  e.run('actionPrev()');
  assert.equal(e.run('timerState().seconds'), 6);
  assert.equal(e.run('game.timer.running'), false);
});


test('primeras seis preguntas idénticas a preguntas.txt con cinco respuestas y puntos', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'preguntas.txt'), 'utf8');
  const expected = [...text.matchAll(/Pregunta: (.+)\r?\nRespuestas:\r?\n([\s\S]*?)(?=\r?\n\r?\n|$)/g)].map(match => ({
    question: match[1].trim(),
    answers: match[2].trim().split(/\r?\n/).map(line => {
      const answer = line.match(/^- (.+) \((\d+)\)$/);
      assert.ok(answer, line);
      return { text: answer[1], points: Number(answer[2]) };
    })
  }));
  assert.equal(expected.length, 30);
  expected.forEach(question => assert.equal(question.answers.length, 5));
  assert.deepEqual(engine().value('ROUNDS'), expected.slice(0, 6));
});

test('partida completa: una pregunta por ronda, x2 en tercera, x3 en sexta', () => {
  const e = engine();
  const questions = new Set();
  for (let index = 1; index <= 6; index++) {
    const state = e.value("stateFor('admin')");
    questions.add(state.question);
    assert.equal(state.round, index);
    assert.equal(state.totalRounds, 6);
    assert.equal(state.multiplier, state.round === 3 ? 2 : state.round === 6 ? 3 : 1);
    e.run("actionFaceoff('left'); for(let i=0;i<5;i++) actionReveal(i)");
    assert.equal(e.run('bank()'), 100 * state.multiplier);
    assert.equal(e.run('game.phase'), 'roundEnd');
    e.run('actionNext()');
  }
  assert.equal(questions.size, 6);
  assert.equal(e.run('game.phase'), 'gameOver');
  assert.equal(e.run('game.scores.left'), 900);
  e.run('actionPrev()');
  assert.equal(e.run('game.round'), 5);
  assert.equal(e.run('game.scores.left'), 900);
});
