# Tarjetas para invitados

Antes de iniciar el servidor, instala las dependencias del archivo de bloqueo:

`multer` ya está declarado en `package.json` y `package-lock.json`.

```powershell
npm.cmd ci
$env:UPLOAD_PASSWORD = 'elige-una-contrasena-privada'
npm.cmd start
```

Abre `http://localhost:3000/?upload=true` (tambien funciona `/upload`).
El navegador pedira usuario y contrasena: usuario `admin` y la contrasena que
configuraste en `UPLOAD_PASSWORD`. En la nube, configura esa variable en el
proveedor y usa HTTPS. Sin esa variable, el panel permanece cerrado.

El formulario acepta hasta 20 imágenes PNG, JPG, GIF o WebP por subida, de hasta
10 MB por imagen. Puedes seleccionarlas juntas desde el celular o la computadora.
El lote se valida antes de guardar: si algún archivo es inválido, no se guarda
ninguna foto. Si falla el guardado, se limpian los archivos de ese lote.
Debajo aparece **Galeria Actual**, con miniaturas y un boton **Eliminar** por
imagen. El boton pide confirmacion y borra tanto el archivo como su entrada en
`cards.json`. La galeria y el carrusel se actualizan en vivo, tambien si hay otro
panel abierto. Esta eliminacion no se puede deshacer.

La consulta privada `GET /api/cards` y el borrado `DELETE /api/cards/:filename`
usan el mismo usuario y contrasena del panel. No requieren dependencias nuevas.

Cada imagen recibe un nombre unico, se guarda en `public/img/tarjetas/` y se
agrega a `cards.json` en la raiz del proyecto. Los invitados reciben el aviso
por Socket.IO y actualizan su carrusel sin recargar.

Para preparar tarjetas manualmente, copia las imagenes a `public/img/tarjetas/`
y agrega sus nombres (sin carpetas) al arreglo de `cards.json`:

```json
["tarjeta-1.png", "tarjeta-2.jpg"]
```

El carrusel aparece debajo del tablero, con fundido y cambio cada 10 segundos.
Con una sola tarjeta queda fija; si la lista esta vacia, se oculta. Una tarjeta
inexistente se omite al siguiente cambio. Los cambios manuales del JSON se leen
al abrir o reconectar la vista; las subidas del formulario notifican de inmediato.

En Railway usa `npm start`, configura `UPLOAD_PASSWORD` y una sola instancia.
El servidor escucha en `0.0.0.0` y en el puerto de la variable `PORT` de Railway.
Las subidas funcionan en el disco temporal para el evento; pueden perderse al
reiniciar o desplegar. Si despues quieres conservarlas, monta almacenamiento
persistente para `public/img/tarjetas/` y `cards.json`. Esta version no comparte
archivos entre varias instancias. Las escrituras del manifiesto se serializan
para conservar varias subidas simultaneas y notificar solo cuando estan guardadas.

La respuesta de POST /api/cards incluye `filenames` (todos los nombres) y `count`.
Para una sola imagen también incluye `filename` por compatibilidad. Los archivos
se envían como campos repetidos `card` dentro de FormData.
