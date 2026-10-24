> Estado final de fotos (24 de octubre de 2026): subida múltiple habilitada, hasta 20 imágenes de 10 MB cada una. Pasaron las 11 pruebas automáticas y la prueba real en Edge de selección múltiple, galería, carrusel, borrado y funcionamiento del juego ante errores de fotos. El carrusel conserva el intervalo exacto de 10000 ms; el cambio visible se observó en 11045 ms en el navegador de prueba (incluye carga y comprobación). Solo después de pasar las pruebas se eliminaron las seis fotos de prueba del proyecto. cards.json quedó como [] y public/img/tarjetas/ contiene únicamente .gitkeep. Esta actualización sustituye las menciones históricas de conservación de fotos de este informe.

Archivos de esta actualización: cards.js, public/upload.html, public/js/upload.js, tests/cards.test.js, tests/browser-flow.cjs, TARJETAS.md, cards.json, AUDITORIA-LOCAL.md y la captura auditoria-viewer.png. La configuración de multer y POST /api/cards reside en cards.js, montado desde server.js; no fue necesario modificar server.js ni viewer.js (ya usa 10000 ms).

> Actualización: la configuración de 30 preguntas agrupadas descrita en este informe fue sustituida a petición del usuario. Ahora hay seis rondas, una pregunta por ronda (las primeras seis de preguntas.txt), total dinámico desde ROUNDS.length, x2 en la tercera y x3 en la sexta.

# Auditoría local — 24 de octubre de 2026

## Resultado

- Las 30 preguntas de `server.js` coinciden exactamente con `preguntas.txt`, incluidas sus 150 respuestas y puntos.
- Cada partida utiliza 30 preguntas: seis rondas de cinco preguntas. Ronda 3 x2; ronda 6 x3.
- El ganador se determina tras la pregunta 30. Se retiró el cierre anticipado a los 300 puntos para permitir jugar las seis rondas.
- El avance y retroceso guardan el tablero de cada pregunta, sus puntos, equis e historial, sin duplicar premios.
- `multer` ya estaba en `dependencies` y en el archivo de bloqueo: no se modificaron `package.json` ni `package-lock.json`.
- El servidor ahora sirve `public/upload.html`; la ruta anterior apuntaba a un archivo inexistente en la raíz.
- Las rutas POST/GET/DELETE `/api/cards` están en `cards.js`, montado desde `server.js`. Conservan autenticación, validación de imágenes, límite de 10 MB y escrituras serializadas.
- Un `cards.json` inválido devuelve un error JSON en las consultas de fotos y no impide iniciar o continuar el juego.
- El formulario y la galería manejan respuestas inválidas y errores, permiten reintentar y reciben actualizaciones por Socket.IO.
- El carrusel conserva el try/catch de carga y tolera que falte su contenedor, fotos borradas y almacenamiento del navegador bloqueado.

## Validación realizada

`node --test tests/game.test.js tests/cards.test.js`: **11 pruebas aprobadas**.

Prueba real con Playwright y Microsoft Edge, en una copia temporal del proyecto:

1. Abrir invitados y el formulario autenticado.
2. Subir una imagen mediante el formulario y verla en galería y carrusel sin recargar.
3. Borrar esa imagen mediante su botón y comprobar que desaparece de ambos.
4. Simular un error HTTP 500 en la carga de fotos de invitados.
5. Usar el panel de administrador para asignar equipo, revelar respuesta y avanzar; verificar banco y puntaje en invitados.
6. Volver a la pregunta anterior y avanzar de nuevo.
7. Simular un error en la galería, verificar el mensaje y recuperar la consulta.
8. Comprobar que no hubo errores JavaScript no controlados.

La captura final se guarda en `auditoria-viewer.png`. Las seis fotos originales y `cards.json` se conservaron.

## Archivos modificados

- `server.js`: 30 tableros agrupados en seis rondas; multiplicadores, estado, navegación y cierre al final.
- `cards.js`: ruta correcta del formulario y errores JSON de lectura sin derribar el servidor.
- `public/index.html`: botones de siguiente/anterior pregunta.
- `public/js/animator.js`: identificación de pregunta, indicador de ronda/pregunta y navegación.
- `public/js/viewer.js`: identificación de pregunta y protección del carrusel/almacenamiento.
- `public/js/upload.js`: validación de respuestas, manejo de fallos y recuperación de galería.
- `.env.example`: variable UPLOAD_PASSWORD documentada.
- `tests/game.test.js`: comparación exacta con preguntas.txt y partida completa con multiplicadores.
- `tests/cards.test.js`: fixture con formulario correcto y prueba de manifiesto inválido.
- `FUNCIONES-DEL-JUEGO.md`: reglas y controles actualizados; ejecución de prueba de navegador.
- `TARJETAS.md`: instalación reproducible mediante npm ci.

## Archivos creados

- `tests/browser-flow.cjs`: prueba real de navegador, opcional; requiere Playwright. Admite PLAYWRIGHT_MODULE y BROWSER_CHANNEL=msedge.
- `auditoria-viewer.png`: captura de verificación.
- `AUDITORIA-LOCAL.md`: este informe.

`public/upload.html` ya tenía el formulario, los identificadores y scripts correctos; no necesitó modificación.

## Inicio local

```powershell
npm.cmd ci
$env:UPLOAD_PASSWORD = 'tu-contrasena-privada'
npm.cmd start
```

- Administrador: http://localhost:3000/admin
- Invitados: http://localhost:3000/viewer
- Fotos: http://localhost:3000/upload (usuario admin, contraseña de UPLOAD_PASSWORD)

El servidor lee variables del entorno; no carga archivos .env automáticamente.
El estado de la partida se conserva en memoria y se reinicia al reiniciar el servidor.
Para conservar las fotos en la nube, el futuro despliegue necesita almacenamiento persistente y una sola instancia, como se explica en TARJETAS.md.
