'use strict';
// Ejecución opcional: PLAYWRIGHT_MODULE debe resolver el paquete playwright instalado.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(root, '.cards-test-browser-'));
  let child, browser;
  try {
    fs.cpSync(path.join(root, 'public'), path.join(fixture, 'public'), { recursive: true });
    for (const file of ['server.js', 'cards.js']) fs.copyFileSync(path.join(root, file), path.join(fixture, file));
    fs.writeFileSync(path.join(fixture, 'cards.json'), '[]');
    const net = require('node:net');
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    child = spawn(process.execPath, ['server.js'], { cwd: fixture, env: { ...process.env, PORT: String(port), UPLOAD_PASSWORD: 'browser-test-only', PUBLIC_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Inicio agotado')), 15000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Salida ' + code)); });
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.stderr.on('data', data => process.stderr.write(data));
    });
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    const context = await browser.newContext({ httpCredentials: { username: 'admin', password: 'browser-test-only' } });
    const viewer = await context.newPage();
    const upload = await context.newPage();
    const admin = await context.newPage();
    const errors = [];
    for (const page of [viewer, upload, admin]) page.on('pageerror', error => errors.push(error.message));
    const base = 'http://127.0.0.1:' + port;
    await viewer.addInitScript(() => {
      window.auditIntervals = [];
      const original = window.setInterval;
      window.setInterval = (callback, delay, ...args) => {
        window.auditIntervals.push(delay);
        return original(callback, delay, ...args);
      };
    });
    await viewer.goto(base);
    await viewer.waitForFunction(() => document.getElementById('question').textContent.includes('papá primerizo'));
    await upload.goto(base + '/upload');
    await upload.locator('#cardGallery[aria-busy="false"]').waitFor({ state: 'attached' });
    await upload.locator('#card').setInputFiles([
      { name: 'foto-1.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(root, 'public', 'img', 'logo.png')) },
      { name: 'foto-2.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(root, 'public', 'img', 'logo.png')) }
    ]);
    assert.equal(await upload.locator('#fileName').textContent(), '2 fotos seleccionadas');
    await upload.locator('button[type="submit"]').click();
    await upload.waitForFunction(() => document.querySelectorAll('.gallery-card').length === 2);
    await viewer.locator('#cardCarousel:not([hidden]) img.is-visible').waitFor();
    assert.equal(await upload.locator('.gallery-card').count(), 2);
    const first = await viewer.locator('#cardCarousel img.is-visible').getAttribute('src');
    assert.ok(await viewer.evaluate(() => auditIntervals.includes(10000)));
    const started = Date.now();
    await viewer.waitForFunction(previous => document.querySelector('#cardCarousel img.is-visible')?.getAttribute('src') !== previous, first, { timeout: 15000 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 9000 && elapsed <= 13000, 'Cambio real de tarjeta en ' + elapsed + ' ms');
    const second = await viewer.locator('#cardCarousel img.is-visible').getAttribute('src');
    assert.notEqual(second, first);
    assert.equal(await viewer.locator('#cardCarousel img.is-visible').evaluate(img => img.naturalWidth > 0), true);
    console.log('Carrusel: intervalo configurado de 10000 ms; cambio real observado en ' + elapsed + ' ms.');
    upload.on('dialog', dialog => dialog.accept());
    await upload.locator('.gallery-delete').first().click();
    await upload.waitForFunction(() => document.querySelectorAll('.gallery-card').length === 1);
    await upload.locator('.gallery-delete').click();
    await upload.waitForFunction(() => document.querySelectorAll('.gallery-card').length === 0);
    await viewer.locator('#cardCarousel[hidden]').waitFor({ state: 'attached' });
    // El fallo de fotos no debe bloquear Socket.IO, el tablero ni los puntos.
    await viewer.route('**/cards.json', route => route.fulfill({ status: 500, body: 'error' }));
    await viewer.reload();
    await viewer.waitForFunction(() => document.querySelectorAll('#answers .answer').length === 5);
    await admin.goto(base + '/admin');
    await admin.waitForFunction(() => document.getElementById('question').textContent.includes('papá primerizo'));
    await admin.locator('#btnFaceoffLeft').click();
    await admin.locator('#btnAns1').click();
    await viewer.waitForFunction(() => document.getElementById('bankValue').textContent === '40');
    await admin.locator('#btnNext').click();
    await viewer.waitForFunction(() => document.getElementById('scoreLeft').textContent === '040');
    await viewer.waitForFunction(() => document.getElementById('question').textContent.includes('pañalera'));
    assert.equal(await admin.locator('#btnPrev').isEnabled(), true);
    await admin.locator('#btnPrev').click();
    await viewer.waitForFunction(() => document.getElementById('question').textContent.includes('papá primerizo'));
    await admin.locator('#btnNext').click();
    await viewer.waitForFunction(() => document.getElementById('question').textContent.includes('pañalera'));
    await upload.route('**/api/cards', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fallo simulado de galería' }) }));
    await upload.locator('#refreshGallery').click();
    await upload.waitForFunction(() => document.getElementById('galleryStatus').textContent.includes('Fallo simulado'));
    assert.equal(await upload.locator('#refreshGallery').isEnabled(), true);
    await upload.unroute('**/api/cards');
    await upload.locator('#refreshGallery').click();
    await upload.locator('#cardGallery[aria-busy="false"]').waitFor({ state: 'attached' });
    await viewer.screenshot({ path: path.join(root, 'auditoria-viewer.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('OK navegador: subida múltiple, galería, carrusel de 10 segundos, borrado, API fallida, recuperación, tablero y puntajes sin errores JS.');
  } finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    if (path.dirname(fixture) === root && path.basename(fixture).startsWith('.cards-test-browser-')) fs.rmSync(fixture, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

