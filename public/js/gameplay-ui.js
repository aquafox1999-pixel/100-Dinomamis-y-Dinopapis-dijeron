(() => {
  'use strict';
  let audioContext;

  function unlockBuzzer() {
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      if (!audioContext) audioContext = new Context();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch (error) { /* El resto del juego funciona sin Web Audio. */ }
  }

  async function playBuzzer() {
    if (!audioContext) return;
    if (audioContext.state !== 'running') {
      try { await audioContext.resume(); } catch (error) { return; }
    }
    if (audioContext.state !== 'running') return;
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.025);
    gain.gain.setValueAtTime(0.11, now + 1.1);
    gain.gain.linearRampToValueAtTime(0, now + 1.3);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    let stopped = 0;
    [95, 110].forEach(frequency => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = frequency;
      oscillator.connect(filter);
      oscillator.start(now);
      oscillator.stop(now + 1.32);
      oscillator.onended = () => {
        oscillator.disconnect();
        if (++stopped === 2) { filter.disconnect(); gain.disconnect(); }
      };
    });
  }

  function renderStrikes(container, strikes) {
    if (!container) return;
    container.setAttribute('aria-label', strikes + ' de 3 equis');
    Array.from(container.children).forEach((dot, index) => {
      const on = index < strikes;
      const wasOn = dot.classList.contains('is-on');
      dot.classList.toggle('is-on', on);
      dot.classList.toggle('just-added', on && !wasOn);
      dot.setAttribute('aria-hidden', 'true');
    });
    container.classList.toggle('has-three', strikes === 3);
  }

  function renderTimer(timer) {
    if (!timer) return;
    const card = document.getElementById('timerPanel');
    const value = document.getElementById('timerValue');
    const toggle = document.getElementById('timerEnabled');
    const pause = document.getElementById('btnTimerPause');
    if (card) {
      card.classList.toggle('is-off', !timer.enabled);
      card.classList.toggle('is-urgent', timer.enabled && timer.seconds > 0 && timer.seconds <= 3);
    }
    if (value) value.textContent = timer.enabled ? String(timer.seconds).padStart(2, '0') : '--';
    const status = document.getElementById('timerStatus');
    if (status) status.textContent = !timer.enabled ? 'Desactivado' : timer.running ? 'En marcha' : timer.seconds === 0 ? 'Tiempo terminado' : 'Pausado';
    if (toggle) toggle.checked = timer.enabled;
    if (pause) {
      pause.textContent = timer.running ? 'PAUSAR' : 'REANUDAR';
      pause.dataset.running = String(timer.running);
      pause.disabled = !timer.enabled || timer.editable === false || (timer.seconds === 0 && !timer.running);
    }
    ['btnTimerAdd', 'btnTimerSubtract'].forEach(id => {
      const button = document.getElementById(id);
      if (button) button.disabled = !timer.enabled || timer.editable === false;
    });
  }

  window.GameEffects = { unlockBuzzer, playBuzzer, renderStrikes, renderTimer };
})();
