'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

test('subidas privadas detras de proxy HTTPS y manifiesto sin perder subidas simultaneas', async () => {
  const root = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(root, '.cards-test-'));
  let child;
  try {
    for (const file of ['server.js', 'cards.js']) {
      fs.copyFileSync(path.join(root, file), path.join(fixture, file));
    }
    fs.mkdirSync(path.join(fixture, 'public'));
    fs.copyFileSync(path.join(root, 'public', 'upload.html'), path.join(fixture, 'public', 'upload.html'));
    fs.writeFileSync(path.join(fixture, 'cards.json'), '[]');
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    child = spawn(process.execPath, ['server.js'], {
      cwd: fixture,
      env: { ...process.env, PORT: String(port), UPLOAD_PASSWORD: 'test-only-password' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('El servidor no inicio.')), 30000);
      child.stderr.on('data', data => process.stderr.write(data));
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error('Salida ' + code)); });
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    });
    const base = 'http://127.0.0.1:' + port;
    const headers = {
      Authorization: 'Basic ' + Buffer.from('admin:test-only-password').toString('base64'),
      Host: 'fiesta.up.railway.app',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'fiesta.up.railway.app',
      Origin: 'https://fiesta.up.railway.app'
    };
    assert.equal((await fetch(base + '/upload')).status, 401);
    assert.equal((await fetch(base + '/api/cards', { method: 'POST' })).status, 401);
    assert.equal((await fetch(base + '/upload', { headers })).status, 200);
    assert.equal((await fetch(base + '/api/cards', { method: 'POST', headers: { ...headers, Origin: 'https://other.example' } })).status, 403);
    const image = fs.readFileSync(path.join(root, 'public', 'img', 'logo.png'));
    function form(buffer, type) {
      const data = new FormData();
      data.append('card', new Blob([buffer], { type: type || 'image/png' }), 'tarjeta.png');
      return data;
    }
    const results = await Promise.all([1, 2].map(() => fetch(base + '/api/cards', {
      method: 'POST', headers, body: form(image)
    })));
    for (const response of results) assert.equal(response.status, 201, await response.text());
    const cards = await (await fetch(base + '/cards.json')).json();
    assert.equal(cards.length, 2);
    assert.equal(new Set(cards).size, 2);
    for (const filename of cards) {
      assert.deepEqual(fs.readFileSync(path.join(fixture, 'public', 'img', 'tarjetas', filename)), image);
      assert.equal((await fetch(base + '/img/tarjetas/' + filename)).status, 200);
    }
    assert.equal((await fetch(base + '/api/cards', { method: 'POST', headers, body: form('not an image') })).status, 400);
    assert.equal((await fetch(base + '/api/cards', { method: 'POST', headers, body: form('text', 'text/plain') })).status, 400);
    assert.equal((await fetch(base + '/api/cards', { method: 'POST', headers, body: form(Buffer.alloc(10 * 1024 * 1024 + 1)) })).status, 413);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, 'cards.json'), 'utf8')).length, 2);
    assert.equal((await fetch(base + '/api/cards')).status, 401);
    assert.deepEqual(await (await fetch(base + '/api/cards', { headers })).json(), cards);
    const deleteURL = filename => base + '/api/cards/' + encodeURIComponent(filename);
    assert.equal((await fetch(deleteURL(cards[0]), { method: 'DELETE' })).status, 401);
    assert.equal((await fetch(deleteURL(cards[0]), { method: 'DELETE', headers: { ...headers, Origin: 'https://other.example' } })).status, 403);
    assert.equal((await fetch(deleteURL('..\\server.js'), { method: 'DELETE', headers })).status, 400);
    const orphan = path.join(fixture, 'public', 'img', 'tarjetas', 'orphan.png');
    fs.writeFileSync(orphan, image);
    assert.equal((await fetch(deleteURL('orphan.png'), { method: 'DELETE', headers })).status, 404);
    assert.equal(fs.existsSync(orphan), true);
    const concurrent = await Promise.all([
      fetch(deleteURL(cards[0]), { method: 'DELETE', headers }),
      fetch(base + '/api/cards', { method: 'POST', headers, body: form(image) })
    ]);
    assert.equal(concurrent[0].status, 200);
    assert.equal(concurrent[1].status, 201);
    assert.equal(fs.existsSync(path.join(fixture, 'public', 'img', 'tarjetas', cards[0])), false);
    const remaining = await (await fetch(base + '/api/cards', { headers })).json();
    assert.equal(remaining.length, 2);
    assert.equal(remaining.includes(cards[0]), false);
    assert.equal((await fetch(deleteURL(cards[0]), { method: 'DELETE', headers })).status, 404);
    // Una entrada obsoleta tambien se puede eliminar del manifiesto.
    fs.unlinkSync(path.join(fixture, 'public', 'img', 'tarjetas', remaining[0]));
    for (const name of remaining) assert.equal((await fetch(deleteURL(name), { method: 'DELETE', headers })).status, 200);
    assert.deepEqual(await (await fetch(base + '/cards.json')).json(), []);
    function batch(buffers) {
      const data = new FormData();
      buffers.forEach((buffer, index) => data.append('card', new Blob([buffer], { type: 'image/png' }), 'foto-' + index + '.png'));
      return data;
    }
    const savedFiles = () => fs.readdirSync(path.join(fixture, 'public', 'img', 'tarjetas')).sort();
    const beforeBatch = savedFiles();
    // Un archivo inválido rechaza todo el lote sin guardar fotos parciales.
    assert.equal((await fetch(base + '/api/cards', { method: 'POST', headers, body: batch([image, 'invalido']) })).status, 400);
    assert.deepEqual(savedFiles(), beforeBatch);
    assert.deepEqual(await (await fetch(base + '/cards.json')).json(), []);
    assert.equal((await fetch(base + '/api/cards', { method: 'POST', headers, body: batch(Array(21).fill(image)) })).status, 400);
    assert.deepEqual(savedFiles(), beforeBatch);
    const multi = await fetch(base + '/api/cards', { method: 'POST', headers, body: batch(Array(20).fill(image)) });
    assert.equal(multi.status, 201);
    const uploaded = await multi.json();
    assert.equal(uploaded.count, 20);
    assert.equal(new Set(uploaded.filenames).size, 20);
    assert.deepEqual(await (await fetch(base + '/cards.json')).json(), uploaded.filenames);
    for (const filename of uploaded.filenames) {
      assert.deepEqual(fs.readFileSync(path.join(fixture, 'public', 'img', 'tarjetas', filename)), image);
      assert.equal((await fetch(base + '/img/tarjetas/' + filename)).status, 200);
      assert.equal((await fetch(deleteURL(filename), { method: 'DELETE', headers })).status, 200);
    }
    assert.deepEqual(savedFiles(), beforeBatch);
    assert.deepEqual(await (await fetch(base + '/cards.json')).json(), []);
    // Un manifiesto dañado debe fallar solo en fotos, sin detener el juego.
    fs.writeFileSync(path.join(fixture, 'cards.json'), '{incorrecto');
    const broken = await fetch(base + '/api/cards', { headers });
    assert.equal(broken.status, 500);
    assert.match((await broken.json()).error, /galería/);
    assert.equal((await fetch(base + '/cards.json')).status, 500);
    assert.equal((await fetch(base + '/healthz')).status, 200);
    fs.writeFileSync(path.join(fixture, 'cards.json'), '[]');
    assert.deepEqual(await (await fetch(base + '/cards.json')).json(), []);
    assert.equal(fs.readdirSync(fixture).some(name => /\.(tmp|deleted)$/.test(name)), false);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    if (path.dirname(fixture) === root && path.basename(fixture).startsWith('.cards-test-')) {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
});
