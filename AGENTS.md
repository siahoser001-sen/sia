# AGENTS.md

Proyecto SIA (Sistema de Información Académica) — SENA. Backend Node/Express + MySQL 8, frontend HTML plano + JS vanilla.

## Estado del repo (léelo primero)
- `git ls-files` / el historial de `origin/main` NO representan la app actual: la mayor parte del sistema real está en archivos **sin commitear**. Lo que está trackeado es el estado viejo (invitaciones/autorización por correo); lo importante vive en archivos untracked (matrícula por código, materias por curso, plan de evaluación, boletines PDF, calendario, comunicados, llamadas/pizarrón, etc.). No asumas que algo no existe porque no aparece en git.
- `docs/modulos/actualizaciones/ROADMAP.md` describe el diseño/estado por secciones pero **se ha desincronizado de la realidad repetidas veces**: antes de dar por bueno lo que diga (funciones, rutas, pantallas, marcas ✅), verifícalo con grep sobre el código real. `README.md` es solo el manual de instalación/arranque.
- Documentación estratégica (organizada bajo `docs/modulos/`): `docs/modulos/vision/VISION.md` (propósito y modelo pedagógico), `docs/modulos/actualizaciones/GUIA_DE_AVANCE.md` (fases/hitos/DoD y cómo documentar), y las specs de módulos en `docs/modulos/actualizaciones/*.md` (p. ej. `EVALUACIONES.md`) — leer/actualizar la del módulo en el que trabajes **antes** de codificar. La sección 0 de `docs/modulos/actualizaciones/ROADMAP.md` ("Plan estratégico") es la brújula actual.

## Ejecutar y verificar
- Preparación: `copy .env.example .env` (llenar MySQL, JWT, email), crear BD `sia_db` en MySQL, correr migraciones, `npm install`.
- `npm run dev` (nodemon) o `npm start`. **No hay tests, lint ni build**: la verificación es manual (navegador + MySQL Workbench). Las pruebas manuales end-to-end pendientes y sus credenciales están en `docs/verificacion/PRUEBAS_MANUALES.md`.
- El backend sirve el frontend en `http://localhost:3000/frontend/login.html` (la raíz `/` redirige ahí). Escucha en `0.0.0.0`; `CORS_ORIGIN` vacío = refleja cualquier origen (necesario para entrar desde el celular). No hace falta Live Server.

## Base de datos (MySQL, NO PostgreSQL)
- Driver `mysql2/promise`, pool en `src/config/db.js`. Placeholders `?` (no `$1`); las queries devuelven `[rows]`, no `.rows`. UUID: `CHAR(36) PRIMARY KEY DEFAULT (UUID())`.
- Migraciones = archivos numerados `database/NN_nombre.sql` (01→19) que se ejecutan **en orden**. Hoy las corriste a mano, pero ya hay runner: `npm run migrate` aplica desde código las pendientes (`database/NN_*.sql`) usando `mysql2` con `multipleStatements`, y `npm run migrate:seed` sirve la **primera vez** para marcar las 01→19 como ya aplicadas sin releerlas. Cambio de esquema → crear `database/20_...` y correr `npm run migrate`. `create-tables.js` SOLO crea las 2 tablas de sockets/pizarrón, no es un migrador general. Las 18 y 19 ya existen (usuarios de prueba y revocación de sesiones JWT).
- Transacciones: `pool.getConnection()` → `beginTransaction()`/`commit()` (nunca `pool.query('BEGIN')`).
- Los errores de FK/constraint de MySQL se traducen a mensajes amigables en español en los controllers — mantén ese patrón.

## Arquitectura
- `src/app.js` es el cableado: ahí se monta toda ruta bajo `/api/*` y se sirven `/frontend` y `/storage`. Desde un controller se emite por socket con `req.app.get('io')`.
- Frontend: una página `.html` por pantalla, cada una con su propio `<script>`. **Explicitamente NO React.** Cada página lee `sessionStorage.getItem('sia_token')` (ojo: es `sessionStorage`, no `localStorage` como dice el README) y hace fetch contra `window.location.origin` — nunca quemar `localhost:3000` en el frontend.
- Roles JWT: `superadmin | admin | docente | estudiante | acudiente`. "Director de curso" NO es un rol: es `grupos.director_id`, verificado por endpoint (ver `resumen.controller.js`, `calendario.controller.js`, `boletin.controller.js`).
- Auth por ruta: `authMiddleware` + `soloRoles(...)` (src/middleware/auth.middleware.js). Error global al final de `app.js` via `manejadorErrores.js`.
- Socket.io comparte el puerto HTTP; JWT va en `handshake.auth.token`. La autorización se revalida en el backend aunque el frontend oculte botones.

## Convenciones
- Todo en español: UI, respuestas `{ ok: true, mensaje: '...' }`, comentarios y commits (el historial va en español, sin prefijo `feat:`/`fix:`).
- Los controllers existentes usan try/catch propio; el código nuevo puede envolver en `src/utils/asyncHandler.js` (cae en el manejador de errores).
- Patrón de periodo activo: los endpoints de notas/resumen/plan-evaluación/boletín usan el periodo marcado `activo` de la institución si no reciben `periodo_id`, y filtran fallas por rango de fechas del periodo (asistencia/notas no siempre tienen `periodo_id`). Sigue ese patrón en funciones nuevas.
- `storage/` está en `.gitignore` (archivos subidos, PDFs de boletines, comunicados) — se crea en runtime.

## Seguridad y sesiones
- JWT revocación: blacklist de `jti` en memoria (`src/utils/revocacion.js`) para logout puntual + columna `token_version` en `usuarios` para invalidar TODAS las sesiones al cambiar/recuperar contraseña. `auth.middleware.js` y el `io.use` de sockets validan ambos.
- Rate-limit por IP en login: `src/middleware/rateLimit.middleware.js` con `express-rate-limit`, configurable via `.env` (`RATE_LIMIT_LOGIN_WINDOW_MIN`, `RATE_LIMIT_LOGIN_MAX`). `TRUST_PROXY=1` solo si corre detrás de nginx/proxy.
- El bloqueo por cuenta (`intentos_fallidos`) es adicional al rate-limit por IP.

## Archivos huérfanos (sin enlazar)
- `frontend/llamadas-estudiante.html` — pantalla de videollamada; queda enlazada en `dashboard.html` y `mis-clases.html` (se completó su conexión).
- `frontend/pizarron.html` — tablero de videollamada; backend (sockets) listo y enlazado desde `mis-clases.html` (directores). ~~`admin-dashboard.html`~~ se eliminó el 2026-09-02 (era borrador viejo de `panel-admin.html`, nadie lo enlazaba).