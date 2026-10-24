(() => {
  'use strict';
  const form = document.getElementById('cardUpload');
  const input = document.getElementById('card');
  const status = document.getElementById('uploadStatus');
  const button = form.querySelector('button[type="submit"]');
  const gallery = document.getElementById('cardGallery');
  const galleryStatus = document.getElementById('galleryStatus');
  const refresh = document.getElementById('refreshGallery');
  const deleting = new Set();
  let requestId = 0;

  async function api(url, options) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || (response.status === 401
      ? 'Tu acceso ha caducado. Recarga la página para ingresar de nuevo.' : 'No se pudo completar la operación. Intenta de nuevo.'));
    if (result === null) throw new Error('El servidor devolvió una respuesta inválida. Intenta de nuevo.');
    return result;
  }

  function feedback(node, message, error = false) {
    node.textContent = message;
    node.classList.toggle('is-error', error);
  }

  function fileLabel() {
    document.getElementById('fileName').textContent = input.files.length > 1
      ? input.files.length + ' fotos seleccionadas' : input.files[0]?.name || 'Ningún archivo seleccionado';
  }
  input.addEventListener('change', () => { fileLabel(); feedback(status, ''); });

  async function loadGallery() {
    const request = ++requestId;
    gallery.setAttribute('aria-busy', 'true');
    refresh.disabled = true;
    try {
      const cards = await api('/api/cards');
      if (request !== requestId) return;
      if (!Array.isArray(cards) || cards.some(name => typeof name !== 'string' ||
          /[\\/]/.test(name) || !/\.(png|jpe?g|gif|webp)$/i.test(name))) throw new Error('No se pudo leer la galería.');
      const fragment = document.createDocumentFragment();
      cards.forEach((filename, index) => {
        const card = document.createElement('figure');
        card.className = 'gallery-card';
        const image = document.createElement('img');
        image.src = '/img/tarjetas/' + encodeURIComponent(filename);
        image.alt = 'Tarjeta ' + (index + 1);
        image.loading = 'lazy';
        image.decoding = 'async';
        const caption = document.createElement('figcaption');
        const title = document.createElement('strong');
        title.textContent = 'Tarjeta ' + (index + 1);
        const name = document.createElement('span');
        name.className = 'gallery-filename';
        name.textContent = filename;
        name.title = filename;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'soft-btn gallery-delete';
        remove.textContent = deleting.has(filename) ? 'Eliminando…' : 'Eliminar';
        remove.setAttribute('aria-label', 'Eliminar tarjeta ' + (index + 1));
        remove.dataset.filename = filename;
        remove.disabled = deleting.has(filename);
        caption.append(title, name, remove);
        card.append(image, caption);
        fragment.append(card);
      });
      gallery.replaceChildren(fragment);
      document.getElementById('galleryCount').textContent = cards.length + (cards.length === 1 ? ' tarjeta en el carrusel' : ' tarjetas en el carrusel');
      document.getElementById('galleryEmpty').hidden = cards.length !== 0;
      if (galleryStatus.classList.contains('is-error')) feedback(galleryStatus, '');
    } catch (error) {
      if (request === requestId) feedback(galleryStatus, error.message, true);
    } finally {
      if (request === requestId) {
        gallery.setAttribute('aria-busy', 'false');
        refresh.disabled = false;
      }
    }
  }

  gallery.addEventListener('click', async event => {
    const remove = event.target.closest('button[data-filename]');
    if (!remove || remove.disabled) return;
    const filename = remove.dataset.filename;
    if (!window.confirm('¿Eliminar esta tarjeta de la galería y del carrusel de invitados? Esta acción no se puede deshacer.')) return;
    deleting.add(filename);
    remove.disabled = true;
    remove.textContent = 'Eliminando…';
    feedback(galleryStatus, 'Eliminando tarjeta…');
    try {
      await api('/api/cards/' + encodeURIComponent(filename), { method: 'DELETE' });
      feedback(galleryStatus, 'Tarjeta eliminada. El carrusel de invitados ya se actualizó.');
    } catch (error) {
      feedback(galleryStatus, error.message, true);
    } finally {
      deleting.delete(filename);
      await loadGallery();
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const files = Array.from(input.files);
    if (!files.length) return;
    if (files.length > 20) {
      feedback(status, 'Selecciona como máximo 20 imágenes por subida.', true);
      return;
    }
    if (files.some(file => file.size > 10 * 1024 * 1024)) {
      feedback(status, 'Cada imagen debe pesar como máximo 10 MB.', true);
      return;
    }
    button.disabled = true;
    feedback(status, 'Subiendo ' + files.length + (files.length === 1 ? ' foto…' : ' fotos…'));
    try {
      await api('/api/cards', { method: 'POST', body: new FormData(form) });
      form.reset();
      fileLabel();
      feedback(status, files.length === 1 ? '¡Foto subida! Ya está disponible en el carrusel de invitados.'
        : '¡' + files.length + ' fotos subidas! Ya están disponibles en el carrusel de invitados.');
      await loadGallery();
    } catch (error) {
      feedback(status, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  refresh.addEventListener('click', () => { feedback(galleryStatus, ''); loadGallery(); });
  if (typeof io === 'function') {
    const socket = io();
    socket.on('cards:updated', loadGallery);
    socket.on('connect', loadGallery);
    socket.on('connect_error', () => feedback(galleryStatus, 'Sin conexión en vivo. Puedes pulsar Actualizar para reintentar.', true));
  }
  loadGallery();
})();
