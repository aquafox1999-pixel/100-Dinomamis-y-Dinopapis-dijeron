'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function setupCards(app, io) {
  const directory = path.join(__dirname, 'public', 'img', 'tarjetas');
  const manifest = path.join(__dirname, 'cards.json');
  let pendingWrite = Promise.resolve();
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, '[]\n');

  function readCards() {
    const cards = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(cards) || cards.some(name => typeof name !== 'string' ||
      /[\\/]/.test(name) || !/\.(png|jpe?g|gif|webp)$/i.test(name))) {
      throw new Error('cards.json debe contener un arreglo de nombres de imagen.');
    }
    return cards;
  }

  function authenticate(req, res, next) {
    res.set('Cache-Control', 'no-store');
    const password = process.env.UPLOAD_PASSWORD;
    if (!password) return res.status(503).send('Configura UPLOAD_PASSWORD para habilitar las subidas.');
    const authorization = req.get('authorization') || '';
    const credentials = authorization.startsWith('Basic ')
      ? Buffer.from(authorization.slice(6), 'base64').toString('utf8') : '';
    const expected = 'admin:' + password;
    const hash = value => crypto.createHash('sha256').update(value).digest();
    if (!crypto.timingSafeEqual(hash(credentials), hash(expected))) {
      res.set('WWW-Authenticate', 'Basic realm="Tarjetas", charset="UTF-8"');
      return res.status(401).send('Acceso privado.');
    }
    next();
  }

  function sameOrigin(req, res, next) {
    const origin = req.get('origin');
    const publicHost = (req.get('x-forwarded-host') || req.get('host')).split(',')[0].trim();
    const publicOrigin = req.protocol + '://' + publicHost;
    const configuredOrigin = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
    if (origin && origin !== publicOrigin && origin !== configuredOrigin) {
      return res.status(403).json({ error: 'Origen no permitido.' });
    }
    next();
  }

  app.get(['/upload', '/upload.html'], authenticate, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'upload.html'));
  });

  function listCards(req, res, next) {
    try {
      res.set('Cache-Control', 'no-store').json(readCards());
    } catch (error) {
      console.error('No se pudo leer la galería:', error.message);
      res.status(500).json({ error: 'No se pudo leer la galería. Intenta de nuevo.' });
    }
  }
  app.get('/cards.json', listCards);
  app.get('/api/cards', authenticate, listCards);

  app.delete('/api/cards/:filename', authenticate, sameOrigin, (req, res) => {
    const filename = req.params.filename;
    const destination = path.resolve(directory, filename);
    if (/[\\/:\x00-\x1f]/.test(filename) || path.dirname(destination) !== directory ||
        !/\.(png|jpe?g|gif|webp)$/i.test(filename)) {
      return res.status(400).json({ error: 'Nombre de imagen no permitido.' });
    }
    pendingWrite = pendingWrite.then(async () => {
      const temporary = manifest + '.' + crypto.randomUUID() + '.tmp';
      const backup = manifest + '.' + crypto.randomUUID() + '.deleted';
      let moved = false;
      try {
        const cards = readCards();
        if (!cards.includes(filename)) return res.status(404).json({ error: 'La tarjeta ya no existe en el carrusel.' });
        const remaining = cards.filter(name => name !== filename);
        await fs.promises.writeFile(temporary, JSON.stringify(remaining, null, 2) + '\n', { flag: 'wx' });
        try {
          await fs.promises.rename(destination, backup);
          moved = true;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await fs.promises.rename(temporary, manifest);
      } catch (error) {
        if (moved) await fs.promises.rename(backup, destination).catch(restoreError => console.error('No se pudo restaurar la tarjeta:', restoreError.message));
        await fs.promises.unlink(temporary).catch(() => {});
        console.error('No se pudo eliminar la tarjeta:', error.message);
        return res.status(500).json({ error: 'No se pudo eliminar la tarjeta. Intenta de nuevo.' });
      }
      if (moved) await fs.promises.unlink(backup).catch(error => console.error('No se pudo limpiar el archivo temporal:', error.message));
      io.emit('cards:updated');
      res.json({ filename: filename, deleted: true });
    });
  });

  let upload;
  function receiveUpload(req, res, callback) {
    if (upload) return upload(req, res, callback);
    let multer;
    try {
      multer = require('multer');
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') return callback(error);
      return res.status(503).json({ error: 'Falta instalar multer. Ejecuta npm install multer y reinicia el servidor.' });
    }
    upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 20, fields: 0, parts: 21 },
      fileFilter(req, file, callback) {
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.mimetype)) {
          return callback(new Error('Solo se admiten imagenes PNG, JPG, GIF o WebP.'));
        }
        callback(null, true);
      }
    }).array('card', 20);
    upload(req, res, callback);
  }

  function imageExtension(buffer) {
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
    if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return '.jpg';
    if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return '.gif';
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
    return null;
  }

  app.post('/api/cards', authenticate, sameOrigin, (req, res) => {
    receiveUpload(req, res, error => {
      if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error:
        error.code === 'LIMIT_FILE_SIZE' ? 'Cada imagen debe pesar como máximo 10 MB.' :
          ['LIMIT_FILE_COUNT', 'LIMIT_PART_COUNT'].includes(error.code) ? 'Selecciona como máximo 20 imágenes por subida.' : error.message });
      if (!req.files || !req.files.length) return res.status(400).json({ error: 'Selecciona al menos una imagen.' });
      const files = req.files.map(file => ({ buffer: file.buffer, extension: imageExtension(file.buffer) }));
      if (files.some(file => !file.extension)) return res.status(400).json({ error: 'Uno de los archivos no contiene una imagen compatible. No se guardó ninguna imagen.' });
      files.forEach(file => { file.filename = crypto.randomUUID() + file.extension; });
      const filenames = files.map(file => file.filename);
      const temporary = manifest + '.' + crypto.randomUUID() + '.tmp';
      // Serializa las actualizaciones para conservar todas las subidas simultaneas.
      // El disco se escribe sin bloquear el reloj ni los eventos del juego.
      pendingWrite = pendingWrite.then(async () => {
        const written = [];
        try {
          const cards = readCards();
          for (const file of files) {
            const destination = path.join(directory, file.filename);
            // Registra también una escritura incompleta para limpiarla si falla el disco.
            written.push(destination);
            await fs.promises.writeFile(destination, file.buffer, { flag: 'wx' });
          }
          cards.push(...filenames);
          await fs.promises.writeFile(temporary, JSON.stringify(cards, null, 2) + '\n', { flag: 'wx' });
          await fs.promises.rename(temporary, manifest);
          io.emit('cards:updated');
          res.status(201).json({ filenames, count: filenames.length,
            ...(filenames.length === 1 ? { filename: filenames[0] } : {}) });
        } catch (saveError) {
          await Promise.all([...written, temporary].map(file => fs.promises.unlink(file).catch(() => {})));
          console.error('No se pudo guardar la tarjeta:', saveError.message);
          res.status(500).json({ error: 'No se pudieron guardar las imágenes. Intenta de nuevo.' });
        }
      });
    });
  });
};
